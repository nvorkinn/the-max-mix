// A throwaway probe for the image-based A/B update plan (chunk 0, the Pi spike). It runs on a Mac with Docker and SSH
// access to a test Pi, and never touches a Pi's live card: everything goes onto a spare card.
//
//   node pi/tools/ab-probe.mts image
//       Builds ~/ab-spike/out/ab-spike.img.zst in an arm64 Debian container: the published flash image
//       (the-max-mix.img.zst) re-laid out as the plan's six-partition GPT card, plus an Imager list that offers it.
//   node pi/tools/ab-probe.mts card [disk]
//       After Raspberry Pi Imager has written the card: lists what is on each FAT partition (where Imager's wizard
//       put user-data and network-config), and with --fix copies those files into boot-a, where cloud-init reads them.
//   node pi/tools/ab-probe.mts pi <command> [args]     (PI=admin@host, default admin@192.168.0.150)
//       status | tryboot | reboot | break <A|B> | mend <A|B> | readonly <on|off> | grow-data | rootfs <file.tar.zst>
//       | install <url> | rauc <args...>
//   node pi/tools/ab-probe.mts bundle <rootfs.tar.zst> <version> [out.raucb]
//       Builds a signed RAUC bundle (verity format, block-hash-index for adaptive updates) from a root tarball.
//
// Results go in docs/ab-spike-results.md. Work files live in ~/ab-spike (cache, keys, out).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const WORK = process.env['AB_SPIKE_DIR'] ?? path.join(homedir(), 'ab-spike');
const PI = process.env['PI'] ?? 'admin@192.168.0.150';
const BASE_URL =
  process.env['BASE_URL'] ??
  'https://github.com/nvorkinn/the-max-mix/releases/download/flash-image/the-max-mix.img.zst';

/** The plan's card layout, in MiB. Partition GUIDs are fixed so cmdline.txt can name its root by PARTUUID. */
const LAYOUT = [
  { n: 1, label: 'autoboot', mib: 32, type: '0700', fs: 'vfat16' },
  { n: 2, label: 'boot-a', mib: 256, type: '0700', fs: 'vfat32' },
  { n: 3, label: 'boot-b', mib: 256, type: '0700', fs: 'vfat32' },
  { n: 4, label: 'root-a', mib: 4096, type: '8300', fs: 'ext4' },
  { n: 5, label: 'root-b', mib: 4096, type: '8300', fs: 'ext4' },
  { n: 6, label: 'data', mib: 512, type: '8300', fs: 'ext4' }
] as const;
const DISK_GUID = '6d61786d-6978-4ab0-8000-000000000000';
const partGuid = (n: number): string => `6d61786d-6978-4ab0-8000-00000000000${n}`;

const sh = String.raw;

/** The Pi side of the A/B switch, installed in the image: which slot booted, and RAUC's custom bootloader backend. */
const AB_COMMON = sh`# Shared by ab-boot-mount and the RAUC backend. Slot A = boot partition 2, slot B = 3 (autoboot.txt).
booted_partition() { od -An -tu1 -j3 -N1 /proc/device-tree/chosen/bootloader/partition | tr -d ' '; }
tryboot_flag() { od -An -tu1 -j3 -N1 /proc/device-tree/chosen/bootloader/tryboot 2>/dev/null | tr -d ' '; }
slot_of() { case $1 in 2) echo "${'$'}{AB_A:-a}" ;; 3) echo "${'$'}{AB_B:-b}" ;; *) echo "?" ;; esac; }
partition_of() { case $1 in A|a) echo 2 ;; B|b) echo 3 ;; *) return 1 ;; esac; }
# The spike's own image names its slots A and B in system.conf; main's image (and adopt-main) a and b.
if grep -q '^bootname=A' /etc/rauc/system.conf 2>/dev/null; then AB_A=A AB_B=B; fi
disk() { echo "/dev/$(lsblk -no pkname /dev/disk/by-partlabel/autoboot)"; }
part() { local d; d=$(disk); case $d in *[0-9]) echo "$d"p"$1" ;; *) echo "$d$1" ;; esac; }
`;

const AB_BOOT_MOUNT = sh`#!/bin/bash
# Mounts the boot partition the firmware booted from on /boot/firmware, so one root image serves both slots.
set -euo pipefail
. /usr/lib/ab/common.sh
for _ in $(seq 50); do [[ -e /dev/disk/by-partlabel/autoboot ]] && break; sleep 0.2; done
mkdir -p /boot/firmware
mountpoint -q /boot/firmware || mount -o rw,noatime "$(part "$(booted_partition)")" /boot/firmware
`;

