#!/usr/bin/env bash
# Builds the image on this machine with pi-gen's Docker build (see README.md).
#   pi/image/build-local.sh full   clean build of every stage; run it once, and again to refresh the stock stages
#   pi/image/build-local.sh        fast rebuild: stage0 to stage2 are reused, only stage-kiosk reruns
# Set APT_PROXY (for example http://host.docker.internal:3142) to download packages through apt-cacher-ng; nothing is
# needed without it. Set PI_GEN_DIR to keep the pi-gen checkout somewhere else.
set -euo pipefail

# Keep in step with pi-gen-version in .github/workflows/pi-image.yml.
pi_gen_tag=2026-10-06-raspios-trixie-arm64

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
pi_gen=${PI_GEN_DIR:-$root/pi-gen}
mode=${1:-fast}
if [[ $mode != fast && $mode != full ]]; then
  echo "Usage: $0 [fast|full]" >&2
  exit 1
fi

if [[ ! -d $pi_gen ]]; then
  git clone --branch "$pi_gen_tag" --depth 1 https://github.com/RPi-Distro/pi-gen "$pi_gen"
fi

"$root/pi/image/prepare.sh"
rm -rf "$pi_gen/stage-kiosk"
cp -a "$root/pi/image/stage-kiosk" "$pi_gen/stage-kiosk"
{
  cat "$root/pi/image/config"
  if [[ -n ${APT_PROXY:-} ]]; then
    echo "APT_PROXY=$APT_PROXY"
  fi
} > "$pi_gen/config"

# Only the kiosk stage is exported as an image.
touch "$pi_gen/stage2/SKIP_IMAGES"

if [[ $mode == full ]]; then
  docker rm -v pigen_work > /dev/null 2>&1 || true
  rm -f "$pi_gen"/stage{0,1,2}/SKIP
  (cd "$pi_gen" && PRESERVE_CONTAINER=1 ./build-docker.sh -c config)
else
  if [[ -z $(docker ps -a --filter name=pigen_work -q) ]]; then
    echo "There is no finished build to reuse: run '$0 full' first." >&2
    exit 1
  fi
  (cd "$pi_gen" && touch stage{0,1,2}/SKIP && PRESERVE_CONTAINER=1 CONTINUE=1 ./build-docker.sh -c config)
fi
# From here on, stage0 to stage2 stay finished until the next full build.
touch "$pi_gen"/stage{0,1,2}/SKIP
echo "The image is in $pi_gen/deploy"
