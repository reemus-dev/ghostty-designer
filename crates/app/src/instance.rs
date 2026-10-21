//! One designer per state folder. The lock on `<state>/lock` decides the
//! owner, and the owner's socket accepts one message from later launches:
//! `focus`, optionally followed by an activation token, answered with `ok`.
//! Not `tauri-plugin-single-instance`: keyed by app id, it joins sandboxes to
//! the real designer, it runs after `gtk::init`, too late for a later launch
//! that must never start a `Host`, and it drops the Wayland activation token.

use std::fs::{self, DirBuilder, File, TryLockError};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{DirBuilderExt, MetadataExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

/// How long a later launch retries the socket while the owner starts.
const CONNECT_FOR: Duration = Duration::from_secs(5);
const MAX_MESSAGE: u64 = 4096;
/// `sun_path` holds 104 bytes on macOS, including the terminating NUL.
const MAX_SOCKET_PATH: usize = 103;

pub enum Claim {
    Owner(Owner),
    /// Another launch owns the state folder and has raised its window.
    Focused,
}

pub struct Owner {
    lock: File,
    listener: UnixListener,
}

/// Whether a designer holds the lock for `state` right now.
pub fn running(state: &Path) -> bool {
    File::open(state.join("lock"))
        .is_ok_and(|lock| matches!(lock.try_lock(), Err(TryLockError::WouldBlock)))
}

/// Takes the lock and the socket, or asks the owner to raise its window.
pub fn claim(state: &Path, runtime: &Path, token: Option<&str>) -> Result<Claim, String> {
    let socket = socket_path(state, runtime)?;
    fs::create_dir_all(state)
        .map_err(|error| format!("could not create {}: {error}", state.display()))?;
    let lock_path = state.join("lock");
    let lock = File::options()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock_path)
        .map_err(|error| format!("could not open {}: {error}", lock_path.display()))?;
    match lock.try_lock() {
        Ok(()) => {
            // Only a lock holder binds, so a file here is a dead owner's socket.
            match fs::remove_file(&socket) {
                Err(error) if error.kind() != io::ErrorKind::NotFound => {
                    return Err(format!("could not remove {}: {error}", socket.display()));
                }
                _ => {}
            }
            let listener = UnixListener::bind(&socket)
                .map_err(|error| format!("could not listen on {}: {error}", socket.display()))?;
            Ok(Claim::Owner(Owner { lock, listener }))
        }
        Err(TryLockError::WouldBlock) => {
            focus(&socket, token)?;
            Ok(Claim::Focused)
        }
        Err(TryLockError::Error(error)) => {
            Err(format!("could not lock {}: {error}", lock_path.display()))
        }
    }
}

impl Owner {
    /// Answers focus requests for the rest of the process. `on_focus` gets
    /// the activation token and returns once the window has been raised.
    pub fn serve(self, on_focus: impl Fn(Option<String>) + Send + 'static) {
        thread::spawn(move || {
            let _lock = self.lock;
            for stream in self.listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                if let Some(token) = read_request(&stream) {
                    on_focus(token);
                    let _ = stream.write_all(b"ok\n");
                }
            }
        });
    }
}

#[expect(
    clippy::option_option,
    reason = "None rejects the request; Some(None) is a focus request without a token"
)]
fn read_request(stream: &UnixStream) -> Option<Option<String>> {
    stream.set_read_timeout(Some(Duration::from_secs(1))).ok()?;
    let mut line = String::new();
    BufReader::new(stream.take(MAX_MESSAGE))
        .read_line(&mut line)
        .ok()?;
    let rest = line.strip_suffix('\n')?.strip_prefix("focus")?;
    match rest.strip_prefix(' ') {
        None if rest.is_empty() => Some(None),
        Some(token) if !token.is_empty() => Some(Some(token.to_owned())),
        _ => None,
    }
}

fn focus(socket: &Path, token: Option<&str>) -> Result<(), String> {
    let not_answering = |error: io::Error| {
        format!(
            "the running designer did not answer at {}: {error}",
            socket.display()
        )
    };
    let deadline = Instant::now() + CONNECT_FOR;
    let mut stream = loop {
        match UnixStream::connect(socket) {
            Ok(stream) => break stream,
            Err(_) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
            Err(error) => return Err(not_answering(error)),
        }
    };
    let message =
        match token.filter(|token| !token.is_empty() && !token.contains(char::is_whitespace)) {
            Some(token) => format!("focus {token}\n"),
            None => "focus\n".to_owned(),
        };
    stream
        .set_read_timeout(Some(CONNECT_FOR))
        .and_then(|()| stream.write_all(message.as_bytes()))
        .map_err(not_answering)?;
    let mut reply = String::new();
    BufReader::new(stream.take(8))
        .read_line(&mut reply)
        .map_err(not_answering)?;
    if reply == "ok\n" {
        Ok(())
    } else {
        Err(not_answering(io::ErrorKind::UnexpectedEof.into()))
    }
}

/// `<runtime>/gd-<hash of the state folder>.sock`. The hash is FNV-1a, so
/// every build agrees on the path.
fn socket_path(state: &Path, runtime: &Path) -> Result<PathBuf, String> {
    let hash = state
        .as_os_str()
        .as_bytes()
        .iter()
        .fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3)
        });
    let path = runtime.join(format!("gd-{:012x}.sock", hash >> 16));
    if path.as_os_str().len() > MAX_SOCKET_PATH {
        return Err(format!("the socket path {} is too long", path.display()));
    }
    Ok(path)
}

