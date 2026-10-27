//! The installed Ghostty: detection, CLI actions, instances and reloads.

use std::ffi::OsStr;
use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::api::{Appearance, PREVIEW_FILE_NAME, Platform};
use crate::env::{BUNDLE_ID, Config, Env};

const MAC_APP_BIN: &str = "/Applications/Ghostty.app/Contents/MacOS/ghostty";
/// Kills a hung command, such as osascript waiting on the Apple Events consent prompt.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Debug)]
pub struct Ghostty {
    pub bin: PathBuf,
    pub version: String,
    /// The folder of Ghostty's bundled themes, when it has one.
    pub bundled_themes_dir: Option<PathBuf>,
    /// The edited config's main file, chosen at startup.
    pub config_path: PathBuf,
    /// The preview file, next to the main config.
    pub preview_path: PathBuf,
}

#[derive(Debug)]
pub struct CliOutput {
    pub status: ExitStatus,
    pub stdout: String,
    pub stderr: String,
}

pub async fn detect(env: &Env) -> Result<Ghostty, String> {
    let bin = find_binary(env).await?;
    let config_path = env.config_to_write();

    let (result, themes) = tokio::join!(
        run(env, &bin, ["+version"], COMMAND_TIMEOUT),
        run(
            env,
            &bin,
            ["+list-themes", "--path", "--plain"],
            COMMAND_TIMEOUT
        )
    );
    let result = result.map_err(|error| format!("cannot run {}: {error}", bin.display()))?;
    let version = parse_version(&result.stdout).ok_or_else(|| {
        format!(
            "cannot read the version of {}: {}",
            bin.display(),
            result.stderr
        )
    })?;

    Ok(Ghostty {
        version: version.to_owned(),
        bundled_themes_dir: themes
            .ok()
            .and_then(|themes| bundled_themes_dir(&themes.stdout)),
        preview_path: config_path.with_file_name(PREVIEW_FILE_NAME),
        config_path,
        bin,
    })
}

async fn find_binary(env: &Env) -> Result<PathBuf, String> {
    if let Some(bin) = &env.ghostty_bin {
        return Ok(bin.clone());
    }
    if env.platform == Platform::Macos {
        if Path::new(MAC_APP_BIN).exists() {
            return Ok(MAC_APP_BIN.into());
        }
        let query = format!("kMDItemCFBundleIdentifier == '{BUNDLE_ID}'");
        if let Ok(found) = run(env, Path::new("mdfind"), [query], COMMAND_TIMEOUT).await
            && found.status.success()
            && let Some(app) = found.stdout.split('\n').find(|line| !line.is_empty())
        {
            return Ok(Path::new(app).join("Contents/MacOS/ghostty"));
        }
    }
    let path = env.child_env.iter().find(|(key, _)| key == "PATH");
    std::env::split_paths(path.map_or(OsStr::new(""), |(_, value)| value))
        .map(|dir| dir.join("ghostty"))
        .find(|bin| {
            bin.metadata()
                .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        })
        .ok_or_else(|| "cannot find Ghostty: install it, or add it to your PATH".to_owned())
}

/// Ghostty finds its own resources, so the designer asks it instead of
/// repeating the lookup. A line of `+list-themes --path --plain`:
/// `0x96f (resources) /usr/share/ghostty/themes/0x96f`.
fn bundled_themes_dir(output: &str) -> Option<PathBuf> {
    output.lines().find_map(|line| {
        let (_, path) = line.split_once(" (resources) ")?;
        Path::new(path).parent().map(Path::to_owned)
    })
}

/// The version line of `ghostty +version`: `  - version: 1.4.0`.
fn parse_version(output: &str) -> Option<&str> {
    output
        .lines()
        .find_map(|line| line.trim_start().strip_prefix("- version: "))
        .and_then(|rest| rest.split(char::is_whitespace).next())
        .filter(|version| !version.is_empty())
}

