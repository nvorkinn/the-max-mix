# A/B update spike: results

Chunk 0 of the image-based A/B update plan, run on 2026-11-24 on the-max-mix-4 (Raspberry Pi 5, 8 GB, Touch Display 2)
with a spare 64 GB card; the Pi's own card was not touched. The probe is
[`pi/tools/ab-probe.mts`](../pi/tools/ab-probe.mts). It builds a test card in an arm64 Debian container on a Mac, from
the published flash image re-laid out as the plan's six partitions with RAUC added, and drives the Pi over SSH. Slot A
ran that spike system; slot B then got main's real image (`dev` bundle, main 96f7f4b), installed by RAUC from slot A,
and slot A in turn got #674's image, installed by main's `kiosk-update` from slot B.

## Results

| #   | Question                                             | Result                                                          |
| --- | ---------------------------------------------------- | --------------------------------------------------------------- |
| 1   | Six-partition GPT card boots                         | Yes on Pi 5 (EEPROM 2026-10-30), first try. Pi 4B not tried     |
| 2   | tryboot: B once, fallback to A, commit               | Yes, all three. Fallback on a failed health check: _pending_    |
| 3   | Where Imager's wizard writes                         | Partition 1 (`autoboot`), not `boot-a`                          |
| 4   | Read-only root with /data binds, kiosk works         | Yes on #674's image, after 12 bugs found here (below)           |
| 5   | `rauc install` streaming from a GitHub release asset | Yes, through the redirect, with a shell tryboot backend         |
| 6   | Sizes                                                | 1.15 GB bundles; 359 MiB from Pi OS, 90 MB for a package change |

## 1. GPT boot

The card: `autoboot` 32 MiB FAT16, `boot-a`/`boot-b` 256 MiB FAT32, `root-a`/`root-b` 4 GiB ext4, `data` ext4;
partition types `0700` and `8300`; fixed partition GUIDs. `autoboot.txt` on partition 1:

```ini
[all]
tryboot_a_b=1
boot_partition=2
[tryboot]
boot_partition=3
```

