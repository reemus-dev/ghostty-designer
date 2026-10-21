//! The include walk: the config files Ghostty loads, in its order, as found
//! from their `config-file` lines.

use std::collections::HashSet;
use std::ffi::OsString;
use std::io;
use std::path::{Component, Path, PathBuf};

use crate::api::{IncludeReset, PreviewInclude};
use crate::watch::canonical;

/// A config file as read.
pub struct LoadedFile {
    pub path: PathBuf,
    /// Decoded as UTF-8, invalid bytes as U+FFFD, with its byte order mark.
    pub text: String,
    pub utf8: bool,
}

pub struct ConfigSet {
    /// The files that load, in Ghostty's order, without the preview file.
    pub files: Vec<LoadedFile>,
    pub preview: PreviewInclude,
    /// With the preview absent: the line that dropped its queued include.
    pub preview_cleared_by: Option<IncludeReset>,
}

/// Ghostty's `whitespace` (src/cli/args.zig:19).
fn trim_whitespace(s: &str) -> &str {
    s.trim_matches([' ', '\t'])
}

fn unquote(value: &str) -> &str {
    if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
        &value[1..value.len() - 1]
    } else {
        value
    }
}

/// The value of a `config-file` line, as Ghostty's `LineIterator` reads it
/// (src/cli/args.zig:1452-1484): no inline comments.
fn include_value(line: &str) -> Option<&str> {
    let entry = line.trim_matches([' ', '\t', '\r']);
    if entry.starts_with('#') {
        return None;
    }
    let (key, value) = entry.split_once('=')?;
    (trim_whitespace(key) == "config-file").then(|| unquote(trim_whitespace(value)))
}

/// Loads the main files, then their `config-file` includes breadth-first in one
/// queue, as Ghostty does (src/config/Config.zig:4197-4267). Missing files are
/// skipped and the include of `preview_path` is left out. `home` expands `~/`.
pub fn load_config_set(
    main_paths: &[PathBuf],
    home: &Path,
    preview_path: &Path,
) -> io::Result<ConfigSet> {
    let mut walk = Walk {
        home,
        preview_path: canonical(preview_path),
        files: Vec::new(),
        queue: Vec::new(),
        next: 0,
        preview: PreviewInclude::Absent,
        preview_cleared_by: None,
    };
    // Ghostty only dedupes includes, by their exact path text. Treating main
    // files as loaded too avoids loading a main file twice when an include
    // points back at it.
    let mut loaded: HashSet<OsString> = main_paths.iter().map(|p| p.clone().into()).collect();

    for main in main_paths {
        walk.load(main)?;
    }
    // Walks by index like Ghostty, so includes appended or a queue cleared
    // mid-walk behave alike.
    while let Some(include) = walk.queue.get(walk.next).cloned() {
        walk.next += 1;
        if !loaded.insert(include.clone().into()) {
            continue;
        }
        if walk.is_preview(&include) {
            walk.preview = PreviewInclude::Last;
        } else {
            walk.load(&include)?;
        }
    }
    let loads = walk.preview != PreviewInclude::Absent;
    Ok(ConfigSet {
        files: walk.files,
        preview: walk.preview,
        preview_cleared_by: walk.preview_cleared_by.filter(|_| !loads),
    })
}

struct Walk<'a> {
    home: &'a Path,
    preview_path: PathBuf,
    files: Vec<LoadedFile>,
    queue: Vec<PathBuf>,
    /// The index of the next include to walk.
    next: usize,
    preview: PreviewInclude,
    preview_cleared_by: Option<IncludeReset>,
}

