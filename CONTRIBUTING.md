# Contributing

## Setup

Requires [Mise](https://mise.jdx.dev/), which installs the pinned toolchain. On
Linux, the build also needs the GTK 3 and WebKitGTK 4.1 development packages
(`libwebkit2gtk-4.1-dev` on Debian and Ubuntu).

```sh
git clone https://github.com/reemus-dev/ghostty-designer.git
cd ghostty-designer
mise install
mise run install
mise run check
```

## Run in a sandbox

`mise run dev` edits your real config and reloads your Ghostty. To work without
touching either, run the app in a sandbox. Each sandbox has its own home, config
and state under `.cache/sandboxes/<name>/`, and never reloads Ghostty, so
previews land only in its config files. In a shell with Mise activated, the
commands in `scripts/` are on `PATH`:

```sh
sandbox.ts --name try run      # run the app from source in the sandbox "try"
sandbox.ts --name try start    # the same, in the background
sandbox.ts --name try stop     # quit the background app
sandbox.ts --name try reset    # restore the sandbox's baseline config
```

Add `--dev` to `run` or `start` for a hot-reloading panel. Sandboxes with
different names run side by side.

`mise run dev` and sandboxes serve WebDriver on 127.0.0.1, so `panel.ts` can
drive the panel. [docs/verify.md](docs/verify.md) covers driving the app and the
Lima VMs for Linux.

## Tasks

| Task                      | Action                                                                    |
| ------------------------- | ------------------------------------------------------------------------- |
| `mise run check`          | Typecheck, lint, unit tests, clippy, Rust tests and format check          |
| `mise run fix`            | Apply safe lint fixes, then format TypeScript and Rust                    |
| `mise run test:scenarios` | Replay the session scenarios against an installed Ghostty 1.3.1           |
| `mise run build`          | Build `dist/ghostty-designer`                                             |
| `mise run dev`            | Run from source with a hot-reloading panel, against your real config      |
| `mise run dev:reset`      | Make the next `dev` run a first launch, keeping saved settings and themes |

CI runs `check` on macOS and Linux, and the scenarios on macOS.

## Where to read next

- [docs/architecture.md](docs/architecture.md): what the Rust host owns and what
  the panel owns, and why.
- [docs/distribution.md](docs/distribution.md): how releases are packaged for
  each platform.
- [AGENTS.md](AGENTS.md): the code map, design constraints and conventions that
  the agents building this project follow.
