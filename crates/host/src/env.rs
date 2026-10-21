//! The process environment, read once at startup. Core modules take an `Env`
//! instead, so tests and sandboxes run without mutating global state.

use std::ffi::{CStr, OsStr, OsString};
use std::fs;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use crate::api::Platform;

pub(crate) const BUNDLE_ID: &str = "com.mitchellh.ghostty";

#[derive(Clone, Debug)]
pub struct Env {
    pub platform: Platform,
    /// $HOME: `~/` includes and the XDG defaults.
    pub home: PathBuf,
    /// `CFFIXED_USER_HOME` or the passwd home: Application Support.
    user_home: PathBuf,
    xdg_config: PathBuf,
    /// The designer's own state folder.
    pub state_dir: PathBuf,
    /// `GHOSTTY_CONFIG_PATH`, which only the macOS app reads.
    config_path_override: Option<PathBuf>,
    /// `GHOSTTY_RESOURCES_DIR`.
    pub resources_dir: Option<PathBuf>,
    /// Folders where installing or removing a font file changes the scan.
    pub font_dirs: Vec<PathBuf>,
    /// `GHOSTTY_DESIGNER_TARGET_PID`: the instances to reload instead of the
    /// running ones. `Some(empty)` means no targets.
    pub target_pids: Option<Vec<u32>>,
    /// `GHOSTTY_DESIGNER_GHOSTTY`: the Ghostty CLI to run instead of the
    /// installed one, so sandboxes can run a fake.
    pub ghostty_bin: Option<PathBuf>,
    /// The environment Ghostty and osascript children run with.
    pub child_env: Vec<(OsString, OsString)>,
}

impl Env {
    pub fn from_process() -> Result<Env, String> {
        Env::from_vars(std::env::vars_os().collect(), passwd_home())
    }

    pub fn from_vars(
        vars: Vec<(OsString, OsString)>,
        passwd_home: Option<PathBuf>,
    ) -> Result<Env, String> {
        let get = |key: &str| vars.iter().find(|(k, _)| k == key).map(|(_, v)| v);
        // An empty value counts as unset, like `${VAR:-default}`.
        let path = |key: &str| get(key).filter(|v| !v.is_empty()).map(PathBuf::from);

        let home = path("HOME")
            .or_else(|| passwd_home.clone())
            .ok_or("cannot find the home folder: HOME is unset and the user has no passwd entry")?;
        let platform = if cfg!(target_os = "macos") {
            Platform::Macos
        } else {
            Platform::Linux
        };
        let font_dirs = match platform {
            Platform::Macos => vec![home.join("Library/Fonts"), "/Library/Fonts".into()],
            Platform::Linux => vec![
                home.join(".local/share/fonts"),
                home.join(".fonts"),
                "/usr/share/fonts".into(),
                "/usr/local/share/fonts".into(),
            ],
        };
        // Set but empty means no targets, never discovery. Only positive PIDs:
        // kill(0) would signal the designer's own process group.
        let target_pids = get("GHOSTTY_DESIGNER_TARGET_PID").map(|pids| {
            pids.to_string_lossy()
                .split(',')
                .filter_map(|pid| pid.trim().parse().ok())
                .filter(|&pid| pid > 0)
                .collect()
        });

        Ok(Env {
            platform,
            user_home: path("CFFIXED_USER_HOME")
                .or(passwd_home)
                .unwrap_or_else(|| home.clone()),
            xdg_config: path("XDG_CONFIG_HOME").unwrap_or_else(|| home.join(".config")),
            state_dir: path("XDG_STATE_HOME")
                .unwrap_or_else(|| home.join(".local/state"))
                .join("ghostty-designer"),
            config_path_override: path("GHOSTTY_CONFIG_PATH"),
            resources_dir: path("GHOSTTY_RESOURCES_DIR"),
            font_dirs,
            target_pids,
            ghostty_bin: path("GHOSTTY_DESIGNER_GHOSTTY"),
            home,
            child_env: vars,
        })
    }

    fn xdg_dir(&self) -> PathBuf {
        self.xdg_config.join("ghostty")
    }

    pub(crate) fn user_themes_dir(&self) -> PathBuf {
        self.xdg_dir().join("themes")
    }

    /// Ghostty resolves Application Support through `NSFileManager`
    /// (src/os/macos.zig:24-32), which follows `CFFIXED_USER_HOME` but not HOME.
    fn app_support_dir(&self) -> PathBuf {
        self.user_home
            .join("Library/Application Support")
            .join(BUNDLE_ID)
    }

