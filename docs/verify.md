# Verify the window on Linux and macOS

GUI checks stay at smoke level: the window launches and renders, one edit
reaches the preview file, save works, and quit is clean. Never run the app or
Ghostty CLI actions against the real config or the user's running Ghostty.

## Linux: Lima VMs

| VM               | Use for                                                   |
| ---------------- | --------------------------------------------------------- |
| `gd-ubuntu-2404` | Window checks (default), X11 and Wayland                  |
| `gd-ubuntu-2204` | Window checks on the glibc floor, package builds (podman) |

`scripts/lima/provision.sh <vm>` creates, starts, and provisions a VM. It is
safe to rerun. When a script reports a missing tool, run it, not ad hoc
installs, so the VMs stay reproducible. Add new requirements to `provision.sh`.

Work in a VM only through these scripts. They keep everything under `~/gd` and
`~/gd-pkg`, and anything else in a VM home is disposable.

### Window

```sh
scripts/lima/window.sh gd-ubuntu-2404 start x11   # or wayland: builds the tree in the VM, then starts the window
scripts/lima/window.sh gd-ubuntu-2404 shot .cache/shot.png
scripts/lima/window.sh gd-ubuntu-2404 close       # like the close button, then shows the exit code
scripts/lima/window.sh gd-ubuntu-2404 stop
```

- Run one window per VM. `start` refuses while a window runs. If the window is
  yours, run `stop` first. Use a different VM to work in parallel.
- The app runs in a VM-local sandbox. Read its preview file with
  `limactl shell <vm> -- cat gd/sandbox/xdg/ghostty/ghostty-designer.conf`.
- To click by element instead of pixels, start the window with `--webdriver`:

  ```sh
  scripts/lima/window.sh gd-ubuntu-2404 start x11 --webdriver
  scripts/lima/window.sh gd-ubuntu-2404 click '//button[normalize-space()="Make readable"]'
  scripts/lima/window.sh gd-ubuntu-2404 js 'return document.body.innerText.includes("1 unsaved change")'
  ```

  `js` prints `{"value": ...}`. Under WebDriver the app is not incognito: it
  keeps webview data in the sandbox's `webview` state folder. `close` cannot
  report the exit code, so check a clean exit with a plain `start`.

### Packages

```sh
scripts/lima/packages.sh gd-ubuntu-2204 build
scripts/lima/packages.sh gd-ubuntu-2204 check ubuntu:22.04 ubuntu:24.04 fedora:44
```

`check` installs into fresh containers, so every run starts clean.

### Resources

Each VM takes 4 GiB of RAM. The scripts start a stopped VM automatically, so
stop VMs when you finish: `limactl stop <vm>`.

## macOS

- Run the window in a repo sandbox: `mise run sandbox run --name <name>`.
- Drive it with the [cua-driver](https://github.com/trycua/cua) CLI. Pass the
  same `"session":"<name>"` on every call, or pixel clicks fail with
  `screenshot_context_missing`.
- The web content is in the accessibility tree. Press controls by the
  `element_token` from a fresh snapshot. Avoid pixel clicks: background clicks
  do not register and foreground clicks are flaky. `set_value` on a text field
  does not commit the value, and background key presses (`hotkey`) do not reach
  the web view.
- Quit through the menu: `invoke_menu` with
  `["ghostty-designer","Quit Ghostty Designer"]`. cua-driver cannot press Dock →
  Quit, so a person checks it by hand.
