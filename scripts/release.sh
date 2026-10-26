#!/usr/bin/env bash
# Sets the release version, builds and checks the release files, and prints the
# Homebrew formula that installs them. The release workflow runs all four.
#
#   release.sh version <version>  write the version into Cargo.toml and Cargo.lock
#   release.sh build [target]     archive for this machine or target, plus .deb and .rpm on Linux, into dist/release
#   release.sh check [target]     install and launch the target's files: on macOS here, on Linux in Docker containers
#   release.sh formula            Homebrew formula for the macOS archives in dist/release/checksums.txt
#
# The version tag is the only record of a release's version. The repository
# keeps 0.0.0, and the workflow writes the tag's version before it builds.
set -euo pipefail

USAGE="usage: release.sh version <version>|build [target]|check [target]|formula"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$ROOT/dist/release
cd "$ROOT"
VERSION=$(cargo pkgid -p ghostty-designer)
VERSION=${VERSION##*@}

version() {
  local version=${1:?$USAGE}
  sed "s/^version = \".*\"$/version = \"$version\"/" Cargo.toml >Cargo.toml.new
  mv Cargo.toml.new Cargo.toml
  cargo update --workspace --quiet
}

archive() { echo "ghostty-designer_${VERSION}_$1_$2.tar.gz"; }

# Sets target, os, arch and bundles for a target triple, this machine's by default.
platform() {
  target=${1:-$(rustc -vV | sed -n 's/^host: //p')}
  case $target in
    aarch64-apple-darwin) os=darwin arch=arm64 bundles=app ;;
    x86_64-apple-darwin) os=darwin arch=x86_64 bundles=app ;;
    aarch64-unknown-linux-gnu) os=linux arch=arm64 bundles=deb,rpm ;;
    x86_64-unknown-linux-gnu) os=linux arch=x86_64 bundles=deb,rpm ;;
    *) echo "release.sh: unsupported target $target" >&2; exit 1 ;;
  esac
}

build() {
  platform "$1"
  rustup target add "$target"
  TAURI_APP_PATH=crates/app tauri build --ci --target "$target" --bundles "$bundles" -- --locked

  local bin=target/$target/release
  mkdir -p "$OUT"
  # LICENSE beside the app keeps the archive from having a single top-level
  # folder, which mise would strip, taking the .app name with it.
  if [ "$os" = darwin ]; then
    tar -czf "$OUT/$(archive "$os" "$arch")" -C "$bin/bundle/macos" "Ghostty Designer.app" -C "$ROOT" LICENSE
  else
    tar -czf "$OUT/$(archive "$os" "$arch")" -C "$bin" ghostty-designer -C "$ROOT" LICENSE
    # The bundler names packages after the product name.
    local package file
    for package in "$bin/bundle/deb/Ghostty Designer_${VERSION}_"*.deb "$bin/bundle/rpm/Ghostty Designer-${VERSION}-"*.rpm; do
      file=${package##*/}
      cp "$package" "$OUT/ghostty-designer${file#Ghostty Designer}"
    done
  fi
  ls -l "$OUT"
}

check() {
  platform "$1"
  dir=$(mktemp -d)
  trap 'rm -rf "$dir"' EXIT
  tar -xzf "$OUT/$(archive "$os" "$arch")" -C "$dir"
  local binary=$dir/ghostty-designer
  [ "$os" = darwin ] && binary="$dir/Ghostty Designer.app/Contents/MacOS/ghostty-designer"
  local printed
  printed=$("$binary" --version)
  if [ "$printed" != "ghostty-designer $VERSION" ]; then
    echo "release.sh: $target --version printed '$printed', not 'ghostty-designer $VERSION'" >&2
    exit 1
  fi

  # The app needs a Ghostty CLI to start. This one answers from the fixtures.
  cat >"$dir/ghostty" <<EOF
#!/bin/sh
case \$1 in
  +version) cat "$ROOT/crates/host/tests/fixtures/ghostty-1.3.1/version.txt" ;;
  +list-fonts) cat "$ROOT/crates/host/tests/fixtures/ghostty-1.3.1/list-fonts.txt" ;;
  +show-config) echo 'font-size = 13' ;;
esac
EOF
  chmod +x "$dir/ghostty"
  export GHOSTTY_DESIGNER_GHOSTTY=$dir/ghostty

  if [ "$os" = darwin ]; then
    scripts/smoke.sh "$binary"
    return
  fi
  local deb=ghostty-designer_${VERSION}_${arch/x86_64/amd64}.deb
  local rpm=ghostty-designer-${VERSION}-1.${arch/arm64/aarch64}.rpm
  local apt='apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq'
  # Each container installs a file the way the README says, then smokes it.
  contained() {
    echo "=== $1"
    docker run --rm -v "$ROOT:$ROOT:ro" -v "$dir:$dir:ro" -w "$ROOT" -e GHOSTTY_DESIGNER_GHOSTTY \
      "$1" bash -ec "$2 >/dev/null; scripts/smoke.sh $3"
  }
  contained ubuntu:22.04 "$apt ./dist/release/$deb xvfb xauth" ghostty-designer
  contained ubuntu:latest "$apt ./dist/release/$deb xvfb xauth" ghostty-designer
  contained debian:12 "$apt ./dist/release/$deb xvfb xauth" ghostty-designer
  contained fedora:latest "dnf install -y -q ./dist/release/$rpm xorg-x11-server-Xvfb /usr/bin/xvfb-run" ghostty-designer
  contained ubuntu:22.04 "$apt libwebkit2gtk-4.1-0 libgtk-3-0 procps fontconfig xvfb xauth" "$binary"
  if [ "$arch" = x86_64 ]; then
    contained archlinux:latest "pacman -Sy --noconfirm --needed webkit2gtk-4.1 gtk3 procps-ng fontconfig xorg-server-xvfb xorg-xauth" "$binary"
  fi
}

formula() {
  local base=https://github.com/reemus-dev/ghostty-designer/releases/download/v$VERSION
  sha() {
    awk -v file="$(archive darwin "$1")" '
      $2 == file {print $1; found = 1}
      END {if (!found) {print "release.sh: " file " is not in checksums.txt" >"/dev/stderr"; exit 1}}
    ' "$OUT/checksums.txt"
  }
  local arm64 x86_64
  arm64=$(sha arm64)
  x86_64=$(sha x86_64)
  cat <<EOF
class GhosttyDesigner < Formula
  desc "Design Ghostty's appearance, with your own Ghostty windows as the live preview"
  homepage "https://github.com/reemus-dev/ghostty-designer"
  version "$VERSION"
  license "MIT"

  # Homebrew's style check allows no url in on_arm and on_intel blocks.
  if Hardware::CPU.arm?
    url "$base/$(archive darwin arm64)"
    sha256 "$arm64"
  else
    url "$base/$(archive darwin x86_64)"
    sha256 "$x86_64"
  end

  depends_on macos: :sequoia

  # The exec script runs the binary from inside the bundle, so macOS shows the
  # app's name and icon. A symlink would show the link's name.
  def install
    prefix.install "Ghostty Designer.app"
    bin.write_exec_script prefix/"Ghostty Designer.app/Contents/MacOS/ghostty-designer"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/ghostty-designer --version")
  end
end
EOF
}

case ${1:-} in
  version) version "${2:-}" ;;
  build) build "${2:-}" ;;
  check) check "${2:-}" ;;
  formula) formula ;;
  *) echo "$USAGE" >&2; exit 2 ;;
esac
