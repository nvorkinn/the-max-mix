#!/usr/bin/env bash
# Starts a built image and checks it the way it will be used: it comes up healthy as a non-root user, serves the app and
# its single-page-app fallback, has the build-time Spotify client ID in the built JavaScript, and keeps no server settings
# or state.
# Usage: docker build --build-arg SPOTIFY_CLIENT_ID=ci1234 -t the-max-mix:test . && bash scripts/test-container.sh the-max-mix:test ci1234
set -euo pipefail

image=${1:?usage: test-container.sh <image> [client-id-the-image-was-built-with]}
client_id=${2:-ci1234}
containers=()
cleanup() {
  if ((${#containers[@]})); then docker rm --force "${containers[@]}" > /dev/null 2>&1 || true; fi
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  for container in "${containers[@]}"; do docker logs "$container" >&2 || true; done
  exit 1
}

# Runs the image; sets $container and $port.
start() {
  container=$(docker run --detach --publish 127.0.0.1::3000 "$image")
  containers+=("$container")
  port=$(docker port "$container" 3000/tcp | head -n 1 | sed 's/.*://')
  local deadline=$((SECONDS + 60))
  until curl --fail --silent --max-time 2 "http://127.0.0.1:$port/api/health" > /dev/null; do
    ((SECONDS < deadline)) || fail "$image did not become healthy"
    sleep 1
  done
}

echo "The container comes up healthy and serves the app"
start
base="http://127.0.0.1:$port"
[[ $(curl --silent "$base/api/health") == '{"ready":true}' ]] || fail "unexpected /api/health reply"
[[ $(docker exec "$container" id -u) != 0 ]] || fail "the container runs as root"

index=$(curl --silent --fail "$base/") || fail "/ does not answer"
[[ $index == *'id="root"'* ]] || fail "/ is not the app's index.html"
[[ $(curl --silent --fail "$base/settings") == "$index" ]] || fail "a client-side route does not fall back to index.html"
[[ $(curl --silent --output /dev/null --write-out '%{http_code}' "$base/assets/missing.js") == 404 ]] || fail "a missing asset is not a 404"
[[ $(curl --silent --output /dev/null --write-out '%{http_code}' --path-as-is "$base/../etc/passwd") == 400 ]] || fail "a path traversal is not refused"

echo "The built JavaScript carries the client ID"
bundle=$(grep -o '/assets/[^"]*\.js' <<< "$index" | head -n 1)
[[ -n $bundle ]] || fail "index.html does not reference a JavaScript bundle"
headers=$(curl --silent --fail --dump-header - --output /dev/null "$base$bundle") || fail "$bundle does not answer"
grep -qi '^cache-control:.*immutable' <<< "$headers" || fail "$bundle is not served as immutable"
script=$(curl --silent --fail "$base$bundle") || fail "$bundle does not answer"
grep -qF "$client_id" <<< "$script" || fail "the client ID $client_id is not in $bundle (was the image built with --build-arg SPOTIFY_CLIENT_ID=$client_id?)"

echo "The image keeps no server settings or state"
environment=$(docker exec "$container" printenv)
if grep -Eq '^(SPOTIFY_CLIENT_ID|SPOTIFY_CLIENT_SECRET|DATA_DIR|PUBLIC_URL|DEMO_MODE|PLAYBACK_MODE)=' <<< "$environment"; then
  fail "the container still has server settings in its environment"
fi
[[ $(docker image inspect --format '{{len .Config.Volumes}}' "$image") == 0 ]] || fail "the image declares a volume"
docker exec "$container" test ! -e /app/server || fail "the image still contains the server"

echo "Container checks passed"
