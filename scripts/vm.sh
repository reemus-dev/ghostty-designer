#!/usr/bin/env bash
# Runs the Lima VMs: provisions them, builds the current tree and runs its window
# in a VM-local sandbox under X11 (Xvfb + openbox) or Wayland (sway headless),
# and builds and checks the Linux packages.
#
#   vm.sh <vm> provision                 create or start the VM, then install what its role needs
#   vm.sh <vm> start <x11|wayland>       build, then start the window
#   vm.sh <vm> shot <out.png>            screenshot the VM display
#   vm.sh <vm> close                     close the window as its close button would
#   vm.sh <vm> status                    app process, exit code and stderr
#   vm.sh <vm> stop                      kill the app (keeps the display server and the VM)
#   vm.sh <vm> packages build            .deb and .rpm in an ubuntu:22.04 container (the glibc floor)
#   vm.sh <vm> packages check <image>... install them into fresh containers, e.g. ubuntu:24.04 fedora:44
#
# gd-ubuntu-2404 runs the window. gd-ubuntu-2204 runs it on the glibc floor and
# builds packages with podman. `provision` is safe to rerun.
#
# The window lives in ~/gd: src, target, sandbox, app.err, app.exit. The app
# serves WebDriver on a port per VM, which Lima forwards to the host, so
# `panel.ts --vm <vm>` drives its panel. One window per VM: `start` refuses
# while a window runs, and `stop` kills every WebKit process in the VM.
# Packages live in ~/gd-pkg, and land in ~/gd-pkg/target/release/bundle/.
set -euo pipefail

USAGE="usage: vm.sh <vm> provision|start <x11|wayland>|shot <out.png>|close|status|stop|packages build|packages check <image>..."
VM=${1:?$USAGE}
ACTION=${2:?$USAGE}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUST=$(sed -nE 's/^rust = (\{ *version = )?"([^"]+)".*/\2/p' "$ROOT/.mise.toml")
# Where panel.ts finds the port. Ports from 4446 stay clear of the dev
# instance's 4445 and of the ephemeral ports sandboxes take.
PORT_FILE=$ROOT/.cache/vms/$VM/webdriver-port
PORT=$((4446 + $(printf %s "$VM" | cksum | cut -d' ' -f1) % 1000))
vm() { limactl shell "$VM" -- bash -o pipefail -c "$1"; }

# Prelude run inside the VM: display env for the current mode.
VMENV='
mkdir -p ~/gd; cd ~/gd
MODE=$(cat mode 2>/dev/null || echo x11)
export XDG_RUNTIME_DIR=/tmp/xdg-gd; mkdir -p -m700 $XDG_RUNTIME_DIR
if [ "$MODE" = x11 ]; then export DISPLAY=:99 GDK_BACKEND=x11
else export WAYLAND_DISPLAY=wayland-1 GDK_BACKEND=wayland; unset DISPLAY; fi
'

status() {
  vm "$VMENV"'
    echo "mode=$MODE exit=$(cat app.exit 2>/dev/null || echo running-or-none)"
    echo "--- ps"; pgrep -af "[g]d/target/debug/ghostty-designer|[W]ebKit" | cut -c1-160 || true
    echo "--- app.err"; cat app.err 2>/dev/null || true'
}

case "$ACTION ${3:-}" in
"provision "*) ;;
"start "* | "shot "* | "close "* | "status "* | "stop "* | "packages build" | "packages check")
  [ "$(limactl list --format "{{.Status}}" "$VM")" = Running ] || limactl start "$VM"
  ;;
*)
  echo "$USAGE" >&2
  exit 2
  ;;
esac

case $ACTION in
provision)
  # The scenario replay expects this Ghostty.
  GHOSTTY=1.3.1

  case $VM in
  gd-ubuntu-2204) TEMPLATE=ubuntu-22.04 ROLES="window packages" ;;
  gd-ubuntu-2404) TEMPLATE=ubuntu-24.04 ROLES=window ;;
  *) echo "unknown vm: $VM" >&2; exit 2 ;;
  esac

  limactl list -q | grep -qx "$VM" ||
    limactl create --tty=false --name "$VM" --vm-type vz --cpus 4 --memory 4 --disk 30 --mount-none "template:$TEMPLATE"
  limactl start "$VM"

  for role in $ROLES; do
    echo "=== $VM: $role"
    case $role in
    window)
      limactl shell "$VM" -- bash -s "$RUST" "$GHOSTTY" <<'VM'
set -euo pipefail
# sudo drops the caller's env. stdin is this script, so apt must not read it.
apt() { sudo DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get -y -qq "$@" </dev/null >/dev/null; }
apt update
# Tauri 2 build prerequisites, then the display stacks and tools the window actions use.
apt install --no-install-recommends build-essential pkg-config curl ca-certificates \
  libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libxdo-dev libssl-dev \
  xvfb openbox sway grim imagemagick xdotool wmctrl dbus-user-session xdg-desktop-portal xdg-desktop-portal-gtk \
  fontconfig procps

