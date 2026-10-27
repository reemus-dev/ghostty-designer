//! The preview file and the engine that owns it.
//!
//! Ghostty loads the preview file through the include line, so writing it and
//! reloading the instances shows a draft live. [`Preview`] is the only writer.
//!
//! # Design
//!
//! - **Latest value.** [`Preview::apply`] and [`Preview::revert`] replace the
//!   wanted text in a `watch` channel and return at once. A worker task writes
//!   one text at a time, then takes the latest wanted one.
//!   A newer draft lets the current apply finish, so a colour drag shows a
//!   frame every validation. A revert scheduled after an apply drops it, even
//!   when a newer draft follows the revert before the worker looks:
//!   mid-validation, which kills its `+validate-config` child, or after it,
//!   before the write. So an apply is never written after a later revert.
//! - **Statuses.** Every [`Status`] carries the id the caller gave the text it
//!   describes, and the worker emits statuses in the order the texts were
//!   scheduled. An apply dropped for a revert reports nothing after
//!   `applying`. An apply written after a newer draft was scheduled reports
//!   under its own id, so the caller keeps only statuses of the id it last
//!   scheduled.
//! - **One at a time.** An apply's validation and write, and a
//!   [`Preview::without_preview`] read, run one at a time under an async
//!   mutex. A read therefore never sees the draft, and its restore never
//!   overwrites a newer write.
//! - **Shutdown barrier.** Every file write takes the one file mutex and
//!   checks the shutdown flag under it. [`Preview::clear_now`] and
//!   [`Preview::close`] set the flag and write the empty text in one critical
//!   section, so that write is the last one. A failed write returns its
//!   error, and a later call writes again. Neither waits for the async mutex,
//!   so a hung `+validate-config` or
//!   a hung read cannot delay shutdown. The worker holds the engine only to
//!   report and write, so an engine dropped without shutdown writes nothing
//!   more.
//! - **No colour replies.** While the engine runs, the file starts with
//!   [`SESSION_TEXT`], even with no draft. Only the shutdown write empties it.
//! - **Crash recovery.** A preview file at [`Preview::start`] that holds more
//!   than [`SESSION_TEXT`] is a stale draft from a crashed run, or the marker a
//!   preview-less read leaves while Ghostty still shows the draft. An empty
//!   file is a clean start. Either is reverted through the channel: write
//!   [`SESSION_TEXT`], reload, and reset zoom when the old text set a font size.
//! - **Zoom.** Ghostty applies a new `font-size` only to terminals not zoomed
//!   by hand (src/Surface.zig:1742-1756), so zoom resets whenever the last
//!   `font-size` of the written text changes: on an apply, a revert, at
//!   shutdown and in crash recovery.

use std::ffi::OsString;
use std::fs;
use std::io::{self, Write};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};

use tokio::sync::watch;

use crate::api::{PreviewState, PreviewStatus};
use crate::env::Env;
use crate::ghostty::{self, Ghostty};

// ─── Engine ───

/// An apply status of the text the caller scheduled with this id. None for
/// the engine's own reverts.
#[derive(Clone, Debug, PartialEq)]
pub struct Status {
    pub id: Option<String>,
    pub apply: PreviewStatus,
}

/// What the preview file starts with while the engine runs, draft or not.
//
// [UNTIL] The oldest Ghostty the designer supports includes the fix, released
// in 1.4.0. https://github.com/ghostty-org/ghostty/issues/14833
//
// Without this line a preview reload can freeze Ghostty 1.3.1 for good. Each
// terminal's termio thread is the only reader of a 64-message mailbox, yet
// handling a reload makes it send into that mailbox and wait for a free slot.
// Programs that subscribe to light/dark reports get one on every reload, and
// some answer with a burst of colour queries: Herdr sends 258, also on every
// resize. Each reply takes a mailbox slot. When a burst fills the mailbox while
// the thread handles a reload, the thread waits on itself. Its terminal stops,
// and the main thread blocks on the full mailbox next. With no colour replies,
// a burst takes no slots. Programs that ask for Ghostty's colours meanwhile get
// no answer and keep the colours they knew.
const SESSION_TEXT: &str = "osc-color-report-format = none\n";