/// `+show-config` of `files` and their includes, loaded in Ghostty's order.
/// The CLI reads only Ghostty's default files and takes no config flags
/// (src/cli/show_config.zig:62-68), so it runs with a temporary config folder
/// whose config includes `files`, and the user themes folder linked in.
/// `CFFIXED_USER_HOME` moves Application Support there too.
pub async fn show_config(env: &Env, ghostty: &Ghostty, files: &[PathBuf]) -> io::Result<CliOutput> {
    let dir = tempfile::Builder::new()
        .prefix("ghostty-designer-")
        .tempdir_in(env.temp_dir())?;
    let config_dir = dir.path().join("ghostty");
    fs::create_dir(&config_dir)?;
    std::os::unix::fs::symlink(env.user_themes_dir(), config_dir.join("themes"))?;
    let includes: Vec<_> = files
        .iter()
        .map(|file| format!("config-file = \"{}\"\n", file.display()))
        .collect();
    fs::write(config_dir.join("config.ghostty"), includes.concat())?;

    let mut shown = env.clone();
    for key in ["XDG_CONFIG_HOME", "CFFIXED_USER_HOME"] {
        shown.child_env.retain(|(name, _)| name != key);
        shown.child_env.push((key.into(), dir.path().into()));
    }
    let mut output = ghostty
        .run(&shown, ["+show-config", "--changes-only=false"])
        .await?;
    output.stdout = without_first_includes(&output.stdout, files.len());
    Ok(output)
}

/// `+show-config` output without its first `count` `config-file` values, the
/// temporary config's own. With none left the key shows empty, as Ghostty
/// shows a config without includes.
fn without_first_includes(shown: &str, count: usize) -> String {
    const KEY: &str = "config-file = ";
    let mut lines = Vec::new();
    let (mut dropped, mut kept, mut first) = (0, false, None);
    for line in shown.split_inclusive('\n') {
        if line.starts_with(KEY) {
            if dropped < count {
                dropped += 1;
                first.get_or_insert(lines.len());
                continue;
            }
            kept = true;
        }
        lines.push(line);
    }
    if !kept && let Some(at) = first {
        lines.insert(at, "config-file = \n");
    }
    lines.concat()
}

impl Ghostty {
    /// Runs a Ghostty CLI action.
    pub async fn run(
        &self,
        env: &Env,
        args: impl IntoIterator<Item = impl AsRef<OsStr>>,
    ) -> io::Result<CliOutput> {
        run(env, &self.bin, args, COMMAND_TIMEOUT).await
    }
}

/// Runs a command with the environment's variables, killing it after
/// `timeout` or when the future is dropped. Output goes through pipes because
/// the CLI truncates a stdout file when it finishes
/// (`cli/validate_config.zig:46`).
pub(crate) async fn run(
    env: &Env,
    bin: &Path,
    args: impl IntoIterator<Item = impl AsRef<OsStr>>,
    timeout: Duration,
) -> io::Result<CliOutput> {
    let mut child = Command::new(bin)
        .args(args)
        .env_clear()
        .envs(env.child_env.iter().map(|(key, value)| (key, value)))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let (Some(mut stdout), Some(mut stderr)) = (child.stdout.take(), child.stderr.take()) else {
        unreachable!("both are piped");
    };

    let finished = tokio::time::timeout(timeout, async {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let (read_out, read_err, status) = tokio::join!(
            stdout.read_to_end(&mut out),
            stderr.read_to_end(&mut err),
            child.wait()
        );
        read_out?;
        read_err?;
        Ok(CliOutput {
            status: status?,
            stdout: String::from_utf8_lossy(&out).into_owned(),
            stderr: String::from_utf8_lossy(&err).into_owned(),
        })
    })
    .await;
    match finished {
        Ok(result) => result,
        Err(_) => {
            // Kills and reaps it, so the PID is free once this returns.
            let _ = child.kill().await;
            Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!("{} timed out after {timeout:?}", bin.display()),
            ))
        }
    }
}

