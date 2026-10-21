//! Folder watches that report once their events settle.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use notify::{EventKind, RecursiveMode, Watcher};

/// Watches folders on its own thread. Dropping it stops the watch.
pub struct FolderWatch(mpsc::Sender<Message>);

enum Message {
    Event(notify::Result<notify::Event>),
    Watch {
        folders: Vec<PathBuf>,
        targets: Vec<PathBuf>,
    },
    Stop,
}

impl FolderWatch {
    /// Starts a watch on no folders, which watches each folder with `mode`.
    /// `on_change` runs on the watch's thread once the events that count
    /// settle for `settle`: those about a target or a path under it, those
    /// without paths, and those after which a watched folder appeared or
    /// vanished.
    pub fn start(
        mode: RecursiveMode,
        settle: Duration,
        log: Arc<dyn Fn(&str) + Send + Sync>,
        on_change: impl Fn() + Send + 'static,
    ) -> FolderWatch {
        let (messages, inbox) = mpsc::channel();
        let sender = messages.clone();
        std::thread::spawn(move || {
            let watcher =
                notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                    // inotify reports opens and closes, such as the font scan
                    // reading the fonts; those change nothing.
                    if !event
                        .as_ref()
                        .is_ok_and(|event| matches!(event.kind, EventKind::Access(_)))
                    {
                        let _ = sender.send(Message::Event(event));
                    }
                });
            let mut watcher = match watcher {
                Ok(watcher) => watcher,
                Err(error) => return log(&format!("cannot start a folder watch: {error}")),
            };
            let (mut folders, mut targets) = (Vec::new(), Vec::new());
            let mut watched = HashMap::new();
            let mut due: Option<Instant> = None;
            loop {
                let message = match due {
                    None => inbox.recv().map_err(RecvTimeoutError::from),
                    Some(due) => inbox.recv_timeout(due.saturating_duration_since(Instant::now())),
                };
                match message {
                    Ok(Message::Watch {
                        folders: new_folders,
                        targets: new_targets,
                    }) => {
                        folders = new_folders;
                        // FSEvents reports canonical paths.
                        targets = new_targets
                            .iter()
                            .flat_map(|target| [target.clone(), canonical(target)])
                            .collect();
                        follow(&mut watcher, mode, &folders, &mut watched, &*log);
                    }
                    Ok(Message::Event(Ok(event))) => {
                        let moved = follow(&mut watcher, mode, &folders, &mut watched, &*log);
                        let counts = event.paths.is_empty()
                            || event
                                .paths
                                .iter()
                                .any(|path| targets.iter().any(|target| path.starts_with(target)));
                        if moved || counts {
                            due = Some(Instant::now() + settle);
                        }
                    }
                    Ok(Message::Event(Err(error))) => {
                        log(&format!("a folder watch failed: {error}"));
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        due = None;
                        on_change();
                    }
                    Ok(Message::Stop) | Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        });
        FolderWatch(messages)
    }

    /// Watches each folder or, while it is missing, its nearest existing
    /// ancestor non-recursively, so a folder created later counts. A folder
    /// deleted later falls back to its ancestor. Replaces the previous
    /// folders and targets.
    pub fn watch(&self, folders: Vec<PathBuf>, targets: Vec<PathBuf>) {
        let _ = self.0.send(Message::Watch { folders, targets });
    }
}

impl Drop for FolderWatch {
    fn drop(&mut self) {
        let _ = self.0.send(Message::Stop);
    }
}

/// Points the watcher at each folder, or its nearest existing ancestor.
/// Tells whether the watched paths changed, which means a folder appeared
/// or vanished.
fn follow(
    watcher: &mut impl Watcher,
    mode: RecursiveMode,
    folders: &[PathBuf],
    watched: &mut HashMap<PathBuf, RecursiveMode>,
    log: &dyn Fn(&str),
) -> bool {
    let mut moved = false;
    // A folder can appear or vanish between the check and the watch, so
    // check again until nothing moves.
    for _ in 0..8 {
        let mut wanted = HashMap::new();
        for folder in folders {
            let Some(path) = nearest_existing(folder) else {
                continue;
            };
            let mode = if path == folder {
                mode
            } else {
                RecursiveMode::NonRecursive
            };
            let entry = wanted.entry(path.to_owned()).or_insert(mode);
            if mode == RecursiveMode::Recursive {
                *entry = mode;
            }
        }
        if wanted == *watched {
            break;
        }
        for (path, mode) in watched.iter() {
            if wanted.get(path) != Some(mode) {
                // Fails when the folder is gone, which drops its watch anyway.
                let _ = watcher.unwatch(path);
            }
        }
        for (path, &mode) in &wanted {
            if watched.get(path) != Some(&mode)
                && let Err(error) = watcher.watch(path, mode)
            {
                log(&format!("cannot watch {}: {error}", path.display()));
            }
        }
        *watched = wanted;
        moved = true;
    }
    moved
}

/// `path` with its nearest existing ancestor canonical: the file it reaches,
/// or for a missing file the one it would create.
pub fn canonical(path: &Path) -> PathBuf {
    let Some(base) = nearest_existing(path) else {
        return path.to_owned();
    };
    let rest = path.strip_prefix(base).unwrap_or(Path::new(""));
    fs::canonicalize(base).map_or_else(|_| path.to_owned(), |base| base.join(rest))
}

fn nearest_existing(path: &Path) -> Option<&Path> {
    path.ancestors().find(|dir| dir.exists())
}
