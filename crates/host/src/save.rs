//! Saving into the user's config files: the transactional write with its
//! "original" snapshot and `previous/` backup, restoring the original, and
//! writing, renaming and deleting user themes.
//!
//! Everything here is sync file work, so the host runs it on a blocking
//! thread.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File, Permissions};
use std::io::{self, Write};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::api::{Error, SavedFiles};
use crate::watch::canonical;

/// Names the folders a save stages its backup in, under the state dir.
const STAGING_PREFIX: &str = "previous-";

/// A file's new content. `before` is the content it was planned from, None
/// when the file was absent. `after` is None to remove the file. Text is
/// written as it is decoded; bytes as they are.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileEdit {
    pub path: PathBuf,
    pub before: Option<String>,
    pub after: Option<Content>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Content {
    Text(String),
    Bytes(Vec<u8>),
}

impl Content {
    fn bytes(&self) -> &[u8] {
        match self {
            Content::Text(text) => text.as_bytes(),
            Content::Bytes(bytes) => bytes,
        }
    }
}

/// Puts back each file of `scope`, the current config's files, as it was before
/// the designer first wrote it. Other edited configs, such as an app's file or
/// one opened with `--config`, share the state dir, so their files stay
/// untouched.
pub fn restore_original(state_dir: &Path, scope: &[PathBuf]) -> Result<(), Error> {
    let originals = original_files_dir(state_dir);
    let mut edits = Vec::new();
    for entry in read_manifest(state_dir).map_err(Error::Internal)? {
        if !scope.contains(&entry.path) {
            continue;
        }
        let path = entry.path;
        let current = read_if_exists(&path).map_err(|error| {
            Error::Internal(format!("Could not read {}: {error}", path.display()))
        })?;
        // Bytes, so an original that is not valid UTF-8 comes back exactly.
        let original = if entry.existed {
            let copy = mirror(&originals, &path);
            Some(fs::read(&copy).map_err(|error| {
                Error::Internal(format!(
                    "Could not read the original {}: {error}",
                    copy.display()
                ))
            })?)
        } else {
            None
        };
        if current == original {
            continue;
        }
        edits.push(FileEdit {
            before: current.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()),
            after: original.map(Content::Bytes),
            path,
        });
    }
    apply_save(&edits, state_dir).map(drop)
}

/// Whether the original snapshot covers a file of `scope`. False when the
/// snapshot cannot be read.
pub fn has_original(state_dir: &Path, scope: &[PathBuf]) -> bool {
    read_manifest(state_dir)
        .is_ok_and(|entries| entries.iter().any(|entry| scope.contains(&entry.path)))
}

/// The file of the user theme `name`. Only a plain file name passes, so the
/// file stays inside the folder.
fn theme_file(themes_dir: &Path, name: &str) -> Result<PathBuf, Error> {
    let components: Vec<Component<'_>> = Path::new(name).components().collect();
    if name.contains('\0')
        || name.starts_with('.')
        || !matches!(components[..], [Component::Normal(part)] if part == name)
    {
        return Err(Error::Input(format!("Invalid theme name: {name}")));
    }
    Ok(themes_dir.join(name))
}

/// Writes a new user theme, or gives false when a file has the name. It never
/// replaces a file. The theme appears whole: it is written to a hidden temp
/// file, which the theme list skips, then renamed to its name.
pub fn write_theme(themes_dir: &Path, name: &str, text: &str) -> Result<bool, Error> {
    let file = theme_file(themes_dir, name)?;
    let written = fs::create_dir_all(themes_dir).and_then(|()| {
        let mut temp = tempfile::Builder::new()
            .permissions(Permissions::from_mode(0o666))
            .tempfile_in(themes_dir)?;
        temp.write_all(text.as_bytes())?;
        temp.persist_noclobber(&file).map_err(|error| error.error)?;
        Ok(())
    });
    match written {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(Error::Internal(format!(
            "Could not write {}: {error}",
            file.display()
        ))),
    }
}

