//! Theme files: the bundled themes and the user's, as text.

use std::fs;
use std::path::Path;

use crate::api::{ThemeFile, ThemeSource};

/// Reads both folders, which may be missing. Files that are hidden, not
/// regular files (symlinks are followed) or unreadable are skipped. Blocking:
/// call it off the async runtime.
pub fn load_themes(user_dir: &Path, bundled_dir: &Path) -> Vec<ThemeFile> {
    [
        (bundled_dir, ThemeSource::Bundled),
        (user_dir, ThemeSource::User),
    ]
    .into_iter()
    .flat_map(|(dir, source)| {
        read_theme_dir(dir)
            .into_iter()
            .map(move |(name, text)| ThemeFile { name, source, text })
    })
    .collect()
}

fn read_theme_dir(dir: &Path) -> Vec<(String, String)> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            // A name that is not UTF-8 cannot be a theme name in a config.
            let name = entry.file_name().into_string().ok()?;
            if name.starts_with('.') {
                return None;
            }
            let path = entry.path();
            if !fs::metadata(&path).ok()?.is_file() {
                return None;
            }
            let bytes = fs::read(&path).ok()?;
            Some((name, String::from_utf8_lossy(&bytes).into_owned()))
        })
        .collect()
}
