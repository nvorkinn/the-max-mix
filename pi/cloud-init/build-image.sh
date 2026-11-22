#!/usr/bin/env bash
# Builds THE MAX MIX's ready-made flash image: stock Raspberry Pi OS Lite (64-bit) with the first-boot setup added, and
# the Raspberry Pi Imager list that offers it. The flash-image workflow runs it and publishes both on the flash-image
# pre-release. Needs root (it mounts the image), curl, jq, sfdisk and xz.
#
# Usage:
#   build-image.sh upstream > upstream.json
#     prints the newest Raspberry Pi OS Lite (64-bit) in Imager's official list, as {os, devices}: its list entry and
#     the Pis it runs on. The workflow compares it with the last build's, to build only when something changed.
#   sudo build-image.sh build upstream.json <output folder> <image URL>
#     writes the-max-mix.img.xz and the-max-mix.rpi-imager-manifest into the output folder. The image URL is where the
#     published the-max-mix.img.xz is downloaded from.
#
# Only two files are added to the system partition, and the playbook still installs everything at the first boot:
#   /var/lib/cloud/scripts/per-instance/the-max-mix-first-boot  (first-boot)
#   /etc/cloud/cloud.cfg.d/99-the-max-mix.cfg                    (the-max-mix.cfg)
set -euo pipefail

if [[ ${1:-} == upstream ]]; then
  curl --fail --silent --show-error --location --retry 3 https://downloads.raspberrypi.com/os_list_imagingutility_v4.json \
    | jq -e '([.. | objects | select(.url? // "" | test("/raspios_lite_arm64/images/"))] | first) as $os
      | {os: $os, devices: [.imager.devices[] | select(.tags | any(IN($os.devices[])))]}'
  exit
fi
if [[ ${1:-} != build || $# != 4 ]]; then
  echo "Usage: build-image.sh upstream | build-image.sh build <upstream.json> <output folder> <image URL>" >&2
  exit 2
fi
upstream=$2
out=$3
image_url=$4
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d)
root=$work/root
image=$work/the-max-mix.img

started=$SECONDS
ticker=
# One line per step, with the time since the start, so the log shows where a slow build spends its time.
step() {
  printf '[%3dm%02ds] %s\n' $(((SECONDS - started) / 60)) $(((SECONDS - started) % 60)) "$*"
}
mib() {
  echo "$(($(stat --format=%s "$1") / 1048576)) MiB"
}
# During a long step, report how far a file has grown every 30 seconds.
watch_file() {
  stop_watching
  (
    while sleep 30; do
      if [[ -f $1 ]]; then
        step "  ... $2: $(mib "$1") so far"
      fi
    done
  ) &
  ticker=$!
}
stop_watching() {
  if [[ -n $ticker ]]; then
    kill "$ticker" 2> /dev/null || true
    wait "$ticker" 2> /dev/null || true
    ticker=
  fi
}

cleanup() {
  stop_watching
  if mountpoint --quiet "$root"; then
    umount "$root"
  fi
  rm -rf "$work"
}
trap cleanup EXIT

upstream_url=$(jq -r .os.url "$upstream")
upstream_sha256=$(jq -r .os.extract_sha256 "$upstream")
step "Downloading and unpacking $upstream_url ($(($(jq -r .os.image_download_size "$upstream") / 1048576)) MiB to download, $(($(jq -r .os.extract_size "$upstream") / 1048576)) MiB unpacked)"
watch_file "$image" unpacked
curl --fail --silent --show-error --location --retry 3 "$upstream_url" | xz --decompress --stdout > "$image"
stop_watching
step "Unpacked $(mib "$image"); checking its sha256 against Imager's official list"
echo "$upstream_sha256  $image" | sha256sum --check --strict -

# The system partition is the second one. Mounting it at its offset needs no partition devices (losetup --partscan
# leaves them to udev, which a runner does not always have ready in time).
start=$(sfdisk --json "$image" | jq -e '.partitiontable.partitions[1].start')
step "Mounting the system partition (sector $start)"
mkdir "$root"
mount -o "loop,offset=$((start * 512))" "$image" "$root"
if [[ ! -d $root/etc/cloud/cloud.cfg.d ]]; then
  echo "This Raspberry Pi OS has no cloud-init (no /etc/cloud/cloud.cfg.d), so the first-boot setup would never run" >&2
  exit 1
fi
step "Adding /var/lib/cloud/scripts/per-instance/the-max-mix-first-boot and /etc/cloud/cloud.cfg.d/99-the-max-mix.cfg"
install -D --mode=0755 --owner=root --group=root "$here/first-boot" \
  "$root/var/lib/cloud/scripts/per-instance/the-max-mix-first-boot"
install --mode=0644 --owner=root --group=root "$here/the-max-mix.cfg" "$root/etc/cloud/cloud.cfg.d/99-the-max-mix.cfg"
umount "$root"

step "Hashing the image"
extract_size=$(stat --format=%s "$image")
extract_sha256=$(sha256sum "$image" | cut -d' ' -f1)
mkdir -p "$out"
step "Compressing with xz on $(nproc) threads (the slow part, about 3 minutes)"
watch_file "$out/the-max-mix.img.xz" compressed
xz --threads=0 -6 --stdout "$image" > "$out/the-max-mix.img.xz"
stop_watching
step "Compressed to $(mib "$out/the-max-mix.img.xz"); hashing it and writing the Imager list"
download_size=$(stat --format=%s "$out/the-max-mix.img.xz")
download_sha256=$(sha256sum "$out/the-max-mix.img.xz" | cut -d' ' -f1)

# Imager's list format (rpi-imager doc/json-schema/os-list-schema.json). The devices are the official list's own Pis
# that this image runs on, so Imager asks which Pi as usual. init_format (cloudinit-rpi) turns Imager's customisation
# wizard on.
jq --null-input \
  --slurpfile upstream "$upstream" \
  --arg url "$image_url" \
  --argjson extract_size "$extract_size" \
  --arg extract_sha256 "$extract_sha256" \
  --argjson download_size "$download_size" \
  --arg download_sha256 "$download_sha256" \
  --arg date "$(date -u +%F)" \
  '$upstream[0].os as $base | {
    imager: {devices: $upstream[0].devices},
    os_list: [{
      name: "The Max Mix",
      description: "Raspberry Pi OS Lite (64-bit, \($base.release_date)) that sets itself up as a Max Mix kiosk at its first boot",
      icon: $base.icon,
      website: "https://github.com/nvorkinn/the-max-mix",
      url: $url,
      extract_size: $extract_size,
      extract_sha256: $extract_sha256,
      image_download_size: $download_size,
      image_download_sha256: $download_sha256,
      release_date: $date,
      init_format: $base.init_format,
      devices: $base.devices,
      capabilities: ($base.capabilities // [])
    }]
  }' > "$out/the-max-mix.rpi-imager-manifest"
step "Built $out/the-max-mix.img.xz ($download_size bytes) and $out/the-max-mix.rpi-imager-manifest"
