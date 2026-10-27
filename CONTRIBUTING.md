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
| `mise run test:scenarios` | Replay the session scenarios against the installed Ghostty                |
| `mise run build`          | Build `dist/ghostty-designer`                                             |
| `mise run dev`            | Run from source with a hot-reloading panel, against your real config      |
| `mise run dev:reset`      | Make the next `dev` run a first launch, keeping saved settings and themes |

CI runs `check` on macOS and Linux, and the scenarios on macOS.

## Ghostty versions

The designer supports Ghostty 1.3.1 and later. CI replays the scenarios against
the oldest supported version and the newest release, which the `scenarios` job
in [ci.yml](.github/workflows/ci.yml) lists. Both share one set of recordings.

When Ghostty releases a new version:

1. Make it the newest version in the `scenarios` job, with its DMG's SHA-256.
2. Replace `crates/host/tests/fixtures/ghostty-<version>/` with its `+version`
   and `+show-config --default --docs` output, captured in a sandbox shell
   (`eval "$(sandbox.ts --name <name> env)"`). Update the paths and tests that
   name the folder.
3. Compare its source with the previous release for every option in
   `ui/core/options.ts`: new keys and values, reload behaviour and platforms.
   Add a note where an older supported version behaves differently, such as
   "needs Ghostty 1.4".
4. Run `mise run test:scenarios` with it installed.

To raise the oldest supported version, change it in the `scenarios` job and in
the README's requirements. Then resolve the `[UNTIL]` markers that it satisfies,
and delete the notes about older versions.

## Where to read next

- [docs/architecture.md](docs/architecture.md): what the Rust host owns and what
  the panel owns, and why.
- [docs/distribution.md](docs/distribution.md): how releases are packaged for
  each platform.
- [AGENTS.md](AGENTS.md): the code map, design constraints and conventions that
  the agents building this project follow.