/// PIDs of running Ghostty GUI instances. Never includes a `ghostty +action`
/// CLI process: SIGUSR2's default action would kill it.
pub async fn list_instances(env: &Env) -> Vec<u32> {
    if let Some(pids) = &env.target_pids {
        return pids.clone();
    }
    // Ghostty does not load another file, and other apps may not reload on
    // SIGUSR2, whose default action ends a process.
    if env.config != Config::Ghostty {
        return Vec::new();
    }
    match env.platform {
        #[cfg(target_os = "macos")]
        Platform::Macos => running_apps(),
        // `pgrep` is looked up on the Env's PATH.
        _ => match run(
            env,
            Path::new("pgrep"),
            ["-a", "-x", "ghostty"],
            COMMAND_TIMEOUT,
        )
        .await
        {
            Ok(output) if output.status.success() => gui_pids(&output.stdout),
            _ => Vec::new(),
        },
    }
}

/// Registered apps only, so never a CLI process.
#[cfg(target_os = "macos")]
fn running_apps() -> Vec<u32> {
    use objc2_app_kit::NSRunningApplication;
    use objc2_foundation::NSString;

    objc2::rc::autoreleasepool(|_| {
        let id = NSString::from_str(BUNDLE_ID);
        NSRunningApplication::runningApplicationsWithBundleIdentifier(&id)
            .to_vec()
            .iter()
            // An app without a process reports -1.
            .filter_map(|app| u32::try_from(app.processIdentifier()).ok())
            .filter(|&pid| pid > 0)
            .collect()
    })
}

/// PIDs from `pgrep -a` lines (`<pid> <argv0> <args>...`), skipping
/// processes with a `+action` argument.
fn gui_pids(pgrep: &str) -> Vec<u32> {
    pgrep
        .split('\n')
        .filter_map(|line| {
            let mut words = line.split(' ');
            let pid = words.next()?;
            let mut args = words.skip(1);
            if args.any(|arg| arg.starts_with('+')) {
                return None;
            }
            pid.parse().ok().filter(|&pid| pid > 0)
        })
        .collect()
}

/// Reloads every file of each instance's config.
pub fn reload(pids: &[u32]) {
    // SIGUSR2 reloads on macOS (macos/Sources/App/macOS/AppDelegate.swift:547-550)
    // and GTK (src/apprt/gtk/class/application.zig:1486).
    for &pid in pids {
        // Only positive PIDs: kill(0) or a negative PID signals a process group.
        if let Ok(pid @ 1..) = libc::pid_t::try_from(pid) {
            // SAFETY: kill takes no pointers. A failure means the instance
            // exited since it was listed.
            unsafe { libc::kill(pid, libc::SIGUSR2) };
        }
    }
}

const RESET_FONT_SIZE_JXA: &str = r#"
function run(pids) {
  for (const pid of pids) {
    const app = Application(Number(pid));
    for (const terminal of app.terminals()) {
      app.performAction("reset_font_size", {on: terminal});
    }
  }
}
"#;

/// Sends `reset_font_size` to every terminal, so `font-size` from config
/// applies to surfaces zoomed by hand (src/Surface.zig:1742-1756). macOS only,
/// through Apple Events, which need the user's consent. `osascript` is looked
/// up on the Env's PATH.
pub async fn reset_font_size(env: &Env, pids: &[u32]) {
    if env.platform != Platform::Macos || pids.is_empty() {
        return;
    }
    let mut args = vec!["-l".to_owned(), "JavaScript".into(), "-e".into()];
    args.push(RESET_FONT_SIZE_JXA.into());
    args.extend(pids.iter().map(u32::to_string));
    // A failure, such as refused consent, leaves the terminals' zoom as it was.
    let _ = run(env, Path::new("osascript"), args, COMMAND_TIMEOUT).await;
}

/// The half of a light/dark theme pair shown first: the system's appearance.
/// Linux is always dark. `defaults` is looked up on the Env's PATH.
pub async fn system_appearance(env: &Env) -> Appearance {
    if env.platform != Platform::Macos {
        return Appearance::Dark;
    }
    let args = ["read", "-g", "AppleInterfaceStyle"];
    match run(env, Path::new("defaults"), args, COMMAND_TIMEOUT).await {
        Ok(output) if output.stdout.trim() == "Dark" => Appearance::Dark,
        _ => Appearance::Light,
    }
}

#[cfg(test)]
mod tests {
    use std::process::Command;
    use std::time::Instant;

    use super::*;
    use crate::testkit::{Action, Behaviour, Delay, TestEnv};

