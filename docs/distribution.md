# Distribution

Decided on 2026-10-20, from probes of a window-only build of the app. Release
work builds on these facts.

## macOS: an app bundle, entered through an exec script

Ship `Ghostty Designer.app` holding the single binary. The Homebrew formula puts
the bundle in its prefix and writes `bin/ghostty-designer` with
`write_exec_script`, not a symlink:

```ruby
def install
  prefix.install "Ghostty Designer.app"
  bin.write_exec_script prefix/"Ghostty Designer.app/Contents/MacOS/ghostty-designer"
end
```

`write_exec_script` writes `exec "<target>" "$@"`, so the process runs from its
real path inside the bundle.

Why:

- Only a bundle gives the Dock name and icon, the app menu title and a bundle id
  without app code. The unbundled binary shows the generic `exec` icon and the
  name `ghostty-designer`, because Tauri sets a runtime Dock icon only in dev
  builds (`tauri-codegen/src/context.rs:228`, `tauri/src/app.rs:2733`).
- Through a symlink, macOS finds the bundle (the bundle id resolves), but names
  the app after the symlink: the Dock and the bold app menu show
  `ghostty-designer`. The exec script, a direct launch and `open` all show
  `Ghostty Designer`.
- The bundle must be signed as a bundle. Tauri's default leaves the binary only
  linker-signed (identifier `ghostty_designer-<hash>`, Info.plist not bound),
  and then a direct launch has no bundle id. `bundle.macOS.signingIdentity: "-"`
  signs the bundle ad hoc with identifier `dev.reemus.ghostty-designer`,
  Info.plist bound and the hardened runtime flag. The bundle still runs.

### Evidence

Measured with `lsappinfo`, `NSRunningApplication` and
`responsibility_get_pid_responsible_for_pid`, launched from a shell inside
Ghostty, in a sandbox:

| Launch                                                | Name (Dock, menu)  | Bundle id | Icon   | Responsible process |
| ----------------------------------------------------- | ------------------ | --------- | ------ | ------------------- |
| Bare binary                                           | `ghostty-designer` | none      | `exec` | Ghostty             |
| Bundle via `bin/` symlink, linker-signed              | `ghostty-designer` | none      | bundle | Ghostty             |
| Bundle via `bin/` symlink, ad-hoc signed              | `ghostty-designer` | yes       | bundle | Ghostty             |
| Bundle via exec script, ad-hoc signed                 | `Ghostty Designer` | yes       | bundle | Ghostty             |
| Bundle, new session (`setsid`, reparented to launchd) | `Ghostty Designer` | yes       | bundle | Ghostty             |
| Bundle, new session, responsibility disclaimed        | `Ghostty Designer` | yes       | bundle | the app itself      |
| `open` / Finder                                       | `Ghostty Designer` | yes       | bundle | the app itself      |

A screenshot of the symlink launch shows the app menu titled `ghostty-designer`.
The app menu follows the running application's name, so the other rows are
inferred from the name column. A window opened in every shape, and a screenshot
of the bare binary's window shows the UI.

### Who TCC holds responsible for Apple Events

`reset_font_size` runs `osascript`, a child of the designer. TCC attributes an
Apple Event to the sender's responsible process:

- Every launch from a terminal, including the `setsid` detached launch, is the
  terminal's responsibility. The consent prompt would name the terminal
  (Ghostty, iTerm, …) and the consent would be stored for that terminal.
- A launch through LaunchServices (Finder, Spotlight, `open`) is its own
  responsibility. The prompt names Ghostty Designer and shows
  `NSAppleEventsUsageDescription`, which `crates/app/Info.plist` sets.
- The detached launch can make the window its own responsibility from a terminal
  too: `posix_spawn` with `POSIX_SPAWN_SETSID` and the private
  `responsibility_spawnattrs_setdisclaim(attr, 1)`, which the probe confirmed.
  LaunchServices is not an option for it: `open --env` did not pass `HOME` or
  `XDG_STATE_HOME` to the app, so a sandbox cannot survive it.

Consent stored against an ad-hoc signature is tied to that exact build, so with
self-responsibility each upgrade would ask again. A Developer ID signature keeps
consent across upgrades.

Unverified, because it needs an Apple Event to the user's Ghostty: whether TCC
asks at all when the responsible app and the target are both Ghostty. To check,
in a Ghostty window:

1. Run `osascript -e 'tell application id "com.mitchellh.ghostty" to get name'`.
2. Note whether a prompt appears and which app it names, then look in System
   Settings → Privacy & Security → Automation for a Ghostty → Ghostty entry.

If no prompt appears, terminal responsibility is the better default for terminal
launches: no prompt ever. Desktop launches still prompt as Ghostty Designer.

### Info.plist

