import {Channel, invoke, type InvokeArgs} from "@tauri-apps/api/core";
import {getCurrentWindow} from "@tauri-apps/api/window";
import type {CommandError, ConfigChoice, HostMessage} from "@/core/bindings";
import {SessionError} from "@/core/errors";
import {createHost} from "@/core/host";

/** Commands reject with a `CommandError`, or with a string from Tauri itself. */
async function call<T>(command: string, args?: InvokeArgs): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error) {
      const {kind, message} = error as CommandError;
      throw new SessionError(message, kind);
    }
    throw new SessionError(
      error instanceof Error ? error.message : String(error),
      "internal",
    );
  }
}

/** The app's commands and its one channel. */
export const host = createHost({
  connect: (onMessage) =>
    call("connect", {events: new Channel<HostMessage>(onMessage)}),
  call: (command) => call("call", {command}),
  callOrdered: (command) => call("call_ordered", {command}),
});

/** Reports the launch: null once the session has drawn, else why it failed. */
export const reportStart = (error: string | null) =>
  call<void>("report_start", {error});

export const closePromptShown = () => call<void>("close_prompt_shown");

export const closeWindow = () => call<void>("close_window");

export const canStayOnTop = () => call<boolean>("can_stay_on_top");

export const configChoices = () => call<ConfigChoice[]>("config_choices");

/**
 * Edits Ghostty's config with a null `path`, else the file at `path`, with
 * Ghostty's config as its base as `ghosttyBase` says, else as last chosen.
 * Reload the page once it resolves.
 */
export const switchConfig = (
  path: string | null,
  ghosttyBase: boolean | null,
) => call<void>("switch_config", {path, ghosttyBase});

/** The config file a later launch asked for, once. */
export const takeSwitchRequest = () =>
  call<string | null>("take_switch_request");

/** Takes `path` off the recent files. */
export const forgetConfig = (path: string) =>
  call<void>("forget_config", {path});

/** Keeps the window above other windows, or lets them cover it again. */
export const keepOnTop = (on: boolean) => getCurrentWindow().setAlwaysOnTop(on);
