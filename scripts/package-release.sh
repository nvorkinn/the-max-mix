#!/usr/bin/env bash
# Assembles a runnable release tarball from an already-built checkout:
#   release-out/the-max-mix-<version>.tar.gz (+ .sha256)
# Contents: server sources with production dependencies, the built client, scripts, and docs. The version in the
# packaged package.json files is set from the argument; the checkout's own files are not changed.
# Setting SPOTIFY_CLIENT_ID (not a secret) bakes it into the packaged server/.env.example, so the installer can fill it
# in on the device.
# Usage: npm run build && bash scripts/package-release.sh v1.2.3
set -euo pipefail

version=${1:?usage: package-release.sh <version>}
if [[ ! $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Version must look like v1.2.3 or v1.2.3-rc.1, got: $version" >&2
  exit 1
fi
client_id=${SPOTIFY_CLIENT_ID:-}
if [[ -n $client_id && ! $client_id =~ ^[A-Za-z0-9]{1,64}$ ]]; then
  echo "SPOTIFY_CLIENT_ID must be letters and digits only, got: $client_id" >&2
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
mkdir -p "$stage/server" "$stage/client"

cp "$root/package.json" "$root/LICENSE" "$root/README.md" "$root/.nvmrc" "$stage/"
cp -R "$root/scripts" "$stage/scripts"
cp -R "$root/client/dist" "$stage/client/dist"
cp -R "$root/server/src" "$stage/server/src"
cp "$root/server/package.json" "$root/server/package-lock.json" "$root/server/.env.example" "$stage/server/"
if [[ -n $client_id ]]; then
  sed -i.bak "s/^SPOTIFY_CLIENT_ID=.*/SPOTIFY_CLIENT_ID=$client_id/" "$stage/server/.env.example"
  rm "$stage/server/.env.example.bak"
fi
# The repository keeps a 0.0.0 placeholder; the release version comes from the tag, so stamp it into the copies only.
for dir in "$stage" "$stage/server"; do
  (cd "$dir" && npm version "${version#v}" --no-git-tag-version --ignore-scripts --allow-same-version > /dev/null)
done
(cd "$stage/server" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)

COPYFILE_DISABLE=1 tar -czf "$out/$name.tar.gz" -C "$out" "$name"
(cd "$out" && shasum -a 256 "$name.tar.gz" > "$name.tar.gz.sha256")
rm -rf "$stage"
echo "Wrote $out/$name.tar.gz"
