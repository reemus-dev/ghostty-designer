//! The designer's native side: what the panel cannot do in a web page. It
//! reads and writes files, runs Ghostty, owns the preview file, and reports
//! changes on disk, Ghostty instances and fonts to the panel.
//!
//! # Design
//!
//! - **Commands.** A [`Command`] runs concurrently: the panel orders its own
//!   requests. An [`OrderedCommand`] returns at once, so it runs in the order
//!   it arrives. Writes to the user's files (a save, a restore, a new theme)
//!   run one at a time.
//! - **Config files only.** A save or a restore writes only the config path
//!   and the files the config loads at that moment, walked under the write
//!   lock. This guards against a panel bug, not a hostile page: config text
//!   can already run commands through Ghostty.
//! - **Messages.** The watchers, the instance poll, the font scan, the
//!   preview engine and the window's appearance report to the connected
//!   panel's channel. Without a panel their messages are dropped, and
//!   [`Host::connect`] returns what they reported.
//! - **Watches.** Each load of the config points its watch at the folders of
//!   the config files. The user themes folder and the font folders are
//!   watched from the start. Config and theme events settle for
//!   [`WATCH_DEBOUNCE`] before the panel hears of them, and font events for
//!   [`FONT_WATCH_SETTLE`] before a rescan.
//! - **Shutdown.** [`Host::close`] waits for a write in progress and refuses
//!   later ones, then clears the preview with its last, empty write.
//!   [`Host::clear_now`] clears it without awaiting, for exit paths where the
//!   runtime may not run again.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};
use std::time::Duration;

use notify::RecursiveMode;

use crate::api::{
    AppConfig, Command, CommandResult, ConfigChoice, ConfigFile, EditedConfig, Error, FontFamily,
    HostInfo, HostMessage, LoadedConfig, OrderedCommand, SaveEdit, SavedFiles, ThemeFile,
};
use crate::app_state;
use crate::config_file::load_config_set;
use crate::env::{Config, Env};
use crate::fonts::{FontIndex, FontScan};
use crate::ghostty::{self, Ghostty};
use crate::preview::{self, Preview};
use crate::save::{self, Content, FileEdit};
use crate::themes;
use crate::watch::{FolderWatch, canonical};

/// Receives every message for the panel, in order.
pub type Sink = Box<dyn Fn(HostMessage) + Send + Sync>;
type Log = Arc<dyn Fn(&str) + Send + Sync>;

/// Nothing announces a Ghostty launch or quit, so the instances are polled.
const INSTANCES_POLL: Duration = Duration::from_secs(10);
/// Editors write a file in several steps: report once they settle.
const WATCH_DEBOUNCE: Duration = Duration::from_millis(150);
/// Font installers copy several files: scan once they settle.
const FONT_WATCH_SETTLE: Duration = Duration::from_secs(1);
const STATE_FILE: &str = "state.json";

#[derive(Clone)]
pub struct Host(Arc<Shared>);

struct Shared {
    env: Env,
    ghostty: Ghostty,
    preview: Preview,
    defaults_with_docs: String,
    log: Log,
    panel: Arc<Panel>,
    font_scan: Arc<FontScan>,
    config_watch: FolderWatch,
    _themes_watch: FolderWatch,
    _font_watch: FolderWatch,
    /// The Ghostty instances last listed.
    pids: Mutex<Vec<u32>>,
    /// The files of the last `load_config`.
    loaded: Mutex<Vec<PathBuf>>,
    /// The panel's unsaved changes, for the close guard.
    changes: AtomicUsize,
    stash: Mutex<Option<String>>,
    /// Writes to the user's files run one at a time. True once closed.
    writes: tokio::sync::Mutex<bool>,
}

/// The connected panel, and the fonts the scan last reported.
#[derive(Default)]
struct Panel {
    sink: Mutex<Option<Sink>>,
    /// None until the first scan.
    fonts: Mutex<Option<Vec<FontFamily>>>,
}

