//! Contract between the host and the panel: the commands and their
//! results, and the messages on the panel's channel. The panel owns the
//! domain. The host reads and writes files, runs Ghostty and reports what
//! changed.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Basename of the preview file, beside the config path. The panel writes the
/// include line that loads it.
pub const PREVIEW_FILE_NAME: &str = "ghostty-designer.conf";

#[derive(Serialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Macos,
    Linux,
}

#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
pub struct FontFace {
    pub style: String,
    /// Opaque id for `font://localhost/<id>`.
    pub id: String,
}

#[derive(Serialize, TS, Clone, Debug, PartialEq)]
pub struct FontAxis {
    pub tag: String,
    pub name: String,
    pub min: f64,
    pub max: f64,
    pub default: f64,
}

#[derive(Serialize, TS, Clone, Debug, PartialEq)]
pub struct FontFamily {
    pub family: String,
    pub faces: Vec<FontFace>,
    pub nerd: bool,
    /// The feature tags the faces offer, in byte order: AAT `morx` features
    /// as OpenType tags, or GSUB and GPOS features of the default script, or
    /// else Latin.
    pub features: Vec<String>,
    /// The feature that joins code such as `->` into ligatures, calt or liga.
    /// None for a family without code ligatures.
    pub ligatures: Option<String>,
    pub axes: Vec<FontAxis>,
}

#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GhosttyInfo {
    pub version: String,
    pub platform: Platform,
    /// The main config the designer edits.
    pub config_path: String,
    pub edited: EditedConfig,
}

/// Whose config the designer edits.
#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum EditedConfig {
    /// Ghostty's own, which the preview reloads.
    Ghostty,
    /// Another file, which nothing reloads. `app` names a known app's file.
    File {
        app: Option<String>,
        ghostty_base: bool,
    },
}

/// What `connect` returns.
#[derive(Serialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub ghostty: GhosttyInfo,
    /// `ghostty +show-config --default --docs`, run once at start.
    pub defaults_with_docs: String,
    /// null while the first font scan runs. A "fonts" message follows.
    pub fonts: Option<Vec<FontFamily>>,
    /// Running Ghostty instances the preview reloads.
    pub instances: u32,
    /// The panel's own text from its last `write_state`, kept in `state.json`
    /// in the state folder. null when the file is missing or unreadable.
    pub persisted: Option<String>,
    /// The panel's own blob from its last `report_draft`, so a reloaded page
    /// can pick up where the crashed one left.
    pub stash: Option<String>,
}

/// Whether the preview file loads, and whether a file loading after it can
/// beat the draft.
#[derive(Serialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PreviewInclude {
    Absent,
    Last,
    Shadowed,
}

#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
pub struct ConfigFile {
    pub path: String,
    /// The file decoded as UTF-8, invalid bytes as U+FFFD, with its byte
    /// order mark.
    pub text: String,
    /// False when the file is not valid UTF-8, so `text` is not its content.
    pub utf8: bool,
}

/// A `config-file` line with an empty value, which drops the includes still
/// queued.
#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
pub struct IncludeReset {
    pub path: String,
    /// 1-based.
    pub line: usize,
}

#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoadedConfig {
    /// The files Ghostty loads, in its order, without the preview file.
    pub files: Vec<ConfigFile>,
    pub preview: PreviewInclude,
    /// With `preview` absent: the line that dropped the preview include.
    pub preview_cleared_by: Option<IncludeReset>,
    /// True when a backup of the pre-designer config exists.
    pub can_restore_original: bool,
    /// Files of `files` a save does not write: Ghostty's, below another file.
    pub read_only: Vec<String>,
    /// With Ghostty's config edited: other apps' config files, which they
    /// load over it.
    pub apps: Vec<AppConfig>,
}

#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
pub struct AppConfig {
    pub app: String,
    pub file: ConfigFile,
}

/// A config the designer can switch to.
#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ConfigChoice {
    Ghostty {
        path: String,
    },
    App {
        app: String,
        path: String,
    },
    /// A file opened by path lately.
    Recent {
        path: String,
    },
}

#[derive(Serialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    Light,
    Dark,
}

#[derive(Serialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeSource {
    User,
    Bundled,
}

/// A theme file from the bundled or the user themes folder.
#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
pub struct ThemeFile {
    pub name: String,
    pub source: ThemeSource,
    pub text: String,
}

#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
pub struct SavedTheme {
    pub path: String,
}

/// One file of a save: its content when planned, null when absent, and its
/// new content.
#[derive(Deserialize, TS, Clone, Debug, PartialEq, Eq)]
pub struct SaveEdit {
    pub path: String,
    pub before: Option<String>,
    pub after: String,
}

#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavedFiles {
    /// The previous versions of the files the save replaced.
    pub backup_dir: String,
    pub files: Vec<String>,
}

#[derive(Serialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PreviewState {
    Idle,
    Applying,
    Applied,
    Error,
}

#[derive(Serialize, TS, Clone, Debug, PartialEq)]
pub struct PreviewStatus {
    pub state: PreviewState,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
    /// With `error`: the keys Ghostty rejected. The preview shows every other
    /// change.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rejected: Option<Vec<String>>,
}

/// The panel's commands that run concurrently, with their arguments.
#[derive(Deserialize, TS, Debug)]
#[serde(
    tag = "command",
    content = "args",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Command {
    LoadConfig,
    ShowConfig,
    ValidateConfig { text: String },
    SystemAppearance,
    LoadThemes,
    WriteTheme { name: String, text: String },
    ResetFontSize,
    ApplySave { edits: Vec<SaveEdit> },
    RestoreOriginal,
    WriteState { text: String },
}