[ -x ~/.cargo/bin/rustup ] || curl -sSf https://sh.rustup.rs | sh -s -- -y -q --profile minimal --default-toolchain none
~/.cargo/bin/rustup -q toolchain install "$1" --profile minimal -c clippy >/dev/null
~/.cargo/bin/rustup -q default "$1" >/dev/null

if [ "$(ghostty +version 2>/dev/null | head -1)" != "Ghostty $2" ]; then
  # A distro package in /usr/bin would shadow the snap in /snap/bin.
  if dpkg -s ghostty >/dev/null 2>&1; then apt remove ghostty; fi
  snap list ghostty >/dev/null 2>&1 && sudo snap refresh ghostty || sudo snap install ghostty --classic
fi
got=$(/snap/bin/ghostty +version | head -1)
[ "$got" = "Ghostty $2" ] || echo "warning: the snap installed $got, not Ghostty $2" >&2
echo "$(~/.cargo/bin/rustc --version), $got"
VM
      ;;
    packages)
      limactl shell "$VM" -- bash -c 'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq podman </dev/null >/dev/null && podman --version'
      ;;
    esac
  done
  ;;
start)
  MODE=${3:?usage: vm.sh <vm> start <x11|wayland>}
  [ "$MODE" = x11 ] || [ "$MODE" = wayland ] || { echo "mode must be x11 or wayland" >&2; exit 2; }
  vm 'for c in cargo ghostty Xvfb openbox sway grim import wmctrl; do
    command -v $c >/dev/null || { echo "$c is missing: run vm.sh '"$VM"' provision" >&2; exit 1; }
  done'
  if vm 'pgrep -f "[g]d/target/debug/ghostty-designer" >/dev/null'; then
    echo "a window already runs in $VM. If it is yours, run: $0 $VM stop" >&2
    exit 1
  fi
  # The VM has no Bun, so the UI bundle is built here and copied with the crates.
  (cd "$ROOT" && mise run ui:build >/dev/null)
  "$0" "$VM" stop
  COPYFILE_DISABLE=1 tar -C "$ROOT" --exclude target --exclude gen -czf - Cargo.toml Cargo.lock crates dist/ui scripts/sandbox-env.sh |
    limactl shell "$VM" -- bash -c 'rm -rf ~/gd/src && mkdir -p ~/gd/src && tar -xzf - -C ~/gd/src 2>/dev/null'
  # Cargo never prunes stale artifacts, so start the build over when the disk runs low.
  vm '[ "$(df --output=avail -k / | tail -1)" -gt $((8 << 20)) ] || { echo "under 8 GiB free: removing ~/gd/target"; rm -rf ~/gd/target; }'
  vm 'cd ~/gd/src && CARGO_TARGET_DIR=~/gd/target cargo build --locked -p ghostty-designer --features webdriver 2>&1 | tail -3'
  echo "$MODE" | limactl shell "$VM" -- tee gd/mode >/dev/null

  vm "$VMENV"'
    if [ "$MODE" = x11 ]; then
      pgrep -x Xvfb >/dev/null || { setsid nohup Xvfb :99 -screen 0 1280x900x24 >/dev/null 2>&1 </dev/null & sleep 2; }
      pgrep -x openbox >/dev/null || { setsid nohup openbox >/dev/null 2>&1 </dev/null & sleep 1; }
    else
      pgrep -x sway >/dev/null || {
        printf "output HEADLESS-1 resolution 1280x900\nfor_window [title=\".*\"] floating enable\n" > sway.conf
        WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 setsid nohup sway -c ~/gd/sway.conf >/tmp/sway.log 2>&1 </dev/null & sleep 3; }
    fi
    # Portal backends need the display in their environment. Without it every window start
    # stalls 40-80 s on xdg-desktop-portal timeouts (the headless VM has no desktop session).
    (
      export XDG_RUNTIME_DIR=/run/user/$(id -u)
      dbus-update-activation-environment --systemd DISPLAY=:99 ${WAYLAND_DISPLAY:+WAYLAND_DISPLAY=/tmp/xdg-gd/$WAYLAND_DISPLAY} XDG_CURRENT_DESKTOP=GNOME
      if ! systemctl --user is-active -q xdg-desktop-portal; then
        systemctl --user reset-failed; systemctl --user restart xdg-permission-store xdg-document-portal xdg-desktop-portal-gtk
        timeout 90 systemctl --user restart xdg-desktop-portal || true
      fi
    )
    S=~/gd/sandbox; mkdir -p $S/home $S/xdg $S/state
    rm -f app.exit app.err
    setsid nohup env GHOSTTY_DESIGNER_TARGET_PID= GHOSTTY_DESIGNER_ATTACHED=1 TAURI_WEBDRIVER_PORT='"$PORT"' \
      ~/gd/src/scripts/sandbox-env.sh $S bash -c "$HOME/gd/target/debug/ghostty-designer 2>$HOME/gd/app.err; echo \$? >$HOME/gd/app.exit" \
      >/dev/null 2>&1 </dev/null &
    sleep 5'
  mkdir -p "$(dirname "$PORT_FILE")"
  echo "$PORT" >"$PORT_FILE"
  status
  ;;