    /// Main config files, in Ghostty's load order, as they exist now.
    pub(crate) fn main_config_files(&self) -> Vec<PathBuf> {
        // Load order: src/config/Config.zig:3994-4057.
        let mut files = vec![
            self.xdg_dir().join("config"),
            self.xdg_dir().join("config.ghostty"),
        ];
        if self.platform == Platform::Macos {
            let support = self.app_support_dir();
            files.push(support.join("config"));
            files.push(preferred_file(&support));
        }
        // A file reached through several paths (symlinks) counts once, at its
        // last path: that one wins, and is the one config_to_write picks.
        let existing: Vec<_> = files.into_iter().filter(|file| file.exists()).collect();
        let real: Vec<_> = existing
            .iter()
            .map(|file| fs::canonicalize(file).ok())
            .collect();
        existing
            .into_iter()
            .enumerate()
            .filter(|(i, _)| !real[i + 1..].contains(&real[*i]))
            .map(|(_, file)| file)
            .collect()
    }

    /// The file Ghostty opens for editing (`+edit-config`, Open Config):
    /// src/config/file_load.zig:96-121. On macOS, Application Support wins
    /// when it has content, then XDG, and with neither it is Application
    /// Support.
    pub(crate) fn config_to_write(&self) -> PathBuf {
        let xdg = preferred_file(&self.xdg_dir());
        if self.platform == Platform::Linux {
            return xdg;
        }
        let support = preferred_file(&self.app_support_dir());
        if has_content(&support) || !has_content(&xdg) {
            support
        } else {
            xdg
        }
    }

    /// The macOS app loads only `GHOSTTY_CONFIG_PATH` when it is set
    /// (macos/Sources/App/macOS/AppDelegate.swift:166), but the CLI, and so
    /// `+show-config`, ignores it. The designer reads and writes what the CLI
    /// loads, so it accepts the override only when it names that same file.
    pub(crate) fn check_config_override(&self, config_path: &Path) -> Result<(), String> {
        let Some(path) = &self.config_path_override else {
            return Ok(());
        };
        if self.platform != Platform::Macos {
            return Ok(());
        }
        let loaded = self.main_config_files();
        if std::path::absolute(path).is_ok_and(|path| path == config_path)
            && loaded.iter().all(|file| file == config_path)
        {
            return Ok(());
        }
        let reads = if loaded.is_empty() {
            config_path.display().to_string()
        } else {
            let names: Vec<_> = loaded
                .iter()
                .map(|file| file.display().to_string())
                .collect();
            names.join(", ")
        };
        Err(format!(
            "GHOSTTY_CONFIG_PATH={} is not supported: Ghostty's CLI reads {reads} instead. Unset it, or set it to {} with no other config file.",
            path.display(),
            config_path.display()
        ))
    }
}

/// Ghostty treats a missing, empty or non-regular file as absent
/// (src/config/file_load.zig:133-170).
fn has_content(file: &Path) -> bool {
    fs::metadata(file).is_ok_and(|meta| meta.is_file() && meta.len() > 0)
}

/// `config.ghostty`, else the legacy `config` if only it has content
/// (src/config/file_load.zig:29-50, 66-88).
fn preferred_file(dir: &Path) -> PathBuf {
    let current = dir.join("config.ghostty");
    let legacy = dir.join("config");
    if !has_content(&current) && has_content(&legacy) {
        legacy
    } else {
        current
    }
}

