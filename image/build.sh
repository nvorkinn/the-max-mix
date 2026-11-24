#!/usr/bin/env bash
# Builds THE MAX MIX's A/B image from image/ (see README.md). Runs as root on an arm64 Linux machine (GitHub's
# ubuntu-24.04-arm runners), so the Pi's programs run natively in the chroot with no QEMU. Three steps, each its own
# command, so that CI can cache the slow one:
#
#   build.sh upstream                     prints Raspberry Pi OS Lite (arm64) from Imager's official list, as JSON
#   build.sh base <upstream.json> <out>   Pi OS Lite plus image/packages.txt -> <out>/base.tar.zst (cached by CI: it
#                                         changes only with packages.txt, the apt archives, Pi OS or the weekly refresh)
#   build.sh bundle <base.tar.zst> <artefacts> <ref> <out>
#                                         base + rootfs/, units, accounts, persist.list, release.env and the built
#                                         artefacts -> <out>/the-max-mix.raucb, signed with $RAUC_KEY (a file) for
#                                         rootfs/etc/rauc/keyring.pem (or $RAUC_CERT, for a throwaway check build).
#                                         <artefacts> holds app/ (the built web app) and
#                                         kiosk-audio/ (pi/kiosk-audio with its node_modules); <ref> is the tag or the
#                                         channel (dev, branch-<name>). Nothing is compiled here.
#   build.sh card <the-max-mix.raucb> <out>
#                                         a promotion: that bundle's slot images, unchanged, on a six-partition card
#                                         -> <out>/the-max-mix.img.zst and the-max-mix.rpi-imager-manifest
#
# The bundle's file systems are built to come out the same from the same input (fixed UUIDs and hash seed, every file
# dated SOURCE_DATE_EPOCH), so that RAUC's adaptive update downloads only the blocks a release changed.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/.." && pwd)

# The card's partitions (pi/kiosk-audio/boot-slots.ts numbers the boot ones; rootfs/etc/rauc/system.conf names them).
AUTOBOOT_MIB=32
BOOT_MIB=256
ROOT_MIB=3072
DATA_MIB=256
# The same every build, so unchanged files land on the same blocks.
ROOT_UUID=6d61786d-6978-4000-8000-726f6f746673
HASH_SEED=6d61786d-6978-4000-8000-686173687365
BOOT_ID=4d4d4958

started=$SECONDS
step() {
  printf '[%3dm%02ds] %s\n' $(((SECONDS - started) / 60)) $(((SECONDS - started) % 60)) "$*"
}
mib() {
  echo "$(($(stat --format=%s "$1") / 1048576)) MiB"
}

# Lines that say something in one of image/'s lists: no comments, no blank lines.
list() {
  sed -e 's/#.*//' -e 's/[[:space:]]*$//' "$1" | awk 'NF'
}