/// A per-user folder for the socket: `$XDG_RUNTIME_DIR` on Linux and
/// `$TMPDIR` on macOS, else a private folder under `/tmp`.
pub fn runtime_dir() -> Result<PathBuf, String> {
    let var = if cfg!(target_os = "macos") {
        "TMPDIR"
    } else {
        "XDG_RUNTIME_DIR"
    };
    if let Some(dir) = std::env::var_os(var).filter(|dir| !dir.is_empty()) {
        return Ok(dir.into());
    }
    // SAFETY: getuid cannot fail.
    let uid = unsafe { libc::getuid() };
    let dir = PathBuf::from(format!("/tmp/ghostty-designer-{uid}"));
    match DirBuilder::new().mode(0o700).create(&dir) {
        Err(error) if error.kind() != io::ErrorKind::AlreadyExists => {
            return Err(format!("could not create {}: {error}", dir.display()));
        }
        _ => {}
    }
    // Someone else may have made it first.
    let private = fs::symlink_metadata(&dir)
        .is_ok_and(|meta| meta.is_dir() && meta.uid() == uid && meta.mode() & 0o077 == 0);
    if !private {
        return Err(format!(
            "{} is not a private folder of this user",
            dir.display()
        ));
    }
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier, Mutex};

    use super::*;

    /// A state folder that doubles as the runtime folder.
    struct Dir(PathBuf);

    impl Dir {
        fn new(name: &str) -> Dir {
            let dir = std::env::temp_dir().join(format!("gd-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Dir(dir)
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Serves focus requests, recording each token before the reply.
    fn serve(owner: Owner) -> Arc<Mutex<Vec<Option<String>>>> {
        let focused = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&focused);
        owner.serve(move |token| record.lock().unwrap().push(token));
        focused
    }

    // Separate `File`s are separate open file descriptions, so their locks
    // conflict within one process as they do across processes.
    #[test]
    fn simultaneous_launches_give_one_owner_and_one_focus() {
        for round in 0..20 {
            let dir = Dir::new(&format!("race-{round}"));
            let barrier = Arc::new(Barrier::new(2));
            let launches: Vec<_> = (0..2)
                .map(|launch| {
                    let (dir, barrier) = (dir.0.clone(), Arc::clone(&barrier));
                    thread::spawn(move || {
                        barrier.wait();
                        let token = format!("token-{launch}");
                        match claim(&dir, &dir, Some(&token)).unwrap() {
                            Claim::Owner(owner) => Err(serve(owner)),
                            Claim::Focused => Ok(launch),
                        }
                    })
                })
                .collect();
            let results: Vec<_> = launches.into_iter().map(|l| l.join().unwrap()).collect();
            let focused: Vec<_> = results.iter().filter_map(|r| r.as_ref().ok()).collect();
            let owners: Vec<_> = results.iter().filter_map(|r| r.as_ref().err()).collect();
            assert_eq!((owners.len(), focused.len()), (1, 1), "round {round}");
            // The owner raised its window for that launch before it reported.
            assert_eq!(
                *owners[0].lock().unwrap(),
                [Some(format!("token-{}", focused[0]))]
            );
        }
    }

    #[test]
    fn replaces_a_dead_owners_socket() {
        let dir = Dir::new("stale");
        let socket = socket_path(&dir.0, &dir.0).unwrap();
        drop(UnixListener::bind(&socket).unwrap());
        assert!(socket.exists());

        let Claim::Owner(owner) = claim(&dir.0, &dir.0, None).unwrap() else {
            panic!("expected to own a state folder with a dead owner's socket");
        };
        let focused = serve(owner);
        assert!(matches!(
            claim(&dir.0, &dir.0, None).unwrap(),
            Claim::Focused
        ));
        assert_eq!(*focused.lock().unwrap(), [None]);
    }

    #[test]
    fn never_connects_to_a_socket_without_the_lock() {
        let dir = Dir::new("stranger");
        let socket = socket_path(&dir.0, &dir.0).unwrap();
        let stranger = UnixListener::bind(&socket).unwrap();
        stranger.set_nonblocking(true).unwrap();

        let Claim::Owner(owner) = claim(&dir.0, &dir.0, None).unwrap() else {
            panic!("expected to own a state folder nobody has locked");
        };
        let focused = serve(owner);
        assert!(matches!(
            claim(&dir.0, &dir.0, None).unwrap(),
            Claim::Focused
        ));
        assert_eq!(focused.lock().unwrap().len(), 1);
        assert_eq!(
            stranger.accept().unwrap_err().kind(),
            io::ErrorKind::WouldBlock
        );
    }

    #[test]
    fn ignores_anything_but_a_focus_request() {
        let dir = Dir::new("junk");
        let Claim::Owner(owner) = claim(&dir.0, &dir.0, None).unwrap() else {
            panic!("expected to own a fresh state folder");
        };
        let focused = serve(owner);
        let socket = socket_path(&dir.0, &dir.0).unwrap();
        for junk in ["quit\n", "focusx\n", "focus \n", "focus"] {
            let mut stream = UnixStream::connect(&socket).unwrap();
            stream.write_all(junk.as_bytes()).unwrap();
            stream.shutdown(std::net::Shutdown::Write).unwrap();
            let mut reply = String::new();
            stream.read_to_string(&mut reply).unwrap();
            assert_eq!(reply, "", "{junk:?}");
        }
        assert!(focused.lock().unwrap().is_empty());
    }
}
