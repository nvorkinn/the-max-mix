# THE MAX MIX Raspberry Pi image

A ready-to-flash Raspberry Pi OS 64-bit image for THE MAX MIX. Flash it, boot, give the Pi your Wi-Fi password on its own
touchscreen, and it installs the kiosk by itself. Nothing has to be typed at a keyboard or into a terminal.

> **Status:** the image build, the first-boot scripts and the units here have never been built or booted. The first real
> build and a walk through on a Pi (see [Checking a new image](#checking-a-new-image)) are still to do.

## What is in the image

- Raspberry Pi OS (Debian trixie) 64-bit with the labwc desktop, built with [pi-gen](https://github.com/RPi-Distro/pi-gen)
  from its `stage0` to `stage3` plus [`stage-maxmix`](stage-maxmix). The extra applications of `stage4` (office suite,
  games and so on) are left out to keep the download small.
- NetworkManager as the only network stack.
- Chromium, `git`, `python3` and `ansible-core` (with `python3-apt` and `acl`), so `ansible-pull` can run on the first
  boot as soon as the Pi is online. The Pi needs to reach GitHub and the package mirrors once; the hosted app is needed
  from then on.
- The Wi-Fi setup portal from [`pi/wifi`](../wifi), installed with `pi/wifi/install.sh` (`the-max-mix-wifi.service`).
- The bootstrap: `the-max-mix-bootstrap.service` plus the first-boot screen (details below).
- Desktop autologin, no screen blanking (applied with `raspi-config nonint` at build time), UK English locale
  (`en_GB.UTF-8`), `Europe/London` time zone, UK keyboard, host name `the-max-mix`.
- No password for the desktop user `maxmix`, SSH switched off, and none of Raspberry Pi OS's first-run user wizard.

## Build the image

The [Pi image workflow](../../.github/workflows/pi-image.yml) builds it. It does not run on pull requests.

- Push a version tag (`git tag v1.2.3 && git push origin v1.2.3`): the workflow builds `the-max-mix-1.2.3.img.xz`, attaches it
  and `the-max-mix-1.2.3.img.xz.sha256` to the release for the tag (creating the release if there is none) and keeps the
  files as a workflow artifact. The image is built from that tag and installs the playbook from the same tag, so the image
  and the playbook always match.
- Or run it by hand (**Actions > Pi image > Run workflow**) on any branch for a test build. The image is only uploaded as a
  workflow artifact (kept for 14 days), named `the-max-mix-dev-<branch>-<commit>.img.xz`, and installs the playbook from
  that branch.

A build takes roughly one to two hours on GitHub's free arm64 runner and produces an image of about 1 GB (the workflow
fails if it would be over GitHub's 2 GiB limit for a release asset). `pi/wifi/install.sh` has to exist, so merge the Wi-Fi
setup portal first.

Choices, and why:

- **pi-gen through `usimd/pi-gen-action`.** pi-gen is what builds Raspberry Pi OS itself, so the result is as close to the
  official image as a custom one gets, and a custom stage is the supported way to extend it. The action runs pi-gen's Docker
  build on a GitHub runner, frees disk space and returns the image path. It is pinned by commit SHA, and the pi-gen release
  it checks out (`2026-10-06-raspios-trixie-arm64`) is pinned by tag, so a build does not change under you. Update both
  deliberately.
- **A native arm64 runner** (`ubuntu-24.04-arm`, free for public repositories) avoids emulating the Pi's CPU, which is several
  times slower. If the repository becomes private, change `runs-on` to `ubuntu-latest` (slower, emulated).
- **`stage0` to `stage3` only.** The desktop is `stage3`; Chromium is added by this repository's stage.
- **No password, no default account anyone knows.** pi-gen will only skip its "choose a username" first-run wizard if a
  password is given, so the workflow passes a random one that is never printed, and the image stage removes it again.
- **Cloud-init stays on**, so Raspberry Pi Imager's customisation (see below) can still set a host name, keyboard, SSH key
  or password on the first boot.

The Wi-Fi country (regulatory domain) is built into the image: `GB` unless you set `wifi_country` when you run the workflow
by hand. A Pi will not use Wi-Fi at all until a country is set, so use the country where the Pi will live. The kiosk
address is `https://the-max-mix.vercel.app/` unless you set `kiosk_url` (by hand) or the repository variable
`PI_KIOSK_URL`; see [Forks and settings](#forks-and-settings).

To build by hand without GitHub, follow [pi-gen's README](https://github.com/RPi-Distro/pi-gen#readme): check out the same
release, copy `pi/wifi` to `pi/image/stage-maxmix/02-wifi/files/wifi`, set `STAGE_LIST="stage0 stage1 stage2 stage3 <path to
stage-maxmix>"`, `FIRST_USER_NAME=maxmix`, `FIRST_USER_PASS=<anything, it is removed>` and `DISABLE_FIRST_BOOT_USER_RENAME=1`,
and optionally write `KIOSK_URL=`, `PLAYBOOK_REPO=` and `PLAYBOOK_REF=` lines to `stage-maxmix/build.env`.

## Flash it

1. Download `the-max-mix-<version>.img.xz` and `the-max-mix-<version>.img.xz.sha256` from the
   [releases page](https://github.com/nvorkinn/the-max-mix/releases). Check the download with
   `sha256sum --check the-max-mix-<version>.img.xz.sha256` (macOS: `shasum -a 256 --check ...`).
2. Open [Raspberry Pi Imager](https://www.raspberrypi.com/software/). Choose the Pi model, then under operating system
   **Use custom** and pick the `.img.xz` file (Imager unpacks it; do not unpack it yourself).
3. Choose the SD card (16 GB or more) and write it.
4. If Imager offers customisation for the image, use it only for things you really want (host name, keyboard, an SSH key; see
   [Getting in](#getting-in-ssh-and-a-password)). Nothing is required: Wi-Fi is entered on the Pi itself.
5. Put the card in the Pi, connect the touchscreen and power it on.

## First boot, step by step

1. **Boot and resize.** The Pi expands its filesystem and logs in to the desktop by itself. The touchscreen shows
   "Starting up" for up to a minute.
2. **No internet yet.** The first-boot screen switches to the Wi-Fi setup portal (`http://127.0.0.1:8088/`). It shows the
   setup hotspot `THE-MAX-MIX-SETUP` with its password and a QR code, so you can finish the setup from a phone, or just
   use the touchscreen. Pick the home Wi-Fi network and enter its password.
3. **Connecting.** Once the Pi is online, the portal starts `the-max-mix-bootstrap.service`, and the screen shows "Connecting,
   setting up THE MAX MIX. This takes a few minutes." The service runs `ansible-pull` with the playbook in
   [`ansible/`](../../ansible), which installs and configures the kiosk. If it fails (no route to GitHub, a flaky
   connection) it tries again, waiting longer each time, up to ten minutes between attempts.
4. **Hand over.** When `ansible-pull` succeeds, `/var/lib/the-max-mix/bootstrapped` is written, the first-boot screen
   closes and the real kiosk (Chromium, fullscreen, the hosted app) starts. If it does not start within a minute, the Pi
   restarts once and the kiosk starts after the restart.
5. **Sign in to Spotify** once in Settings, as described in the [main README](../../README.md#spotify-configuration).

Later boots go straight to the kiosk: the bootstrap and first-boot screen are skipped for good once the marker file exists.
If the Pi already has ethernet, or a Wi-Fi network from Imager's customisation, step 2 is skipped and the bootstrap starts
by itself as soon as the network is up.

## Forks and settings

Everything the bootstrap uses is in `/etc/the-max-mix/bootstrap.env`:

- `KIOSK_URL`: the address the kiosk opens (default `https://the-max-mix.vercel.app/`). Register exactly this address, with
  the trailing slash, as a redirect URI in the Spotify dashboard.
- `PLAYBOOK_REPO`: the repository `ansible-pull` clones (default `https://github.com/nvorkinn/the-max-mix.git`; a build
  uses the repository it was built in).
- `PLAYBOOK_REF`: the branch or tag of it (default `main`; a release image uses its own tag).
- `KIOSK_USER`: the desktop user that runs the kiosk. Empty means the first normal user (uid 1000).

To make an image for a fork, build it in the fork (it uses the fork as `PLAYBOOK_REPO` and its own tag as `PLAYBOOK_REF`) and
set the repository variable `PI_KIOSK_URL` (Settings > Secrets and variables > Actions > Variables) to the fork's hosted
address. To change a card that is already flashed but not yet set up, edit `/etc/the-max-mix/bootstrap.env` on the card's
second (root) partition. After setup, change `kiosk_url` the way the main README describes and run the playbook again.

To run the bootstrap again, delete `/var/lib/the-max-mix/bootstrapped` and run
`sudo systemctl start the-max-mix-bootstrap.service`.

## Getting in: SSH and a password

The image has **no password** for the desktop user and **SSH is off**, so a lost or stolen card does not come with a
well-known login. The kiosk needs neither. To get a shell:

- **Raspberry Pi Imager customisation**, if it is offered for the image: set a user name and password, and enable SSH with
  your public key (or a password). It writes a cloud-init file on the card's boot partition that applies on the first
  boot.
- **Or edit the `user-data` file** on the card's boot partition (the `bootfs` drive that appears on a computer after
  flashing) before the first boot, for example:

  ```yaml
  #cloud-config
  users:
    - name: maxmix
      ssh_authorized_keys:
        - ssh-ed25519 AAAA... you@example
  runcmd:
    - [systemctl, enable, --now, ssh]
  ```

  and to set a password instead (so you can use a keyboard on the Pi), add `chpasswd: { users: [{ name: maxmix, password: <password>, type: text }], expire: false }`.

Any account Imager creates is picked up as the kiosk user by the bootstrap (it uses the first normal user); the desktop
autologin follows the same account, so keep a single normal user on the Pi.

## Troubleshooting

On the Pi (over SSH, or on a keyboard with `Ctrl+Alt+F2`):

```bash
# What the bootstrap and the Wi-Fi portal are doing
journalctl -u the-max-mix-bootstrap -u the-max-mix-wifi -b
# What the first-boot screen shows (as the desktop user)
cat /var/lib/the-max-mix/status.json
journalctl --user -u the-max-mix-firstboot -b
# The last ansible-pull output
cat /var/lib/the-max-mix/last-run.log
# Start the bootstrap now instead of waiting for its next retry
sudo systemctl start --no-block the-max-mix-bootstrap.service
```

- **The screen stays on "Waiting for Wi-Fi".** Join the `THE-MAX-MIX-SETUP` hotspot from a phone, or plug in ethernet. A wrong Wi-Fi
  country makes some networks invisible: rebuild with the right `wifi_country`.
- **"Setup hit a snag" keeps coming back.** Read `last-run.log`: usually GitHub or the package mirrors are unreachable, or
  the `PLAYBOOK_REF` does not exist. The bootstrap retries by itself.
- **The Pi shows a desktop, not the first-boot screen.** The desktop autostart did not run; start it by hand with
  `/opt/the-max-mix/bin/the-max-mix-firstboot-session` from a terminal in the desktop session.
- **Nothing happens after "All set".** Run `systemctl --user start the-max-mix-kiosk.service` as the desktop user; the
  [main README](../../README.md#operations-and-updates) has the kiosk's own logs.

## How it fits together

- [`stage-maxmix`](stage-maxmix) is the pi-gen stage: `00-install-packages` (apt packages), `01-system` (the files below and
  the settings), `02-wifi` (runs `pi/wifi/install.sh`) and `03-account` (no password, no first-run wizard, autologin).
- `/etc/systemd/system/the-max-mix-bootstrap.service` runs `/opt/the-max-mix/bin/the-max-mix-bootstrap` as root on every boot
  until it has succeeded once (`ConditionPathExists=!/var/lib/the-max-mix/bootstrapped`), retrying on failure with a growing
  delay. A NetworkManager dispatcher script starts it again as soon as any connection comes up, and the Wi-Fi portal starts it
  with `systemctl start --no-block` once Wi-Fi connects.
- The script writes `/var/lib/the-max-mix/status.json` (`starting`, `waiting_for_network`, `running`, `failed` or `done`),
  runs `ansible-pull -U $PLAYBOOK_REPO -C $PLAYBOOK_REF -i localhost, -e kiosk_url=... -e kiosk_user=... ansible/local.yml`,
  and writes the marker only on success. The playbook is idempotent, so a retry is safe.
- The desktop autostart (`/etc/xdg/labwc/autostart` and `/etc/xdg/autostart`) runs `the-max-mix-firstboot-session`, which
  starts the user service `the-max-mix-firstboot.service` while the marker is missing. It opens a separate Chromium
  profile on the portal or on `/opt/the-max-mix/firstboot/index.html`, which polls `status.json`.
- The two kiosks never run together: the playbook's `the-max-mix-kiosk.service` gets a drop-in that makes it conflict with
  the first-boot service and refuse to start until the marker exists. When setup is done the first-boot screen starts the
  real kiosk, which stops the first-boot screen.

## Checking a new image

Until this has been done once, treat the image as untested:

1. Run the Pi image workflow by hand and download the artifact.
2. Flash it to a card, boot a Pi 4 or newer with the touchscreen, and walk through [First boot](#first-boot-step-by-step) with
   no ethernet attached.
3. Reboot after setup and check the kiosk comes straight up with no first-boot screen, and that `systemctl is-enabled ssh`
   says it is disabled.
