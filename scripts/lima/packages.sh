#!/usr/bin/env bash
# Builds the .deb and .rpm in an ubuntu:22.04 container (the glibc floor) inside
# a Lima VM with podman, then installs them with the package manager into fresh
# distro containers, so every install starts clean. The VM needs podman
# (`provision.sh gd-ubuntu-2204`).
#
#   packages.sh <vm> build              packages land in ~/gd-pkg/target/release/bundle/ in the VM
#   packages.sh <vm> check <image>...   install into each image, e.g. ubuntu:24.04 fedora:44
set -euo pipefail

VM=${1:?usage: packages.sh <vm> build|check <image>...}
ACTION=${2:?missing action}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
[ "$(limactl list --format "{{.Status}}" "$VM")" = Running ] || limactl start "$VM"

case $ACTION in
build)
  RUST=$(sed -nE 's/^rust = (\{ *version = )?"([^"]+)".*/\2/p' "$ROOT/.mise.toml")
  TAURI_CLI=$(sed -n 's/.*"@tauri-apps\/cli": "\(.*\)".*/\1/p' "$ROOT/package.json")
  # The VM has no Bun, so the UI bundle is built here and copied with the crates.
  (cd "$ROOT" && mise run ui:build >/dev/null)
  COPYFILE_DISABLE=1 tar -C "$ROOT" --exclude target -czf - Cargo.toml Cargo.lock crates dist/ui |
    limactl shell "$VM" -- bash -c 'rm -rf ~/gd-pkg/src && mkdir -p ~/gd-pkg/src && tar -xzf - -C ~/gd-pkg/src 2>/dev/null'
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
  shift 2
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
*)
  echo "unknown action: $ACTION" >&2
  exit 2
  ;;
esac
