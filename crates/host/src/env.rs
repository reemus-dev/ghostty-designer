//! The process environment, read once at startup. Core modules take an `Env`
//! instead, so tests and sandboxes run without mutating global state.

use std::ffi::{CStr, OsStr, OsString};
use std::fs;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use crate::api::{PREVIEW_FILE_NAME, Platform};

pub(crate) const BUNDLE_ID: &str = "com.mitchellh.ghostty";

/// The config the designer edits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Config {
    /// Ghostty's own config.
    Ghostty,
    /// Another config file, which loads after Ghostty's main config files
    /// when it has Ghostty's config as its base.
    File { path: PathBuf, ghostty_base: bool },
}

struct KnownApp {
    name: &'static str,
    files: Vec<PathBuf>,
    /// Whether it loads Ghostty's config before its own file.
    ghostty_base: bool,
}

#[derive(Clone, Debug)]
pub struct Env {
    pub platform: Platform,
    pub config: Config,
    /// $HOME: `~/` includes and the XDG defaults.
    pub home: PathBuf,
    /// `CFFIXED_USER_HOME` or the passwd home: Application Support.
    user_home: PathBuf,
    xdg_config: PathBuf,
    /// The designer's own state folder.
    pub state_dir: PathBuf,
    /// Folders where installing or removing a font file changes the scan.
    pub font_dirs: Vec<PathBuf>,
    /// `GHOSTTY_DESIGNER_TARGET_PID`: the instances to reload instead of the
    /// running ones. `Some(empty)` means no targets.
    pub target_pids: Option<Vec<u32>>,
    /// `GHOSTTY_DESIGNER_GHOSTTY`: the Ghostty CLI to run instead of the
    /// installed one, so tests can run a fake and the scenarios a chosen CLI.
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
            config: Config::Ghostty,
            user_home: path("CFFIXED_USER_HOME")
                .or(passwd_home)
                .unwrap_or_else(|| home.clone()),
            xdg_config: path("XDG_CONFIG_HOME").unwrap_or_else(|| home.join(".config")),
            state_dir: path("XDG_STATE_HOME")
                .unwrap_or_else(|| home.join(".local/state"))
                .join("ghostty-designer"),
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

    /// Where the designer's temporary files go: `TMPDIR`, else `/tmp`.
    pub(crate) fn temp_dir(&self) -> PathBuf {
        self.child_env
            .iter()
            .find(|(key, value)| key == "TMPDIR" && !value.is_empty())
            .map_or_else(|| "/tmp".into(), |(_, value)| value.into())
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

    /// The files that load first, in load order, as they exist now. Their
    /// includes load after all of them.
    pub(crate) fn main_config_files(&self) -> Vec<PathBuf> {
        let (ghostty_base, file) = match &self.config {
            Config::Ghostty => (true, None),
            Config::File { path, ghostty_base } => (*ghostty_base, Some(path.clone())),
        };
        let mut files = if ghostty_base {
            self.ghostty_files()
        } else {
            Vec::new()
        };
        files.extend(file);
        once_each(files)
    }

    /// The main config files a save may write: Ghostty's, or the chosen file.
    pub(crate) fn writable_config_files(&self) -> Vec<PathBuf> {
        match &self.config {
            Config::Ghostty => self.main_config_files(),
            Config::File { path, .. } => once_each(vec![path.clone()]),
        }
    }

    /// Ghostty's main config files, in its load order.
    fn ghostty_files(&self) -> Vec<PathBuf> {
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
        files
    }

    /// Other apps built on libghostty with a config file of their own, in
    /// their default setup: the first candidate with content.
    /// - cmux: CmuxGhosttyConfigPathResolver.swift in manaflow-ai/cmux
    /// - Supacode: SupacodePaths.swift and GhosttyRuntime.swift in supabitapp/supacode
    /// - Ghostex: packages/paths/src/lib.rs and `runtime_config.rs` in maddada/Ghostex
    /// - agterm: ConfigPaths.swift and GhosttyApp.swift in umputun/agterm
    /// - macterm: Macterm/Config/MactermConfigFile.swift in thdxg/macterm
    fn known_apps(&self) -> [KnownApp; 5] {
        let cmux = self
            .user_home
            .join("Library/Application Support/com.cmuxterm.app");
        [
            KnownApp {
                name: "cmux",
                files: vec![cmux.join("config.ghostty"), cmux.join("config")],
                ghostty_base: true,
            },
            KnownApp {
                name: "Supacode",
                files: vec![self.xdg_config.join("supacode/config.ghostty")],
                ghostty_base: true,
            },
            KnownApp {
                name: "Ghostex",
                files: vec![self.xdg_config.join("ghostex/ghostty/config.ghostty")],
                ghostty_base: false,
            },
            KnownApp {
                name: "agterm",
                files: vec![self.home.join(".config/agterm/ghostty.conf")],
                ghostty_base: false,
            },
            KnownApp {
                name: "macterm",
                files: vec![self.home.join(".config/macterm/config.ghostty")],
                ghostty_base: true,
            },
        ]
    }

    /// Each known app's config file, when it has one.
    pub(crate) fn app_config_files(&self) -> Vec<(&'static str, PathBuf)> {
        self.known_apps()
            .into_iter()
            .filter_map(|app| Some((app.name, app.files.into_iter().find(|f| has_content(f))?)))
            .collect()
    }

    fn known_app(&self, path: &Path) -> Option<KnownApp> {
        self.known_apps()
            .into_iter()
            .find(|app| app.files.iter().any(|file| file == path))
    }

    /// The known app whose config file `path` is.
    pub(crate) fn app_of(&self, path: &Path) -> Option<&'static str> {
        self.known_app(path).map(|app| app.name)
    }

