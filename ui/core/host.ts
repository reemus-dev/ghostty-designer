// What the session needs from the native process: Ghostty, the files it
// reads and writes, the preview file and the window. The app implements it
// over its commands and one channel.
import type {
  Appearance,
  Command,
  CommandResult,
  HostInfo,
  HostMessage,
  LoadedConfig,
  OrderedCommand,
  SavedFiles,
  SaveEdit,
  ThemeFile,
} from "@/core/bindings";
import {SessionError} from "./errors";

/** Every method rejects with a `SessionError`. */
export type Host = {
  /** Subscribes to the host's messages and reports what it knows at start. */
  connect(onMessage: (message: HostMessage) => void): Promise<HostInfo>;
  /** Reads the config files again, and watches them from now on. */
  loadConfig(): Promise<LoadedConfig>;
  /** `ghostty +show-config` of the saved config, without the preview file. */
  showConfig(): Promise<string>;
  /** Ghostty's complaints about a config text, or "" when it is valid. */
  validateConfig(text: string): Promise<string>;
  systemAppearance(): Promise<Appearance>;
  loadThemes(): Promise<ThemeFile[]>;
  /** Creates a user theme, or resolves false when the name is taken. */
  writeTheme(name: string, text: string): Promise<boolean>;
  /** Renames a user theme, or resolves false when the new name is taken. */
  renameTheme(name: string, to: string): Promise<boolean>;
  deleteTheme(name: string): Promise<void>;
  /** Shows the text in every instance. Its statuses carry `id`. */
  previewApply(id: string, text: string): Promise<void>;
  /** Clears the preview file. Its statuses carry `id`. */
  previewRevert(id: string): Promise<void>;
  resetFontSize(): Promise<void>;
  /** Writes the edits, each only if its file still holds `before`. */
  applySave(edits: SaveEdit[]): Promise<SavedFiles>;
  /** Puts back the config files as they were before the first save. */
  restoreOriginal(): Promise<void>;
  /** Replaces the text that `connect` reports as `persisted`. */
  writeState(text: string): Promise<void>;
  /**
   * The number of unsaved changes for the close guard, and a blob that
   * `connect` returns after the page reloads.
   */
  reportDraft(changes: number, stash: string): Promise<void>;
  rescanFonts(): Promise<void>;
};

/**
 * How a host reaches the native process. Each call rejects with a
 * `SessionError`.
 */
export type HostTransport = {
  connect: (onMessage: (message: HostMessage) => void) => Promise<HostInfo>;
  call: (command: Command) => Promise<CommandResult>;
  /** For the commands that must run in the order they are sent. */
  callOrdered: (command: OrderedCommand) => Promise<void>;
};

/** Each command's result, by command name. */
type Results = {
  [R in CommandResult as R["command"]]: R extends {result: infer T} ? T : void;
};

/** The host over a transport. */
export function createHost({connect, call, callOrdered}: HostTransport): Host {
  const run = async <C extends Command>(
    command: C,
  ): Promise<Results[C["command"]]> => {
    const reply = await call(command);
    if (reply.command !== command.command) {
      throw new SessionError(
        `${command.command} received the result of ${reply.command}`,
        "internal",
      );
    }
    return (
      "result" in reply ? reply.result : undefined
    ) as Results[C["command"]];
  };
  return {
    connect,
    loadConfig: () => run({command: "load_config"}),
    showConfig: () => run({command: "show_config"}),
    validateConfig: (text) => run({command: "validate_config", args: {text}}),
    systemAppearance: () => run({command: "system_appearance"}),
    loadThemes: () => run({command: "load_themes"}),
    writeTheme: (name, text) =>
      run({command: "write_theme", args: {name, text}}),
    renameTheme: (name, to) => run({command: "rename_theme", args: {name, to}}),
    deleteTheme: (name) => run({command: "delete_theme", args: {name}}),
    previewApply: (id, text) =>
      callOrdered({command: "preview_apply", args: {id, text}}),
    previewRevert: (id) => callOrdered({command: "preview_revert", args: {id}}),
    resetFontSize: () => run({command: "reset_font_size"}),
    applySave: (edits) => run({command: "apply_save", args: {edits}}),
    restoreOriginal: () => run({command: "restore_original"}),
    writeState: (text) => run({command: "write_state", args: {text}}),
    reportDraft: (changes, stash) =>
      callOrdered({command: "report_draft", args: {changes, stash}}),
    rescanFonts: () => callOrdered({command: "rescan_fonts"}),
  };
}