/// Stands in for the preview text while a preview-less read runs. Ghostty
/// loads nothing from it, but a start after a crash sees a file to revert.
const HIDDEN: &str = "# ghostty-designer: hidden during a config read\n";

/// Owns the preview file. Its worker stops once it drops.
pub struct Preview(Arc<Shared>);

struct Shared {
    env: Env,
    ghostty: Ghostty,
    /// The latest wanted text. Generation 0 is the file as found.
    wanted: watch::Sender<Wanted>,
    /// The latest generation the worker finished with.
    done: watch::Sender<u64>,
    /// Applies and preview-less reads run one at a time.
    turn: Arc<tokio::sync::Mutex<()>>,
    /// Held across every write of the preview file. Never held across an await.
    file: Mutex<FileState>,
    on_status: Box<dyn Fn(Status) + Send + Sync>,
}

#[derive(Clone, Default)]
struct Wanted {
    generation: u64,
    /// The generation of the latest revert: every apply before it is dropped.
    last_revert: u64,
    id: Option<String>,
    text: String,
}

struct FileState {
    /// Set at shutdown: only the final, empty write follows it.
    shut_down: bool,
    /// Set once the final write cleared the file.
    cleared: bool,
    /// The last `font-size` of the text Ghostty last reloaded.
    font_size: Option<String>,
}

impl Preview {
    /// Starts the engine for `ghostty`'s preview file, and before returning
    /// writes [`SESSION_TEXT`] in place of what it finds. `on_status` runs on the
    /// worker, in the order the texts were scheduled.
    pub async fn start(
        env: Env,
        ghostty: Ghostty,
        on_status: impl Fn(Status) + Send + Sync + 'static,
    ) -> Preview {
        let stale = read_lossy(&ghostty.preview_path);
        let (wanted, receiver) = watch::channel(Wanted::default());
        let shared = Arc::new(Shared {
            env,
            ghostty,
            wanted,
            done: watch::Sender::new(0),
            turn: Arc::default(),
            file: Mutex::new(FileState {
                shut_down: false,
                cleared: false,
                font_size: last_font_size(&stale),
            }),
            on_status: Box::new(on_status),
        });
        let worker = Worker {
            env: shared.env.clone(),
            ghostty: shared.ghostty.clone(),
            turn: Arc::clone(&shared.turn),
            shared: Arc::downgrade(&shared),
        };
        tokio::spawn(worker.run(receiver));

        let preview = Preview(shared);
        if stale != SESSION_TEXT {
            preview.revert(None);
            preview.settled().await;
        }
        preview
    }

    /// Shows the text in every instance, after the current write. An empty
    /// text is a revert. Its statuses carry `id`.
    pub fn apply(&self, id: Option<String>, text: String) {
        self.0.wanted.send_modify(|wanted| {
            let generation = wanted.generation + 1;
            let last_revert = if text.is_empty() {
                generation
            } else {
                wanted.last_revert
            };
            *wanted = Wanted {
                generation,
                last_revert,
                id,
                text,
            };
        });
    }

    /// Clears the draft from the preview file, so instances show the saved
    /// config.
    pub fn revert(&self, id: Option<String>) {
        self.apply(id, String::new());
    }

    /// Runs the future `read` makes while the preview file shows no draft,
    /// without reloading, so Ghostty CLI commands that read the real config
    /// see it without the draft. Fails only when the file cannot be replaced.
    pub async fn without_preview<F: Future>(
        &self,
        read: impl FnOnce() -> F,
    ) -> io::Result<F::Output> {
        let _turn = self.0.turn.lock().await;
        let _hidden = Hidden::new(&self.0)?;
        Ok(read().await)
    }

    /// Shutdown: clears the preview for good, then reloads the instances and
    /// resets zoom if the preview set a font size. Never waits for an apply
    /// or a preview-less read.
    pub async fn close(&self) -> io::Result<()> {
        let Some(sized) = self.clear_for_good()? else {
            return Ok(());
        };
        let pids = ghostty::list_instances(&self.0.env).await;
        ghostty::reload(&pids);
        if sized {
            ghostty::reset_font_size(&self.0.env, &pids).await;
        }
        Ok(())
    }

    /// Shutdown without awaiting anything, for exit paths where the runtime
    /// may not run again: clears the preview for good and reloads `pids`.
    pub fn clear_now(&self, pids: &[u32]) -> io::Result<()> {
        if self.clear_for_good()?.is_some() {
            ghostty::reload(pids);
        }
        Ok(())
    }

