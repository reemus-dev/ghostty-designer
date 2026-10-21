#!/usr/bin/env bash
# Creates the Lima VM if it is missing, starts it, and installs what its role
# needs. Safe to rerun: installs are idempotent.
#
#   provision.sh <vm>
#
#   gd-ubuntu-2404   window.sh
#   gd-ubuntu-2204   window.sh on the glibc floor, packages.sh (podman)
set -euo pipefail

VM=${1:?usage: provision.sh <vm>}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
RUST=$(sed -nE 's/^rust = (\{ *version = )?"([^"]+)".*/\2/p' "$ROOT/.mise.toml")
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
# Tauri 2 build prerequisites, then the display stacks and tools window.sh drives.
apt install --no-install-recommends build-essential pkg-config curl ca-certificates \
  libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libxdo-dev libssl-dev \
  xvfb openbox sway grim imagemagick xdotool wmctrl dbus-user-session xdg-desktop-portal xdg-desktop-portal-gtk \
  fontconfig procps webkit2gtk-driver jq

[ -x ~/.cargo/bin/rustup ] || curl -sSf https://sh.rustup.rs | sh -s -- -y -q --profile minimal --default-toolchain none
~/.cargo/bin/rustup -q toolchain install "$1" --profile minimal -c clippy >/dev/null
~/.cargo/bin/rustup -q default "$1" >/dev/null
~/.cargo/bin/cargo install -q --locked tauri-driver@2.1.0

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
