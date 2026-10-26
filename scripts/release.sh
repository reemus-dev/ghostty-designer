#!/usr/bin/env bash
# Sets the release version, builds and checks the release files, and writes the
# Homebrew formula and npm package that install them. The release workflow runs
# all five.
#
#   release.sh version <version>  write the version into Cargo.toml and Cargo.lock
#   release.sh build [target]     archive for this machine or target, plus .deb and .rpm on Linux, into dist/release
#   release.sh check [target]     install and launch the target's files: on macOS here, on Linux in Docker containers
#   release.sh formula            Homebrew formula for the macOS archives in dist/release/checksums.txt
#   release.sh npm                npm package in dist/npm, with a build from each archive in dist/release
#
# The version tag is the only record of a release's version. The repository
# keeps 0.0.0, and the workflow writes the tag's version before it builds.
set -euo pipefail

USAGE="usage: release.sh version <version>|build [target]|check [target]|formula|npm"
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

check_version() {
  local printed
  printed=$("$1" --version)
  if [ "$printed" != "ghostty-designer $VERSION" ]; then
    echo "release.sh: $1 --version printed '$printed', not 'ghostty-designer $VERSION'" >&2
    exit 1
  fi
}

check() {
  platform "$1"
  dir=$(mktemp -d)
  trap 'rm -rf "$dir"' EXIT
  tar -xzf "$OUT/$(archive "$os" "$arch")" -C "$dir"
  local binary=$dir/ghostty-designer
  [ "$os" = darwin ] && binary="$dir/Ghostty Designer.app/Contents/MacOS/ghostty-designer"
  check_version "$binary"

  # The npm package runs the build for the machine's own architecture, so only
  # this machine's target runs through it.
  local launcher=
  if [ "$target" = "$(rustc -vV | sed -n 's/^host: //p')" ]; then
    npm_package
    npm pack --silent --pack-destination "$dir" ./dist/npm >/dev/null
    npm install --global --silent --prefix "$dir/npm" "$dir"/ghostty-designer-*.tgz
    launcher=$dir/npm/bin/ghostty-designer
    check_version "$launcher"
  fi

  if [ "$os" = darwin ]; then
    scripts/smoke.sh "$binary"
    [ -z "$launcher" ] || scripts/smoke.sh "$launcher"
    return
  fi
  local deb=ghostty-designer_${VERSION}_${arch/x86_64/amd64}.deb
  local rpm=ghostty-designer-${VERSION}-1.${arch/arm64/aarch64}.rpm
  # Recommended packages stay out, so the declared dependencies must suffice.
  local apt='apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends'
  local dnf='dnf install -y -q --setopt=install_weak_deps=False'
  # Each container installs a file the way the README says, then smokes it. The
  # containers run in parallel. --init gives xvfb-run, which would otherwise be
  # PID 1, a parent that passes on Xvfb's ready signal. A slow or broken distro
  # mirror can stall an install for half an hour, so each install gets 5 minutes
  # and up to 3 fresh containers. Exit status 75 marks a failed install, the only
  # failure that retries.
  local names=() pids=()
  contained() {
    names+=("$1 on $2")
    (
      local try status
      for try in 1 2 3; do
        status=0
        docker run --init --rm -v "$ROOT:$ROOT:ro" -v "$dir:$dir:ro" -w "$ROOT" \
          -e INSTALL="$3" -e SMOKE="$4" "$2" bash -ec \
          'timeout 300 bash -ec "$INSTALL" >/dev/null || exit 75; scripts/smoke.sh "$SMOKE"' ||
          status=$?
        [ "$status" = 75 ] || exit "$status"
        echo "release.sh: install attempt $try failed"
      done
      exit 75
    ) >"$dir/${#names[@]}.log" 2>&1 &
    pids+=($!)
  }
  # Two containers use this image, and parallel runs race to pull it.
  docker pull -q ubuntu:22.04 >/dev/null
  contained .deb ubuntu:22.04 "$apt ./dist/release/$deb xvfb xauth" ghostty-designer
  contained .deb ubuntu:latest "$apt ./dist/release/$deb xvfb xauth" ghostty-designer
  contained .deb debian:12 "$apt ./dist/release/$deb xvfb xauth" ghostty-designer
  contained .rpm fedora:latest "$dnf ./dist/release/$rpm xorg-x11-server-Xvfb /usr/bin/xvfb-run" ghostty-designer
  contained tarball ubuntu:22.04 "$apt libwebkit2gtk-4.1-0 libgtk-3-0 procps fontconfig xvfb xauth" "$binary"
  if [ "$arch" = x86_64 ]; then
    contained tarball archlinux:latest "pacman -Syu --noconfirm --needed webkit2gtk-4.1 gtk3 procps-ng fontconfig xorg-server-xvfb xorg-xauth" "$binary"
  fi

  local i failed=0
  for i in "${!pids[@]}"; do
    if wait "${pids[$i]}"; then
      echo "ok: ${names[$i]}"
    else
      echo "failed: ${names[$i]}"
      cat "$dir/$((i + 1)).log"
      failed=1
    fi
  done
  return "$failed"
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

npm_package() {
  local package=$ROOT/dist/npm file build
  rm -rf "$package"
  mkdir -p "$package"
  cp npm/package.json npm/bin.js README.md LICENSE "$package"
  (cd "$package" && npm pkg set version="$VERSION")
  for file in "$OUT/ghostty-designer_${VERSION}_"*.tar.gz; do
    # bin.js finds a build by Node's platform and arch names.
    build=${file%.tar.gz}
    build=${build#"$OUT/ghostty-designer_${VERSION}_"}
    build=${build/_/-}
    build=${build/x86_64/x64}
    mkdir -p "$package/bin/$build"
    tar -xzf "$file" -C "$package/bin/$build" --exclude LICENSE
  done
  ls "$package/bin"
}

case ${1:-} in
  version) version "${2:-}" ;;
  build) build "${2:-}" ;;
  check) check "${2:-}" ;;
  formula) formula ;;
  npm) npm_package ;;
  *) echo "$USAGE" >&2; exit 2 ;;
esac