    /// Sets the shutdown flag and writes the empty text as the last write.
    /// Some when this call cleared the file, true if the cleared preview set
    /// a font size. None once an earlier call cleared it.
    fn clear_for_good(&self) -> io::Result<Option<bool>> {
        // Overtakes an in-flight apply, so the worker drops it.
        self.revert(None);
        let mut file = self.0.file();
        file.shut_down = true;
        if file.cleared {
            return Ok(None);
        }
        let path = &self.0.ghostty.preview_path;
        if let Err(error) = replace_own_file(path, "") {
            // A missing or empty file shows nothing either, as in a read-only
            // folder, where no draft was ever written.
            if fs::metadata(path).is_ok_and(|meta| meta.len() > 0) {
                return Err(error);
            }
        }
        file.cleared = true;
        Ok(Some(file.font_size.take().is_some()))
    }

    /// Waits until the worker has finished with the latest wanted text.
    async fn settled(&self) {
        let target = self.0.wanted.borrow().generation;
        let mut done = self.0.done.subscribe();
        let _ = done.wait_for(|&done| done >= target).await;
    }
}

impl Shared {
    fn file(&self) -> MutexGuard<'_, FileState> {
        self.file.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn status(&self, wanted: &Wanted, apply: PreviewStatus) {
        let id = wanted.id.clone();
        (self.on_status)(Status { id, apply });
    }
}

/// Writes the latest wanted text, one at a time, until the engine drops. It
/// holds the engine only to report and to write, so it can validate without
/// keeping a dropped engine alive.
struct Worker {
    env: Env,
    ghostty: Ghostty,
    turn: Arc<tokio::sync::Mutex<()>>,
    shared: Weak<Shared>,
}

impl Worker {
    async fn run(self, mut wanted: watch::Receiver<Wanted>) {
        // Set when a newer text arrived during the last one: it is marked seen
        // but not written yet.
        let mut overtaken = false;
        loop {
            if !overtaken && wanted.changed().await.is_err() {
                return;
            }
            overtaken = false;
            let _turn = self.turn.lock().await;
            let next = wanted.borrow_and_update().clone();
            let Some(shared) = self.shared.upgrade() else {
                return;
            };
            if shared.file().shut_down {
                shared.done.send_replace(next.generation);
                continue;
            }
            shared.status(&next, status(PreviewState::Applying));
            drop(shared);

            let reverted =
                |wanted: &watch::Receiver<Wanted>| wanted.borrow().last_revert > next.generation;
            let check = check(&self.env, &self.ghostty, &next.text);
            tokio::pin!(check);
            let checked = loop {
                tokio::select! {
                    checked = &mut check => break Some(checked),
                    changed = wanted.changed() => {
                        if changed.is_err() {
                            return;
                        }
                        overtaken = true;
                        if reverted(&wanted) {
                            break None;
                        }
                    }
                }
            };
            let Some(checked) = checked.filter(|_| !reverted(&wanted)) else {
                overtaken = true;
                continue;
            };
            let Some(shared) = self.shared.upgrade() else {
                return;
            };
            match checked {
                Ok(checked) => shared.write_checked(&next, checked),
                Err(failed) => shared.status(&next, failed),
            }
            shared.done.send_replace(next.generation);
        }
    }
}

impl Shared {
    /// Writes a checked text unless the engine is shut down, reloads, and
    /// reports.
    fn write_checked(&self, next: &Wanted, checked: Checked) {
        let Checked {
            text,
            pids,
            error,
            rejected,
        } = checked;
        let font_size = last_font_size(&text);
        let shown = {
            let mut file = self.file();
            if file.shut_down {
                return;
            }
            let file_text = format!("{SESSION_TEXT}{text}");
            replace_own_file(&self.ghostty.preview_path, &file_text).map(|()| {
                ghostty::reload(&pids);
                std::mem::replace(&mut file.font_size, font_size.clone())
            })
        };
        let shown = match shown {
            Ok(shown) => shown,
            Err(error) => return self.status(next, failed(error.to_string())),
        };
        if shown != font_size {
            // Not awaited: the first Apple Event waits for the user's consent.
            let env = self.env.clone();
            tokio::spawn(async move { ghostty::reset_font_size(&env, &pids).await });
        }
        let apply = if error.is_empty() {
            status(if text.is_empty() {
                PreviewState::Idle
            } else {
                PreviewState::Applied
            })
        } else {
            PreviewStatus {
                rejected: Some(rejected),
                ..failed(error)
            }
        };
        self.status(next, apply);
    }
}

