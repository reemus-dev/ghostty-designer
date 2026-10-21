//! How a launch reports back. From a terminal, the process re-executes itself
//! detached and waits for the copy's one-line report on a pipe, so the prompt
//! returns once the panel is usable. A desktop launch shows startup errors in
//! a dialog.

use std::fs::{self, File, OpenOptions, Permissions};
use std::io::{self, IsTerminal, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, RawFd};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock, PoisonError};
use std::thread;
use std::time::Duration;

/// Set by scripts that supervise the process, and on the detached copy.
const ATTACHED: &str = "GHOSTTY_DESIGNER_ATTACHED";
/// The descriptor of the detached copy's end of the report pipe.
const REPORT_FD: &str = "GHOSTTY_DESIGNER_REPORT_FD";
const WAIT_FOR: Duration = Duration::from_secs(20);

static PIPE: Mutex<Option<File>> = Mutex::new(None);
static REPORTED: AtomicBool = AtomicBool::new(false);
/// The state folder, once known, for `fail`'s log.
static STATE: OnceLock<PathBuf> = OnceLock::new();

/// Takes the report pipe from a waiting parent. Call first in `main`.
pub fn init() {
    let Some(fd) = std::env::var(REPORT_FD)
        .ok()
        .and_then(|fd| fd.parse::<RawFd>().ok())
    else {
        return;
    };
    // SAFETY: no other thread exists yet.
    unsafe { std::env::remove_var(REPORT_FD) };
    // Keeps child processes from holding the pipe open. Fails if the fd is
    // not open.
    // SAFETY: fcntl only reads and sets the descriptor's flags.
    if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } == -1 {
        return;
    }
    // SAFETY: the parent opened this descriptor for us alone.
    *PIPE.lock().unwrap_or_else(PoisonError::into_inner) = Some(unsafe { File::from_raw_fd(fd) });
}

/// Sets the state folder that holds the log.
pub fn use_state_dir(state: &Path) {
    let _ = STATE.set(state.to_owned());
}

fn attached() -> bool {
    std::env::var_os(ATTACHED).is_some_and(|value| value == "1")
}

/// Whether to run the window in a detached copy: a production build launched
/// from a terminal.
pub fn should_detach() -> bool {
    !cfg!(dev) && !attached() && io::stdin().is_terminal()
}

fn log_path(state: &Path) -> PathBuf {
    state.join("ghostty-designer.log")
}

/// Runs this command again detached, with output to the log, and exits with
/// its report.
pub fn detach(state: &Path) -> ! {
    let log = log_path(state);
    let spawned = (|| {
        fs::create_dir_all(state)?;
        // Keeps the previous run's log, which may hold its crash.
        let _ = fs::rename(&log, log.with_extension("log.1"));
        let file = OpenOptions::new()
            .append(true)
            .create(true)
            .mode(0o600)
            .open(&log)?;
        fs::set_permissions(&log, Permissions::from_mode(0o600))?;
        let (reader, writer) = io::pipe()?;
        let fd = writer.as_raw_fd();
        let mut command = Command::new(std::env::current_exe()?);
        command
            .args(std::env::args_os().skip(1))
            .env(ATTACHED, "1")
            .env(REPORT_FD, fd.to_string())
            .stdin(Stdio::null())
            .stdout(file.try_clone()?)
            .stderr(file);
        let detach = move || {
            // SAFETY: setsid takes no arguments.
            let session = unsafe { libc::setsid() };
            // SAFETY: fcntl only clears close-on-exec, so the copy inherits the pipe.
            if session == -1 || unsafe { libc::fcntl(fd, libc::F_SETFD, 0) } == -1 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        };
        // SAFETY: `detach` calls only setsid and fcntl, which are async-signal-safe.
        unsafe { command.pre_exec(detach) };
        command.spawn()?;
        io::Result::Ok(reader)
    })();
    let mut reader = match spawned {
        Ok(reader) => reader,
        Err(error) => fail(&format!("could not start the window: {error}")),
    };

    // The pipe closes once the copy reports or exits.
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut report = String::new();
        let _ = reader.read_to_string(&mut report);
        let _ = sender.send(report);
    });
    let see_log = format!("see {}", log.display());
    match receiver.recv_timeout(WAIT_FOR) {
        Ok(report) => match report.trim_end() {
            line @ ("ready" | "focused") => {
                outln!("{line}");
                std::process::exit(0);
            }
            line => match line.strip_prefix("error ") {
                Some(error) => errln!("ghostty-designer: {error}"),
                None => errln!("ghostty-designer: the window exited while starting; {see_log}"),
            },
        },
        Err(_) => errln!(
            "ghostty-designer: the window did not start within {} s; {see_log}",
            WAIT_FOR.as_secs()
        ),
    }
    std::process::exit(1);
}

/// Reports the launch result once: to the waiting terminal, or to stdout.
pub fn report(line: &str) {
    if REPORTED.swap(true, Ordering::SeqCst) {
        return;
    }
    match PIPE.lock().unwrap_or_else(PoisonError::into_inner).take() {
        Some(mut pipe) => drop(writeln!(pipe, "{line}")),
        None => outln!("{line}"),
    }
}

/// Shows a startup error and exits 1. The error goes to stderr, which is the
/// log in a detached copy, and to the waiting terminal. A desktop launch has
/// neither, so it also goes to the log and a dialog.
pub fn fail(message: &str) -> ! {
    errln!("ghostty-designer: {message}");
    if let Some(mut pipe) = PIPE.lock().unwrap_or_else(PoisonError::into_inner).take() {
        let _ = write!(pipe, "error {message}");
    } else if !attached() && !io::stdin().is_terminal() {
        if let Some(state) = STATE.get() {
            let _ = fs::create_dir_all(state).and_then(|()| {
                let mut log = OpenOptions::new()
                    .append(true)
                    .create(true)
                    .mode(0o600)
                    .open(log_path(state))?;
                writeln!(log, "ghostty-designer: {message}")
            });
        }
        dialog(message);
    }
    std::process::exit(1);
}

#[cfg(target_os = "macos")]
fn dialog(message: &str) {
    // osascript's own `display alert` needs no Apple Events consent.
    let _ = Command::new("osascript")
        .args([
            "-e",
            "on run argv",
            "-e",
            "display alert \"Ghostty Designer could not start\" message (item 1 of argv) as critical",
            "-e",
            "end run",
            message,
        ])
        .stdout(Stdio::null())
        .status();
}

#[cfg(target_os = "linux")]
fn dialog(message: &str) {
    use gtk::prelude::*;

    if gtk::init().is_err() {
        return;
    }
    let dialog = gtk::MessageDialog::new(
        None::<&gtk::Window>,
        gtk::DialogFlags::MODAL,
        gtk::MessageType::Error,
        gtk::ButtonsType::Close,
        "Ghostty Designer could not start",
    );
    dialog.set_secondary_text(Some(message));
    dialog.run();
}