mounts=()
loops=()
work=
cleanup() {
  local i
  for ((i = ${#mounts[@]} - 1; i >= 0; i--)); do
    umount --lazy "${mounts[i]}" 2> /dev/null || true
  done
  for i in "${loops[@]}"; do
    losetup --detach "$i" 2> /dev/null || true
  done
  if [[ -n $work ]]; then
    rm -rf "$work"
  fi
}
trap cleanup EXIT

bind_system() {
  local root=$1 fs
  for fs in proc sys dev dev/pts; do
    mount --bind "/$fs" "$root/$fs"
    mounts+=("$root/$fs")
  done
  mount -t tmpfs tmpfs "$root/run"
  mounts+=("$root/run")
  mount -t tmpfs tmpfs "$root/tmp"
  mounts+=("$root/tmp")
}
unbind_system() {
  local i
  for ((i = ${#mounts[@]} - 1; i >= 0; i--)); do
    umount "${mounts[i]}"
  done
  mounts=()
}
in_root() {
  local root=$1
  shift
  chroot "$root" /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LC_ALL=C.UTF-8 \
    DEBIAN_FRONTEND=noninteractive "$@"
}

upstream() {
  curl --fail --silent --show-error --location --retry 3 https://downloads.raspberrypi.com/os_list_imagingutility_v4.json \
    | jq -e '([.. | objects | select(.url? // "" | test("/raspios_lite_arm64/images/"))] | first) as $os
      | {os: $os, devices: [.imager.devices[] | select(.tags | any(IN($os.devices[])))]}'
}

base() {
  local upstream_json=$1 out=$2
  work=$(mktemp -d)
  local image=$work/pios.img root=$work/root
  local url sha
  url=$(jq -r .os.url "$upstream_json")
  sha=$(jq -r .os.extract_sha256 "$upstream_json")
  step "Downloading and unpacking $url"
  curl --fail --silent --show-error --location --retry 3 "$url" | xz --decompress --stdout > "$image"
  step "Unpacked $(mib "$image"); checking its sha256 against Imager's official list"
  echo "$sha  $image" | sha256sum --check --strict -

  local loop
  loop=$(losetup --find --show --partscan --read-only "$image")
  loops+=("$loop")
  mkdir -p "$work/pi-root" "$work/pi-boot" "$root"
  mount -o ro "${loop}p2" "$work/pi-root"
  mounts+=("$work/pi-root")
  mount -o ro "${loop}p1" "$work/pi-boot"
  mounts+=("$work/pi-boot")
  step "Copying Pi OS's root and boot file systems"
  cp -a "$work/pi-root/." "$root/"
  rm -rf "$root/boot/firmware"
  mkdir -p "$root/boot/firmware"
  cp -r "$work/pi-boot/." "$root/boot/firmware/"
  umount "$work/pi-boot" "$work/pi-root"
  mounts=()

  step "Installing image/packages.txt"
  # The other archives first (NodeSource, Tailscale): their packages are in packages.txt.
  cp -r "$here/rootfs/etc/apt/." "$root/etc/apt/"
  # The runner's DNS, for apt, and Pi OS's own file back afterwards.
  mv "$root/etc/resolv.conf" "$work/resolv.conf"
  cp --dereference /etc/resolv.conf "$root/etc/resolv.conf"
  bind_system "$root"
  local install=() purge=() line
  while read -r line; do
    if [[ $line == -* ]]; then
      purge+=("${line#-}")
    else
      install+=("$line")
    fi
  done < <(list "$here/packages.txt")
  in_root "$root" apt-get update
  in_root "$root" apt-get install --yes --no-install-recommends "${install[@]}"
  if ((${#purge[@]})); then
    in_root "$root" apt-get purge --yes --auto-remove "${purge[@]}"
  fi
  in_root "$root" apt-get clean
  unbind_system
  mv -f "$work/resolv.conf" "$root/etc/resolv.conf"
  rm -rf "$root/var/lib/apt/lists/"*

  mkdir -p "$out"
  step "Packing the base layer"
  tar --create --numeric-owner --xattrs --acls --directory "$root" . | zstd --quiet --threads=0 -3 > "$out/base.tar.zst"
  step "Base layer: $(mib "$out/base.tar.zst")"
}

# Fills <root> (a copy of the base layer) with everything image/ says, and the artefacts.
assemble() {
  local root=$1 artefacts=$2 ref=$3 commit=$4

  step "Copying image/rootfs"
  # As root:root, keeping symlinks and the executable bit: programs 0755, other files 0644.
  (cd "$here/rootfs" && find . -mindepth 1) | while read -r path; do
    local source=$here/rootfs/$path target=$root/${path#./}
    if [[ -L $source ]]; then
      rm -rf "$target"
      cp -P "$source" "$target"
    elif [[ -d $source ]]; then
      install -d -m 0755 -o root -g root "$target"
    elif [[ -x $source ]]; then
      install -m 0755 -o root -g root "$source" "$target"
    else
      install -m 0644 -o root -g root "$source" "$target"
    fi
  done
  chmod 0440 "$root"/etc/sudoers.d/*

  step "Adding the built artefacts"
  rm -rf "$root/opt/the-max-mix"
  install -d -m 0755 "$root/opt/the-max-mix"
  cp -r "$artefacts/app" "$root/opt/the-max-mix/app"
  cp -r "$artefacts/kiosk-audio" "$root/opt/the-max-mix/kiosk-audio"
  chown -R root:root "$root/opt/the-max-mix"
  chmod -R u=rwX,go=rX "$root/opt/the-max-mix"

  # Spotify Soloist lives on /data (kiosk-soloist-update): its terms keep it out of the image.
  ln -sfn /data/soloist/soloist "$root/usr/local/bin/soloist"

  printf 'KIOSK_RELEASE_REF=%s\nKIOSK_RELEASE_COMMIT=%s\n' "$ref" "$commit" \
    | install -D -m 0644 /dev/stdin "$root/usr/lib/the-max-mix/release.env"

  step "Binding persist.list over /data"
  install -d -m 0755 "$root/data"
  persist "$root"

  step "Accounts, locale and units"
  bind_system "$root"
  in_root "$root" systemd-sysusers
  in_root "$root" locale-gen
  local action unit
  while read -r action unit; do
    case $action in
      enable) in_root "$root" systemctl enable "$unit" ;;
      enable-global) in_root "$root" systemctl --global enable "$unit" ;;
      mask) in_root "$root" systemctl mask "$unit" ;;
      *)
        echo "image/units.txt: unknown action $action" >&2
        exit 1
        ;;
    esac
  done < <(list "$here/units.txt")
  unbind_system

  # Each Pi gets its own on /data (persist.list); the image's must not be shared by every Pi.
  : > "$root/etc/machine-id"
  echo the-max-mix > "$root/etc/hostname"
  rm -f "$root"/etc/ssh/ssh_host_*
  rm -rf "$root/var/lib/apt/lists/"* "$root/var/cache/"* "$root/var/log/"*.log

  step "Boot files for each slot"
  cp "$here/boot/config.txt" "$root/boot/firmware/config.txt"
  cp "$here/boot/cmdline.txt" "$root/boot/firmware/cmdline.txt"
}

# Each persist.list line becomes an fstab bind mount from /data. kiosk-persist.service makes the sources on /data
# (copying what the image has there, the first time) before any of them mounts.
persist() {
  local root=$1 kind target source
  local sources=$root/usr/lib/the-max-mix/persist-sources
  install -d -m 0755 "$(dirname "$sources")"
  : > "$sources"
  {
    echo
    echo '# From image/persist.list, by image/build.sh: the Pi'"'"'s own state, from /data.'
  } >> "$root/etc/fstab"
  while read -r kind target source; do
    if [[ $kind == dir ]]; then
      mkdir -p "$root$target"
    else
      mkdir -p "$(dirname "$root$target")"
      touch "$root$target"
    fi
    echo "$kind $target $source" >> "$sources"
    printf '/data/%s %s none bind,x-systemd.requires=kiosk-persist.service,x-systemd.after=kiosk-persist.service 0 0\n' \
      "$source" "$target" >> "$root/etc/fstab"
  done < <(list "$here/persist.list")
}

# A file system image of <dir> whose blocks depend only on its contents.
ext4_image() {
  local dir=$1 file=$2
  find "$dir" -xdev -exec touch --no-dereference --date="@$SOURCE_DATE_EPOCH" {} +
  local used
  used=$(du --summarize --block-size=1M --apparent-size "$dir" | cut -f1)
  if ((used * 115 / 100 > ROOT_MIB)); then
    echo "The root file system needs ${used} MiB, too much for a ${ROOT_MIB} MiB slot" >&2
    exit 1
  fi
  # The whole slot, so a later release's file system that grew still fits the same layout. RAUC's adaptive update skips
  # the blocks a Pi already has, so the empty space costs nothing to download.
  E2FSPROGS_FAKE_TIME=$SOURCE_DATE_EPOCH mkfs.ext4 -q -F -L root -U "$ROOT_UUID" -E "hash_seed=$HASH_SEED,root_owner=0:0" \
    -T default -d "$dir" "$file" "${ROOT_MIB}M"
}

vfat_image() {
  local dir=$1 file=$2
  truncate --size="${BOOT_MIB}M" "$file"
  mkfs.vfat -n BOOT -i "$BOOT_ID" --invariant "$file" > /dev/null
  find "$dir" -exec touch --date="@$SOURCE_DATE_EPOCH" {} +
  MTOOLS_SKIP_CHECK=1 mcopy -s -m -i "$file" "$dir"/* ::/
}

bundle() {
  local base_tar=$1 artefacts=$2 ref=$3 out=$4
  local commit
  commit=$(git -c safe.directory="$repo" -C "$repo" rev-parse HEAD)
  : "${RAUC_KEY:?RAUC_KEY must name the bundle signing key file}"
  export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(git -c safe.directory="$repo" -C "$repo" log -1 --format=%ct)}
  work=$(mktemp -d)
  local root=$work/root contents=$work/bundle
  mkdir -p "$root" "$contents"
  step "Unpacking the base layer"
  zstd --quiet --decompress --stdout "$base_tar" | tar --extract --numeric-owner --xattrs --acls --directory "$root"
  assemble "$root" "$artefacts" "$ref" "$commit"

  step "Making the boot and root file systems"
  mv "$root/boot/firmware" "$work/boot"
  mkdir "$root/boot/firmware"
  vfat_image "$work/boot" "$contents/boot.vfat"
  ext4_image "$root" "$contents/rootfs.ext4"

  local version="$ref+$commit"
  cat > "$contents/manifest.raucm" << EOF
[update]
compatible=the-max-mix-pi
version=$version
build=$SOURCE_DATE_EPOCH

[bundle]
format=verity

[image.rootfs]
filename=rootfs.ext4
adaptive=block-hash-index

[image.boot]
filename=boot.vfat
EOF
  mkdir -p "$out"
  rm -f "$out/the-max-mix.raucb"
  step "Signing the bundle ($version)"
  rauc bundle --cert="${RAUC_CERT:-$here/rootfs/etc/rauc/keyring.pem}" --key="$RAUC_KEY" "$contents" "$out/the-max-mix.raucb"
  step "Built $out/the-max-mix.raucb ($(mib "$out/the-max-mix.raucb"))"
}

card() {
  local raucb=$1 out=$2
  work=$(mktemp -d)
  local card=$work/the-max-mix.img
  step "Checking and unpacking $raucb"
  rauc extract --keyring="$here/rootfs/etc/rauc/keyring.pem" "$raucb" "$work/bundle"
  local version
  version=$(sed -n 's/^version=//p' "$work/bundle/manifest.raucm")

  # 1 autoboot, 2 boot-a, 3 boot-b, 4 root-a, 5 root-b, 6 data. The file ends after root-a: slot B is filled by the first
  # update, and kiosk-first-boot.ts moves the GPT's backup header to the card's end and grows data over the rest.
  local start=2048 size
  local -a parts=()
  part() {
    local label=$1 mib=$2 type=$3
    size=$((mib * 2048))
    parts+=("start=$start, size=$size, type=$type, name=$label")
    start=$((start + size))
  }
  local fat=EBD0A0A2-B9E5-4433-87C0-68B6B72699C7 linux=0FC63DAF-8483-4772-8E79-3D69D8477DE4
  part autoboot "$AUTOBOOT_MIB" "$fat"
  part boot-a "$BOOT_MIB" "$fat"
  part boot-b "$BOOT_MIB" "$fat"
  part root-a "$ROOT_MIB" "$linux"
  local end_of_file=$start
  part root-b "$ROOT_MIB" "$linux"
  part data "$DATA_MIB" "$linux"
  truncate --size=$(((start + 34) * 512)) "$card"
  printf 'label: gpt\nfirst-lba: 2048\n%s\n' "$(printf '%s\n' "${parts[@]}")" | sfdisk --quiet "$card"

  local loop
  loop=$(losetup --find --show --partscan "$card")
  loops+=("$loop")
  step "Writing the partitions"
  mkfs.vfat -n bootfs -i 4d4d4941 "${loop}p1" > /dev/null
  printf '[all]\ntryboot_a_b=1\nboot_partition=2\n[tryboot]\nboot_partition=2\n' > "$work/autoboot.txt"
  MTOOLS_SKIP_CHECK=1 mcopy -i "${loop}p1" "$work/autoboot.txt" ::/autoboot.txt
  dd if="$work/bundle/boot.vfat" of="${loop}p2" bs=4M conv=fsync status=none
  dd if="$work/bundle/rootfs.ext4" of="${loop}p4" bs=4M conv=fsync status=none
  losetup --detach "$loop"
  loops=()
  # Imager writes the file and no more, so it ends after root-a: slot B is filled by the first update, and
  # kiosk-first-boot.ts moves the GPT backup header to the card's end and formats data over the rest.
  truncate --size=$((end_of_file * 512)) "$card"

  step "Hashing and compressing the card"
  mkdir -p "$out"
  local extract_size extract_sha256
  extract_size=$(stat --format=%s "$card")
  extract_sha256=$(sha256sum "$card" | cut -d' ' -f1)
  zstd --quiet --threads=0 -9 --stdout "$card" > "$out/the-max-mix.img.zst"
  local upstream_json=$work/upstream.json
  upstream > "$upstream_json"
  jq --null-input \
    --slurpfile upstream "$upstream_json" \
    --arg url "${IMAGE_URL:?IMAGE_URL must be where the card will be downloaded from}" \
    --arg version "$version" \
    --argjson extract_size "$extract_size" \
    --arg extract_sha256 "$extract_sha256" \
    --argjson download_size "$(stat --format=%s "$out/the-max-mix.img.zst")" \
    --arg download_sha256 "$(sha256sum "$out/the-max-mix.img.zst" | cut -d' ' -f1)" \
    --arg date "$(date -u +%F)" \
    '$upstream[0].os as $base | {
      imager: {devices: [$upstream[0].devices[] | select(.tags | any(IN("pi4-64bit", "pi5-64bit")))]},
      os_list: [{
        name: "The Max Mix",
        description: "THE MAX MIX kiosk \($version), Pi 4 and Pi 5. Updates itself.",
        icon: $base.icon,
        website: "https://github.com/nvorkinn/the-max-mix",
        url: $url,
        extract_size: $extract_size,
        extract_sha256: $extract_sha256,
        image_download_size: $download_size,
        image_download_sha256: $download_sha256,
        release_date: $date,
        init_format: $base.init_format,
        devices: [$base.devices[] | select(IN("pi4-64bit", "pi5-64bit"))],
        capabilities: ($base.capabilities // [])
      }]
    }' > "$out/the-max-mix.rpi-imager-manifest"
  step "Built $out/the-max-mix.img.zst ($(mib "$out/the-max-mix.img.zst")) from $version"
}

usage() {
  sed -n '2,/^set /p' "${BASH_SOURCE[0]}" | sed '$d' >&2
  exit 2
}
command=${1:-}
shift || true
case $command:$# in
  upstream:0) upstream ;;
  base:2) base "$@" ;;
  bundle:4) bundle "$@" ;;
  card:2) card "$@" ;;
  *) usage ;;
esac
