# Architecture: the domain lives in the panel

The Rust host does only what a native process must do. The panel owns the design
session in TypeScript.

| Rust host (`crates/host/`)                                   | Panel (`ui/core/`)                             |
| ------------------------------------------------------------ | ---------------------------------------------- |
| Read, watch and write files                                  | Parse config files, the option catalog         |
| Run the Ghostty CLI, find and reload instances               | The draft, undo, intents                       |
| The preview file engine and crash recovery                   | Colours, readability warnings, theme matching  |
| Atomic saves with backups, restore of the original           | Save plans and their diffs                     |
| The include walk, which limits a save to the config's files  | What Ghostty shows for a draft, and where from |
| Font scans and font files, the CLI, the window and lifecycle |                                                |

The two meet in typed host commands and one message channel, defined in
`crates/host/src/api.rs`.

## Why

- **One owner per concept.** The panel must render every edit at once, so it
  needs the colour, theme and value rules itself. With those rules also in Rust,
  each one existed twice, and the two copies had to be kept in step by hand.
- **Tauri does not require a Rust domain.** The webview runs the same TypeScript
  a browser would. A web page cannot read the user's files or run Ghostty, so
  only that work crosses into Rust.
- **The host stays small and testable.** `crates/host/` has no Tauri or GUI
  dependency. Its tests and the session scenarios run it with a fake Ghostty or
  the real CLI in sandbox folders.

## Alternative considered

**The whole domain in Rust, the panel only renders.** Every rule the panel shows
instantly would then need a copy in TypeScript or a round trip per edit. This
was built and reverted, because of the duplication.

## Consequences

- A save writes only the config path and the files the config loads, which the
  host walks itself. A bug in the panel cannot widen that.
- Commands that must keep their order, such as preview applies, are synchronous
  host commands. The others run concurrently. See `Command` and `OrderedCommand`
  in `api.rs`.
