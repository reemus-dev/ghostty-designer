// Generated from crates/host/src/api.rs by `UPDATE_BINDINGS=1 cargo test -p ghostty-designer-host bindings`.

export const PREVIEW_FILE_NAME = "ghostty-designer.conf";

export type Appearance = "light" | "dark";

/**
 * The panel's commands that run concurrently, with their arguments.
 */
export type Command = { "command": "load_config" } | { "command": "show_config" } | { "command": "validate_config", "args": { text: string, } } | { "command": "system_appearance" } | { "command": "load_themes" } | { "command": "write_theme", "args": { name: string, text: string, } } | { "command": "reset_font_size" } | { "command": "apply_save", "args": { edits: Array<SaveEdit>, } } | { "command": "restore_original" } | { "command": "write_state", "args": { text: string, } };

/**
 * A command failure. `input` refuses a request the files or the arguments do
 * not allow, and says why. `internal` is an operation that failed, such as a
 * read or a write, and is also logged.
 */
export type CommandError = { "kind": "input", "message": string } | { "kind": "internal", "message": string };

/**
 * What a `Command` returns, tagged with the command's name.
 */
export type CommandResult = { "command": "load_config", "result": LoadedConfig } | { "command": "show_config", "result": string } | { "command": "validate_config", "result": string } | { "command": "system_appearance", "result": Appearance } | { "command": "load_themes", "result": Array<ThemeFile> } | { "command": "write_theme", "result": SavedTheme | null } | { "command": "reset_font_size", "result": boolean } | { "command": "apply_save", "result": SavedFiles } | { "command": "restore_original", "result": SavedFiles } | { "command": "write_state" };

export type ConfigFile = { path: string, 
/**
 * The file decoded as UTF-8, invalid bytes as U+FFFD, with its byte
 * order mark.
 */
text: string, 
/**
 * False when the file is not valid UTF-8, so `text` is not its content.
 */
utf8: boolean, };

export type FontAxis = { tag: string, name: string, min: number, max: number, default: number, };

export type FontFace = { style: string, 
/**
 * Opaque id for `font://localhost/<id>`.
 */
id: string, };

export type FontFamily = { family: string, faces: Array<FontFace>, nerd: boolean, 
/**
 * The feature tags the faces offer, in byte order: AAT `morx` features
 * as OpenType tags, or GSUB and GPOS features of the default script, or
 * else Latin.
 */
features: Array<string>, axes: Array<FontAxis>, };

export type GhosttyInfo = { version: string, platform: Platform, 
/**
 * The main config the designer edits.
 */
configPath: string, };

/**
 * What `connect` returns.
 */
export type HostInfo = { ghostty: GhosttyInfo, 
/**
 * `ghostty +show-config --default --docs`, run once at start.
 */
defaultsWithDocs: string, 
/**
 * null while the first font scan runs. A "fonts" message follows.
 */
fonts: Array<FontFamily> | null, 
/**
 * Running Ghostty instances the preview reloads.
 */
instances: number, 
/**
 * The panel's own text from its last `write_state`, kept in `state.json`
 * in the state folder. null when the file is missing or unreadable.
 */
persisted: string | null, 
/**
 * The panel's own blob from its last `report_draft`, so a reloaded page
 * can pick up where the crashed one left.
 */
stash: string | null, };

/**
 * Messages on the panel's channel.
 */
export type HostMessage = { "type": "config-changed" } | { "type": "themes-changed" } | { "type": "fonts", fonts: Array<FontFamily>, } | { "type": "instances", count: number, } | { "type": "preview-status", id: string, apply: PreviewStatus, } | { "type": "close-requested" };

/**
 * A `config-file` line with an empty value, which drops the includes still
 * queued.
 */
export type IncludeReset = { path: string, 
/**
 * 1-based.
 */
line: number, };

export type LoadedConfig = { 
/**
 * The files Ghostty loads, in its order, without the preview file.
 */
files: Array<ConfigFile>, preview: PreviewInclude, 
/**
 * With `preview` absent: the line that dropped the preview include.
 */
previewClearedBy: IncludeReset | null, 
/**
 * True when a backup of the pre-designer config exists.
 */
canRestoreOriginal: boolean, };

/**
 * The panel's commands that return at once. They run in the order the
 * panel sends them, so a later preview always replaces an earlier one.
 */
export type OrderedCommand = { "command": "preview_apply", "args": { id: string, text: string, } } | { "command": "preview_revert", "args": { id: string, } } | { "command": "report_draft", "args": { changes: number, stash: string | null, } } | { "command": "rescan_fonts" };

export type Platform = "macos" | "linux";

/**
 * Whether the preview file loads, and whether a file loading after it can
 * beat the draft.
 */
export type PreviewInclude = "absent" | "last" | "shadowed";

export type PreviewState = "idle" | "applying" | "applied" | "error";

export type PreviewStatus = { state: PreviewState, error?: string, 
/**
 * With `error`: the keys Ghostty rejected. The preview shows every other
 * change.
 */
rejected?: Array<string>, };

/**
 * One file of a save: its content when planned, null when absent, and its
 * new content.
 */
export type SaveEdit = { path: string, before: string | null, after: string, };

export type SavedFiles = { 
/**
 * The previous versions of the files the save replaced.
 */
backupDir: string, files: Array<string>, };

export type SavedTheme = { path: string, };

/**
 * A theme file from the bundled or the user themes folder.
 */
export type ThemeFile = { name: string, source: ThemeSource, text: string, };

export type ThemeSource = "user" | "bundled";