/// Renames a user theme, or gives false when a file has the new name. It never
/// replaces a file: the new name links to the file before the old one goes.
pub fn rename_theme(themes_dir: &Path, name: &str, to: &str) -> Result<bool, Error> {
    let from = theme_file(themes_dir, name)?;
    let file = theme_file(themes_dir, to)?;
    let renamed = match fs::hard_link(&from, &file) {
        Ok(()) => fs::remove_file(&from),
        // A file system that ignores case finds the theme itself under a name
        // that differs only in case.
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            if !same_file(&from, &file) {
                return Ok(false);
            }
            fs::rename(&from, &file)
        }
        Err(error) => Err(error),
    };
    renamed
        .map(|()| true)
        .map_err(|error| Error::Internal(format!("Could not rename {}: {error}", from.display())))
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::metadata(a), fs::metadata(b)) {
        (Ok(a), Ok(b)) => a.dev() == b.dev() && a.ino() == b.ino(),
        _ => false,
    }
}

/// Deletes a user theme. A theme already gone counts as deleted.
pub fn delete_theme(themes_dir: &Path, name: &str) -> Result<(), Error> {
    let file = theme_file(themes_dir, name)?;
    match fs::remove_file(&file) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(Error::Internal(format!(
            "Could not delete {}: {error}",
            file.display()
        ))),
        _ => Ok(()),
    }
}

/// Backup folders a save left in the state dir instead of moving them into
/// `previous/`: after a crash mid-save, a rollback that could not put every
/// file back (the folder then holds their only previous versions), or a
/// failed final move.
pub fn unmoved_backups(state_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(state_dir) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with(STAGING_PREFIX))
                && entry.file_type().is_ok_and(|kind| kind.is_dir())
        })
        .map(|entry| entry.path())
        .collect();
    found.sort();
    found
}

#[derive(Clone, Serialize, Deserialize)]
struct ManifestEntry {
    path: PathBuf,
    existed: bool,
}

fn manifest_path(state_dir: &Path) -> PathBuf {
    state_dir.join("original").join("manifest.json")
}

fn original_files_dir(state_dir: &Path) -> PathBuf {
    state_dir.join("original").join("files")
}

/// Mirrors an absolute path under a directory: `..` folds away lexically, but
/// never above `dir`.
fn mirror(dir: &Path, file: &Path) -> PathBuf {
    let mut out = dir.to_owned();
    let mut depth = 0;
    for component in file.components() {
        match component {
            Component::Normal(part) => {
                out.push(part);
                depth += 1;
            }
            Component::ParentDir if depth > 0 => {
                out.pop();
                depth -= 1;
            }
            Component::Prefix(_)
            | Component::RootDir
            | Component::CurDir
            | Component::ParentDir => {}
        }
    }
    out
}

fn read_manifest(state_dir: &Path) -> Result<Vec<ManifestEntry>, String> {
    let file = manifest_path(state_dir);
    let Some(bytes) = read_if_exists(&file)
        .map_err(|error| format!("Could not read {}: {error}", file.display()))?
    else {
        return Ok(Vec::new());
    };
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Could not read {}: {error}", file.display()))
}

fn write_manifest(state_dir: &Path, entries: &[ManifestEntry]) -> Result<(), String> {
    let manifest = manifest_path(state_dir);
    serde_json::to_string_pretty(entries)
        .map_err(io::Error::other)
        .and_then(|json| replace_target_synced(&manifest, json.as_bytes()))
        .map_err(|error| format!("Could not write {}: {error}", manifest.display()))
}

struct Staged<'a> {
    edit: &'a FileEdit,
    step: Step,
}

enum Step {
    /// Rename the written temp file over the target.
    Replace { temp: PathBuf, target: PathBuf },
    /// Move the file aside over an empty placeholder this save created, so a
    /// rollback can move it back as it was, even a symlink. `moved` once it is.
    Remove { aside: PathBuf, moved: bool },
}