/// A text ready to write: what Ghostty accepts of it, and the instances to reload.
struct Checked {
    text: String,
    pids: Vec<u32>,
    /// Ghostty's complaints about the full text, or "".
    error: String,
    rejected: Vec<String>,
}

/// Validates a text. Ghostty names the key of each rejected line, so the
/// rest still previews.
async fn check(env: &Env, ghostty: &Ghostty, text: &str) -> Result<Checked, PreviewStatus> {
    let (error, pids) = tokio::join!(validate(env, ghostty, text), ghostty::list_instances(env));
    let error = error.map_err(|error| failed(error.to_string()))?;
    let rejected = rejected_keys(&error);
    let text = text
        .split('\n')
        .filter(|line| !rejected.iter().any(|key| key == setting_key(line)))
        .collect::<Vec<_>>()
        .join("\n");
    if !error.is_empty() {
        if rejected.is_empty() {
            return Err(failed(error));
        }
        let remaining = validate(env, ghostty, &text).await;
        if !remaining
            .map_err(|error| failed(error.to_string()))?
            .is_empty()
        {
            return Err(failed(error));
        }
    }
    Ok(Checked {
        text,
        pids,
        error,
        rejected,
    })
}

/// Ghostty's complaints about a config text, or "" when it is valid. An
/// invalid file would open macOS's Configuration Errors window on reload.
pub(crate) async fn validate(env: &Env, ghostty: &Ghostty, text: &str) -> io::Result<String> {
    // +validate-config fails on an empty file, which needs no check.
    if text.is_empty() {
        return Ok(String::new());
    }
    // Private, removed on drop even when a validation is cancelled, and never
    // through a symlink planted in a shared /tmp.
    let mut file = tempfile::Builder::new()
        .prefix("ghostty-designer-")
        .suffix(".conf")
        .tempfile_in(env.temp_dir())?;
    file.write_all(text.as_bytes())?;
    let mut arg = OsString::from("--config-file=");
    arg.push(file.path());
    let args = [OsString::from("+validate-config"), arg];
    let check = ghostty.run(env, args).await?;
    let output = if check.status.success() {
        ""
    } else if !check.stdout.is_empty() {
        &check.stdout
    } else {
        &check.stderr
    };
    Ok(output
        .trim()
        .lines()
        .map(without_location)
        .collect::<Vec<_>>()
        .join("\n"))
}

/// Strips the `<file>:<line>:` prefix of a `+validate-config` line: through
/// the first `:<digits>:`.
fn without_location(line: &str) -> &str {
    for (i, _) in line.match_indices(':') {
        let rest = &line[i + 1..];
        let digits = rest.len() - rest.trim_start_matches(|c: char| c.is_ascii_digit()).len();
        if digits > 0 && rest[digits..].starts_with(':') {
            return &rest[digits + 1..];
        }
    }
    line
}

/// The key each complaint names: `<key>: invalid value …`.
fn rejected_keys(error: &str) -> Vec<String> {
    error
        .lines()
        .filter_map(|line| {
            let line = line.trim_start();
            let key = line.trim_start_matches(|c: char| {
                c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'
            });
            let key = &line[..line.len() - key.len()];
            (!key.is_empty() && line[key.len()..].starts_with(':')).then(|| key.to_owned())
        })
        .collect()
}

fn setting_key(line: &str) -> &str {
    line.split(" = ").next().unwrap_or(line)
}

/// The last `font-size` a preview text sets.
fn last_font_size(text: &str) -> Option<String> {
    text.lines()
        .rev()
        .filter_map(|line| line.split_once(" = "))
        .find(|(key, _)| *key == "font-size")
        .map(|(_, value)| value.to_owned())
}

fn failed(error: String) -> PreviewStatus {
    PreviewStatus {
        error: Some(error),
        ..status(PreviewState::Error)
    }
}

fn status(state: PreviewState) -> PreviewStatus {
    PreviewStatus {
        state,
        error: None,
        rejected: None,
    }
}

