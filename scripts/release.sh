#!/usr/bin/env bash
# Builds the release files and prints the Homebrew formula that installs them.
# The release workflow runs both.
#
#   release.sh build [target]   archive for this machine or target, plus .deb and .rpm on Linux, into dist/release
#   release.sh formula          Homebrew formula for the macOS archives in dist/release/checksums.txt
#
# The version is the crate's, so a release tags the commit that sets it.
set -euo pipefail

USAGE="usage: release.sh build [target]|formula"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$ROOT/dist/release
cd "$ROOT"
VERSION=$(cargo pkgid -p ghostty-designer)
VERSION=${VERSION##*@}

archive() { echo "ghostty-designer_${VERSION}_$1_$2.tar.gz"; }

build() {
  local target=${1:-$(rustc -vV | sed -n 's/^host: //p')}
  local os arch bundles
  case $target in
    aarch64-apple-darwin) os=darwin arch=arm64 bundles=app ;;
    x86_64-apple-darwin) os=darwin arch=x86_64 bundles=app ;;
    aarch64-unknown-linux-gnu) os=linux arch=arm64 bundles=deb,rpm ;;
    x86_64-unknown-linux-gnu) os=linux arch=x86_64 bundles=deb,rpm ;;
    *) echo "release.sh: unsupported target $target" >&2; exit 1 ;;
  esac
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

  on_arm do
    url "$base/$(archive darwin arm64)"
    sha256 "$arm64"
  end

  on_intel do
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
  build) build "${2:-}" ;;
  formula) formula ;;
  *) echo "$USAGE" >&2; exit 2 ;;
esac