The Pi 5 booted slot A from it unchanged. The firmware reports the partition it booted from in
`/proc/device-tree/chosen/bootloader/partition` and the tryboot flag in `.../tryboot`; that is all a backend needs.
`root=PARTLABEL=root-b` works (Pi OS's initramfs resolves it).

From stock Pi OS, an image must:

- drop ` resize` from `cmdline.txt`: Pi OS's initramfs (`resize_early`, `set_partuuid`) would otherwise grow the root
  partition and rewrite the MBR disk ID;
- say `ro` or `rw` on the kernel command line: with no root line in `/etc/fstab` nothing remounts root;
- leave out `/var/swap` (1 GB in Pi OS's image).

## 2. tryboot

`reboot "0 tryboot"` booted partition 3 once with the tryboot flag set to 1. Pulling the power then booted slot A again
(flag 0), so a slot that hangs costs one power cycle at worst, or none with the hardware watchdog. On B, `rauc status
mark-good` through main's `rauc-backend.ts` rewrote `[all] boot_partition=3`, and a plain reboot then came back on B:
the commit works.

RAUC runs the backend in its own mount namespace, so a partition the backend mounts stays mounted there (rw) and the
rest of the system cannot mount it read-only ("would change RO state"). The backend should unmount after each write.

## 3. Imager's wizard

Raspberry Pi Imager 2.0.12 writes `user-data`, `meta-data` and `network-config` to the card's first FAT partition, the
`autoboot` one, and creates a `cmdline.txt` there holding only its own additions
(`cfg80211.ieee80211_regdom=GB ds=nocloud;i=rpi-imager-<id>`). It does not touch `boot-a`. Main's
`kiosk-first-boot.ts` read them from there on slot B's first boot: "host name the-max-mix-ab, 1 SSH key(s), Wi-Fi …",
and grew `data` to the end of the card (49 GB).

Imager's `user-data` sets `hostname`, `user` (name, SSH keys), `ssh_pwauth`, `timezone`, `keyboard`, `apt`,
`packages`, `runcmd` (`systemctl enable --now ssh`), `manage_etc_hosts` and `manage_resolv_conf`; `network-config` is
netplan v2 with `wifis` (password, regulatory domain) and `ethernets`.

## 4. Read-only root: what broke on main's image

Each was reported to the planning thread as it turned up and is fixed in #674.

|     | Symptom                                      | Cause                                                                                                         |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| a   | No Wi-Fi                                     | Pi OS's `NetworkManager.state` has `WirelessEnabled=false` and is seeded to `/data`                           |
| b   | No SSH                                       | Debian's `ssh.service` runs `sshd -t` before the drop-in that makes the host keys                             |
| c   | No kiosk session                             | `systemd-logind` can't create `/var/lib/systemd/linger`; rfkill, backlight, udisks2 also need `/var/lib`      |
| d   | Unhealthy slot not rolled back               | the health check trusted its own state file, not the firmware's tryboot flag                                  |
| e   | Progress stuck at 43% for minutes            | RAUC reports no progress inside an adaptive image copy (#675)                                                 |
| f   | `screen-setup.ts` crashes                    | it writes `/boot/firmware/cmdline.txt`, which the image never mounted                                         |
| g   | admin is UID 985, not 1000                   | Pi OS's `pi` user holds 1000, so `sysusers.d` picks a dynamic UID                                             |
| h   | Nothing can update or commit                 | the image had `rauc` but not `rauc-service`, so no RAUC daemon on D-Bus                                       |
| i   | `kiosk-update` fails at once                 | RAUC mounts bundles under `/mnt/rauc` on the read-only root; needs `mountprefix=/run/rauc`                    |
| j   | Install dies mid-copy ("Input/output error") | a new build replaced the rolling asset under the same name while RAUC streamed it by range requests           |
| k   | No reboot into the new slot                  | `systemctl reboot 0 tryboot`: "Too many arguments"                                                            |
| l   | Same bundle reinstalled every 2 minutes      | after (k) the updater recorded the booted version as pending; the next boot then marked the wrong slot failed |

On main's image, with (a) to (c) worked around on the card, Cage could not drive the Touch Display 2 ("Swapchain for
output 'DSI-2' failed test") until `screen-setup.ts` ran properly (f); after that the app sent heartbeats. #674's image
then came up on slot A with no workarounds: read-only root, Wi-Fi, SSH, `rauc.service`, Cage, Chromium and the app
(`/health` heartbeat 13 s old).

## 5. Streaming from GitHub

`rauc info` and `rauc install` on `https://github.com/nvorkinn/the-max-mix/releases/download/dev/the-max-mix.raucb`
work as is: RAUC 1.13's streaming follows the redirect to GitHub's object store and uses range requests there. A spike
`system.conf` with `bootloader=custom` and a 60-line shell backend over `autoboot.txt` was enough for slot A to install
main's bundle; a system post-install handler pointed `boot-b`'s `cmdline.txt` at `root=PARTLABEL=root-b`.

## 6. Sizes

| Install                                           | Bundle  | Downloaded     | Time (Wi-Fi) |
| ------------------------------------------------- | ------- | -------------- | ------------ |
| main's `dev` into slot B, from the spike's slot A | 1.15 GB | 359 MiB        | 10 min 15 s  |
| #674 (packages added, fixes) into slot A, from B  | 1.15 GB | 89.6 MB (7.8%) | about 2 min  |

The first install already reused most of the root: 381,782 of the 1,048,576 4 KiB chunks were zero, and slot A's Pi OS
blocks matched many more. Building the hash indexes for the target and active slots took one minute each.

## What the plan must change

- **Root slots need 4 GiB, not 3.** The kiosk's root is about 2.7 GB of files (2.3 GB in `/usr`). Chunk 4 already uses
  4 GiB.
- **`/var/lib` needs a writable layer** under the persist binds (fixed in #674 as tmpfs).
- **Progress:** show "Downloading…" with bytes from the network, not RAUC's percentage, during the root image (#675).
- **Rolling channels need a unique file per build**, with a pointer to the current one (j, done in #674 as
  `bundle.txt`), and old files kept a while for Pis mid-install.
- **Trust the firmware, not a state file,** for "is this a trial boot" (`/proc/device-tree/chosen/bootloader/tryboot`),
  so a bad state file can't commit or fail the wrong slot (d, l).
- **A delta is small:** about 90 MB for a release that adds packages, so the dev channel's 2-minute loop is realistic on
  Wi-Fi.
