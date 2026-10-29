#!/usr/bin/env bash
# Assembles a runnable release tarball from an already-built checkout:
#   release-out/the-max-mix-<version>.tar.gz (+ .sha256)
# Contents: the built client (client/dist, with the Spotify client ID baked in at build time), scripts (including
# serve.mjs and the kiosk.env.example template), package.json, LICENSE, README and .nvmrc. There is no server and
# nothing to install on the device. The version in the packaged package.json is set from the argument; the checkout's
# own files are not changed.
# Usage: VITE_SPOTIFY_CLIENT_ID=<id> npm run build && bash scripts/package-release.sh v1.2.3
set -euo pipefail

version=${1:?usage: package-release.sh <version>}
if [[ ! $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Version must look like v1.2.3 or v1.2.3-rc.1, got: $version" >&2
  exit 1
fi
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
if [[ ! -f $root/client/dist/index.html ]]; then
  echo "client/dist is missing. Run 'npm run build' first." >&2
  exit 1
fi

name=the-max-mix-$version
out=$root/release-out
stage=$out/$name
rm -rf "$out"
mkdir -p "$stage/client"

cp "$root/package.json" "$root/LICENSE" "$root/README.md" "$root/.nvmrc" "$stage/"
cp -R "$root/scripts" "$stage/scripts"
rm -rf "$stage/scripts/test"
cp -R "$root/client/dist" "$stage/client/dist"
# The repository keeps a 0.0.0 placeholder; the release version comes from the tag, so stamp it into the copy only.
(cd "$stage" && npm version "${version#v}" --no-git-tag-version --ignore-scripts --allow-same-version > /dev/null)
[[ -f $stage/scripts/serve.mjs && -f $stage/scripts/kiosk.env.example ]] || {
  echo "scripts/serve.mjs and scripts/kiosk.env.example must exist." >&2
  exit 1
}

COPYFILE_DISABLE=1 tar -czf "$out/$name.tar.gz" -C "$out" "$name"
(cd "$out" && shasum -a 256 "$name.tar.gz" > "$name.tar.gz.sha256")
rm -rf "$stage"
echo "Wrote $out/$name.tar.gz"