impl Walk<'_> {
    fn is_preview(&self, include: &Path) -> bool {
        canonical(include) == self.preview_path
    }

    fn load(&mut self, path: &Path) -> io::Result<()> {
        if !path.is_file() {
            return Ok(());
        }
        let bytes = std::fs::read(path)?;
        let text = String::from_utf8_lossy(&bytes).into_owned();
        if self.preview == PreviewInclude::Last {
            self.preview = PreviewInclude::Shadowed;
        }
        let base = path.parent().unwrap_or(Path::new("/"));
        // Ghostty skips one leading BOM (src/config/Config.zig:3887-3895).
        let body = text.strip_prefix('\u{FEFF}').unwrap_or(&text);
        for (index, line) in body.split('\n').enumerate() {
            let Some(value) = include_value(line) else {
                continue;
            };
            // An empty value clears the queue (src/config/path.zig:362-366).
            if value.is_empty() {
                let unwalked = self.queue.get(self.next..).unwrap_or_default();
                if unwalked.iter().any(|include| self.is_preview(include)) {
                    self.preview_cleared_by = Some(IncludeReset {
                        path: path.display().to_string(),
                        line: index + 1,
                    });
                }
                self.queue.clear();
                continue;
            }
            if let Some(include) = resolve_include(value, base, self.home) {
                self.queue.push(include);
            }
        }
        self.files.push(LoadedFile {
            path: path.to_owned(),
            utf8: std::str::from_utf8(&bytes).is_ok(),
            text,
        });
        Ok(())
    }
}

/// Path rules from src/config/path.zig:60-76 and 146-232. None when Ghostty
/// blanks the path.
fn resolve_include(value: &str, base: &Path, home: &Path) -> Option<PathBuf> {
    let target = unquote(value.strip_prefix('?').unwrap_or(value));
    if target.is_empty() {
        return None;
    }
    // `~/` is joined as text, without normalising (src/os/homedir.zig:136-149).
    if let Some(rest) = target.strip_prefix('~')
        && rest.starts_with('/')
    {
        let mut path = home.as_os_str().to_owned();
        path.push(rest);
        return Some(path.into());
    }
    if target.starts_with('/') {
        return Some(target.into());
    }

    // Ghostty's realpath falls back to a lexical resolve only when the file
    // is missing. Any other error blanks the path.
    match std::fs::canonicalize(base.join(target)) {
        // Ghostty opens the path to resolve it, which fails with a slash after
        // a file. macOS realpath accepts it.
        Ok(path) if target.ends_with('/') && !path.is_dir() => None,
        Ok(path) => Some(path),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Some(resolve_lexically(base, target)),
        Err(_) => None,
    }
}