/// Removes the files this save created for steps that did not run.
fn discard(staged: &[Staged<'_>]) {
    for item in staged {
        match &item.step {
            Step::Replace { temp, .. } => {
                let _ = remove_file_force(temp);
            }
            Step::Remove {
                aside,
                moved: false,
            } => {
                let _ = remove_file_force(aside);
            }
            Step::Remove { moved: true, .. } => {}
        }
    }
}

/// Refuses edits it cannot save as planned, then writes each file beside its
/// target. Then extends the "original" snapshot with files it does not cover
/// yet (never overwriting it), copies the current files, and renames the writes
/// into place. A failure before the renames changes no file; one during them puts
/// back the files already replaced from the copy, and takes back what the
/// snapshot gained. Only once every rename is done does the copy replace the
/// previous one.
pub fn apply_save(edits: &[FileEdit], state_dir: &Path) -> Result<SavedFiles, Error> {
    let backup_dir = state_dir.join("previous");
    if edits.is_empty() {
        return Ok(SavedFiles {
            backup_dir: backup_dir.display().to_string(),
        });
    }

    let mut targets: HashMap<PathBuf, &Path> = HashMap::new();
    for edit in edits {
        let path = edit.path.display();
        // Two paths to one file would share a temp file and undo each other.
        if let Some(other) = targets.insert(canonical(&edit.path), &edit.path) {
            return Err(Error::Input(format!(
                "{} and {path} are the same file, so a save cannot edit both",
                other.display()
            )));
        }
        let current = read_if_exists(&edit.path)
            .map_err(|error| Error::Internal(format!("Could not read {path}: {error}")))?;
        // A text edit would turn bytes that are not UTF-8 into U+FFFD.
        if let Some(current) = &current
            && matches!(edit.after, Some(Content::Text(_)))
            && std::str::from_utf8(current).is_err()
        {
            return Err(Error::Input(format!(
                "{path} is not valid UTF-8, so it was left as is"
            )));
        }
        let current = current.as_deref().map(String::from_utf8_lossy);
        if current.as_deref() != edit.before.as_deref() {
            return Err(Error::Input(format!(
                "{path} changed. Review the save again."
            )));
        }
    }
    let prior = read_manifest(state_dir).map_err(Error::Internal)?;
    check_backup_paths(&prior, edits)?;

    let mut staged: Vec<Staged<'_>> = Vec::with_capacity(edits.len());
    for edit in edits {
        let step = match &edit.after {
            None => create_sibling(&edit.path, "removed", 0o600).map(|(aside, _)| Step::Remove {
                aside,
                moved: false,
            }),
            Some(content) => stage(&edit.path, content.bytes())
                .map(|(temp, target)| Step::Replace { temp, target }),
        };
        match step {
            Ok(step) => staged.push(Staged { edit, step }),
            Err(error) => {
                discard(&staged);
                return Err(Error::Internal(format!(
                    "Could not write {}: {error}. No file was changed.",
                    edit.path.display()
                )));
            }
        }
    }

    let added = match extend_original(edits, state_dir, prior) {
        Ok(added) => added,
        Err(error) => {
            discard(&staged);
            return Err(Error::Internal(format!("{error}. No file was changed.")));
        }
    };
    let staging = match back_up(edits, state_dir) {
        Ok(staging) => staging,
        Err(error) => {
            discard(&staged);
            let note = take_back_note(state_dir, added);
            return Err(Error::Internal(format!(
                "{error}. No file was changed.{note}"
            )));
        }
    };

    for i in 0..staged.len() {
        let item = &mut staged[i];
        let done = match &mut item.step {
            Step::Replace { temp, target } => fs::rename(temp, target),
            Step::Remove { aside, moved } => match fs::rename(&item.edit.path, &*aside) {
                // Already gone, so only the placeholder is left to remove.
                Err(error) if error.kind() == io::ErrorKind::NotFound => remove_file_force(aside),
                renamed => {
                    *moved = renamed.is_ok();
                    renamed
                }
            },
        };
        if let Err(error) = done {
            discard(&staged[i..]);
            let stuck = put_back(&staged[..i], &staging);
            let outcome = if stuck.is_empty() {
                let _ = fs::remove_dir_all(&staging);
                let note = take_back_note(state_dir, added);
                format!("The files written before it were put back.{note}")
            } else {
                format!(
                    "Could not put back {}; their previous versions are in {}.",
                    stuck.join(", "),
                    staging.display()
                )
            };
            return Err(Error::Internal(format!(
                "Could not write {}: {error}. {outcome}",
                staged[i].edit.path.display()
            )));
        }
    }

    // Every file is saved, so failures from here on are not reported: a
    // backup left in its staging folder is returned as the backup.
    let mut dirs = HashSet::new();
    for item in &staged {
        match &item.step {
            Step::Replace { target, .. } => dirs.extend(target.parent()),
            Step::Remove { aside, moved } => {
                if *moved {
                    let _ = remove_file_force(aside);
                }
                dirs.extend(item.edit.path.parent());
            }
        }
    }
    for dir in dirs {
        let _ = sync_dir(dir);
    }
    let moved = remove_dir_all_force(&backup_dir).and_then(|()| fs::rename(&staging, &backup_dir));
    let backup_dir = if moved.is_ok() { backup_dir } else { staging };
    Ok(SavedFiles {
        backup_dir: backup_dir.display().to_string(),
    })
}

/// What a save added to the original snapshot.
struct Added {
    prior: Vec<ManifestEntry>,
    copies: Vec<PathBuf>,
}

/// Extends the original snapshot, `prior`, with the files it does not cover
/// yet. The copies are durable before the manifest names them, so restoring
/// never writes a torn copy over the user's config.
fn extend_original(
    edits: &[FileEdit],
    state_dir: &Path,
    prior: Vec<ManifestEntry>,
) -> Result<Option<Added>, String> {
    let covered: HashSet<&Path> = prior.iter().map(|entry| entry.path.as_path()).collect();
    let uncovered: Vec<&FileEdit> = edits
        .iter()
        .filter(|edit| !covered.contains(edit.path.as_path()))
        .collect();
    if uncovered.is_empty() {
        return Ok(None);
    }

    let originals = original_files_dir(state_dir);
    let mut copies = Vec::new();
    let mut dirs = HashSet::new();
    for edit in uncovered.iter().filter(|edit| edit.before.is_some()) {
        let copy = mirror(&originals, &edit.path);
        let copied = copy_synced(&edit.path, &copy, state_dir, &mut dirs);
        copies.push(copy);
        if let Err(error) = copied {
            remove_copies(&copies);
            return Err(format!(
                "Could not back up {}: {error}",
                edit.path.display()
            ));
        }
    }
    if let Err(error) = sync_dirs(dirs) {
        remove_copies(&copies);
        return Err(format!("Could not back up the original config: {error}"));
    }

    let added = uncovered.iter().map(|edit| ManifestEntry {
        path: edit.path.clone(),
        existed: edit.before.is_some(),
    });
    let entries: Vec<ManifestEntry> = prior.iter().cloned().chain(added).collect();
    let added = Added { prior, copies };
    if let Err(error) = write_manifest(state_dir, &entries) {
        let note = take_back_note(state_dir, Some(added));
        return Err(format!("{error}{note}"));
    }
    Ok(Some(added))
}

/// `mirror` folds `..` lexically, so paths to two different files can map to
/// one backup path, where one file's copy would replace the other's. Refuses
/// an edit whose backup path another edit or a snapshot entry already uses.
fn check_backup_paths(prior: &[ManifestEntry], edits: &[FileEdit]) -> Result<(), Error> {
    let root = Path::new("/");
    let mut owners: HashMap<PathBuf, &Path> = HashMap::new();
    for entry in prior {
        owners
            .entry(mirror(root, &entry.path))
            .or_insert(&entry.path);
    }
    for edit in edits {
        let owner = *owners.entry(mirror(root, &edit.path)).or_insert(&edit.path);
        if owner != edit.path {
            return Err(Error::Input(format!(
                "{} and {} share one backup path, so a save cannot edit {}. Write the path without \"..\"",
                owner.display(),
                edit.path.display(),
                edit.path.display()
            )));
        }
    }
    Ok(())
}

fn remove_copies(copies: &[PathBuf]) {
    for copy in copies {
        let _ = remove_file_force(copy);
    }
}

/// Takes back what a failed save added to the original snapshot, so a later
/// restore cannot remove a file that save only planned to create. The copies
/// go only once the manifest no longer names them. Returns a note for the
/// save's error when the manifest could not be put back.
fn take_back_note(state_dir: &Path, added: Option<Added>) -> String {
    let Some(Added { prior, copies }) = added else {
        return String::new();
    };
    match write_manifest(state_dir, &prior) {
        Ok(()) => {
            remove_copies(&copies);
            String::new()
        }
        Err(error) => format!(
            " The original snapshot may now list a file this save never wrote, so restoring it could remove that file ({error})."
        ),
    }
}

/// Copies the current files into a new staging folder, which it returns.
fn back_up(edits: &[FileEdit], state_dir: &Path) -> Result<PathBuf, String> {
    let staging = make_staging(state_dir)
        .map_err(|error| format!("Could not create a backup folder: {error}"))?;
    let mut dirs = HashSet::new();
    for edit in edits.iter().filter(|edit| edit.before.is_some()) {
        let copy = mirror(&staging, &edit.path);
        if let Err(error) = copy_synced(&edit.path, &copy, state_dir, &mut dirs) {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!(
                "Could not back up {}: {error}",
                edit.path.display()
            ));
        }
    }
    if let Err(error) = sync_dirs(dirs) {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("Could not back up the config: {error}"));
    }
    Ok(staging)
}

