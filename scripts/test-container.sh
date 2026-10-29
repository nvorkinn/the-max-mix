#!/usr/bin/env bash
# Starts a built image and checks it the way it will be used: it comes up healthy as a non-root user with a writable
# /data and its default client ID, and, given a public address, it uses it for the Spotify callback and accepts only
# that host name.
# Usage: docker build --build-arg SPOTIFY_CLIENT_ID=ci1234 -t the-max-mix:test . && bash scripts/test-container.sh the-max-mix:test
set -euo pipefail

image=${1:?usage: test-container.sh <image>}
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

# Runs the image with the given docker run options; sets $container and $port.
start() {
  container=$(docker run --detach --publish 127.0.0.1::3000 "$@" "$image")
  containers+=("$container")
  port=$(docker port "$container" 3000/tcp | head -n 1 | sed 's/.*://')
  local deadline=$((SECONDS + 60))
  until curl --fail --silent --max-time 2 "http://127.0.0.1:$port/api/health" > /dev/null; do
    ((SECONDS < deadline)) || fail "$image did not become healthy"
    sleep 1
  done
}

echo "A demo-mode container comes up healthy"
start --env DEMO_MODE=true
[[ $(curl --silent "http://127.0.0.1:$port/api/info") == *'"demoMode":true'* ]] || fail "/api/info does not report demo mode"
[[ $(docker exec "$container" id -u) != 0 ]] || fail "the container runs as root"
docker exec "$container" sh -c 'touch /data/.writable && rm /data/.writable' || fail "/data is not writable"
[[ $(docker exec "$container" printenv SPOTIFY_CLIENT_ID) =~ ^[A-Za-z0-9]+$ ]] || fail "the image has no default SPOTIFY_CLIENT_ID (build it with --build-arg)"

echo "Given a public address it uses it for the Spotify callback and accepts only that host"
start --env PUBLIC_URL=https://maxmix.example.com
# cspell:ignore Fmaxmix Fapi Fauth Fcallback (the percent-encoded callback in Spotify's sign-in address)
login=$(curl --silent --output /dev/null --write-out '%{redirect_url}' --header 'Host: maxmix.example.com' "http://127.0.0.1:$port/api/auth/login")
[[ $login == *'redirect_uri=https%3A%2F%2Fmaxmix.example.com%2Fapi%2Fauth%2Fcallback'* ]] || fail "unexpected Spotify sign-in address: $login"
status=$(curl --silent --output /dev/null --write-out '%{http_code}' --header 'Host: other.example.com' "http://127.0.0.1:$port/api/info")
[[ $status == 403 ]] || fail "expected 403 for another host name, got $status"

echo "Container checks passed"
