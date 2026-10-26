# Run and drive the app

Run the app in a sandbox or a Lima VM, and drive its panel to answer a specific
question about your change.

## Sandbox

`AGENTS.md` lists the `sandbox.ts` commands.

- `start` returns once the panel answers, and refuses while the sandbox runs.
  The app's output goes to `.cache/sandboxes/<name>/run.log`.
- `start --dev` serves the UI with hot reloading. It also restarts the app on
  every Rust edit, including another session's, so the app loses its state.

## Drive the panel

Development builds serve WebDriver from inside the app, so `panel.ts` drives the
panel on both systems. It finds the panel's elements in the page, not on the
screen, so it needs no focus or pixel coordinates, and it scrolls an element
into view before it clicks it.

```sh
panel.ts --name <name> click '[aria-label="Themes"]'
panel.ts --name <name> wait '[role="dialog"]'
panel.ts --name <name> fill '[aria-label="Search themes"]' nord
panel.ts --name <name> key Meta+k
panel.ts --name <name> drag '//input[@aria-label="Cursor opacity"]/..' -60,0
panel.ts --name <name> js 'return document.activeElement.ariaLabel'
panel.ts --name <name> text '//h2[contains(., "Nord")]/..'
panel.ts --name <name> shot .cache/nord.png '[data-theme="Nord"]'
```

- `--name` picks a sandbox, `--vm` a Lima VM, and `--dev` the user's dev
  instance, whose edits reach the real config and Ghostty.
- Selectors are CSS, or XPath when they start with `/`. Both views stay mounted,
  so a command acts on the one visible match. It waits up to five seconds for
  one, then fails when there are none or several.
- `click` presses the pointer like a mouse in WebKit: only a text field takes
  focus, so no focus ring or tooltip shows on the clicked button.
- `js` runs an async function body, so it can `await` a condition.
- `shot` captures the web content only. The window frame, title bar and menus
  need a screenshot of the screen.

## Tour the panel

`tour.ts` resets a `tour` sandbox, walks the panel through its views, popups and
dialogs, and screenshots each stop into `.cache/tour/`. It walks twice: in the
default 1200 × 800 window, and in the narrowest one the window allows. Its
`index.html` maps how the stops connect, then shows each stop's screenshots side
by side, for a visual audit of the whole panel. From a terminal, the tour opens
the page in the browser. Runs on one machine give the same screenshots. When you
add a view, popup or dialog, add a stop to `STOPS` in `tour.ts`.

## Real input

`panel.ts` sends the page synthetic events. They cover clicks, typing, the
panel's own shortcuts and pointer drags such as sliders. Use real input only for
what they never reach:

| Check                                                    | Why the page's events miss it                 |
| -------------------------------------------------------- | --------------------------------------------- |
| Menu items and their shortcuts: Quit, Close, ⌘W, Ctrl+W  | The native menu takes the key before the page |
| Title bar, traffic lights, window frame, moving a window | They are outside the page                     |
| HTML drag and drop, such as swapping two colour slots    | Only the real pointer starts a drag           |
| Hover styles                                             | `:hover` follows the real pointer             |

Read window state, such as always on top, with the system's tools, and confirm
every outcome with `panel.ts js` or the sandbox's files.

- **Linux VM:** the VM has its own display and input, so use real input freely.
  It works only in an `x11` window, because headless sway gives the app no
  pointer. Run `xdotool` on display `:99` through `limactl shell <vm> --`. Place
  the pointer at the window's `xwininfo` absolute corner plus the element's
  position from `panel.ts js`. `xdotool getwindowgeometry` reports the corner
  too low. Move a drag in several steps, or the drop does not register.
- **macOS:** use the [cua-driver](https://github.com/trycua/cua) CLI on the
  window. Several designers can be open, so find the sandbox's pid with
  `lsof -ti tcp:$(cat .cache/sandboxes/<name>/webdriver-port) -sTCP:LISTEN`.
  Pass the same `"session":"<name>"` on every call, or pixel clicks fail with
  `screenshot_context_missing`. Background actions are safe: `invoke_menu`, such
  as `["ghostty-designer","Quit Ghostty Designer"]`, and presses on window
  elements. Foreground input moves the user's real pointer and keyboard, so ask
  the user first, or run the check in a Linux VM. cua-driver cannot press Dock →
  Quit, so a person checks it by hand.

## Linux: Lima VMs

| VM               | Use for                                                   |
| ---------------- | --------------------------------------------------------- |
| `gd-ubuntu-2404` | Window checks (default), X11 and Wayland                  |
| `gd-ubuntu-2204` | Window checks on the glibc floor, package builds (podman) |

`vm.sh <vm> provision` creates, starts, and provisions a VM. It is safe to
rerun. When a script reports a missing tool, run it, not ad hoc installs, so the
VMs stay reproducible. Add new requirements to its `provision` action.

Work in a VM only through `vm.sh`, plus `limactl shell <vm> --` for reads and
`limactl stop <vm>`. The script keeps everything under `~/gd` and `~/gd-pkg`,
and anything else in a VM home is disposable.

### Window

```sh
vm.sh gd-ubuntu-2404 start x11   # or wayland: builds the tree in the VM, then starts the window
vm.sh gd-ubuntu-2404 shot .cache/shot.png
vm.sh gd-ubuntu-2404 close       # like the close button, then shows the exit code
vm.sh gd-ubuntu-2404 stop
```

- Run one window per VM. `start` refuses while a window runs. If the window is
  yours, run `stop` first. Use a different VM to work in parallel.
- The app runs in a VM-local sandbox. Read its preview file with
  `limactl shell <vm> -- cat gd/sandbox/xdg/ghostty/ghostty-designer.conf`.
- Drive the panel with `panel.ts --vm gd-ubuntu-2404 …`.
- Before a build, `start` removes the VM's build folder when the disk has under
  8 GiB free, because Cargo never removes stale build files. `packages build`
  does the same for its own folder.

### Packages

```sh
vm.sh gd-ubuntu-2204 packages build
vm.sh gd-ubuntu-2204 packages check ubuntu:22.04 ubuntu:24.04 fedora:44
```

`check` installs into fresh containers, so every run starts clean.

### Resources

Each VM takes 4 GiB of RAM. `vm.sh` starts a VM that is shut down, so shut down
VMs when you finish: `limactl stop <vm>`.
