// The native host for the scenario replay: the app's Rust host, run over
// stdio by crates/host/examples/stdio-host.rs against a sandbox root. It
// sends the app's commands through the same `createHost`, so only Tauri's
// invoke and channel are left out. Every Ghostty call runs with the
// sandbox's home, config and state, and no instance is ever reloaded.
import {existsSync, mkdirSync, writeFileSync} from "node:fs";
import path from "node:path";
import type {
  CommandError,
  CommandResult,
  HostInfo,
  HostMessage,
} from "@/core/bindings";
import {SessionError} from "@/core/errors";
import {createHost, type Host} from "@/core/host";

const BIN = path.join(
  import.meta.dir,
  "../../../target/debug/examples/stdio-host",
);
const CLOSE_TIMEOUT_MS = 10_000;

type Line =
  | {id: number; ok: unknown}
  | {id: number; error: CommandError}
  | {message: HostMessage};

type Call = {
  resolve: (value: unknown) => void;
  reject: (error: SessionError) => void;
};

export type TestHost = Host & {
  /**
   * Closes the host, which clears the preview. Nothing reaches the panel after
   * it.
   */
  close(): Promise<void>;
};

/** Starts the host for the sandbox at `root` with the Ghostty CLI `ghostty`. */
export function startTestHost(root: string, ghostty: string): TestHost {
  if (!existsSync(BIN)) {
    throw new Error(`${BIN} is missing: run mise run test:scenarios`);
  }
  const home = path.join(root, "home");
  // cfprefsd answers `defaults` with the real user's appearance whatever the
  // sandbox's home, so a stand-in answers instead.
  const bin = path.join(home, "bin");
  mkdirSync(bin, {recursive: true});
  writeFileSync(path.join(bin, "defaults"), "#!/bin/sh\necho Dark\n", {
    mode: 0o755,
  });

  const child = Bun.spawn([BIN], {
    env: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HOME: home,
      CFFIXED_USER_HOME: home,
      XDG_CONFIG_HOME: path.join(root, "xdg"),
      XDG_STATE_HOME: path.join(root, "state"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      TMPDIR: path.join(root, "tmp"),
      GHOSTTY_DESIGNER_GHOSTTY: ghostty,
      // Set but empty: no instances, and no discovery.
      GHOSTTY_DESIGNER_TARGET_PID: "",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });

  let onMessage: ((message: HostMessage) => void) | undefined;
  let closed = false;
  let ids = 0;
  const pending = new Map<number, Call>();

  const receive = (text: string) => {
    const line = JSON.parse(text) as Line;
    if ("message" in line) {
      if (!closed) onMessage?.(line.message);
      return;
    }
    const call = pending.get(line.id);
    pending.delete(line.id);
    if ("error" in line) {
      call?.reject(new SessionError(line.error.message, line.error.kind));
    } else {
      call?.resolve(line.ok);
    }
  };

  void (async () => {
    const chunks = child.stdout.pipeThrough(new TextDecoderStream());
    let partial = "";
    for await (const chunk of chunks) {
      const lines = (partial + chunk).split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) receive(line);
    }
    const code = await child.exited;
    for (const call of pending.values()) {
      call.reject(new SessionError(`The host exited with ${code}`, "internal"));
    }
    pending.clear();
  })();

  /** Sends a request named after the app's Tauri command, with its argument. */
  const request = (name: "connect" | "call" | "call_ordered", arg: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      if (closed) {
        reject(new SessionError("The host is closed", "internal"));
        return;
      }
      const id = ++ids;
      pending.set(id, {resolve, reject});
      void child.stdin.write(`${JSON.stringify({id, [name]: arg})}\n`);
      void child.stdin.flush();
    });

  return {
    ...createHost({
      connect: (listener) => {
        onMessage = listener;
        return request("connect", null) as Promise<HostInfo>;
      },
      call: (command) => request("call", command) as Promise<CommandResult>,
      callOrdered: async (command) => {
        await request("call_ordered", command);
      },
    }),

    async close() {
      if (closed) return;
      closed = true;
      void child.stdin.end();
      const code = await Promise.race([
        child.exited,
        Bun.sleep(CLOSE_TIMEOUT_MS).then(() => null),
      ]);
      if (code === null) {
        child.kill();
        throw new Error("The host did not close in time");
      }
      if (code !== 0) throw new Error(`The host closed with ${code}`);
    },
  };
}
