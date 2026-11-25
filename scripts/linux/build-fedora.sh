#!/usr/bin/env sh
# Build the Fedora .rpm in a container: `sh scripts/linux/build-fedora.sh` (Linux, macOS, or Git Bash on Windows).
# Output: src-tauri/target/fedora/*.rpm. Cargo, npm and target caches live in docker volumes between runs.
set -eu
cd "$(dirname "$0")/../.."
root=$(pwd -W 2>/dev/null || pwd) # Docker Desktop on Windows wants C:/... paths
export MSYS_NO_PATHCONV=1
mkdir -p src-tauri/target/fedora
docker build -t quire-fedora -f scripts/linux/fedora.Dockerfile scripts/linux
docker run --rm \
  -v "$root:/src:ro" \
  -v "$root/src-tauri/target/fedora:/out" \
  -v quire-fedora-cargo:/root/.cargo/registry \
  -v quire-fedora-npm:/root/.npm \
  -v quire-fedora-target:/build/src-tauri/target \
  quire-fedora sh -euc '
    # host node_modules hold host-native binaries, so copy the sources and install fresh
    tar -C /src --exclude=./node_modules --exclude=./src-tauri/target --exclude="./dist*" \
      --exclude=./android-eink --exclude=./.git --exclude=./test-results -cf - . | tar -xf -
    npm ci --no-audit --no-fund
    npx tauri build --bundles rpm
    cp src-tauri/target/release/bundle/rpm/*.rpm /out/
  '
ls -l src-tauri/target/fedora
