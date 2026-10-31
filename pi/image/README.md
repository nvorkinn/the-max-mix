# THE MAX MIX kiosk image

A ready-to-flash Raspberry Pi OS Lite (64-bit, Debian 13 "trixie") image for a Raspberry Pi 4 or 5 with a Waveshare 7-inch
1024x600 HDMI + USB-touch screen. Flashing it is the only setup step: there is no SSH, no provisioning and no Wi-Fi
configured in advance.

> The image has not been built or booted on a real Pi yet. See "Still to verify" below.

## What you see

- **Online:** the app, full screen in Chromium (`https://the-max-mix.vercel.app/?kiosk=1`).
- **Offline:** a black screen with a centred Wi-Fi setup panel and an on-screen keyboard.
- Never a desktop, a terminal, boot text, browser controls or a mouse cursor.

## Build

The [Pi image workflow](../../.github/workflows/pi-image.yml) builds it with
[pi-gen](https://github.com/RPi-Distro/pi-gen), Raspberry Pi's own image builder. Run it from Actions > Pi image > Run workflow
(the image is a workflow artifact), or push a `v*` tag to attach `the-max-mix-<version>.img.xz` and its `.sha256` to the
release.

By hand, with Docker, use `pi/image/build-local.sh`. Build on an ARM machine (a Raspberry Pi 5, Apple Silicon): on x86
every `apt install` in the image runs through QEMU emulation, which is much slower.

```bash
pi/image/build-local.sh full   # first time, and to refresh the stock stages
pi/image/build-local.sh        # afterwards: reuses stage0 to stage2, reruns only stage-kiosk
```

The fast rebuild keeps pi-gen's build container (`PRESERVE_CONTAINER=1`, `CONTINUE=1`) and marks stage0 to stage2 with
`SKIP` files, so only the kiosk stage runs. Local images are not compressed (`DEPLOY_COMPRESSION=none` in
`pi/image/config`). To avoid downloading packages on every build, run
[apt-cacher-ng](https://www.unix-ag.uni-kl.de/~bloch/acng/) (for example in a Docker container) and set
`APT_PROXY=http://host.docker.internal:3142` when running the script; it works without a proxy too.

`stage-kiosk` runs after `stage2` and is the only stage exported as an image. It holds no configuration of its own:
`00-packages` installs Ansible, git and `python3-apt`, and `01-install/00-run.sh` runs the playbook
[`ansible/local.yml`](../../ansible/local.yml) inside the image's chroot with `kiosk_image_build=true`, so services are
enabled and nothing is started. [`prepare.sh`](prepare.sh) only copies `ansible/` and `pi/wifi-panel/` into the stage, the
one directory pi-gen's build can see. Everything installed and configured on the device is in the Ansible role
([`ansible/roles/kiosk`](../../ansible/roles/kiosk)); [`config`](config) keeps pi-gen's own base settings (host name, the
`kiosk` user, locale, keyboard, Wi-Fi country, no SSH), which the playbook sets again.

The image bakes in the same `kiosk_pull_ref` (`stable`) that the device's update timer pulls. Reflashing is only for fresh
devices: a deployed one gets playbook changes by `ansible-pull` (see the [README](../../README.md#raspberry-pi-kiosk)).

## Bluetooth keyboard and mouse

The devices in `kiosk_bluetooth_devices` ([`defaults/main.yml`](../../ansible/roles/kiosk/defaults/main.yml)) are paired on
first boot, with no network and no touch screen. Put each device in pairing mode (on the channel you want for the Pi) when
the Pi starts. `kiosk-bluetooth-pair.service` scans for 30 seconds, rests for 30 and repeats until every device is paired
and trusted, then exits; later boots reconnect by themselves. Progress is in `journalctl -u kiosk-bluetooth-pair`. Give a
device's channels the same `name` when they have different addresses: one paired address is enough. Keyboards that ask for a
passkey are not supported.

`kiosk_hide_cursor` is `true`, so no pointer shows on the touch screen. Set it to `false` while a mouse is the only way to
use the screen.

## Flash

1. Download and unpack the `.img.xz` (or give it to Raspberry Pi Imager as it is).
2. In [Raspberry Pi Imager](https://www.raspberrypi.com/software/) choose **Use custom** and select the image. Do not apply
   OS customisation: the image sets up everything itself.
3. Put the card in the Pi, connect the screen and power.

## First boot

1. The file system expands to fill the card (pi-gen's default) and the Pi reboots once.
2. A black Plymouth splash covers the boot. The Wi-Fi country (GB), locale (`en_GB.UTF-8`) and time zone
   (`Europe/London`) are already set.
3. `kiosk.service` starts [Cage](https://github.com/cage-kiosk/cage), a single-app Wayland compositor, on tty7 as the
   `kiosk` user. Cage runs `/usr/local/bin/kiosk-session` forever.
4. `kiosk-session` waits up to 30 seconds for NetworkManager to report full connectivity (a check against
   `network-test.debian.org`, set in `/etc/NetworkManager/conf.d/20-connectivity.conf`). If it does, it runs Chromium; if
   not, it runs `/usr/local/bin/wifi-panel` until it connects.
5. The panel offers Cancel only when a connection already works. Connect, and the session loop starts Chromium.
6. `kiosk-pull.timer` runs the first `ansible-pull` three minutes after boot and then every five minutes, applying the
   playbook only when `stable` has moved. If there is no network yet, or the `stable` ref does not exist, the run fails
   and only logs (`journalctl -u kiosk-pull`); the kiosk is not affected. A pull that changed kiosk files makes `kiosk-restart.timer` restart the kiosk at 04:30.

The app's Wi-Fi button (shown with `?kiosk=1`) opens `kiosk-wifi://open`. Chromium's managed policy lets
`https://the-max-mix.vercel.app` do that without a prompt, `xdg-open` finds `kiosk-wifi.desktop` through
`/etc/xdg/mimeapps.list`, and `kiosk-open-wifi` creates `/run/kiosk/show-wifi` and stops Chromium. The session loop then runs
the panel and starts Chromium again afterwards. Moving house is covered by the boot-time check; nothing watches the network
while Chromium runs.

The image sets, among other things:

- no SSH, no password for any account (the `kiosk` user is locked and not in `sudo`), no Wi-Fi networks;
- `kiosk` manages NetworkManager connections without sudo through `etc/polkit-1/rules.d/50-kiosk-networkmanager.rules`;
- PipeWire, `pipewire-pulse` and WirePlumber, ready for Bluetooth audio later;
- `unattended-upgrades` for Debian security updates and the Raspberry Pi archive (Chromium, kernel);
- `config.txt` and the kernel command line for the 1024x600 screen, a quiet boot and no cursor. The mode is forced to
  1024x600 on both HDMI ports; change `video=` in `cmdline.txt` for another screen. The screen is not rotated.

## Troubleshooting

There is deliberately no way in over the network and no login, so debug from the SD card on another computer: its
`bootfs` partition holds `config.txt` and `cmdline.txt` (remove `quiet splash` and change `console=tty3` back to `tty1` to
see boot messages). The kiosk logs go to the journal (`journalctl -u kiosk` on a Pi you can log in to).

- **Black screen, no panel or app:** the service may not have a display. Check `kiosk.service` started on tty7.
- **Panel never offers Cancel / always appears:** the connectivity check failed. `network-test.debian.org` must be reachable
  over plain HTTP; a captive portal that needs a browser login is not supported.
- **Sound does not play, or the player says DRM is missing:** Widevine. See "Still to verify".
- **`kiosk-wifi://` does nothing:** see "Still to verify".

## Still to verify

Nobody has built or booted this yet. On the first real image, check:

1. **Boot:** the black splash, then the panel when offline (no Wi-Fi configured), with a working on-screen keyboard.
2. **Widevine on Pi 4 and Pi 5:** the app plays sound. The Pi 5 normally boots a 16 KB-page kernel; the image sets
   `kernel=kernel8.img` for the Pi 5 (`[pi5]` section in `config.txt`), the 4 KB-page kernel the Pi 4 uses. That Widevine
   needs 4 KB pages is unconfirmed (searching found no report either way), so test both. `getconf PAGESIZE` should print 4096.
3. **`kiosk-wifi://` handover:** with a connection up, tap the app's Wi-Fi button. The panel should appear with Cancel, and
   the app should come back after Cancel. Chromium has to hand the link to `xdg-open` without a desktop environment; that
   `xdg-open` runs the handler with no desktop was checked, Chromium's side was not. If Chromium shows an "open this
   app?" prompt or nothing happens, check `chrome://policy` for `AutoLaunchProtocolsFromOrigins`.
4. **Reboot:** it goes straight to the app.
5. **Updates:** with a `stable` ref pushed, `sudo systemctl start kiosk-pull` on a live Pi pulls and applies it (journal:
   `journalctl -u kiosk-pull`) and a second run skips the playbook because `stable` has not moved. A pull with no network or a missing ref fails without
   touching the kiosk. After a change to a kiosk file, `/run/kiosk/restart-needed` exists until the 04:30 restart.
6. **Cursor:** none shows. If one does, the transparent theme in `/usr/share/icons/blank` is not being picked up.