// RAUC's custom backend interface (rauc's system.conf: bootloader=custom): get-primary, set-primary <bootname>,
// get-state <bootname>, set-state <bootname> <good|bad>, get-current. Over autoboot.txt, with tryboot_a_b=1:
// [all] boot_partition is the committed default, [tryboot] the one `reboot "0 tryboot"` boots once.
const RAUC_BACKEND = sh`#!/bin/bash
set -euo pipefail
. /usr/lib/ab/common.sh
mnt=/run/ab/autoboot
with_autoboot() {
  mkdir -p "$mnt"
  mountpoint -q "$mnt" || mount -o rw "$(part 1)" "$mnt"
}
default_partition() { with_autoboot; awk -F= '/^\[all\]/{s=1;next} /^\[/{s=0} s&&$1=="boot_partition"{print $2}' "$mnt/autoboot.txt"; }
write_autoboot() { # <default partition> <tryboot partition>
  with_autoboot
  printf '[all]\ntryboot_a_b=1\nboot_partition=%s\n[tryboot]\nboot_partition=%s\n' "$1" "$2" > "$mnt/autoboot.txt.new"
  sync "$mnt/autoboot.txt.new"
  mv "$mnt/autoboot.txt.new" "$mnt/autoboot.txt"
  sync "$mnt"
}
other() { [[ $1 == 2 ]] && echo 3 || echo 2; }
state_dir=/data/ab; mkdir -p "$state_dir"
[[ $# -gt 0 ]] || set -- ""
case $1 in
  get-current) slot_of "$(booted_partition)" ;;
  get-primary)
    # After an install RAUC asks for the slot to boot next: the tryboot target while one is pending.
    if [[ -f $state_dir/pending ]]; then cat "$state_dir/pending"; else slot_of "$(default_partition)"; fi ;;
  set-primary)
    p=$(partition_of "$2")
    if [[ $p == "$(default_partition)" ]]; then rm -f "$state_dir/pending"; exit 0; fi
    # Never make a new slot the default here: only point tryboot at it. It becomes the default when marked good.
    write_autoboot "$(default_partition)" "$p"
    echo "$2" > "$state_dir/pending" ;;
  get-state)
    if [[ -f $state_dir/bad-$2 ]]; then echo bad; else echo good; fi ;;
  set-state)
    p=$(partition_of "$2")
    if [[ $3 == good ]]; then
      rm -f "$state_dir/bad-$2"
      if [[ $p == "$(booted_partition)" && $p != "$(default_partition)" ]]; then
        write_autoboot "$p" "$(other "$p")"   # commit: the slot that proved itself becomes the default
      fi
      rm -f "$state_dir/pending"
    else
      touch "$state_dir/bad-$2"
      if [[ $p == "$(default_partition)" ]]; then write_autoboot "$(other "$p")" "$(other "$p")"; fi
      rm -f "$state_dir/pending"
    fi ;;
  *) echo "usage: $0 get-current|get-primary|set-primary <slot>|get-state <slot>|set-state <slot> good|bad" >&2; exit 2 ;;
esac
`;

// After RAUC writes a boot slot, point its cmdline.txt at its own root (the bundle's boot image names no slot).
const RAUC_BOOT_HOOK = sh`#!/bin/bash
set -euo pipefail
case $1 in
  slot-post-install)
    [[ $RAUC_SLOT_CLASS == boot ]] || exit 0
    case $RAUC_SLOT_BOOTNAME in A) n=4 ;; B) n=5 ;; esac
    sed -i -E "s/root=PARTUUID=[^ ]+/root=PARTUUID=${partGuid(0).slice(0, -1)}$n/" "$RAUC_SLOT_MOUNT_POINT/cmdline.txt" ;;
esac
`;

const RAUC_SYSTEM_CONF = `[system]
compatible=the-max-mix-ab-spike
bootloader=custom
statusfile=/data/ab/rauc.status
max-bundle-download-size=4294967296
bundle-formats=-plain

[handlers]
bootloader-custom-backend=/usr/lib/ab/rauc-backend

[keyring]
path=/etc/rauc/ca.cert.pem

[slot.rootfs.0]
device=/dev/disk/by-partlabel/root-a
type=ext4
bootname=A

[slot.rootfs.1]
device=/dev/disk/by-partlabel/root-b
type=ext4
bootname=B

[slot.boot.0]
device=/dev/disk/by-partlabel/boot-a
type=vfat
parent=rootfs.0

[slot.boot.1]
device=/dev/disk/by-partlabel/boot-b
type=vfat
parent=rootfs.1
`;