fn passwd_home() -> Option<PathBuf> {
    let mut buf = vec![0u8; 1024];
    loop {
        // SAFETY: passwd holds only integers and pointers, so all zeroes is valid.
        let mut passwd: libc::passwd = unsafe { std::mem::zeroed() };
        let mut result = std::ptr::null_mut();
        // SAFETY: getuid cannot fail and takes no arguments.
        let uid = unsafe { libc::getuid() };
        // SAFETY: getpwuid_r fills `passwd` with pointers into `buf`, which
        // outlives every read of them below.
        let code = unsafe {
            libc::getpwuid_r(
                uid,
                &raw mut passwd,
                buf.as_mut_ptr().cast(),
                buf.len(),
                &raw mut result,
            )
        };
        if code == libc::ERANGE {
            buf.resize(buf.len() * 2, 0);
            continue;
        }
        if code != 0 || result.is_null() || passwd.pw_dir.is_null() {
            return None;
        }
        // SAFETY: pw_dir is not null and points to a C string in `buf`.
        let dir = unsafe { CStr::from_ptr(passwd.pw_dir) };
        return Some(OsStr::from_bytes(dir.to_bytes()).into());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::TestEnv;

    fn env(vars: &[(&str, &str)]) -> Env {
        let vars = vars.iter().map(|(k, v)| (k.into(), v.into())).collect();
        Env::from_vars(vars, Some("/passwd".into())).unwrap()
    }

    #[test]
    fn target_pids() {
        assert_eq!(env(&[("HOME", "/h")]).target_pids, None);
        let pids =
            |value| env(&[("HOME", "/h"), ("GHOSTTY_DESIGNER_TARGET_PID", value)]).target_pids;
        assert_eq!(pids(""), Some(vec![]));
        assert_eq!(pids("12"), Some(vec![12]));
        assert_eq!(pids("12, 34,x,0,-5,"), Some(vec![12, 34]));
    }

    #[test]
    fn empty_variables_fall_back() {
        let env = env(&[
            ("HOME", "/h"),
            ("XDG_CONFIG_HOME", ""),
            ("XDG_STATE_HOME", ""),
            ("CFFIXED_USER_HOME", ""),
            ("GHOSTTY_CONFIG_PATH", ""),
        ]);
        assert_eq!(env.xdg_config, Path::new("/h/.config"));
        assert_eq!(env.state_dir, Path::new("/h/.local/state/ghostty-designer"));
        assert_eq!(env.user_home, Path::new("/passwd"));
        assert_eq!(env.config_path_override, None);
    }

    #[test]
    fn set_variables_win() {
        let env = env(&[
            ("HOME", "/h"),
            ("XDG_CONFIG_HOME", "/x"),
            ("XDG_STATE_HOME", "/s"),
            ("CFFIXED_USER_HOME", "/u"),
            ("GHOSTTY_RESOURCES_DIR", "/r"),
        ]);
        assert_eq!(env.xdg_config, Path::new("/x"));
        assert_eq!(env.state_dir, Path::new("/s/ghostty-designer"));
        assert_eq!(env.user_home, Path::new("/u"));
        assert_eq!(env.resources_dir.as_deref(), Some(Path::new("/r")));
        assert_eq!(env.child_env.len(), 5);
    }

    #[test]
    fn home_falls_back_to_passwd() {
        assert_eq!(env(&[]).home, Path::new("/passwd"));
        Env::from_vars(vec![], None).unwrap_err();
    }

    #[test]
    fn from_process_finds_a_home() {
        Env::from_process().unwrap();
        assert!(passwd_home().is_some());
    }

    /// The testkit's root on the given platform, with no config files yet.
    fn bare(platform: Platform) -> TestEnv {
        let mut t = TestEnv::default();
        t.env.platform = platform;
        fs::remove_file(t.root.join("xdg/ghostty/config")).unwrap();
        t
    }

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn derived_paths() {
        let t = bare(Platform::Linux);
        let xdg = t.root.join("xdg/ghostty");
        assert_eq!(t.env.user_themes_dir(), xdg.join("themes"));
        assert_eq!(t.env.config_to_write(), xdg.join("config.ghostty"));
        write(&xdg.join("config"), "font-size = 12\n");
        assert_eq!(t.env.config_to_write(), xdg.join("config"));
        write(&xdg.join("config.ghostty"), "font-size = 13\n");
        assert_eq!(t.env.config_to_write(), xdg.join("config.ghostty"));
    }

    #[test]
    fn macos_config_to_write() {
        let t = bare(Platform::Macos);
        let xdg = t.root.join("xdg/ghostty");
        let support = t
            .root
            .join("home/Library/Application Support/com.mitchellh.ghostty");
        assert_eq!(t.env.config_to_write(), support.join("config.ghostty"));
        write(&xdg.join("config"), "font-size = 12\n");
        assert_eq!(t.env.config_to_write(), xdg.join("config"));
        write(&support.join("config"), "font-size = 13\n");
        assert_eq!(t.env.config_to_write(), support.join("config"));
        assert_eq!(
            t.env.main_config_files(),
            [xdg.join("config"), support.join("config")]
        );
    }

    #[test]
    fn main_config_files_count_a_linked_file_once() {
        let t = bare(Platform::Linux);
        let xdg = t.root.join("xdg/ghostty");
        write(&xdg.join("config"), "font-size = 12\n");
        std::os::unix::fs::symlink(xdg.join("config"), xdg.join("config.ghostty")).unwrap();
        assert_eq!(t.env.main_config_files(), [xdg.join("config.ghostty")]);
    }

    #[test]
    fn config_override() {
        let mut t = TestEnv::default();
        let config = t.root.join("xdg/ghostty/config");
        assert_eq!(t.env.config_to_write(), config);
        assert_eq!(t.env.check_config_override(&config), Ok(()));

        t.env.config_path_override = Some(t.root.join("other"));
        t.env.platform = Platform::Linux;
        assert_eq!(t.env.check_config_override(&config), Ok(()));
        t.env.platform = Platform::Macos;
        let error = t.env.check_config_override(&config).unwrap_err();
        assert!(
            error.contains(&format!("reads {} instead", config.display())),
            "{error}"
        );

        t.env.config_path_override = Some(config.clone());
        let support = t
            .root
            .join("home/Library/Application Support/com.mitchellh.ghostty/config");
        write(&support, "");
        let error = t.env.check_config_override(&config).unwrap_err();
        assert!(
            error.contains(&format!(
                "reads {}, {} instead",
                config.display(),
                support.display()
            )),
            "{error}"
        );
    }
}