/// What a `Command` returns, tagged with the command's name.
#[derive(Serialize, TS, Debug)]
#[serde(tag = "command", content = "result", rename_all = "snake_case")]
pub enum CommandResult {
    LoadConfig(LoadedConfig),
    ShowConfig(String),
    /// Ghostty's complaints about the text, or "" when it is valid.
    ValidateConfig(String),
    SystemAppearance(Appearance),
    LoadThemes(Vec<ThemeFile>),
    /// None when a file has the name.
    WriteTheme(Option<SavedTheme>),
    /// Whether every terminal accepted the reset.
    ResetFontSize(bool),
    ApplySave(SavedFiles),
    RestoreOriginal(SavedFiles),
    WriteState,
}

/// The panel's commands that return at once. They run in the order the
/// panel sends them, so a later preview always replaces an earlier one.
#[derive(Deserialize, TS, Debug)]
#[serde(
    tag = "command",
    content = "args",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum OrderedCommand {
    /// `id` names the text in its statuses.
    PreviewApply {
        id: String,
        text: String,
    },
    PreviewRevert {
        id: String,
    },
    ReportDraft {
        changes: usize,
        stash: Option<String>,
    },
    RescanFonts,
}

/// Messages on the panel's channel.
#[derive(Serialize, TS, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum HostMessage {
    /// A config file changed on disk, and the changes have settled.
    ConfigChanged,
    /// The user themes folder changed, and the changes have settled.
    ThemesChanged,
    /// A font scan ended: after start, and after each rescan. A failed scan
    /// repeats the last list.
    Fonts { fonts: Vec<FontFamily> },
    /// The number of running Ghostty instances changed.
    Instances { count: u32 },
    /// The system may have switched between light and dark. The panel reads
    /// the appearance with `system_appearance`.
    AppearanceChanged,
    /// The status of the preview text the panel scheduled with this id.
    /// Statuses come in the order the texts were scheduled.
    PreviewStatus { id: String, apply: PreviewStatus },
    /// The window wants to close while there are unsaved changes. The panel
    /// asks the user and acknowledges with `close_prompt_shown`.
    CloseRequested,
    /// A later launch asked to edit a config file. The panel takes it with
    /// `take_switch_request` once it can switch, asking first when there are
    /// unsaved changes.
    SwitchRequested,
}

/// A command failure. `input` refuses a request the files or the arguments do
/// not allow, and says why. `internal` is an operation that failed, such as a
/// read or a write, and is also logged.
#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", content = "message", rename_all = "lowercase")]
// Named `Error`, it would shadow the global `Error` in every UI file that
// imports it.
#[ts(rename = "CommandError")]
pub enum Error {
    Input(String),
    Internal(String),
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::{Value, json};
    use ts_rs::{Config, TypeVisitor};

    use super::*;

    const UPDATE: &str = "UPDATE_BINDINGS=1 cargo test -p ghostty-designer-host bindings";

    /// Collects the declarations of a type and everything it references, by
    /// TypeScript name.
    struct Decls<'a> {
        cfg: &'a Config,
        out: BTreeMap<String, String>,
    }

    impl TypeVisitor for Decls<'_> {
        fn visit<T: TS + 'static + ?Sized>(&mut self) {
            if T::output_path().is_none() {
                return;
            }
            let name = T::ident(self.cfg);
            if self.out.contains_key(&name) {
                return;
            }
            let docs = T::docs().unwrap_or_default();
            let decl = format!("{docs}export {}", T::decl(self.cfg));
            self.out.insert(name, decl);
            T::visit_dependencies(self);
        }
    }

    fn bindings() -> String {
        let cfg = Config::new().with_large_int("number");
        let mut decls = Decls {
            cfg: &cfg,
            out: BTreeMap::new(),
        };
        decls.visit::<HostInfo>();
        decls.visit::<HostMessage>();
        decls.visit::<LoadedConfig>();
        decls.visit::<Appearance>();
        decls.visit::<ThemeFile>();
        decls.visit::<SavedTheme>();
        decls.visit::<SavedFiles>();
        decls.visit::<ConfigChoice>();
        decls.visit::<Command>();
        decls.visit::<CommandResult>();
        decls.visit::<OrderedCommand>();
        decls.visit::<Error>();

        let mut text = format!(
            "// Generated from crates/host/src/api.rs by `{UPDATE}`.\n\n\
             export const PREVIEW_FILE_NAME = {PREVIEW_FILE_NAME:?};\n"
        );
        for decl in decls.out.values() {
            text.push('\n');
            text.push_str(decl);
            text.push('\n');
        }
        text
    }

    #[test]
    fn bindings_are_current() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../ui/core/bindings.ts");
        let text = bindings();
        if std::env::var_os("UPDATE_BINDINGS").is_some() {
            std::fs::write(path, text).unwrap();
        } else {
            let current = std::fs::read_to_string(path).unwrap_or_default();
            assert!(
                current == text,
                "ui/core/bindings.ts is stale. Run `{UPDATE}`."
            );
        }
    }

    fn json(value: impl Serialize) -> Value {
        serde_json::to_value(value).unwrap()
    }

    #[test]
    fn messages_and_errors_serialize_as_the_panel_reads_them() {
        assert_eq!(
            json(HostMessage::CloseRequested),
            json!({"type": "close-requested"})
        );
        assert_eq!(
            json(HostMessage::Fonts { fonts: vec![] }),
            json!({"type": "fonts", "fonts": []})
        );
        assert_eq!(
            json(Error::Input("No such theme".into())),
            json!({"kind": "input", "message": "No such theme"})
        );
        assert_eq!(
            json(Error::Internal("boom".into())),
            json!({"kind": "internal", "message": "boom"})
        );
    }
}