// `pi adopt-main`: lets the spike's slot A install main's real bundles (compatible the-max-mix-pi, signed with
// image/rootfs/etc/rauc/keyring.pem, bootnames a and b, cmdline root=PARTLABEL=root-a). Slot A has no node or
// kiosk-audio, so it keeps this probe's shell backend and stands in for main's post-install handler: point the new
// boot slot's cmdline.txt at its own root, which is what kiosk-update post-install does on an image Pi.
const MAIN_SYSTEM_CONF = RAUC_SYSTEM_CONF.replace('compatible=the-max-mix-ab-spike', 'compatible=the-max-mix-pi')
  .replace('statusfile=/data/ab/rauc.status', 'data-directory=/data/rauc')
  .replace('path=/etc/rauc/ca.cert.pem', 'path=/etc/rauc/keyring.pem')
  .replace(
    'bootloader-custom-backend=/usr/lib/ab/rauc-backend',
    'bootloader-custom-backend=/usr/lib/ab/rauc-backend\npost-install=/usr/lib/ab/post-install'
  )
  .replace('bootname=A', 'bootname=a')
  .replace('bootname=B', 'bootname=b');

const AB_POST_INSTALL = sh`#!/bin/bash
# RAUC system post-install handler: for each boot slot just written, root=PARTLABEL=root-<its slot>.
set -euo pipefail
for i in $RAUC_TARGET_SLOTS; do
  class=RAUC_SLOT_CLASS_$i; device=RAUC_SLOT_DEVICE_$i
  [[ ${'$'}{!class} == boot ]] || continue
  label=$(lsblk -no PARTLABEL "$(readlink -f "${'$'}{!device}")")
  mkdir -p /run/ab/post; mount "${'$'}{!device}" /run/ab/post
  sed -i -E "s/root=PARTLABEL=[^ ]+/root=PARTLABEL=root-${'$'}{label#boot-}/" /run/ab/post/cmdline.txt
  echo "post-install: $label: $(cat /run/ab/post/cmdline.txt)"
  umount /run/ab/post
done
`;

const AB_BOOT_SERVICE = `[Unit]
Description=Mount the booted slot's boot partition on /boot/firmware
DefaultDependencies=no
After=systemd-udev-trigger.service local-fs-pre.target
Before=local-fs.target cloud-init-local.service umount.target
Conflicts=umount.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/lib/ab/ab-boot-mount

[Install]
WantedBy=local-fs.target
`;