    #[tokio::test]
    async fn detects_the_fake() {
        let t = TestEnv::default();
        let ghostty = detect(&t.env).await.unwrap();
        let dir = t.root.join("xdg/ghostty");
        assert_eq!(ghostty.bin, t.ghostty.bin());
        assert_eq!(ghostty.version, "1.4.0");
        assert_eq!(ghostty.config_path, dir.join("config"));
        assert_eq!(ghostty.preview_path, dir.join("ghostty-designer.conf"));
    }

    #[tokio::test]
    async fn detect_reports_an_unreadable_version() {
        let t = TestEnv::default();
        let failing = Behaviour {
            stdout: Some("Ghostty\n".into()),
            stderr: Some("broken".into()),
            ..Behaviour::default()
        };
        t.ghostty.set(Action::Version, None, failing);
        let error = detect(&t.env).await.unwrap_err();
        assert!(error.ends_with(": broken"), "{error}");
    }

    #[tokio::test]
    async fn finds_ghostty_on_path() {
        let mut t = TestEnv::default();
        t.env.ghostty_bin = None;
        t.env.platform = Platform::Linux;
        let dir = t.ghostty.bin().parent().unwrap().to_owned();
        t.env.child_env.retain(|(key, _)| key != "PATH");
        t.env.child_env.push(("PATH".into(), dir.into()));
        assert_eq!(find_binary(&t.env).await, Ok(t.ghostty.bin()));

        t.env.child_env.pop();
        find_binary(&t.env).await.unwrap_err();
    }

    #[test]
    fn skips_cli_actions_in_pgrep_output() {
        let pgrep = "\
            1201 /usr/bin/ghostty --gtk-single-instance=true\n\
            1202 ghostty\n\
            1203 /usr/bin/ghostty +show-config --default --docs\n\
            1204 ghostty --font-size=12 +list-fonts\n";
        assert_eq!(gui_pids(pgrep), [1201, 1202]);
        assert_eq!(gui_pids(""), [] as [u32; 0]);
    }

    #[tokio::test]
    async fn run_kills_a_hung_child_at_the_timeout() {
        let t = TestEnv::default();
        let hang = Behaviour {
            delay: Some(Delay::Hang),
            ..Behaviour::default()
        };
        t.ghostty.set(Action::Version, None, hang);

        let start = Instant::now();
        let timeout = Duration::from_millis(300);
        let error = run(&t.env, &t.ghostty.bin(), ["+version"], timeout)
            .await
            .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(start.elapsed() < Duration::from_secs(5));

        let [pid] = t.ghostty.calls(Action::Version)[..] else {
            panic!("one call expected");
        };
        // SAFETY: kill takes no pointers, and signal 0 only checks the PID.
        let alive = unsafe { libc::kill(pid as libc::pid_t, 0) } == 0;
        assert!(!alive, "the hung child still runs");
    }

    /// A shell process posing as an instance, which exits with 7 on SIGUSR2
    /// once its trap is set.
    fn fake_instance(t: &TestEnv, name: &str) -> std::process::Child {
        let ready = t.root.join(format!("tmp/{name}"));
        let script = format!(
            "trap 'exit 7' USR2; touch '{}'; while :; do sleep 0.05; done",
            ready.display()
        );
        let child = Command::new("sh").args(["-c", &script]).spawn().unwrap();
        while !ready.exists() {
            std::thread::sleep(Duration::from_millis(10));
        }
        child
    }

    #[test]
    fn reload_signals_only_the_given_pids() {
        let t = TestEnv::default();
        let mut target = fake_instance(&t, "target");
        let mut other = fake_instance(&t, "other");

        reload(&[target.id()]);
        assert_eq!(target.wait().unwrap().code(), Some(7));
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(other.try_wait().unwrap(), None);
        other.kill().unwrap();
        other.wait().unwrap();
    }

    #[test]
    fn parses_the_version() {
        let output = include_str!("../tests/fixtures/ghostty-1.4.0/version.txt");
        assert_eq!(parse_version(output), Some("1.4.0"));
        assert_eq!(parse_version("  - version:  1.4.0"), None);
        assert_eq!(parse_version("Ghostty 1.4.0"), None);
    }
}