impl Panel {
    fn send(&self, message: HostMessage) {
        if let Some(sink) = &*lock(&self.sink) {
            sink(message);
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn input(message: impl Into<String>) -> Error {
    Error::Input(message.into())
}

fn internal(error: impl ToString) -> Error {
    Error::Internal(error.to_string())
}

/// Runs file work on a blocking thread.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, Error> {
    tokio::task::spawn_blocking(work).await.map_err(internal)
}

impl Host {
    /// Detects Ghostty, clears a stale preview, reads Ghostty's defaults and
    /// docs, and starts the font scan and the instance poll. `log` receives
    /// what the user cannot act on in the panel. The error is for the user.
    pub async fn start(
        env: Env,
        log: impl Fn(&str) + Send + Sync + 'static,
    ) -> Result<Host, String> {
        let log: Log = Arc::new(log);
        let ghostty = ghostty::detect(&env).await?;
        for dir in save::unmoved_backups(&env.state_dir) {
            log(&format!(
                "a save left the previous versions of its files in {}",
                dir.display()
            ));
        }
        let panel = Arc::new(Panel::default());
        let to_panel = Arc::clone(&panel);
        let preview = Preview::start(env.clone(), ghostty.clone(), move |status| {
            if let Some(id) = status.id {
                let apply = status.apply;
                to_panel.send(HostMessage::PreviewStatus { id, apply });
            }
        })
        .await;
        let (defaults_with_docs, pids) =
            tokio::join!(read_defaults(&env, &ghostty), ghostty::list_instances(&env));
        let defaults_with_docs = defaults_with_docs?;

        let (to_panel, scan_log) = (Arc::clone(&panel), Arc::clone(&log));
        let font_scan = Arc::new(FontScan::start(
            env.clone(),
            ghostty.clone(),
            move |scanned| {
                let fonts = match scanned {
                    Ok(fonts) => fonts,
                    Err(error) => {
                        scan_log(&format!("cannot list the fonts: {error}"));
                        // The panel waits for each scan to end, so a failed
                        // one repeats the last list.
                        lock(&to_panel.fonts).clone().unwrap_or_default()
                    }
                };
                *lock(&to_panel.fonts) = Some(fonts.clone());
                to_panel.send(HostMessage::Fonts { fonts });
            },
        ));
        let scan = Arc::clone(&font_scan);
        let font_watch = FolderWatch::start(
            RecursiveMode::Recursive,
            FONT_WATCH_SETTLE,
            Arc::clone(&log),
            move || scan.rescan(),
        );
        // Linux creates ~/.local/share/fonts with the first user font.
        font_watch.watch(env.font_dirs.clone(), env.font_dirs.clone());
        let to_panel = Arc::clone(&panel);
        let themes_watch = FolderWatch::start(
            RecursiveMode::NonRecursive,
            WATCH_DEBOUNCE,
            Arc::clone(&log),
            move || to_panel.send(HostMessage::ThemesChanged),
        );
        let themes = vec![env.user_themes_dir()];
        themes_watch.watch(themes.clone(), themes);
        let to_panel = Arc::clone(&panel);
        let config_watch = FolderWatch::start(
            RecursiveMode::NonRecursive,
            WATCH_DEBOUNCE,
            Arc::clone(&log),
            move || to_panel.send(HostMessage::ConfigChanged),
        );

        let shared = Arc::new(Shared {
            env,
            ghostty,
            preview,
            defaults_with_docs,
            log,
            panel,
            font_scan,
            config_watch,
            _themes_watch: themes_watch,
            _font_watch: font_watch,
            pids: Mutex::new(pids),
            loaded: Mutex::default(),
            changes: AtomicUsize::new(0),
            stash: Mutex::default(),
            writes: tokio::sync::Mutex::new(false),
        });
        tokio::spawn(poll_instances(Arc::downgrade(&shared)));
        Ok(Host(shared))
    }

    /// Replaces the panel's channel, then returns what the panel starts from.
    pub fn connect(&self, sink: Sink) -> HostInfo {
        let host = &self.0;
        // Before the reads below, so no report falls between them.
        *lock(&host.panel.sink) = Some(sink);
        HostInfo {
            ghostty_version: host.ghostty.version.clone(),
            platform: host.env.platform,
            config_path: host.ghostty.config_path.display().to_string(),
            edited: match &host.env.config {
                Config::Ghostty => EditedConfig::Ghostty,
                Config::File { path, ghostty_base } => EditedConfig::File {
                    app: host.env.app_of(path).map(str::to_owned),
                    ghostty_base: *ghostty_base,
                },
            },
            defaults_with_docs: host.defaults_with_docs.clone(),
            fonts: lock(&host.panel.fonts).clone(),
            instances: u32::try_from(lock(&host.pids).len()).unwrap_or(u32::MAX),
            persisted: read_state(&host.env.state_dir.join(STATE_FILE), &*host.log),
            stash: lock(&host.stash).clone(),
        }
    }

    pub fn env(&self) -> &Env {
        &self.0.env
    }

    /// Ghostty's config, each known app's that exists, then the recent files.
    pub fn config_choices(&self) -> Vec<ConfigChoice> {
        let env = &self.0.env;
        let mut ghostty = env.clone();
        ghostty.config = Config::Ghostty;
        let path = |path: PathBuf| path.display().to_string();
        let apps = env
            .app_config_files()
            .into_iter()
            .map(|(app, file)| ConfigChoice::App {
                app: app.to_owned(),
                path: path(file),
            });
        let recent = app_state::recent(env)
            .into_iter()
            .map(|file| ConfigChoice::Recent { path: path(file) });
        std::iter::once(ConfigChoice::Ghostty {
            path: path(ghostty.config_to_write()),
        })
        .chain(apps)
        .chain(recent)
        .collect()
    }

    /// Runs a command.
    pub async fn run(&self, command: Command) -> Result<CommandResult, Error> {
        let host = &self.0;
        Ok(match command {
            Command::LoadConfig => CommandResult::LoadConfig(self.load_config().await?),
            Command::ShowConfig => CommandResult::ShowConfig(self.show_config().await?),
            Command::ValidateConfig { text } => CommandResult::ValidateConfig(
                preview::validate(&host.env, &host.ghostty, &text)
                    .await
                    .map_err(internal)?,
            ),
            Command::SystemAppearance => {
                CommandResult::SystemAppearance(ghostty::system_appearance(&host.env).await)
            }
            Command::LoadThemes => CommandResult::LoadThemes(self.load_themes().await?),
            Command::WriteTheme { name, text } => {
                CommandResult::WriteTheme(self.write_theme(name, text).await?)
            }
            Command::RenameTheme { name, to } => {
                CommandResult::RenameTheme(self.rename_theme(name, to).await?)
            }
            Command::DeleteTheme { name } => {
                self.delete_theme(name).await?;
                CommandResult::DeleteTheme
            }
            Command::ResetFontSize => {
                self.reset_font_size().await;
                CommandResult::ResetFontSize
            }
            Command::ApplySave { edits } => CommandResult::ApplySave(self.apply_save(edits).await?),
            Command::RestoreOriginal => {
                self.restore_original().await?;
                CommandResult::RestoreOriginal
            }
            Command::WriteState { text } => {
                self.write_state(text).await?;
                CommandResult::WriteState
            }
        })
    }

    /// Runs an ordered command.
    pub fn run_ordered(&self, command: OrderedCommand) {
        match command {
            OrderedCommand::PreviewApply { id, text } => self.0.preview.apply(Some(id), text),
            OrderedCommand::PreviewRevert { id } => self.0.preview.revert(Some(id)),
            OrderedCommand::ReportDraft { changes, stash } => self.report_draft(changes, stash),
            OrderedCommand::RescanFonts => self.0.font_scan.rescan(),
        }
    }

    /// Reads the config files Ghostty loads, and watches them.
    async fn load_config(&self) -> Result<LoadedConfig, Error> {
        let host = Arc::clone(&self.0);
        let loaded = blocking(move || {
            let set = load_config_set(
                &host.env.main_config_files(),
                &host.env.home,
                &host.ghostty.preview_path,
            )
            .map_err(|error| internal(format!("Could not read the config: {error}")))?;
            *lock(&host.loaded) = set.files.iter().map(|file| file.path.clone()).collect();
            let writable = host.config_files()?;
            let can_restore_original = save::has_original(&host.env.state_dir, &writable);
            let read_only = set
                .files
                .iter()
                .filter(|file| !writable.contains(&file.path))
                .map(|file| file.path.display().to_string())
                .collect();
            let files = set.files.into_iter().map(|file| ConfigFile {
                path: file.path.display().to_string(),
                text: file.text,
                utf8: file.utf8,
            });
            // Apps over Ghostty's config, which only inform the save review, so
            // an unreadable one is left out.
            let apps = match host.env.config {
                Config::Ghostty => host.env.app_config_files(),
                Config::File { .. } => Vec::new(),
            };
            let apps = apps
                .into_iter()
                .filter(|(_, path)| app_state::ghostty_base(&host.env, path))
                .filter_map(|(app, path)| {
                    let bytes = fs::read(&path).ok()?;
                    let file = ConfigFile {
                        path: path.display().to_string(),
                        utf8: std::str::from_utf8(&bytes).is_ok(),
                        text: String::from_utf8_lossy(&bytes).into_owned(),
                    };
                    Some(AppConfig {
                        app: app.into(),
                        file,
                    })
                });
            Ok(LoadedConfig {
                files: files.collect(),
                preview: set.preview,
                preview_cleared_by: set.preview_cleared_by,
                can_restore_original,
                read_only,
                apps: apps.collect(),
            })
        })
        .await??;
        self.0.watch_config();
        Ok(loaded)
    }

    /// The config as Ghostty shows it without the preview, which the config
    /// includes.
    async fn show_config(&self) -> Result<String, Error> {
        let host = &self.0;
        let files = host.env.main_config_files();
        let shown = host
            .preview
            .without_preview(|| ghostty::show_config(&host.env, &host.ghostty, &files))
            .await
            .map_err(|error| {
                internal(format!(
                    "Could not hide the preview to read your saved config: {error}"
                ))
            })?
            .map_err(|error| internal(format!("Could not run ghostty +show-config: {error}")))?;
        if !shown.status.success() {
            return Err(internal(format!(
                "ghostty +show-config failed: {}",
                shown.stderr
            )));
        }
        Ok(shown.stdout)
    }

    /// Reads the theme files.
    async fn load_themes(&self) -> Result<Vec<ThemeFile>, Error> {
        let host = &self.0;
        let user = host.env.user_themes_dir();
        let bundled = host.ghostty.bundled_themes_dir.clone().unwrap_or_default();
        blocking(move || themes::load_themes(&user, &bundled)).await
    }

    /// Writes a new user theme, or gives false when the name is taken.
    async fn write_theme(&self, name: String, text: String) -> Result<bool, Error> {
        let dir = self.0.env.user_themes_dir();
        self.write(move || save::write_theme(&dir, &name, &text))
            .await
    }

    async fn delete_theme(&self, name: String) -> Result<(), Error> {
        let dir = self.0.env.user_themes_dir();
        self.write(move || save::delete_theme(&dir, &name)).await
    }

    /// Renames a user theme, or gives false when the new name is taken.
    async fn rename_theme(&self, name: String, to: String) -> Result<bool, Error> {
        let dir = self.0.env.user_themes_dir();
        self.write(move || save::rename_theme(&dir, &name, &to))
            .await
    }

    /// Resets zoom in every instance.
    async fn reset_font_size(&self) {
        let env = &self.0.env;
        let pids = ghostty::list_instances(env).await;
        ghostty::reset_font_size(env, &pids).await;
    }

    /// Writes the edits after checking each file still holds its `before`.
    /// Only the config path and the files the config loads are writable.
    async fn apply_save(&self, edits: Vec<SaveEdit>) -> Result<SavedFiles, Error> {
        let host = Arc::clone(&self.0);
        self.write(move || {
            let writable = host.config_files()?;
            let edits = edits
                .into_iter()
                .map(|edit| {
                    let path = PathBuf::from(edit.path);
                    if !writable.contains(&path) {
                        return Err(input(format!(
                            "{} is not a loaded config file, so a save cannot write it",
                            path.display()
                        )));
                    }
                    Ok(FileEdit {
                        path,
                        before: edit.before,
                        after: Some(Content::Text(edit.after)),
                    })
                })
                .collect::<Result<Vec<_>, _>>()?;
            save::apply_save(&edits, &host.env.state_dir)
        })
        .await
    }

    /// Puts back the config files as they were before the first save.
    async fn restore_original(&self) -> Result<(), Error> {
        let host = Arc::clone(&self.0);
        self.write(move || {
            let scope = host.config_files()?;
            let state_dir = &host.env.state_dir;
            if !save::has_original(state_dir, &scope) {
                return Err(input("No original config was backed up"));
            }
            save::restore_original(state_dir, &scope)
        })
        .await
    }

    /// Replaces `state.json` in the state dir, which keeps the old file when
    /// the write fails.
    async fn write_state(&self, text: String) -> Result<(), Error> {
        let path = self.0.env.state_dir.join(STATE_FILE);
        blocking(move || {
            preview::replace_own_file(&path, &text)
                .map_err(|error| internal(format!("Could not write {}: {error}", path.display())))
        })
        .await?
    }

    /// The panel's unsaved changes and its stash.
    fn report_draft(&self, changes: usize, stash: String) {
        self.0.changes.store(changes, Ordering::SeqCst);
        *lock(&self.0.stash) = Some(stash);
    }

    /// The number of unsaved changes, for the close guard.
    pub fn changes(&self) -> usize {
        self.0.changes.load(Ordering::SeqCst)
    }

    /// Tells the panel the window's appearance changed.
    pub fn appearance_changed(&self) {
        self.0.panel.send(HostMessage::AppearanceChanged);
    }

    /// Tells the panel a later launch asked to edit a config file.
    pub fn switch_requested(&self) {
        self.0.panel.send(HostMessage::SwitchRequested);
    }

    /// The font faces of the latest scan, for `font://`.
    pub fn fonts(&self) -> FontIndex {
        self.0.font_scan.index()
    }

    /// Clears the preview for good without awaiting anything, so it reloads
    /// the instances from the last poll rather than listing them again.
    pub fn clear_now(&self) -> io::Result<()> {
        self.0.preview.clear_now(&lock(&self.0.pids))
    }

    /// The shutdown sequence: waits for a write in progress and refuses later
    /// ones, then clears the preview for good. Idempotent.
    pub async fn close(&self) -> io::Result<()> {
        *self.0.writes.lock().await = true;
        self.0.preview.close().await
    }

    /// Runs a write to the user's files on a blocking thread, after the one
    /// in progress.
    async fn write<T: Send + 'static>(
        &self,
        work: impl FnOnce() -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Error> {
        let closed = self.0.writes.lock().await;
        if *closed {
            return Err(input("Ghostty Designer is closing"));
        }
        blocking(work).await?
    }
}

impl Shared {
    /// The files a save or restore may write: the config path, and the files
    /// the writable main files load now.
    fn config_files(&self) -> Result<Vec<PathBuf>, Error> {
        let set = load_config_set(
            &self.env.writable_config_files(),
            &self.env.home,
            &self.ghostty.preview_path,
        )
        .map_err(|error| internal(format!("Could not read the config: {error}")))?;
        let config = self.ghostty.config_path.clone();
        Ok(std::iter::once(config)
            .chain(set.files.into_iter().map(|file| file.path))
            .collect())
    }

    /// The config path and the files of the last `load_config`.
    fn loaded_files(&self) -> Vec<PathBuf> {
        let config = self.ghostty.config_path.clone();
        std::iter::once(config)
            .chain(lock(&self.loaded).iter().cloned())
            .collect()
    }

    /// Watches the folders of the config files, because atomic saves replace
    /// the files themselves, and a symlinked file's target folder too, where
    /// dotfile tools edit it.
    fn watch_config(&self) {
        let files = self.loaded_files();
        let folders = files
            .iter()
            .flat_map(|file| [file.clone(), canonical(file)])
            .filter_map(|file| file.parent().map(Path::to_owned))
            .collect();
        self.config_watch.watch(folders, files);
    }
}

async fn read_defaults(env: &Env, ghostty: &Ghostty) -> Result<String, String> {
    let args = ["+show-config", "--default", "--docs"];
    let result = ghostty
        .run(env, args)
        .await
        .map_err(|error| format!("cannot run ghostty +show-config --default: {error}"))?;
    if !result.status.success() {
        return Err(format!(
            "ghostty +show-config --default failed: {}",
            result.stderr
        ));
    }
    Ok(result.stdout)
}

/// The panel's state file, None when missing. An unreadable file is logged
/// and read as None.
fn read_state(path: &Path, log: &dyn Fn(&str)) -> Option<String> {
    match fs::read_to_string(path) {
        Ok(text) => Some(text),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => {
            log(&format!("cannot read {}: {error}", path.display()));
            None
        }
    }
}

/// Reports the number of instances when it changes.
async fn poll_instances(host: Weak<Shared>) {
    loop {
        tokio::time::sleep(INSTANCES_POLL).await;
        let Some(host) = host.upgrade() else {
            return;
        };
        let pids = ghostty::list_instances(&host.env).await;
        let count = pids.len();
        let changed = std::mem::replace(&mut *lock(&host.pids), pids).len() != count;
        if changed {
            host.panel.send(HostMessage::Instances {
                count: u32::try_from(count).unwrap_or(u32::MAX),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::TestEnv;

    /// A save reaches only the config path and the files the config loads.
    #[tokio::test]
    async fn a_save_writes_only_config_files() {
        let t = TestEnv::default();
        let config = t.root.join("xdg/ghostty/config");
        let included = t.root.join("xdg/ghostty/colors");
        let outside = t.root.join("home/notes");
        let mut before = fs::read_to_string(&config).unwrap();
        before.push_str("config-file = colors\n");
        fs::write(&config, &before).unwrap();
        fs::write(&included, "keep\n").unwrap();
        fs::write(&outside, "keep\n").unwrap();
        let host = Host::start(t.env.clone(), |_| {}).await.unwrap();
        let edit = |path: &Path, before: Option<&str>| SaveEdit {
            path: path.display().to_string(),
            before: before.map(String::from),
            after: "font-size = 18\n".into(),
        };

        let error = host
            .apply_save(vec![
                edit(&config, Some(&before)),
                edit(&outside, Some("keep\n")),
            ])
            .await
            .unwrap_err();
        assert!(
            matches!(&error, Error::Input(message) if message.contains("notes")),
            "{error:?}"
        );
        assert_eq!(fs::read_to_string(&outside).unwrap(), "keep\n");
        assert_eq!(fs::read_to_string(&config).unwrap(), before);

        host.apply_save(vec![
            edit(&config, Some(&before)),
            edit(&included, Some("keep\n")),
        ])
        .await
        .unwrap();
        assert_eq!(fs::read_to_string(&config).unwrap(), "font-size = 18\n");
        assert_eq!(fs::read_to_string(&included).unwrap(), "font-size = 18\n");
        host.close().await.unwrap();
    }
}