    /// Whether the file at `path` has Ghostty's config as its base, unless the
    /// user chose otherwise: as its known app does by default, else yes.
    pub(crate) fn default_ghostty_base(&self, path: &Path) -> bool {
        self.known_app(path).is_none_or(|app| app.ghostty_base)
    }

    /// The chosen file, or the file Ghostty opens for editing (`+edit-config`,
    /// Open Config): src/config/file_load.zig:96-121. On macOS, Application
    /// Support wins when it has content, then XDG, and with neither it is
    /// Application Support.
    pub(crate) fn config_to_write(&self) -> PathBuf {
        if let Config::File { path, .. } = &self.config {
            return path.clone();
        }
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

    /// A config file to edit, from a path the user gave: `~/` is the home
    /// folder, and a relative path starts from the working folder.
    pub fn config_file(&self, path: &Path) -> Result<PathBuf, String> {
        let path = match path.strip_prefix("~") {
            Ok(rest) => self.home.join(rest),
            Err(_) => path.to_owned(),
        };
        // The preview file goes beside the config, under this name.
        if path.file_name() == Some(PREVIEW_FILE_NAME.as_ref()) {
            return Err(format!(
                "{} is Ghostty Designer's preview file",
                path.display()
            ));
        }
        std::path::absolute(&path)
            .ok()
            .filter(|path| path.is_file())
            .ok_or_else(|| format!("{} is not a file", path.display()))
    }
}

/// The files that exist, each once. A file reached through several paths
/// (symlinks) counts at its last path: that one wins, and is the one
/// `config_to_write` picks.
fn once_each(files: Vec<PathBuf>) -> Vec<PathBuf> {
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
        ]);
        assert_eq!(env.xdg_config, Path::new("/h/.config"));
        assert_eq!(env.state_dir, Path::new("/h/.local/state/ghostty-designer"));
        assert_eq!(env.user_home, Path::new("/passwd"));
    }

    #[test]
    fn set_variables_win() {
        let env = env(&[
            ("HOME", "/h"),
            ("XDG_CONFIG_HOME", "/x"),
            ("XDG_STATE_HOME", "/s"),
            ("CFFIXED_USER_HOME", "/u"),
        ]);
        assert_eq!(env.xdg_config, Path::new("/x"));
        assert_eq!(env.state_dir, Path::new("/s/ghostty-designer"));
        assert_eq!(env.user_home, Path::new("/u"));
        assert_eq!(env.child_env.len(), 4);
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
}