- `NSAppleEventsUsageDescription`: required for the prompt once the app is
  responsible.
- `LSUIElement`: not wanted. It would hide the Dock icon and the menu bar of a
  regular window app.
- `LSMinimumSystemVersion`: `15.0`, from `bundle.macOS.minimumSystemVersion`.
  Tauri also compiles with it as `MACOSX_DEPLOYMENT_TARGET`. macOS 15 is the
  oldest release Apple still updates, and the one CI runs on.
- A Developer ID build with the hardened runtime should also carry the
  `com.apple.security.automation.apple-events` entitlement. Whether it is needed
  when the sender is `osascript` is unverified.

### App icon

The bundle ships `icons/icon.icns`. macOS 27 masks its plate to the system
squircle without the grey backing it gives icons off the template, checked with
`NSWorkspace.iconForFile` on the built app.

`icons/AppIcon.icon` adds macOS's dark, clear and tinted looks. Listed in
`bundle.icon`, it makes the bundler compile it into `Assets.car` with `actool`
and set `CFBundleIconName` (`tauri-bundler/src/bundle/macos/icon.rs`). That
fails the whole bundle with Xcode 27.0: `actool` stops with "Bad file
descriptor" on any standalone `.icon`, Ghostty's included, while Xcode's own
build compiles the same documents. `ictool` renders it in every look.

[UNTIL] `actool` compiles a standalone `.icon`: add `icons/AppIcon.icon` to
`bundle.icon`. https://github.com/ibiscite/ibis/issues/663 reports the same
failure.

### Signing

- Homebrew formula: Homebrew sets the quarantine attribute only for casks
  (`cask/quarantine.rb`), so Gatekeeper does not assess a formula's files.
  Ad-hoc signing is enough, and Apple silicon requires at least that. Homebrew
  re-signs ad hoc only binaries it patches during relocation. A binary that
  links only system libraries should not be patched, but release work should
  confirm with `codesign -dv` after `brew install`.
- mise does not quarantine its downloads either.
- Manual downloads and casks are quarantined. An unnotarized app is then blocked
  until the user allows it in System Settings → Privacy & Security, because
  macOS 15 removed the Control-click bypass. A clean experience needs a
  Developer ID signature and notarization (Apple Developer Program).

### mise

`mise use github:reemus-dev/ghostty-designer` installs the formula's archive.
When an archive holds an app, mise's GitHub backend puts
`<name>.app/Contents/MacOS` on `PATH` (`discover_bin_paths` in
`src/backend/github.rs`). The binary then runs from inside the bundle, as it
does through the exec script.

mise strips an archive's single top-level folder, which would drop the `.app`
name. The archive holds `LICENSE` beside the app to prevent that.

Unverified until the first release: the Dock name of a mise install.

## Linux

### glibc floor

Built in an `ubuntu:22.04` container (glibc 2.35, arm64). The highest symbol
version the binary needs is `GLIBC_2.34`, so it runs on Ubuntu 22.04+, Debian
12+, Fedora 35+ and RHEL 9+. The x86_64 build was not measured.

`DT_NEEDED`, in order:

```
libgdk-3.so.0 libgdk_pixbuf-2.0.so.0 libcairo.so.2 libgobject-2.0.so.0
libglib-2.0.so.0 libdbus-1.so.3 libwebkit2gtk-4.1.so.0 libgtk-3.so.0
libsoup-3.0.so.0 libgio-2.0.so.0 libjavascriptcoregtk-4.1.so.0 libgcc_s.so.1
libm.so.6 libc.so.6
```

### Package dependencies

The Tauri CLI already adds WebKitGTK 4.1 and GTK 3 to both formats
(`tauri-cli/src/interface/rust.rs:1422-1433`). `tauri.conf.json` adds only what
the core runs: `pgrep` and `fc-list`.

| Format | Declared in `tauri.conf.json`        | Final dependencies                                                                                    |
| ------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `.deb` | `procps`, `fontconfig`               | `Depends: procps, fontconfig, libwebkit2gtk-4.1-0, libgtk-3-0`                                        |
| `.rpm` | `/usr/bin/pgrep`, `/usr/bin/fc-list` | `Requires: /usr/bin/fc-list, /usr/bin/pgrep, libgtk-3.so.0()(64bit), libwebkit2gtk-4.1.so.0()(64bit)` |

The RPM uses file dependencies because the package that ships `pgrep` differs
between distributions (`procps-ng` on Fedora, `procps` on openSUSE).

Installed with the package manager, dependencies resolved, all libraries found:

