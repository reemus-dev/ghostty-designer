# ghostty-designer

`ghostty-designer` is a CLI and native control panel window for designing
Ghostty's appearance: themes, fonts, colors, cursor, and window. The user's real
Ghostty windows are the live preview: the designer writes a preview config file
and reloads Ghostty. It is a Tauri app for macOS and Linux: a Rust host for the
native work, and a React panel, embedded in the binary, that owns the design
session in TypeScript.

## Where to work

| Area                             | Responsibility                                                         |
| -------------------------------- | ---------------------------------------------------------------------- |
| `crates/app/`                    | Tauri shell: CLI, window, menu, single instance, launch and exit       |
| `crates/app/src/main.rs`         | Entry, `specimen` subcommand, window and menu, signals, shutdown       |
| `crates/app/src/panel.rs`        | Host commands for the panel, the close guard for unsaved changes       |
| `crates/app/src/instance.rs`     | One designer per state folder, focus requests from later launches      |
| `crates/app/src/launch.rs`       | Detach from the terminal, startup report, error dialog                 |
| `crates/app/src/fonts.rs`        | `font://` protocol that serves font faces to the panel                 |
| `crates/host/`                   | The native side, no Tauri or GUI dependency:                           |
| `crates/host/src/host.rs`        | Host: commands, watches, instance poll, write limit, shutdown fence    |
| `crates/host/src/api.rs`         | Host contract and commands, generates `ui/core/bindings.ts` with ts-rs |
| `crates/host/src/preview.rs`     | Preview file engine, crash recovery, include status                    |
| `crates/host/src/save.rs`        | Transactional write, backups, restore original, new theme files        |
| `crates/host/src/config_file.rs` | Include walk: the config files Ghostty loads, in its order             |
| `crates/host/src/ghostty.rs`     | Detect Ghostty, run CLI actions, find instances, reload                |
| `crates/host/src/themes.rs`      | Read the bundled and user theme files                                  |
| `crates/host/src/fonts.rs`       | Background font scan and face files                                    |
| `crates/host/src/watch.rs`       | Folder watches that report once their events settle                    |
| `crates/host/src/specimen.rs`    | `specimen` printout of `specimen.json`, which the panel renders too    |
| `crates/host/src/env.rs`         | Process environment read once, so tests and sandboxes stay isolated    |
| `crates/host/src/testkit.rs`     | Temporary `Env` and a fake Ghostty CLI for tests                       |
| `crates/host/tests/fixtures/`    | Ghostty 1.3.1 outputs, the baseline config, font fixtures              |
| `ui/`                            | React panel: two views, Customise and Themes, both kept mounted        |
| `ui/core/`                       | The session: config, catalog, draft, undo, intents, themes, save plans |
| `ui/core/testing/`               | Scenario replay on the Rust host over stdio (`host/examples/`)         |
| `ui/core/scenarios/`             | Session scenarios and their recordings                                 |
| `ui/app/`                        | Header, view switch, bottom bar, ⌘K palette, save sheet, first run     |
| `ui/features/`                   | Customise sections (colors, fonts, window) and the Themes view         |
| `ui/components/`                 | Shared controls, with shadcn components in `components/ui/`            |
| `ui/lib/`                        | Store, host commands, view helpers, specimen pages                     |
| `scripts/`                       | Sandbox runner, Linux smoke, Lima VM scripts                           |
| `docs/`                          | Architecture and distribution decisions, native window checks          |
| `.github/workflows/`             | CI on macOS and Linux                                                  |

## Design constraints

- Rust does only what a native process must do: read, watch and write files, run
  Ghostty, the preview file engine, atomic saves with backups, fonts, the CLI,
  the window and its lifecycle. The panel owns everything else. Keep
  `crates/host/` free of Tauri. The app crate wires the host to the window.
- A save or restore writes only the config path and the files the config loads,
  which the host walks itself.
- Host commands and channel messages are typed in `api.rs`. After changing it,
  run `UPDATE_BINDINGS=1 cargo test -p ghostty-designer-host bindings`.
- The views render the session's `SessionState` and send `Intent`s. Domain rules
  live in `ui/core/`. The session runs requests one at a time. Keep the ordering
  rules that `startSession` documents when you add a request or a host message.
- Add shadcn components (Base UI variant) with
  `bunx shadcn@<version> add <name>`. `components.json` is hand-written because
  `shadcn init` does not support Bun projects.

## Development

Install the pinned toolchain with `mise install` and dependencies with
`mise run install`. `.mise.toml` is the authority for commands and tool
versions.

```sh
mise run check            # typecheck, lint, bun test, clippy, Rust tests and format check, read-only
mise run fix              # apply oxlint's safe fixes, then format TS and Rust files
mise run test:scenarios   # replay the session scenarios against Ghostty 1.3.1
mise run build            # build dist/ghostty-designer
```

`typecheck` checks two programs: the panel, which sees no Bun or Node types, and
the scripts and tests, which do. `bun test` runs the panel's unit tests.
`test:scenarios` drives the session with the Rust host and real Ghostty 1.3.1 in
sandbox roots. `UPDATE_RECORDINGS=1` rewrites the recordings. Review the diff
before you commit it. `ui/core/scenarios/README.md` describes the format.

When a lint rule flags intentional code, keep the rule on and disable it at that
site with a reason: `oxlint-disable-next-line` with a comment in TypeScript,
`#[expect(lint, reason = "…")]` in Rust. Turn a rule off only when its findings
are mostly noise.

`mise run dev` and the built binary edit the real config and reload the user's
Ghostty, so only the user runs them. Never run the designer or Ghostty CLI
actions against the real config. Ghostty resolves Application Support through
Foundation, which ignores `HOME`, so a changed `XDG_CONFIG_HOME` alone still
reaches the real one. Use a sandbox instead:

```sh
mise run sandbox run         # build and run the app in the sandbox
mise run sandbox run --dev   # the same, with a hot-reloading UI
mise run sandbox env         # export lines for other commands in the sandbox
mise run sandbox reset --no-include   # baseline config without the preview include
```

Each sandbox has its own home, config, state and lock under
`.cache/sandboxes/<name>/`, seeded with a baseline config. `--name <name>` picks
one (default `default`), so parallel runs never collide. The app targets a
stand-in process instead of Ghostty, so nothing reloads. Check previews in the
sandbox's config and preview files.

To check the native window on Linux (Lima VMs) or macOS, follow
`docs/verify.md`.

CI installs the tracked mise toolchain and invokes the same mise tasks used
locally. Do not introduce independent version sources.
