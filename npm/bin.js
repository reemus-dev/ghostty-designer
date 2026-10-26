#!/usr/bin/env node
// Runs the build for this machine. The package holds one per platform, in
// bin/<platform>-<arch>, from the release archives.
import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";

const build = `${process.platform}-${process.arch}`;
// The binary runs from inside the bundle, so macOS shows the app's name and icon.
const file =
  process.platform === "darwin"
    ? "Ghostty Designer.app/Contents/MacOS/ghostty-designer"
    : "ghostty-designer";
const binary = fileURLToPath(new URL(`bin/${build}/${file}`, import.meta.url));
if (!existsSync(binary)) {
  console.error(`ghostty-designer: this package has no build for ${build}`);
  process.exit(1);
}

const app = spawn(binary, process.argv.slice(2), {stdio: "inherit"});
// The app exits through its shutdown on these, so they go to it, not to Node.
/** @type {NodeJS.Signals[]} */
const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
for (const signal of signals) {
  process.on(signal, () => app.kill(signal));
}
app.on("error", (error) => {
  throw error;
});
app.on("exit", (status, signal) => {
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  }
  process.exit(status ?? 1);
});