/// Puts back files from the copy of their previous versions, or from where
/// they were moved aside. Returns those it could not.
fn put_back(done: &[Staged<'_>], backup_dir: &Path) -> Vec<String> {
    let mut stuck = Vec::new();
    for Staged { edit, step } in done {
        let restored = match (step, &edit.before) {
            (Step::Remove { aside, moved }, _) => {
                if *moved {
                    fs::rename(aside, &edit.path)
                } else {
                    Ok(())
                }
            }
            (Step::Replace { .. }, None) => remove_file_force(&edit.path),
            (Step::Replace { .. }, Some(_)) => fs::read(mirror(backup_dir, &edit.path))
                .and_then(|bytes| replace_target_synced(&edit.path, &bytes)),
        };
        if restored.is_err() {
            stuck.push(edit.path.display().to_string());
        }
    }
    stuck
}

/// A new private staging folder.
fn make_staging(state_dir: &Path) -> io::Result<PathBuf> {
    fs::create_dir_all(state_dir)?;
    let dir = tempfile::Builder::new()
        .prefix(STAGING_PREFIX)
        .permissions(Permissions::from_mode(0o700))
        .tempdir_in(state_dir)?;
    Ok(dir.keep())
}

/// The file's bytes, None when it is absent or a link to a missing file.
fn read_if_exists(path: &Path) -> io::Result<Option<Vec<u8>>> {
    if path.exists() {
        fs::read(path).map(Some)
    } else {
        Ok(None)
    }
}

fn remove_file_force(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

fn remove_dir_all_force(path: &Path) -> io::Result<()> {
    match fs::remove_dir_all(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

/// Creates a new file with `mode` beside `file`, so a rename stays on its
/// volume. It never opens an existing file or follows a symlink, so a file
/// that is not ours is never written, and cleanup only ever removes this
/// save's files.
fn create_sibling(file: &Path, suffix: &str, mode: u32) -> io::Result<(PathBuf, File)> {
    let dir = file.parent().unwrap_or(Path::new("."));
    let mut prefix = file.file_name().unwrap_or_default().to_owned();
    prefix.push(".");
    let (created, path) = tempfile::Builder::new()
        .prefix(&prefix)
        .suffix(&format!(".{suffix}"))
        .permissions(Permissions::from_mode(mode))
        .tempfile_in(dir)?
        .keep()
        .map_err(|error| error.error)?;
    Ok((path, created))
}

/// Copies a file and syncs the copy. Adds the folders from its own up to
/// `root`'s parent to `dirs`, for [`sync_dirs`] once every copy is made.
fn copy_synced(from: &Path, to: &Path, root: &Path, dirs: &mut HashSet<PathBuf>) -> io::Result<()> {
    if let Some(dir) = to.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::copy(from, to)?;
    File::open(to)?.sync_all()?;
    let stop = root.parent().unwrap_or(root);
    for dir in to.ancestors().skip(1) {
        dirs.insert(dir.to_owned());
        if dir == stop || !dir.starts_with(stop) {
            break;
        }
    }
    Ok(())
}

/// Syncs folders deepest first, so new entries and the folders holding them
/// survive a power loss.
fn sync_dirs(dirs: HashSet<PathBuf>) -> io::Result<()> {
    let mut dirs: Vec<PathBuf> = dirs.into_iter().collect();
    dirs.sort_by_key(|dir| std::cmp::Reverse(dir.components().count()));
    dirs.iter().try_for_each(|dir| sync_dir(dir))
}

fn sync_dir(dir: &Path) -> io::Result<()> {
    File::open(dir)?.sync_all()
}

/// Writes `content` to a temp file beside the file a rename should replace:
/// through symlinks, keeping the file mode. A link to a missing file is
/// refused, because the rename would replace the link itself. Returns the
/// temp file and the rename's target. The replace makes a new file: it breaks
/// hard links and resets the owner and ACLs.
fn stage(file: &Path, content: &[u8]) -> io::Result<(PathBuf, PathBuf)> {
    let exists = file.exists();
    if !exists && fs::symlink_metadata(file).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err(io::Error::other("it links to a missing file"));
    }
    let target = if exists {
        fs::canonicalize(file)?
    } else {
        file.to_owned()
    };
    let mode = if exists {
        fs::metadata(&target)?.permissions().mode() & 0o7777
    } else {
        0o644
    };
    if let Some(dir) = target.parent() {
        fs::create_dir_all(dir)?;
    }
    let (temp, mut file) = create_sibling(&target, "tmp", mode)?;
    // The open's mode is masked by the umask. Synced before the rename, so a
    // crash cannot leave the config empty.
    let written = file
        .write_all(content)
        .and_then(|()| file.set_permissions(Permissions::from_mode(mode)))
        .and_then(|()| file.sync_all());
    if written.is_err() {
        let _ = fs::remove_file(&temp);
    }
    written.map(|()| (temp, target))
}

/// Replaces the file, through symlinks, in one synced rename, then syncs its
/// folder so the rename lasts. A failed folder sync is not reported: the
/// file is replaced.
fn replace_target_synced(file: &Path, content: &[u8]) -> io::Result<()> {
    let (temp, target) = stage(file, content)?;
    fs::rename(&temp, &target).inspect_err(|_| {
        let _ = fs::remove_file(&temp);
    })?;
    if let Some(dir) = target.parent() {
        let _ = sync_dir(dir);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;

    use super::*;
    use crate::testkit::TestEnv;

    const CONFIG: &str = "font-size = 16\ntheme = \"GitHub Dark\"\n";
    const SAVED: &str = "font-size = 18\ntheme = \"GitHub Dark\"\n";

    /// Its root is canonical: macOS's temp dir is a symlink.
    struct Case {
        _env: TestEnv,
        dir: PathBuf,
        config: PathBuf,
        state_dir: PathBuf,
    }

    fn setup(files: &[(&str, &str)]) -> Case {
        let env = TestEnv::default();
        let dir = env.root.join("case");
        fs::create_dir(&dir).unwrap();
        let config = dir.join("config");
        fs::write(&config, CONFIG).unwrap();
        for (name, content) in files {
            fs::write(dir.join(name), content).unwrap();
        }
        Case {
            state_dir: dir.join("state"),
            _env: env,
            dir,
            config,
        }
    }

    fn edit(path: &Path, before: Option<&str>, after: &str) -> FileEdit {
        FileEdit {
            path: path.to_owned(),
            before: before.map(String::from),
            after: Some(Content::Text(after.into())),
        }
    }

    fn read(file: &Path) -> String {
        fs::read_to_string(file).unwrap()
    }

    #[test]
    fn saves_through_a_symlinked_config_keeping_the_link() {
        let c = setup(&[("dotfile", CONFIG)]);
        let link = c.dir.join("linked");
        symlink(c.dir.join("dotfile"), &link).unwrap();
        apply_save(&[edit(&link, Some(CONFIG), SAVED)], &c.state_dir).unwrap();

        assert!(fs::symlink_metadata(&link).unwrap().is_symlink());
        assert_eq!(read(&c.dir.join("dotfile")), SAVED);
    }

    #[test]
    fn refuses_to_save_through_a_link_to_a_missing_file() {
        let c = setup(&[]);
        let link = c.dir.join("dangling");
        symlink(c.dir.join("missing"), &link).unwrap();

        let error = apply_save(&[edit(&link, None, SAVED)], &c.state_dir).unwrap_err();
        assert!(
            matches!(&error, Error::Internal(message) if message.contains("it links to a missing file")),
            "{error:?}"
        );
        assert!(fs::symlink_metadata(&link).unwrap().is_symlink());
    }

    #[test]
    fn backs_up_keeps_the_first_original_and_restores_it() {
        let c = setup(&[]);
        let new_config = c.dir.join("config.ghostty");
        fs::set_permissions(&c.config, Permissions::from_mode(0o600)).unwrap();
        apply_save(&[edit(&c.config, Some(CONFIG), SAVED)], &c.state_dir).unwrap();
        let edits = [
            edit(&c.config, Some(SAVED), "font-size = 20\n"),
            edit(&new_config, None, "cursor-opacity = 0.8\n"),
        ];
        let result = apply_save(&edits, &c.state_dir).unwrap();

        let mode = fs::metadata(&c.config).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        // The backup mirrors each absolute path.
        let backup = format!("{}{}", result.backup_dir, c.config.display());
        assert_eq!(read(Path::new(&backup)), SAVED);
        assert_eq!(read(&new_config), "cursor-opacity = 0.8\n");

        restore_original(&c.state_dir, &[c.config.clone(), new_config.clone()]).unwrap();
        assert_eq!(read(&c.config), CONFIG);
        assert!(!new_config.exists());
    }

    /// Rollback is our own policy, and only a real failure exercises it: the
    /// second file sits in an append-only folder, so staging beside it
    /// succeeds but moving it aside fails. Linux needs root to set the flag,
    /// so this runs on macOS.
    #[cfg(target_os = "macos")]
    #[test]
    fn puts_back_the_files_written_when_a_later_replace_fails() {
        let c = setup(&[]);
        let locked = c.dir.join("locked");
        fs::create_dir(&locked).unwrap();
        let other = locked.join("config");
        fs::write(&other, "a = 1\n").unwrap();
        let chflags = |flag: &str| {
            let status = std::process::Command::new("chflags")
                .arg(flag)
                .arg(&locked)
                .status()
                .unwrap();
            assert!(status.success());
        };
        let edits = [
            edit(&c.config, Some(CONFIG), SAVED),
            FileEdit {
                path: other.clone(),
                before: Some("a = 1\n".into()),
                after: None,
            },
        ];

        chflags("uappnd");
        let saved = apply_save(&edits, &c.state_dir);
        chflags("nouappnd");

        let error = saved.unwrap_err();
        assert!(
            matches!(&error, Error::Internal(message) if message.ends_with("The files written before it were put back.")),
            "{error:?}"
        );
        assert_eq!(read(&c.config), CONFIG);
        assert_eq!(read(&other), "a = 1\n");
        assert!(!c.state_dir.join("previous").exists());
        assert_eq!(unmoved_backups(&c.state_dir), Vec::<PathBuf>::new());
        assert!(!has_original(&c.state_dir, &[c.config.clone(), other]));
    }

    /// `cfg/link/../colors` is `other/colors`, a different file from
    /// `cfg/colors`, but both map to one backup path.
    #[test]
    fn refuses_a_file_whose_backup_path_another_file_uses() {
        let c = setup(&[]);
        let cfg = c.dir.join("cfg");
        let other = c.dir.join("other");
        fs::create_dir_all(other.join("sub")).unwrap();
        fs::create_dir(&cfg).unwrap();
        symlink(other.join("sub"), cfg.join("link")).unwrap();
        let colors = cfg.join("colors");
        fs::write(&colors, "a = 1\n").unwrap();
        fs::write(other.join("colors"), "b = 1\n").unwrap();
        apply_save(&[edit(&colors, Some("a = 1\n"), "c = 1\n")], &c.state_dir).unwrap();

        let through_link = cfg.join("link").join("..").join("colors");
        let edits = [edit(&through_link, Some("b = 1\n"), "c = 1\n")];
        let error = apply_save(&edits, &c.state_dir).unwrap_err();
        assert!(
            matches!(&error, Error::Input(message) if message.contains("share one backup path")),
            "{error:?}"
        );
        assert_eq!(read(&other.join("colors")), "b = 1\n");
        restore_original(&c.state_dir, std::slice::from_ref(&colors)).unwrap();
        assert_eq!(read(&colors), "a = 1\n");
    }

    #[test]
    fn renames_a_theme_without_replacing_another() {
        let c = setup(&[
            ("Mine", "background = #000000\n"),
            ("Nord", "background = #2e3440\n"),
        ]);
        let names = || {
            let mut names: Vec<String> = fs::read_dir(&c.dir)
                .unwrap()
                .map(|entry| entry.unwrap().file_name().into_string().unwrap())
                .filter(|name| name != "config")
                .collect();
            names.sort();
            names
        };

        assert!(!rename_theme(&c.dir, "Mine", "Nord").unwrap());
        assert_eq!(read(&c.dir.join("Nord")), "background = #2e3440\n");
        assert!(matches!(
            rename_theme(&c.dir, "Mine", "../Mine"),
            Err(Error::Input(_))
        ));

        rename_theme(&c.dir, "Mine", "Ours").unwrap();
        assert_eq!(names(), ["Nord", "Ours"]);
        assert_eq!(read(&c.dir.join("Ours")), "background = #000000\n");

        // Takes the hard link path on a case-sensitive file system, the rename
        // path on one that ignores case, as macOS does by default.
        rename_theme(&c.dir, "Ours", "ours").unwrap();
        assert_eq!(names(), ["Nord", "ours"]);
    }
}