/// `std.fs.path.resolve` for an absolute base: ".." and "." fold away lexically.
fn resolve_lexically(base: &Path, target: &str) -> PathBuf {
    let mut out = PathBuf::from("/");
    for component in base.join(target).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::ParentDir => {
                out.pop();
            }
            Component::RootDir | Component::CurDir | Component::Prefix(_) => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::api::PREVIEW_FILE_NAME;
    use crate::testkit::TestEnv;

    /// Loads `config` from a folder of `files`, with `home/` as the home and
    /// the preview file beside `config`.
    fn load(files: &[(&str, &str)]) -> (PathBuf, ConfigSet) {
        let env = TestEnv::default();
        let dir = env.root.join("case");
        for (name, text) in files {
            let path = dir.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }
        let preview = dir.join(PREVIEW_FILE_NAME);
        let set = load_config_set(&[dir.join("config")], &dir.join("home"), &preview).unwrap();
        (dir, set)
    }

    /// Gives each loaded file's path relative to the folder, and the preview.
    fn walk(files: &[(&str, &str)]) -> (Vec<String>, PreviewInclude) {
        let (dir, set) = load(files);
        let loaded = set
            .files
            .iter()
            .map(|file| file.path.strip_prefix(&dir).unwrap().display().to_string())
            .collect();
        (loaded, set.preview)
    }

    #[test]
    fn walks_includes_as_ghostty_does() {
        use PreviewInclude::*;
        /// A name, the files, the files that load in order, and the preview.
        type Case<'a> = (
            &'a str,
            &'a [(&'a str, &'a str)],
            &'a [&'a str],
            PreviewInclude,
        );
        let cases: &[Case<'_>] = &[
            (
                "breadth-first: a file's includes queue after those already queued",
                &[
                    ("config", "config-file = a\nconfig-file = b\n"),
                    ("a", "config-file = c\n"),
                    ("b", ""),
                    ("c", ""),
                ],
                &["config", "a", "b", "c"],
                Absent,
            ),
            (
                "an include of a file already loaded, or of the main file, loads nothing",
                &[
                    ("config", "config-file = a\nconfig-file = sub/b\n"),
                    ("a", "config-file = config\n"),
                    ("sub/b", "config-file = ../a\n"),
                ],
                &["config", "a", "sub/b"],
                Absent,
            ),
            (
                "comments, quotes, CRLF, whitespace and a byte order mark",
                &[
                    (
                        "config",
                        "\u{FEFF}# config-file = x\n  config-file\t=  \"a\"  \r\nconfig-file = b # c\n",
                    ),
                    ("a", ""),
                    ("b # c", ""),
                ],
                &["config", "a", "b # c"],
                Absent,
            ),
            (
                "missing files are skipped, optional or not",
                &[
                    (
                        "config",
                        "config-file = ?gone\nconfig-file = gone-too\nconfig-file = a\n",
                    ),
                    ("a", ""),
                ],
                &["config", "a"],
                Absent,
            ),
            (
                "`~/` is the home folder",
                &[("config", "config-file = ~/a\n"), ("home/a", "")],
                &["config", "home/a"],
                Absent,
            ),
            (
                "a slash after a file name blanks the path",
                &[("config", "config-file = a/\n"), ("a", "")],
                &["config"],
                Absent,
            ),
            (
                "an empty value clears the queue so far",
                &[
                    (
                        "config",
                        "config-file = a\nconfig-file =\nconfig-file = b\n",
                    ),
                    ("a", ""),
                    ("b", ""),
                ],
                &["config", "b"],
                Absent,
            ),
            (
                "an empty value in an include clears what is still queued",
                &[
                    ("config", "config-file = a\nconfig-file = b\n"),
                    ("a", "config-file = \"\"\n"),
                    ("b", ""),
                ],
                &["config", "a"],
                Absent,
            ),
            (
                "the preview loads last",
                &[
                    (
                        "config",
                        "config-file = a\nconfig-file = ?ghostty-designer.conf\n",
                    ),
                    ("a", ""),
                ],
                &["config", "a"],
                Last,
            ),
            (
                "a file that loads after the preview shadows it",
                &[
                    (
                        "config",
                        "config-file = ?ghostty-designer.conf\nconfig-file = a\n",
                    ),
                    ("a", ""),
                ],
                &["config", "a"],
                Shadowed,
            ),
            (
                "another folder's file with the preview's name is config",
                &[
                    ("config", "config-file = sub/ghostty-designer.conf\n"),
                    ("sub/ghostty-designer.conf", ""),
                ],
                &["config", "sub/ghostty-designer.conf"],
                Absent,
            ),
        ];
        for (name, files, loaded, preview) in cases {
            assert_eq!(
                walk(files),
                (loaded.iter().map(ToString::to_string).collect(), *preview),
                "{name}"
            );
        }
    }

    /// Only a reset that drops the queued preview include counts.
    #[test]
    fn reports_the_reset_that_drops_the_preview() {
        let (dir, set) = load(&[
            (
                "config",
                "config-file = \"\"\nconfig-file = a\nconfig-file = ?ghostty-designer.conf\n",
            ),
            ("a", "font-size = 12\nconfig-file =\n"),
        ]);
        assert_eq!(set.preview, PreviewInclude::Absent);
        let reset = IncludeReset {
            path: dir.join("a").display().to_string(),
            line: 2,
        };
        assert_eq!(set.preview_cleared_by, Some(reset));
    }

    #[test]
    fn reads_invalid_utf8_as_replacement_characters() {
        let env = TestEnv::default();
        let config = env.root.join("config");
        fs::write(&config, b"font-family = \xff\n").unwrap();

        let preview = env.root.join(PREVIEW_FILE_NAME);
        let set = load_config_set(std::slice::from_ref(&config), &env.root, &preview).unwrap();
        assert!(!set.files[0].utf8);
        assert_eq!(set.files[0].text, "font-family = \u{FFFD}\n");
    }
}