// ─── Files ───

/// The preview text set aside while a preview-less read runs, with [`HIDDEN`]
/// in its place. Dropping it puts the text back unless the engine is shut
/// down, so a cancelled read restores too.
struct Hidden<'a> {
    shared: &'a Shared,
    text: String,
}

impl Hidden<'_> {
    fn new(shared: &Shared) -> io::Result<Hidden<'_>> {
        let file = shared.file();
        let path = &shared.ghostty.preview_path;
        let text = if file.shut_down {
            String::new()
        } else {
            read_lossy(path)
        };
        if !text.is_empty() {
            replace_own_file(path, HIDDEN)?;
        }
        Ok(Hidden { shared, text })
    }
}

impl Drop for Hidden<'_> {
    fn drop(&mut self) {
        if self.text.is_empty() {
            return;
        }
        let file = self.shared.file();
        if !file.shut_down {
            // A failure leaves the draft unshown until the next apply.
            let _ = replace_own_file(&self.shared.ghostty.preview_path, &self.text);
        }
    }
}

fn read_lossy(path: &Path) -> String {
    fs::read(path)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}

/// Replaces the file in one rename, so Ghostty never loads half a text.
/// Creates the folder, which a first run may lack. The temp file is new and
/// private, and the rename replaces a symlink rather than its target: right
/// for the preview file and the state files, which are the designer's own.
pub(crate) fn replace_own_file(path: &Path, text: &str) -> io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(dir)?;
    let mut temp = tempfile::NamedTempFile::new_in(dir)?;
    temp.write_all(text.as_bytes())?;
    temp.persist(path).map_err(|error| error.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::process::{Child, Command};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::Duration;

    use tokio::sync::oneshot;
    use tokio::time::sleep;

    use super::*;
    use crate::api::Platform;
    use crate::testkit::{Action, Behaviour, Delay, TestEnv};

    /// A `TestEnv` whose PATH starts with a fake osascript that logs the PIDs it
    /// gets. The real one would send Apple Events to the user's Ghostty.
    fn test_env() -> TestEnv {
        let mut t = TestEnv::default();
        let bin = t.root.join("bin");
        fs::create_dir(&bin).unwrap();
        let log = t.root.join("osascript.log");
        let script = format!(
            "#!/bin/sh\nfor arg; do last=$arg; done\necho \"$last\" >>'{}'\n",
            log.display()
        );
        fs::write(bin.join("osascript"), script).unwrap();
        fs::set_permissions(bin.join("osascript"), fs::Permissions::from_mode(0o755)).unwrap();
        let path = t.env.child_env.iter_mut().find(|(key, _)| key == "PATH");
        let path = &mut path.expect("TestEnv sets PATH").1;
        let mut joined = bin.into_os_string();
        joined.push(":");
        joined.push(&*path);
        *path = joined;
        t
    }

    /// The preview file while the engine runs and shows `draft`.
    fn session(draft: &str) -> String {
        format!("{SESSION_TEXT}{draft}")
    }

    fn preview_path(t: &TestEnv) -> PathBuf {
        t.root.join("xdg/ghostty/ghostty-designer.conf")
    }

    struct Rig {
        t: TestEnv,
        preview: Preview,
        statuses: Arc<Mutex<Vec<Status>>>,
        /// The id of the last text the test scheduled.
        ids: AtomicU32,
    }

    async fn rig(t: TestEnv) -> Rig {
        let ghostty = ghostty::detect(&t.env).await.unwrap();
        let statuses = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&statuses);
        let preview = Preview::start(t.env.clone(), ghostty, move |status| {
            record.lock().unwrap().push(status);
        })
        .await;
        Rig {
            t,
            preview,
            statuses,
            ids: AtomicU32::new(0),
        }
    }

    impl Rig {
        fn file(&self) -> String {
            fs::read_to_string(preview_path(&self.t)).unwrap()
        }

        /// Schedules the text of `pairs` under a new id, and returns the id.
        fn apply(&self, pairs: &[(&str, &str)]) -> String {
            let text = pairs
                .iter()
                .map(|(key, value)| format!("{key} = {value}\n"));
            let id = self.next_id();
            self.preview.apply(Some(id.clone()), text.collect());
            id
        }

        fn revert(&self) -> String {
            let id = self.next_id();
            self.preview.revert(Some(id.clone()));
            id
        }

        fn next_id(&self) -> String {
            (self.ids.fetch_add(1, Ordering::SeqCst) + 1).to_string()
        }

        /// How many zoom resets the fake osascript got.
        fn resets(&self) -> usize {
            let log = fs::read_to_string(self.t.root.join("osascript.log"));
            log.map_or(0, |log| log.lines().count())
        }

        fn statuses(&self) -> Vec<Status> {
            self.statuses.lock().unwrap().clone()
        }

        fn states(&self, id: Option<&str>) -> Vec<PreviewState> {
            let statuses = self.statuses().into_iter();
            statuses
                .filter(|status| status.id.as_deref() == id)
                .map(|status| status.apply.state)
                .collect()
        }

        async fn validation_started(&self, calls: usize) {
            let t = &self.t;
            eventually("a validation", || {
                t.ghostty.calls(Action::ValidateConfig).len() == calls
            })
            .await;
        }
    }

    async fn eventually(what: &str, mut ok: impl FnMut() -> bool) {
        for _ in 0..300 {
            if ok() {
                return;
            }
            sleep(Duration::from_millis(10)).await;
        }
        panic!("timed out waiting for {what}");
    }

    fn delayed(ms: u64) -> Behaviour {
        Behaviour {
            delay: Some(Delay::For(Duration::from_millis(ms))),
            ..Behaviour::default()
        }
    }

    /// A shell process posing as a Ghostty instance: it logs the preview file
    /// each time it gets SIGUSR2, as a reload reads it.
    struct FakeInstance {
        child: Child,
        log: PathBuf,
    }

    impl FakeInstance {
        fn spawn(t: &TestEnv) -> FakeInstance {
            let log = t.root.join("reloads.log");
            let ready = t.root.join("instance-ready");
            let script = format!(
                "trap 'cat \"{preview}\" >>\"{log}\"; echo -- >>\"{log}\"' USR2; touch '{ready}'; while :; do sleep 0.02; done",
                preview = preview_path(t).display(),
                log = log.display(),
                ready = ready.display(),
            );
            let child = Command::new("sh").args(["-c", &script]).spawn().unwrap();
            while !ready.exists() {
                std::thread::sleep(Duration::from_millis(10));
            }
            FakeInstance { child, log }
        }

        fn pid(&self) -> u32 {
            self.child.id()
        }

        /// What the preview file held at each reload.
        fn reloads(&self) -> Vec<String> {
            let log = fs::read_to_string(&self.log).unwrap_or_default();
            let mut reloads: Vec<_> = log.split("--\n").map(str::to_owned).collect();
            reloads.pop();
            reloads
        }
    }

    impl Drop for FakeInstance {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }

    /// Latest value.
    #[tokio::test]
    async fn an_apply_overtaken_by_a_revert_never_shows() {
        let t = test_env();
        t.ghostty.set(Action::ValidateConfig, Some(1), delayed(500));
        let r = rig(t).await;

        let applied = r.apply(&[("background", "#111111")]);
        r.validation_started(1).await;
        let reverted = r.revert();
        r.preview.settled().await;
        assert_eq!(r.file(), SESSION_TEXT);

        // Past the overtaken validation's delay.
        sleep(Duration::from_millis(700)).await;
        assert_eq!(r.file(), SESSION_TEXT);
        assert_eq!(r.states(Some(&applied)), [PreviewState::Applying]);
        assert_eq!(
            r.states(Some(&reverted)),
            [PreviewState::Applying, PreviewState::Idle]
        );
    }

    /// Statuses: they come in the order the texts were scheduled, and an
    /// apply written after a newer one was scheduled reports under its own id.
    #[tokio::test]
    async fn statuses_carry_the_id_of_their_text() {
        let t = test_env();
        t.ghostty.set(Action::ValidateConfig, Some(1), delayed(300));
        let rejecting = Behaviour {
            reject: vec!["font-size".into()],
            ..Behaviour::default()
        };
        t.ghostty.set(Action::ValidateConfig, Some(2), rejecting);
        let r = rig(t).await;

        let first = r.apply(&[("background", "#111111")]);
        r.validation_started(1).await;
        let second = r.apply(&[("background", "#222222"), ("font-size", "abc")]);
        r.preview.settled().await;

        let statuses = r.statuses();
        let ids: Vec<_> = statuses.iter().filter_map(|s| s.id.as_deref()).collect();
        assert_eq!(ids, [&first, &first, &second, &second]);
        assert_eq!(
            r.states(Some(&first)),
            [PreviewState::Applying, PreviewState::Applied]
        );
        let rejected = Status {
            id: Some(second),
            apply: PreviewStatus {
                rejected: Some(vec!["font-size".into()]),
                ..failed("font-size: invalid value \"abc\"".into())
            },
        };
        assert_eq!(statuses.last(), Some(&rejected));
        assert_eq!(r.file(), session("background = #222222\n"));
    }

    /// A drag schedules drafts faster than Ghostty validates them: each
    /// validation still ends in a write, and the last draft is written.
    #[tokio::test]
    async fn a_stream_of_drafts_keeps_landing() {
        let t = test_env();
        t.ghostty.set(Action::ValidateConfig, None, delayed(150));
        let r = rig(t).await;

        let mut last = String::new();
        for step in 0..30 {
            let colour = format!("#0000{step:02x}");
            last = r.apply(&[("background", &colour)]);
            sleep(Duration::from_millis(30)).await;
        }
        let applied = r.statuses().into_iter();
        let applied = applied.filter(|status| status.apply.state == PreviewState::Applied);
        assert!(applied.count() >= 2, "too few frames applied in the drag");

        r.preview.settled().await;
        assert_eq!(r.file(), session("background = #00001d\n"));
        assert_eq!(r.states(Some(&last)).last(), Some(&PreviewState::Applied));
    }

    /// One at a time: a preview-less read waits for an apply in flight, an
    /// apply waits for a read, and the read's restore never overwrites a
    /// newer text.
    #[tokio::test]
    async fn preview_less_reads_never_interleave_with_applies() {
        let t = test_env();
        t.ghostty.set(Action::ValidateConfig, Some(2), delayed(300));
        let r = rig(t).await;
        r.apply(&[("background", "#111111")]);
        r.preview.settled().await;

        let slow_read = || async {
            let before = r.file();
            sleep(Duration::from_millis(400)).await;
            (before, r.file())
        };
        let hidden = (HIDDEN.to_owned(), HIDDEN.to_owned());

        // An apply validating when the read is asked for.
        r.apply(&[("background", "#222222")]);
        r.validation_started(2).await;
        let seen = r.preview.without_preview(slow_read).await.unwrap();
        assert_eq!(seen, hidden);
        assert_eq!(r.file(), session("background = #222222\n"));

        // An apply asked for during the read.
        let (started, read_started) = oneshot::channel();
        let read = r.preview.without_preview(|| async {
            started.send(()).unwrap();
            slow_read().await
        });
        let edit = async {
            read_started.await.unwrap();
            r.apply(&[("background", "#333333")]);
        };
        let (seen, ()) = tokio::join!(read, edit);
        assert_eq!(seen.unwrap(), hidden);
        r.preview.settled().await;
        assert_eq!(r.file(), session("background = #333333\n"));
    }

    /// The shutdown barrier, through `close`: a hung validation cannot delay
    /// the empty write, and nothing writes after it.
    #[tokio::test]
    async fn a_hung_validation_cannot_delay_shutdown() {
        let mut t = test_env();
        let instance = FakeInstance::spawn(&t);
        t.env.target_pids = Some(vec![instance.pid()]);
        let hang = Behaviour {
            delay: Some(Delay::Hang),
            ..Behaviour::default()
        };
        t.ghostty.set(Action::ValidateConfig, None, hang);
        let r = rig(t).await;
        // The fake instance logs once for signals that arrive together.
        eventually("the start reload", || instance.reloads() == [SESSION_TEXT]).await;

        r.apply(&[("background", "#111111")]);
        r.validation_started(1).await;
        let closing = tokio::time::timeout(Duration::from_secs(2), r.preview.close());
        closing
            .await
            .expect("close waited for a hung validation")
            .unwrap();
        assert_eq!(r.file(), "");
        eventually("the reload", || instance.reloads() == [SESSION_TEXT, ""]).await;

        r.apply(&[("background", "#222222")]);
        sleep(Duration::from_millis(300)).await;
        assert_eq!(r.file(), "");
        assert_eq!(instance.reloads(), [SESSION_TEXT, ""]);
        assert_eq!(r.t.ghostty.calls(Action::ValidateConfig).len(), 1);
    }

    /// The shutdown barrier, through `clear_now`: a preview-less read cut
    /// short by shutdown does not restore the draft, and no later apply
    /// writes.
    #[tokio::test]
    async fn shutdown_during_a_preview_less_read_keeps_the_file_empty() {
        let r = rig(test_env()).await;
        r.apply(&[("background", "#111111")]);
        r.preview.settled().await;

        let (started, read_started) = oneshot::channel();
        let (release, released) = oneshot::channel::<()>();
        let read = r.preview.without_preview(|| async {
            started.send(()).unwrap();
            released.await.unwrap();
        });
        let exit = async {
            read_started.await.unwrap();
            r.preview.clear_now(&[]).unwrap();
            release.send(()).unwrap();
        };
        let (read, ()) = tokio::join!(read, exit);
        read.unwrap();
        assert_eq!(r.file(), "");

        r.apply(&[("background", "#222222")]);
        r.preview.settled().await;
        assert_eq!(r.file(), "");
    }

    /// Start, clean or after a crash: an empty file, a stale preview from a
    /// crashed run, or the marker of a read a crash cut short is replaced with
    /// the session text before the reload. Zoom resets when the stale preview
    /// set a font size.
    #[tokio::test]
    async fn start_writes_the_session_text_through_the_engine() {
        let found = [
            ("", 0),
            ("font-size = 15\nbackground = #111111\n", 1),
            (HIDDEN, 0),
        ];
        for (text, resets) in found {
            let mut t = test_env();
            fs::write(preview_path(&t), text).unwrap();
            let instance = FakeInstance::spawn(&t);
            t.env.target_pids = Some(vec![instance.pid()]);

            let r = rig(t).await;
            assert_eq!(r.file(), SESSION_TEXT);
            assert_eq!(r.states(None), [PreviewState::Applying, PreviewState::Idle]);
            eventually("the reload", || instance.reloads() == [SESSION_TEXT]).await;
            if r.t.env.platform == Platform::Macos {
                eventually("the zoom reset", || r.resets() == resets).await;
            }
        }
    }

    /// Latest value, when a newer draft follows the revert before the worker
    /// sees either: the apply before the revert is still never written.
    #[tokio::test]
    async fn an_apply_before_a_revert_and_a_newer_draft_never_shows() {
        let t = test_env();
        t.ghostty.set(Action::ValidateConfig, Some(1), delayed(300));
        let r = rig(t).await;

        let dropped = r.apply(&[("background", "#111111")]);
        r.validation_started(1).await;
        r.revert();
        r.apply(&[("background", "#222222")]);
        r.preview.settled().await;
        sleep(Duration::from_millis(400)).await;

        assert_eq!(r.states(Some(&dropped)), [PreviewState::Applying]);
        assert_eq!(r.file(), session("background = #222222\n"));
    }

    /// Zoom resets once the font size the preview shows changes, and at
    /// shutdown when the preview set one. A rejected font size is not shown.
    /// macOS only, like the reset.
    #[tokio::test]
    async fn zoom_resets_when_the_previewed_font_size_changes() {
        let mut t = test_env();
        if t.env.platform != Platform::Macos {
            return;
        }
        let instance = FakeInstance::spawn(&t);
        t.env.target_pids = Some(vec![instance.pid()]);
        let rejecting = Behaviour {
            reject: vec!["font-size".into()],
            ..Behaviour::default()
        };
        t.ghostty.set(Action::ValidateConfig, Some(1), rejecting);
        let r = rig(t).await;

        r.apply(&[("font-size", "abc"), ("background", "#111111")]);
        r.preview.settled().await;
        assert_eq!(r.file(), session("background = #111111\n"));
        r.apply(&[("font-size", "20")]);
        r.preview.settled().await;
        eventually("the zoom reset", || r.resets() == 1).await;
        r.apply(&[("font-size", "20"), ("background", "#111111")]);
        r.preview.settled().await;
        r.preview.close().await.unwrap();
        // close awaits its own reset; the apply that kept the size made none.
        assert_eq!(r.resets(), 2);
    }
}
