# Session scenarios

`*.json` here are scenarios. `recordings/<name>.json` records what the session
did for each. `mise run test:scenarios` runs `../testing/replay.ts` with
`bun test`: it replays every scenario against the installed Ghostty, which must
be 1.3.1, and compares each run with its recording after the normalisation
below. With `UPDATE_RECORDINGS=1` it writes the recordings from the run instead,
which also records a new scenario. Plain `bun test` skips the replay, because
the runner's file name is outside its pattern. `-t <name>` replays one scenario.

## Sandbox

Each scenario gets a fresh root with `home/`, `xdg/`, `state/` and `tmp/`, and
the session runs on the app's Rust host. `../testing/host.ts` sends each host
call to `crates/host/examples/stdio-host.rs`, which `test:scenarios` builds
first. Only Tauri's command registration and channel are left out. The host runs
with HOME and CFFIXED_USER_HOME at `home`, XDG_CONFIG_HOME at `xdg`,
XDG_STATE_HOME at `state`, XDG_CACHE_HOME at `home/.cache`, TMPDIR at `tmp`, and
GHOSTTY_CONFIG_PATH and the config at `xdg/ghostty/config`. It has no target
instances, so nothing is reloaded. The preview file is
`xdg/ghostty/ghostty-designer.conf`, and only bundled themes exist. A stand-in
`defaults` in `home/bin` makes the system appearance dark. The font list is the
machine's, and the recordings leave it out. Four scenarios run at once.

## Scenario

`{description, setup?, steps}`. In `setup`, `files` maps root-relative paths to
text. The config is `config` (default `<baseline>`, which expands to
`crates/host/tests/fixtures/ghostty-1.3.1/baseline.conf`) plus
`config-file = ?ghostty-designer.conf`, unless `include` is false. Setup writes
the files, then the config. `<root>` expands to the absolute root.

A step is `{op, ...}` with optional `note` and `expect`:

- `intent` (`intent`: an `Intent`), `plan-save`, `restore-original`, `settle`
  (only observes).
- `save`: saves the latest plan, without a colour backup.
- `write-file` (`path`, `text`, `append?`): an external write.

## Recording

A recording is `{start, steps}`. `start` is the settled state after startup:
`{state, apply, files, errors?}`. Each step has `{op, apply, files, errors?}`
and `reply` or `error` (`input` or `internal`: an error's kind is the contract,
its message is wording).

- `reply` is `{state}` (intent, restore-original, settle: the state the session
  last published once the request resolved), `{plan}`, `{result}` or null.
- `apply` is the apply status once the step settled. A reply has none.
- `files` holds the files changed since the previous step: new text, or null
  when deleted. The start's files are every file under the root but `home/` and
  `tmp/`, state dir included, where `previous/` and `original/files/` mirror
  paths as `<root>/...`.
- A step's `state` holds the keys that changed since the previous recorded
  state, whole, but for `saved`, `effective`, `provenance` and `own.colors` only
  the changed entries (null: removed or back to Ghostty's default). `saved` and
  `effective` key each palette colour as `palette:N`.
- `errors` lists the session's background error messages, when there are any.

## Settled

After every step, the runner waits for the `expect` message (`state`, sent since
the step began), then until no message came for 800 ms. That covers debounced
refreshes, including echoes of the session's own writes. Startup waits for the
first font list and the same quiet time. Waiting longer than 15 s fails the
scenario.

## Normalisation

The root becomes `<root>` in text and file keys (keys lose the leading slash),
and the login shell, Ghostty's default `command`, becomes `<shell>`. Text of
several lines, such as file text and plan diffs, becomes a list of its lines, so
a recording diff shows the lines that changed. Plan ids become `plan-N`. `saved`
and `effective` leave out the keys at the default that the host reads from
Ghostty at start, and `provenance` the keys from `default`. Dropped: `ratio` and
`fix` of warnings (colour maths). Key order is not compared, except in preview
text.
