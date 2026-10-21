import {Channel, invoke, type InvokeArgs} from "@tauri-apps/api/core";
import type {CommandError, HostMessage} from "@/core/bindings";
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

export const closePromptShown = () => call<void>("close_prompt_shown");

export const closeWindow = () => call<void>("close_window");