shot)
  OUT=${3:?usage: vm.sh <vm> shot <out.png>}
  vm "$VMENV"'
    rm -f shot.png
    if [ "$MODE" = x11 ]; then import -window root shot.png; else grim shot.png; fi'
  mkdir -p "$(dirname "$OUT")"
  limactl cp "$VM:gd/shot.png" "$OUT"
  echo "$OUT"
  ;;
close)
  rm -f "$PORT_FILE"
  vm "$VMENV"'
    if [ "$MODE" = x11 ]; then wmctrl -c "Ghostty Designer"
    else swaymsg -s $(ls $XDG_RUNTIME_DIR/sway-ipc.*.sock | head -1) "[title=\"Ghostty Designer\"] kill" >/dev/null; fi
    for _ in $(seq 10); do [ -f app.exit ] && break; sleep 0.5; done'
  status
  ;;
status)
  status
  ;;
stop)
  rm -f "$PORT_FILE"
  vm 'pkill -f "[g]d/target/debug/ghostty-designer" || true; sleep 1; pkill -9 -f "[g]d/target/debug/ghostty-designer" || true; pkill -f "[W]ebKit(Web|Network)Process" || true'
  ;;
packages)
  case ${3:-} in
  build)
    TAURI_CLI=$(sed -n 's/.*"@tauri-apps\/cli": "\(.*\)".*/\1/p' "$ROOT/package.json")
    # The VM has no Bun, so the UI bundle is built here and copied with the crates.
    (cd "$ROOT" && mise run ui:build >/dev/null)
    COPYFILE_DISABLE=1 tar -C "$ROOT" --exclude target -czf - Cargo.toml Cargo.lock crates dist/ui |
      limactl shell "$VM" -- bash -c 'rm -rf ~/gd-pkg/src && mkdir -p ~/gd-pkg/src && tar -xzf - -C ~/gd-pkg/src 2>/dev/null'
    # Cargo never prunes stale artifacts, so start the build over when the disk runs low.
    vm '[ "$(df --output=avail -k / | tail -1)" -gt $((8 << 20)) ] || { echo "under 8 GiB free: removing ~/gd-pkg/target"; rm -rf ~/gd-pkg/target; }'
    limactl shell "$VM" -- bash -s "$RUST" "$TAURI_CLI" <<'VM'
set -euo pipefail
podman container exists gd-pkg ||
  podman create --name gd-pkg -v "$HOME/gd-pkg:/w" docker.io/library/ubuntu:22.04 sleep infinity >/dev/null
podman start gd-pkg >/dev/null
podman exec -i gd-pkg bash -s "$1" "$2" <<'CONTAINER'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive PATH=/root/.cargo/bin:$PATH CARGO_TARGET_DIR=/w/target
if [ ! -x /root/.cargo/bin/rustup ]; then
  apt-get update -qq
  # Tauri 2 prerequisites for Debian and Ubuntu (v2.tauri.app/start/prerequisites),
  # minus the tray and SVG libraries, which nothing in the build links.
  apt-get install -y -qq libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev \
    libssl-dev >/dev/null
  curl -sSf https://sh.rustup.rs | sh -s -- -y -q --profile minimal --default-toolchain none
fi
# Both are no-ops when the pinned versions are installed.
rustup -q default "$1"
cargo install -q tauri-cli --version "$2" --locked
# `check` installs whatever packages are here, so none may outlive a failed build.
rm -rf /w/target/release/bundle
cd /w/src/crates/app
cargo tauri build --bundles deb,rpm 2>&1 | grep -E 'Finished|Bundling|error'
CONTAINER
VM
    ;;
  check)
    shift 3
    for image in "$@"; do
      echo "=== $image"
      limactl shell "$VM" -- bash -s "$image" <<'VM'
set -uo pipefail
podman run --rm -i -v "$HOME/gd-pkg/target/release/bundle:/b:ro" "docker.io/library/$1" bash -s <<'CONTAINER'
set -uo pipefail
. /etc/os-release && echo "$PRETTY_NAME"
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq /b/deb/*.deb >/tmp/install.log 2>&1 || { tail -20 /tmp/install.log; exit 1; }
  dpkg -s ghostty-designer | grep '^Depends'
else
  dnf install -y -q /b/rpm/*.rpm >/tmp/install.log 2>&1 || { tail -20 /tmp/install.log; exit 1; }
  rpm -q --requires ghostty-designer | grep -v rpmlib
fi
command -v ghostty-designer pgrep fc-list
echo "missing libraries: $(ldd "$(command -v ghostty-designer)" | grep -c 'not found')"
CONTAINER
VM
    done
    ;;
  esac
  ;;
esac