function run(cmd: string, args: string[], input?: string): void {
  const r = spawnSync(cmd, args, { stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'], input });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} … exited ${r.status ?? r.signal}`);
}

/** Runs a bash script in a privileged arm64 Debian container with ~/ab-spike mounted on /w. */
function docker(script: string, env: Record<string, string> = {}): void {
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  run(
    'docker',
    [
      'run',
      '--rm',
      '-i',
      '--privileged',
      '--platform',
      'linux/arm64',
      '-v',
      `${WORK}:/w`,
      ...envArgs,
      'debian:trixie',
      'bash',
      '-s'
    ],
    script
  );
}

const TOOLS = sh`set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null && apt-get install -y -qq zstd gdisk dosfstools mtools e2fsprogs rsync curl ca-certificates fdisk jq openssl rauc squashfs-tools >/dev/null
step() { printf '[%4ds] %s\n' $SECONDS "$*"; }
`;

/** A test CA and signing key, kept in ~/ab-spike/keys so every bundle verifies against the image's keyring. */
function keys(): void {
  const dir = path.join(WORK, 'keys');
  if (existsSync(path.join(dir, 'ca.cert.pem'))) return;
  mkdirSync(dir, { recursive: true });
  docker(
    TOOLS +
      sh`cd /w/keys
openssl req -x509 -newkey rsa:4096 -nodes -keyout ca.key.pem -out ca.cert.pem -days 3650 -subj "/CN=the-max-mix ab-spike CA" -addext basicConstraints=critical,CA:true -addext keyUsage=critical,keyCertSign
openssl req -newkey rsa:4096 -nodes -keyout dev.key.pem -out dev.csr.pem -subj "/CN=the-max-mix ab-spike signing"
printf 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=codeSigning\n' > ext.cnf
openssl x509 -req -in dev.csr.pem -CA ca.cert.pem -CAkey ca.key.pem -CAcreateserial -out dev.cert.pem -days 3650 -extfile ext.cnf
`
  );
}

function image(): void {
  keys();
  mkdirSync(path.join(WORK, 'cache'), { recursive: true });
  mkdirSync(path.join(WORK, 'out'), { recursive: true });
  const pubKey = readFileSync(path.join(homedir(), '.ssh', 'id_ed25519.pub'), 'utf8').trim();
  const files: Record<string, string> = {
    'usr/lib/ab/common.sh': AB_COMMON,
    'usr/lib/ab/ab-boot-mount': AB_BOOT_MOUNT,
    'usr/lib/ab/rauc-backend': RAUC_BACKEND,
    'usr/lib/ab/rauc-hook': RAUC_BOOT_HOOK,
    'etc/rauc/system.conf': RAUC_SYSTEM_CONF,
    'etc/systemd/system/ab-boot-mount.service': AB_BOOT_SERVICE,
    'etc/fstab': 'proc  /proc  proc  defaults  0  0\nPARTLABEL=data  /data  ext4  defaults,noatime,nofail  0  2\n'
  };
  const writeFiles = Object.entries(files)
    .map(([p, c]) => `mkdir -p "$(dirname root/${p})"\ncat > root/${p} <<'AB_EOF'\n${c}AB_EOF\n`)
    .join('');
  const sgdisk = LAYOUT.map(
    p =>
      `-n ${p.n}:${p.n === 1 ? 16384 : 0}:+${p.mib}M -t ${p.n}:${p.type} -c ${p.n}:${p.label} -u ${p.n}:${partGuid(p.n)}`
  ).join(' ');
  docker(
    TOOLS +
      sh`
base=/w/cache/base.img
if [[ ! -f $base ]]; then step "Downloading $BASE_URL"; curl -fsSL "$BASE_URL" | zstd -d > $base.part; mv $base.part $base; fi
p() { sfdisk -J $base | jq -r ".partitiontable.partitions[$1]|\"\(.start*512) \(.size*512)\""; }
read bo bs < <(p 0); read ro rs < <(p 1)
mkdir -p /mnt/b /mnt/r /x/boot /x/root; cd /x
mount -o ro,loop,offset=$bo,sizelimit=$bs $base /mnt/b
mount -o ro,loop,offset=$ro,sizelimit=$rs $base /mnt/r
step "Copying the base root and boot partitions"
# Leave out the 1 GB swap file (zram swaps on the Pi) so the 4 GB slot has room for the kiosk install.
rsync -aHAX --exclude=/var/swap /mnt/r/ root/
cp -a /mnt/b/. boot/
base_cmdline=$(cat boot/cmdline.txt)
${writeFiles}
chmod 755 root/usr/lib/ab/ab-boot-mount root/usr/lib/ab/rauc-backend root/usr/lib/ab/rauc-hook
cp /w/keys/ca.cert.pem root/etc/rauc/ca.cert.pem
mkdir -p root/data

step "Installing RAUC in the root and adding a spike admin with this Mac's SSH key"
for d in proc sys dev; do mount --bind /$d root/$d; done
cp /etc/resolv.conf root/etc/resolv.conf.ab; mv root/etc/resolv.conf root/etc/resolv.conf.orig 2>/dev/null || true; cp root/etc/resolv.conf.ab root/etc/resolv.conf
chroot root bash -euc '
  apt-get update -qq >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends rauc rauc-service gdisk >/dev/null
  rauc --version
  id admin >/dev/null 2>&1 || useradd -m -s /bin/bash -G sudo,adm admin
  install -d -m 700 -o admin -g admin /home/admin/.ssh
  echo "$0" > /home/admin/.ssh/authorized_keys; chown admin:admin /home/admin/.ssh/authorized_keys; chmod 600 /home/admin/.ssh/authorized_keys
  echo "admin ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/010-ab-spike; chmod 440 /etc/sudoers.d/010-ab-spike
  systemctl enable ssh ab-boot-mount.service
  apt-get clean
' "$PUBKEY"
rm -f root/etc/resolv.conf root/etc/resolv.conf.ab; mv root/etc/resolv.conf.orig root/etc/resolv.conf 2>/dev/null || true
for d in dev sys proc; do umount root/$d; done
du -sh root

step "Building the six partitions"
mkdir -p ab; printf '[all]\ntryboot_a_b=1\nboot_partition=2\n[tryboot]\nboot_partition=3\n' > ab/autoboot.txt
mkfs.vfat -C -F 16 -n AUTOBOOT p1.img $((32*1024)) >/dev/null; mcopy -i p1.img ab/autoboot.txt ::/
for s in a b; do
  n=$([[ $s == a ]] && echo 4 || echo 5)
  rm -f p$s.img; mkfs.vfat -C -F 32 -n BOOT-${'$'}{s^^} p$s.img $((256*1024)) >/dev/null
  cp -a boot boot-$s
  echo "$(echo "$base_cmdline" | sed -E "s/root=PARTUUID=[^ ]+/root=PARTUUID=6d61786d-6978-4ab0-8000-00000000000$n/; s/ resize//") rw panic=10" > boot-$s/cmdline.txt
  cat boot-$s/cmdline.txt
  mcopy -s -i p$s.img boot-$s/* ::/
done
export E2FSPROGS_FAKE_TIME=1700000000
mkfs.ext4 -q -F -L root-a -U 6d61786d-6978-4ab0-8000-0000000000a4 -E root_owner=0:0,hash_seed=6d61786d-6978-4ab0-8000-000000000004 -d root p4.img 4096M
mkfs.ext4 -q -F -L root-b -U 6d61786d-6978-4ab0-8000-0000000000a5 -E root_owner=0:0,hash_seed=6d61786d-6978-4ab0-8000-000000000004 -d root p5.img 4096M
mkdir -p data/ab; mkfs.ext4 -q -F -L data -d data p6.img 512M

step "Assembling the GPT card image"
img=card.img; rm -f $img; truncate -s $(( (8 + 32 + 256*2 + 4096*2 + 512 + 2) * 1048576 )) $img
sgdisk -o -U ${DISK_GUID} -a 2048 $img >/dev/null
sgdisk ${sgdisk} $img >/dev/null
sgdisk -p $img
put() { local start; start=$(sgdisk -i $1 $img | awk '/First sector/{print $3}'); dd if=$2 of=$img bs=1M seek=$((start/2048)) conv=notrunc,sparse status=none; }
put 1 p1.img; put 2 pa.img; put 3 pb.img; put 4 p4.img; put 5 p5.img; put 6 p6.img
step "Compressing"
zstd -q -f -T0 -9 $img -o /w/out/ab-spike.img.zst
echo "extract_size=$(stat -c %s $img) extract_sha256=$(sha256sum $img | cut -d' ' -f1)" > /w/out/ab-spike.img.info
ls -l /w/out
`,
    { BASE_URL, PUBKEY: pubKey }
  );
  writeManifest();
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', d => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

function writeManifest(): void {
  const out = path.join(WORK, 'out');
  const zst = path.join(out, 'ab-spike.img.zst');
  const info = Object.fromEntries(
    readFileSync(path.join(out, 'ab-spike.img.info'), 'utf8')
      .trim()
      .split(' ')
      .map(kv => kv.split('='))
  );
  void sha256(zst).then(digest => {
    const device = (name: string, tags: string[]): Record<string, unknown> => ({
      name,
      tags,
      icon: `https://downloads.raspberrypi.com/imager/icons/RPi_${name.slice(-1)}.png`,
      matching_type: 'inclusive',
      capabilities: []
    });
    const manifest = {
      imager: {
        devices: [
          device('Raspberry Pi 5', ['pi5-64bit', 'pi5-32bit']),
          device('Raspberry Pi 4', ['pi4-64bit', 'pi4-32bit'])
        ]
      },
      os_list: [
        {
          name: 'The Max Mix A/B spike',
          description: 'Six-partition GPT test card for the A/B update spike',
          url: `file://${zst}`,
          extract_size: Number(info['extract_size']),
          extract_sha256: info['extract_sha256'],
          image_download_size: statSync(zst).size,
          image_download_sha256: digest,
          release_date: new Date().toISOString().slice(0, 10),
          init_format: 'cloudinit-rpi',
          devices: ['pi5-64bit', 'pi4-64bit']
        }
      ]
    };
    writeFileSync(path.join(out, 'ab-spike.rpi-imager-manifest'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Imager list: ${path.join(out, 'ab-spike.rpi-imager-manifest')}`);
  });
}

/** Lists every FAT partition on the flashed card (macOS), to see where Imager's wizard wrote its files. */
function card(disk: string, fix: boolean): void {
  const list = execFileSync('diskutil', ['list', disk], { encoding: 'utf8' });
  console.log(list);
  for (const n of [1, 2, 3]) {
    const dev = `${disk}s${n}`;
    spawnSync('diskutil', ['mount', dev], { stdio: 'inherit' });
    const mount = /Mount Point:\s+(.+)/
      .exec(execFileSync('diskutil', ['info', dev], { encoding: 'utf8' }))?.[1]
      ?.trim();
    if (!mount) continue;
    console.log(`\n== ${dev} on ${mount}`);
    for (const f of ['autoboot.txt', 'cmdline.txt', 'user-data', 'meta-data', 'network-config', 'firstrun.sh']) {
      const p = path.join(mount, f);
      if (!existsSync(p)) continue;
      const st = statSync(p);
      console.log(`-- ${f} (${st.size} bytes, modified ${st.mtime.toISOString()})`);
      if (f === 'cmdline.txt' || f === 'autoboot.txt' || f === 'meta-data') console.log(readFileSync(p, 'utf8'));
    }
  }
  if (fix) console.log('\n--fix: copy by hand once the layout above is recorded (the source partition varies).');
}

/** Runs a root bash script on the Pi over SSH. */
function onPi(script: string): void {
  // The spike card has its own host keys, so keep them out of ~/.ssh/known_hosts.
  const hosts = path.join(WORK, 'known_hosts');
  run(
    'ssh',
    [
      '-o',
      'ConnectTimeout=10',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      `UserKnownHostsFile=${hosts}`,
      PI,
      'sudo bash -s'
    ],
    `set -euo pipefail\n. /usr/lib/ab/common.sh\n${script}`
  );
}

const PI_COMMANDS: Record<string, (args: string[]) => void> = {
  status: () =>
    onPi(sh`echo "model: $(tr -d '\0' < /proc/device-tree/model)"
echo "booted: slot $(slot_of "$(booted_partition)") (partition $(booted_partition)), tryboot flag: $(tryboot_flag)"
echo "kernel: $(uname -r)"; echo "cmdline: $(cat /proc/cmdline)"
mkdir -p /run/ab/autoboot; mountpoint -q /run/ab/autoboot || mount -o ro "$(part 1)" /run/ab/autoboot
echo "--- autoboot.txt"; cat /run/ab/autoboot/autoboot.txt
echo "--- mounts"; findmnt -no TARGET,SOURCE,FSTYPE,OPTIONS / /boot/firmware /data || true
lsblk -o NAME,PARTLABEL,SIZE,FSTYPE,MOUNTPOINTS "$(disk)"
command -v rauc >/dev/null && rauc status || true`),
  /** Points tryboot at the other slot and reboots into it once. */
  tryboot: () =>
    onPi(sh`cur=$(booted_partition); other=$([[ $cur == 2 ]] && echo 3 || echo 2)
mkdir -p /run/ab/w; mount -o rw "$(part 1)" /run/ab/w
def=$(awk -F= '/^\[all\]/{s=1;next} /^\[/{s=0} s&&$1=="boot_partition"{print $2}' /run/ab/w/autoboot.txt)
printf '[all]\ntryboot_a_b=1\nboot_partition=%s\n[tryboot]\nboot_partition=%s\n' "$def" "$other" > /run/ab/w/autoboot.txt
cat /run/ab/w/autoboot.txt; sync; umount /run/ab/w
echo "rebooting into partition $other once (tryboot)"; systemd-run --on-active=2 reboot "0 tryboot"`),
  reboot: () => onPi('systemd-run --on-active=2 systemctl reboot'),
  /** Makes a slot unbootable (its root= points nowhere, so the kernel panics and panic=10 resets the Pi). */
  break: ([slot]) =>
    onPi(sh`n=$(partition_of ${slot ?? 'B'}); mkdir -p /run/ab/w; mount -o rw "$(part $n)" /run/ab/w
sed -i -E 's/root=PARTUUID=[^ ]+/root=PARTUUID=00000000-0000-0000-0000-000000000000/' /run/ab/w/cmdline.txt
cat /run/ab/w/cmdline.txt; umount /run/ab/w`),
  mend: ([slot]) =>
    onPi(sh`n=$(partition_of ${slot ?? 'B'}); mkdir -p /run/ab/w; mount -o rw "$(part $n)" /run/ab/w
sed -i -E "s/root=PARTUUID=[^ ]+/root=PARTUUID=6d61786d-6978-4ab0-8000-00000000000$((n+2))/" /run/ab/w/cmdline.txt
cat /run/ab/w/cmdline.txt; umount /run/ab/w`),
  /** Grows the data partition to the end of the card. */
  'grow-data': () =>
    onPi(sh`d=$(disk); sgdisk -e "$d"; sgdisk -d 6 -n 6:0:0 -t 6:8300 -c 6:data -u 6:6d61786d-6978-4ab0-8000-000000000006 "$d"; partprobe "$d" || partx -u "$d"
resize2fs "$(part 6)"; df -h /data`),
  readonly: ([mode]) => onPi(mode === 'off' ? READONLY_OFF : READONLY_ON),
  install: ([url]) =>
    onPi(sh`iface=$(ip route show default | awk '{print $5; exit}')
rx0=$(cat /sys/class/net/$iface/statistics/rx_bytes); t0=$SECONDS
rauc install "${url ?? ''}"
rx1=$(cat /sys/class/net/$iface/statistics/rx_bytes)
echo "downloaded on $iface: $(( (rx1 - rx0) / 1048576 )) MiB in $((SECONDS - t0)) s"
rauc status`),
  rauc: args => onPi(`rauc ${args.join(' ')}`),
  'adopt-main': () => {
    const keyring = execFileSync('git', ['show', 'origin/main:image/rootfs/etc/rauc/keyring.pem'], {
      encoding: 'utf8'
    });
    onPi(sh`cat > /etc/rauc/keyring.pem <<'AB_EOF'
${keyring}AB_EOF
cat > /etc/rauc/system.conf <<'AB_EOF'
${MAIN_SYSTEM_CONF}AB_EOF
cat > /usr/lib/ab/post-install <<'AB_EOF'
${AB_POST_INSTALL}AB_EOF
chmod 755 /usr/lib/ab/post-install
cat > /usr/lib/ab/common.sh <<'AB_EOF'
${AB_COMMON}AB_EOF
mkdir -p /data/rauc; rauc status`);
  }
};

// The plan's persist.list as bind mounts from /data, then root read-only (kernel `ro`, no root line in fstab).
const PERSIST = [
  ['/etc/NetworkManager/system-connections', 'network/system-connections'],
  ['/etc/netplan', 'network/netplan'],
  ['/var/lib/NetworkManager', 'network/state'],
  ['/var/lib/bluetooth', 'bluetooth'],
  ['/var/lib/tailscale', 'tailscale'],
  ['/home', 'home'],
  ['/etc/ssh/keys', 'ssh'],
  ['/var/log/journal', 'journal'],
  ['/var/lib/systemd', 'systemd']
] as const;

const READONLY_ON = sh`
grep -q ' ro\b\| ro$' /proc/cmdline && { echo "root is already read-only"; exit 0; }
mkdir -p /data/the-max-mix
${PERSIST.map(([from, to]) => `mkdir -p "${from}"; if [[ ! -e "/data/${to}" ]]; then mkdir -p "$(dirname /data/${to})"; cp -a "${from}" "/data/${to}"; fi`).join('\n')}
# ssh host keys: sshd reads them where sshd_config says; point it at /etc/ssh/keys (a bind mount from /data/ssh)
mkdir -p /data/ssh; cp -an /etc/ssh/ssh_host_* /data/ssh/ 2>/dev/null || true
printf 'HostKey /etc/ssh/keys/ssh_host_ed25519_key\nHostKey /etc/ssh/keys/ssh_host_rsa_key\nHostKey /etc/ssh/keys/ssh_host_ecdsa_key\n' > /etc/ssh/sshd_config.d/10-ab-keys.conf
# identity: machine-id and hostname from /data
mkdir -p /data/identity; cp -n /etc/machine-id /data/identity/machine-id; cp -n /etc/hostname /data/identity/hostname
{
  echo 'proc  /proc  proc  defaults  0  0'
  echo 'PARTLABEL=data  /data  ext4  defaults,noatime  0  2'
  ${PERSIST.map(([from, to]) => `echo '/data/${to}  ${from}  none  bind,x-systemd.requires-mounts-for=/data  0  0'`).join('\n  ')}
  echo '/data/identity/machine-id  /etc/machine-id  none  bind,x-systemd.requires-mounts-for=/data  0  0'
  echo '/data/identity/hostname  /etc/hostname  none  bind,x-systemd.requires-mounts-for=/data  0  0'
  echo 'tmpfs  /tmp  tmpfs  mode=1777,nosuid,nodev  0  0'
  echo 'tmpfs  /var/tmp  tmpfs  mode=1777,nosuid,nodev  0  0'
  echo 'tmpfs  /var/cache  tmpfs  mode=755  0  0'
  echo 'tmpfs  /var/log  tmpfs  mode=755  0  0'
  echo 'tmpfs  /var/lib/dhcp  tmpfs  mode=755  0  0'
  echo 'tmpfs  /var/spool  tmpfs  mode=755  0  0'
} > /etc/fstab
cat /etc/fstab
mkdir -p /etc/ssh/keys /var/log/journal
for n in 2 3; do mkdir -p /run/ab/w; mount -o rw "$(part $n)" /run/ab/w; sed -i -E 's/ rw( |$)/ ro\1/; / ro( |$)/!s/$/ ro/' /run/ab/w/cmdline.txt; cat /run/ab/w/cmdline.txt; umount /run/ab/w; done
echo "read-only from the next boot"`;

const READONLY_OFF = sh`
for n in 2 3; do mkdir -p /run/ab/w; mount -o rw "$(part $n)" /run/ab/w; sed -i -E 's/ ro( |$)/ rw\1/' /run/ab/w/cmdline.txt; cat /run/ab/w/cmdline.txt; umount /run/ab/w; done
echo "writable from the next boot (fstab keeps the bind mounts)"`;

/** Builds a RAUC bundle from a root tarball: root ext4 (deterministic) + boot vfat, verity format, block-hash-index. */
function bundle(rootfsTar: string, version: string, out: string): void {
  keys();
  const rel = path.relative(WORK, path.resolve(rootfsTar));
  const outRel = path.relative(WORK, path.resolve(out));
  if (rel.startsWith('..') || outRel.startsWith('..')) throw new Error(`keep bundle inputs and outputs under ${WORK}`);
  docker(
    TOOLS +
      sh`mkdir -p /x/root /x/b /x/bundle; cd /x
step "Unpacking /w/${rel}"
zstd -dc "/w/${rel}" | tar -x --xattrs --xattrs-include='*' --numeric-owner -C root
cp -a root/boot/firmware/. b/ 2>/dev/null || true
rm -rf root/boot/firmware/*
export E2FSPROGS_FAKE_TIME=1700000000
step "root.ext4 (4096 MiB, files in sorted order)"
mkfs.ext4 -q -F -L root -U 6d61786d-6978-4ab0-8000-0000000000aa -E root_owner=0:0,hash_seed=6d61786d-6978-4ab0-8000-000000000004 -d root bundle/root.ext4 4096M
step "boot.vfat"
mkfs.vfat -C -F 32 -n BOOT -i 6d617800 bundle/boot.vfat $((256*1024)) >/dev/null
mcopy -s -m -i bundle/boot.vfat b/* ::/
cat > bundle/manifest.raucm <<EOF
[update]
compatible=the-max-mix-ab-spike
version=${version}

[bundle]
format=verity

[hooks]
filename=hook

[image.rootfs]
filename=root.ext4
adaptive=block-hash-index

[image.boot]
filename=boot.vfat
hooks=post-install
EOF
cat > bundle/hook <<'EOF'
${RAUC_BOOT_HOOK}EOF
chmod 755 bundle/hook
rm -f "/w/${outRel}"
step "rauc bundle"
rauc bundle --cert=/w/keys/dev.cert.pem --key=/w/keys/dev.key.pem --keyring=/w/keys/ca.cert.pem bundle "/w/${outRel}"
rauc info --keyring=/w/keys/ca.cert.pem "/w/${outRel}" | head -30
ls -l "/w/${outRel}"
`
  );
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case 'image':
    image();
    break;
  case 'manifest':
    writeManifest();
    break;
  case 'card':
    card(rest.find(a => a.startsWith('/dev/')) ?? '/dev/disk4', rest.includes('--fix'));
    break;
  case 'pi': {
    const [sub = 'status', ...args] = rest;
    const fn = PI_COMMANDS[sub];
    if (!fn) throw new Error(`unknown pi command ${sub}; one of ${Object.keys(PI_COMMANDS).join(', ')}`);
    fn(args);
    break;
  }
  case 'bundle':
    if (rest.length < 2) throw new Error('usage: bundle <rootfs.tar.zst> <version> [out.raucb]');
    bundle(rest[0] ?? '', rest[1] ?? '', rest[2] ?? path.join(WORK, 'out', `ab-spike-${rest[1] ?? ''}.raucb`));
    break;
  default:
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\nimport ')[0]);
}
