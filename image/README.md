# The kiosk image

What the A/B image is made of, as plain files: the image build reads them, and nothing on the Pi changes them. A
release replaces the whole root file system, so a file removed here is gone from every Pi after its next update. Only
what [persist.list](persist.list) names outlives an update.

Every bundle is built from this folder: `dev` on each merge to `main`, and a release's from its tag.

| File                         | What the build does with it                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [packages.txt](packages.txt) | Installs these on Raspberry Pi OS Lite (arm64) with no recommended packages, after adding the archives in `rootfs/`; purges the `-` lines |
| [rootfs/](rootfs)            | Copies it over the root file system as root:root, keeping symlinks and the executable bit (files 0644, programs 0755)                     |
| [boot/](boot)                | The boot partition for either slot (`root=PARTLABEL=root-a`); RAUC's post-install handler points slot B's at `root-b`                     |
| [units.txt](units.txt)       | `systemctl enable`, `systemctl --global enable` or `systemctl mask` for each line                                                         |
| [persist.list](persist.list) | Each line becomes a bind mount from `/data`; the build makes each path, empty, in the image                                               |

After copying, the build also runs `systemd-sysusers` (the accounts, `rootfs/usr/lib/sysusers.d`), `locale-gen`, and
writes `/usr/lib/the-max-mix/release.env`:

```sh
KIOSK_RELEASE_REF=v2.53.0   # the tag, or the channel (dev, branch-<name>)
KIOSK_RELEASE_COMMIT=<the full commit>
```

It drops in the built artefacts: the web app at `/opt/the-max-mix/app`, `pi/kiosk-audio` (without its tests) with its
`node_modules` (installed from [kiosk-audio/package-lock.json](kiosk-audio/package-lock.json)) at
`/opt/the-max-mix/kiosk-audio`. Spotify Soloist is not in the image: its terms do not allow passing it
on, and each build expires after 90 days, so `kiosk-soloist-update.timer` fetches it onto `/data/soloist`, where
`/usr/local/bin/soloist` links (the build makes the link).

## The Pi's own settings

`/data/the-max-mix/kiosk.env` holds what differs from one Pi to the next, as `KEY=value` lines (a systemd
`EnvironmentFile`). Every key may be missing.

| Key                    | Read by                                       | Meaning                                                     |
| ---------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| `KIOSK_NAME`           | kiosk-audio.service                           | The name Soloist goes by in Spotify Connect; else host name |
| `KIOSK_SSH`            | ssh.service (drop-in)                         | `off` keeps sshd from starting                              |
| `KIOSK_TAILSCALE`      | tailscaled.service (drop-in)                  | `off` keeps Tailscale from starting                         |
| `KIOSK_ROTATION`       | kiosk.service, `screen-setup.ts --rotation`   | 0, 90, 180 or 270, for a screen it does not know            |
| `KIOSK_SCALE`          | kiosk.service, `screen-setup.ts --scale`      | Such as 1.5, for a screen it does not know                  |
| `KIOSK_VIDEO_MODE`     | kiosk.service, `screen-setup.ts --video-mode` | Such as 1280x800@60, for a screen with a wrong EDID         |
| `KIOSK_UPDATE_CHANNEL` | kiosk-update                                  | `stable`, `dev` or `branch-<name>`                          |

## From Ansible

Where each part of the Ansible role that set up the first Pis went:

- Values from `defaults/main.yml` are written into the files (the kiosk and admin accounts, ports, timer intervals,
  the journal cap, the AirPlay latency), except the ones above, which each Pi reads from `kiosk.env`.
- The accounts are `sysusers.d` with fixed IDs (admin 1000, kiosk 1001), as their homes on `/data` outlive images.
- `/etc/hosts` no longer gets the host name: `libnss-myhostname` resolves it, so the file is the same on every Pi.
- The kernel command line and `config.txt` are whole files in `boot/` instead of edits to Pi OS's. `video=` is written
  at kiosk start by `screen-setup.ts`.
- SSH host keys live on `/data` (`/etc/ssh/host-keys`); `kiosk-ssh-host-keys` makes missing ones before sshd starts.
- The cursor links, the tty1 mask and the kiosk-audio link are symlinks in `rootfs/` or lines in `units.txt`.

Left out, because the image replaces them:

- `kiosk-pull`, the release tarball, the restart marker, the package and part stamps, `install-files.ts`, `task_progress.py`: updates are
  `kiosk-update` and RAUC.
- `kiosk-app-switch` and the app's `releases/`, `next` and `current`: the app is part of the image, and the reboot into
  the new slot is the switch.
- unattended-upgrades and its settings: security fixes ship as image releases.

The read-only root: `/tmp`, `/var/tmp` and `/var/cache` are in memory, and `/var/lib` is an overlay whose changes stay
in memory (logind, the backlight level, udisks2), with `persist.list`'s binds from `/data` on top. Swap is zram only
(`/etc/rpi/swap.conf.d`), and the radios' rfkill state is not restored, so Wi-Fi is never left blocked.

Proven on a Pi 5 with the Touch Display 2 (the spike, 2026-11-24): booting from either slot on the read-only root with
Wi-Fi, SSH, Cage, Chromium and kiosk-audio up; adaptive installs that download under a tenth of the bundle; a healthy
trial slot kept, and a failed one marked bad with the Pi back on its old slot. After a fallback, the firmware's
[tryboot] section points at the good slot again, so a plain `reboot '0 tryboot'` does not retry the bad one: only a
new install, or `rauc status mark-active other`, makes it the slot to try.