| Target                               | How                   | Result                                                  |
| ------------------------------------ | --------------------- | ------------------------------------------------------- |
| Ubuntu 22.04 server cloud image (VM) | `apt install ./….deb` | 173 new packages, window renders (Xvfb + openbox)       |
| `ubuntu:22.04` container             | `apt install ./….deb` | 269 packages                                            |
| `ubuntu:24.04` container             | `apt install ./….deb` | 276 packages (`libgtk-3-0` resolves to `libgtk-3-0t64`) |
| `debian:12` container                | `apt install ./….deb` | 440 packages                                            |
| `fedora:44` container                | `dnf install ./….rpm` | resolved                                                |
| Fedora 44 cloud image (VM)           | `dnf install ./….rpm` | 180 new packages, window renders (Xvfb + openbox)       |

None of these images had WebKitGTK or GTK 3 before. Kubuntu was not installed:
the minimal 24.04 image stands in for it, since the point is that the package
pulls WebKitGTK 4.1 itself. Arch has no package; its names were checked against
archlinux.org.

`vm.sh <vm> packages build|check <image>…` repeats the build and the container
checks.

### README install lines

Ubuntu and Debian:

```sh
sudo apt install ./ghostty-designer_<version>_amd64.deb
```

Fedora:

```sh
sudo dnf install ./ghostty-designer-<version>-1.x86_64.rpm
```

Tarball, after installing the runtime libraries:

```sh
sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 procps fontconfig   # Ubuntu, Debian
sudo dnf install webkit2gtk4.1 gtk3 procps-ng fontconfig             # Fedora
sudo pacman -S --needed webkit2gtk-4.1 gtk3 procps-ng fontconfig     # Arch
```

Without them, the loader stops before `main`. On a system with GTK 3 but no
WebKitGTK 4.1, such as Ubuntu 22.04 desktop or Kubuntu:

```
ghostty-designer: error while loading shared libraries: libwebkit2gtk-4.1.so.0: cannot open shared object file: No such file or directory
```

Without GTK either, the first missing library is `libgdk-3.so.0`.

### Package metadata

- `tauri.conf.json` sets the descriptions, publisher (the Debian Maintainer),
  homepage, license and category (`Development;` in the desktop entry).
- The package name is `ghostty-designer`, but the bundler names the files after
  the product, `Ghostty Designer_<version>_arm64.deb`. `scripts/release.sh`
  renames them to `ghostty-designer_<version>_arm64.deb`.
- Links open with `xdg-open`, which no package declares. Desktop installs ship
  it.

## Releases

The workspace version in `Cargo.toml` is the release version. To release:

1. Set `version` in `[workspace.package]`, run `cargo check` to update
   `Cargo.lock`, and commit.
2. Tag the commit `v<version>` and push the tag.

`.github/workflows/release.yml` runs CI, builds each target on its own runner,
and publishes the GitHub release with `checksums.txt`. It fails before
publishing if the tag does not match the version. It then writes
`Formula/ghostty-designer.rb` to `reemus-dev/homebrew-tap`, through the
`HOMEBREW_TAP_DEPLOY_KEY` secret: the private half of a deploy key with write
access to the tap. A manual run of the workflow builds the same files as
workflow artifacts and publishes nothing.

| Runner             | Target                      | Files                                                 |
| ------------------ | --------------------------- | ----------------------------------------------------- |
| `macos-15`         | `aarch64-apple-darwin`      | `_darwin_arm64.tar.gz`                                |
| `macos-15`         | `x86_64-apple-darwin`       | `_darwin_x86_64.tar.gz`                               |
| `ubuntu-22.04`     | `x86_64-unknown-linux-gnu`  | `_linux_x86_64.tar.gz`, `_amd64.deb`, `-1.x86_64.rpm` |
| `ubuntu-22.04-arm` | `aarch64-unknown-linux-gnu` | `_linux_arm64.tar.gz`, `_arm64.deb`, `-1.aarch64.rpm` |

Every file name starts with `ghostty-designer_<version>`, or
`ghostty-designer-<version>` for the RPMs. Each archive holds the app (macOS) or
the binary (Linux), and `LICENSE`. `mise run release:build [target]` builds one
row on this machine.

## Open questions

1. Terminal launches: keep the terminal responsible for Apple Events (no code,
   possibly no prompt when the terminal is Ghostty), or disclaim responsibility
   in the detached launch so the prompt always names Ghostty Designer (a private
   API, and with ad-hoc signing a new prompt after every upgrade)? The manual
   check above decides most of it.
2. Developer ID signing and notarization: needed before manual downloads or a
   cask, and for consent that survives upgrades. Waits for the Apple Developer
   account. Tauri signs and notarizes when the `APPLE_*` signing variables are
   set, so it needs secrets passed to the macOS build step and a new
   `signingIdentity`, not a new pipeline.
3. Spotlight and Launchpad: the formula's bundle lives in the Homebrew prefix.
   Offer a caveat to link it into `~/Applications`, or ship a cask as well?
