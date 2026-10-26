//! The designer's own state beside the panel's, in `app.json`: the config to
//! open at launch, the files opened by path lately, and the user's choices of
//! whether a file has Ghostty's config as its base.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::env::{Config, Env};
use crate::preview::replace_own_file;

const FILE: &str = "app.json";
const RECENT_LIMIT: usize = 5;

#[derive(Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct AppState {
    /// None for Ghostty's config.
    open: Option<PathBuf>,
    /// Newest first. Known apps' files are always listed, so never here.
    recent: Vec<PathBuf>,
    /// Only where the choice differs from the default.
    ghostty_base: BTreeMap<PathBuf, bool>,
}

/// A missing or unreadable file reads as no state.
fn read(env: &Env) -> AppState {
    fs::read_to_string(env.state_dir.join(FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Writes `state` without missing files and choices for files it no longer
/// lists.
fn write(env: &Env, mut state: AppState) -> Result<(), String> {
    state.recent.retain(|path| path.is_file());
    state.recent.truncate(RECENT_LIMIT);
    state
        .ghostty_base
        .retain(|path, _| state.recent.contains(path) || env.app_of(path).is_some());
    let path = env.state_dir.join(FILE);
    let text = serde_json::to_string_pretty(&state).map_err(|error| error.to_string())?;
    replace_own_file(&path, &text)
        .map_err(|error| format!("could not write {}: {error}", path.display()))
}

/// Whether the file at `path` has Ghostty's config as its base, as the user
/// last chose, else by default.
pub fn ghostty_base(env: &Env, path: &Path) -> bool {
    read(env)
        .ghostty_base
        .get(path)
        .copied()
        .unwrap_or_else(|| env.default_ghostty_base(path))
}

/// The config last edited while its file exists, else Ghostty's.
pub fn opened(env: &Env) -> Config {
    match read(env).open.and_then(|path| env.config_file(&path).ok()) {
        Some(path) => Config::File {
            ghostty_base: ghostty_base(env, &path),
            path,
        },
        None => Config::Ghostty,
    }
}

/// Opens `config` at the next launch.
pub fn remember(env: &Env, config: &Config) -> Result<(), String> {
    let mut state = read(env);
    state.open = None;
    if let Config::File { path, ghostty_base } = config {
        state.open = Some(path.clone());
        add_recent(env, &mut state, path);
        if *ghostty_base == env.default_ghostty_base(path) {
            state.ghostty_base.remove(path);
        } else {
            state.ghostty_base.insert(path.clone(), *ghostty_base);
        }
    }
    write(env, state)
}

pub fn forget(env: &Env, path: &Path) -> Result<(), String> {
    let mut state = read(env);
    state.recent.retain(|recent| recent != path);
    write(env, state)
}

/// The recent files that exist.
pub(crate) fn recent(env: &Env) -> Vec<PathBuf> {
    let mut recent = read(env).recent;
    recent.retain(|path| path.is_file());
    recent
}

fn add_recent(env: &Env, state: &mut AppState, path: &Path) {
    if env.app_of(path).is_none() {
        state.recent.retain(|recent| recent != path);
        state.recent.insert(0, path.to_owned());
    }
}
