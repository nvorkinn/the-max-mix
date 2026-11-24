# Setting up a kiosk

A kiosk is stock Raspberry Pi OS Lite plus this repository's Ansible playbook. You flash a ready-made image with
Raspberry Pi Imager, and at the first boot it builds itself into a kiosk on your own Wi-Fi. That Wi-Fi is for the first
boot only: the first boot removes it from the card, and at its new home the Pi's owner picks their own network in the
app.

Tested on a Raspberry Pi 4 Model B with a Waveshare 7-inch 1024x600 HDMI and USB touch screen. A Pi 5 should work the
same; the playbook boots it with the 4 KB-page kernel (`kernel=kernel8.img`), which Spotify Soloist has been run on.

## What you need

- A recent [Raspberry Pi Imager](https://www.raspberrypi.com/software/) (2.0 or later).
- A Wi-Fi network you control, or Ethernet, for the first boot.

## Set up

1. Open the image list in Imager. Download
   [`the-max-mix.rpi-imager-manifest`](https://github.com/nvorkinn/the-max-mix/releases/download/flash-image/the-max-mix.rpi-imager-manifest)
   and double-click it, or start Imager with
   `--repo https://github.com/nvorkinn/the-max-mix/releases/download/flash-image/the-max-mix.rpi-imager-manifest`.
   Imager then offers one OS, **The Max Mix**.
2. Choose your Pi, **The Max Mix** and the card, and fill in Imager's customisation:
   - host name `the-max-mix` (`the-max-mix-2` and so on for another kiosk on the same network);
   - user name `admin`. Any password will do: the playbook removes it, and SSH then takes only the keys of the GitHub
     account in `kiosk_admin_github_user` (see "Maintenance over SSH");
   - your Wi-Fi, unless the Pi is on Ethernet;
   - SSH on, if you like. The playbook turns it on in any case.
3. Put the card in the Pi, connect the screen and power it on. cloud-init applies Imager's settings, then the image's
   first-boot script ([`first-boot`](first-boot)) installs Ansible and runs the playbook from the latest GitHub release,
   the same run the Pi's update timer repeats later, and the Pi reboots. Expect 15 to 30 minutes. It tries again every
   minute until it has worked (`/var/log/cloud-init-output.log`).
4. After the reboot the kiosk starts. Test it: sign in to Spotify, save your Soloist key, play something, try the
   speakers.

### The image

The image is the newest stock Raspberry Pi OS Lite (64-bit) with two files added to its system partition, and it carries
no release: the first boot always installs the latest one. It lives in the system partition because Imager writes its own
`user-data` over whatever the card had.

- `/var/lib/cloud/scripts/per-instance/the-max-mix-first-boot` ([`first-boot`](first-boot)): cloud-init runs it once
  for each newly flashed card (Imager gives every card its own instance id), after Imager's settings.
- `/etc/cloud/cloud.cfg.d/99-the-max-mix.cfg` ([`the-max-mix.cfg`](the-max-mix.cfg)): reboot once that has finished.

The [Flash image workflow](../../.github/workflows/flash-image.yml) builds it with [`build-image.sh`](build-image.sh) and
publishes it with Imager's list on the `flash-image` pre-release, which never becomes the latest release, so the links
above never change. It builds when one of those files changes on `main`, when Raspberry Pi OS has a new image (it checks
weekly) or when you run it by hand.

## A second kiosk

Two Pis on one network can't both be `the-max-mix.local`: give the second its own host name in Imager (for example
`the-max-mix-2`) and use `ssh admin@the-max-mix-2.local`.

Settings for one Pi only go in `/etc/the-max-mix/kiosk-vars.yml`, which every pull reads. Edits apply at the next
release. To apply them now (the update timer skips a release it already ran):

```sh
sudo kiosk-pull https://github.com/nvorkinn/the-max-mix.git latest /var/lib/the-max-mix/ansible-pull && sudo reboot
```

## Hand it over

Once the first pull has worked, the first-boot script removes `network-config` and `user-data` from the card and turns
cloud-init off (`/etc/cloud/cloud-init.disabled`), so the setup network is never applied again. Your Wi-Fi stays saved on
the Pi, which keeps it working at your place. NetworkManager keeps each network as a netplan file
(`/etc/netplan/90-NM-*.yaml`), which **Forget** deletes. Before it goes:

1. Settings, **Spotify**: remove everyone.
2. Settings, **Wi-Fi**: **Forget** each saved network. The Pi leaves the network it is on.
3. Hold the clock for two seconds for the debug console, then **Register again**: the screen forgets its countdown-server
   device and shows the pairing QR code, for the new owner to add it to their own account. Wait a minute before
   unplugging, so Chromium has saved it.

At its new home the Pi finds no network it knows, and the app's Wi-Fi screen joins theirs.

Give the new owner the [one-page guide](../../docs/friend-guide.md) (print it, or send the link).

## How the kiosk runs

1. The boot is quiet: no logo, cursor or boot messages. The Wi-Fi country (GB), locale (`en_GB.UTF-8`) and time zone
   (`Europe/London`) come from the playbook.
2. `kiosk.service` starts [Cage](https://github.com/cage-kiosk/cage), a single-app Wayland compositor, on tty7 as the
   `kiosk` user. Cage runs `/usr/local/bin/kiosk-session` forever.
3. `kiosk-session` runs Chromium on the app, and starts it again whenever it exits. When the app is served by kiosk-audio
   on this machine, it first waits up to 30 seconds for that service to answer. The app handles having no network
   itself: when the kiosk starts with none, it opens Settings > Wi-Fi, which lists the networks in range and joins one
   through kiosk-audio. Joining restarts nothing; the app sees the new network by itself.
4. `kiosk-pull.timer` runs `kiosk-pull` three minutes after boot and then every six hours (or at once from the app's
   Update now button, which also follows the pull's journal), applying the playbook only when there is a new release whose Release workflow has uploaded its Pi bundle, and its slow part only when the files it installs changed. A failed run only logs
   (`journalctl -u kiosk-pull`). A pull that changed kiosk files makes `kiosk-restart.timer` restart the kiosk at 04:30.
5. The screen sleeps. The app keeps it on while music plays and for the idle minutes chosen in its settings (5 by
   default), by holding a screen wake lock that Chromium passes to Cage. After that, the app shows a black sleep screen
   and lets go. Ten seconds later without a touch (`kiosk_screen_off_after`), `swayidle` runs `kiosk-display off`, which
   turns the output off with `wlr-randr` (on a DSI panel that switches its backlight off too). The next touch turns it on again, and that tap only dismisses the sleep
   screen. Music that starts while the screen sleeps wakes it through the kiosk service (`POST /display/wake`).

The app's Settings > Wi-Fi (with `?kiosk=1`) changes the network through the kiosk service on 127.0.0.1
(pi/kiosk-audio): `GET /wifi/networks`, `GET /wifi/status` and `POST /wifi/connect`.

The playbook also sets, among other things:

- no password for any account (the `kiosk` user is locked and not in `sudo`);
- SSH for the `admin` account only, by key only, with `sudo`, and Tailscale for SSH from anywhere (see "Maintenance
  over SSH");
- `kiosk` manages NetworkManager connections without sudo through `/etc/polkit-1/rules.d/50-kiosk-networkmanager.rules`;
- PipeWire and WirePlumber, and AirPlay speakers through Avahi;
- `unattended-upgrades` for Debian security updates and the Raspberry Pi archive (Chromium, kernel);
- `config.txt` and the kernel command line for the screen, a quiet boot and no cursor. The mode is forced on both HDMI
  ports: the screen's own mode from its EDID (1280x800 on a 10.1-inch screen), or 1024x600 for a screen that sends
  none. Set `kiosk_video_mode` in `/etc/the-max-mix/kiosk-vars.yml` for a screen whose EDID is wrong; a new mode needs a
  reboot. The app fills a bigger screen at its own resolution. A DSI panel, such as the Raspberry Pi Touch Display 2,
  needs no mode: the firmware finds it (`display_auto_detect=1` in `config.txt`, Raspberry Pi OS's default) and Cage
  runs it at its own. Its own mode is portrait, so the kiosk turns it as it starts, and the touches with it
  (`pi/kiosk-audio/screen-setup.ts`); the boot console stays portrait. A screen in that script's `KNOWN_SCREENS` needs
  nothing on the card: the 10.1-inch Touch Display 2 is turned 90 degrees and drawn 1.5 times as big, which gives the
  app the 1280x800 page it is laid out for. For any other, or one mounted the other way up, set `kiosk_screen_rotation`
  (`90` or `270`, degrees clockwise) and `kiosk_screen_scale` in `/etc/the-max-mix/kiosk-vars.yml`; they apply from
  the next kiosk restart. A screen whose own mode has an odd horizontal timing (a 10.1-inch MPI107 does), which the Pi 4 cannot send, gets that mode with even timings when
  the kiosk starts (`screen-mode.ts --correct`); without that it would run at another mode it lists, such as 1920x1080.

## Maintenance over SSH

The `admin` account has no password, so the only way in is SSH with a key: `ssh admin@the-max-mix.local`. Its keys are
the public keys of the GitHub account in `kiosk_admin_github_user` (`https://github.com/nvorkinn.keys`), which a
`kiosk-ssh-keys.timer` fetches again every 6 hours (`kiosk_admin_keys_interval`), whether or not a release came out, so add
or remove a key on GitHub (Settings > SSH and GPG keys) and it reaches the Pi within that time (`journalctl -u kiosk-ssh-keys`).
`admin` uses `sudo` without a password. Password and root logins are off (`/etc/ssh/sshd_config.d/10-kiosk.conf`). Set
`kiosk_ssh_enabled: false` to turn SSH off.

After reflashing a Pi, your computer still remembers the old host key: `ssh-keygen -R the-max-mix.local` (or the Pi's
address) clears it.

### From anywhere, over Tailscale

`the-max-mix.local` only works on the Pi's own network. For SSH once the Pi is at its new home, the playbook installs
[Tailscale](https://tailscale.com) (`kiosk_tailscale_enabled`). Join it to your tailnet once, at home, before it goes:

1. `ssh admin@the-max-mix.local`, then `sudo tailscale up`. It prints a login link; open it on your computer and sign in
   to your Tailscale account.
2. In the [Tailscale admin console](https://login.tailscale.com/admin/machines), open the Pi's menu and choose
   **Disable key expiry**, or it drops off the tailnet after 180 days and needs someone at its home to log it in again.
3. With Tailscale on your computer too: `ssh admin@the-max-mix` (MagicDNS) or `ssh admin@<the Pi's 100.x address>`.

No auth key goes in the repository or on the card. SSH still goes through `sshd` with your GitHub keys; Tailscale only
carries it. To take a Pi off your tailnet: `sudo tailscale logout`, or remove it in the admin console.

### Screenshots and DevTools

From a clone of the repository on your computer, `npm run kiosk-screenshot -- the-max-mix.local` saves what the screen
shows as a PNG (`kiosk-<host>-<time>.png`, or name it as the second argument). It goes over SSH as `admin`, so any host
that `ssh admin@<host>` reaches works, Tailscale names included, and runs `sudo kiosk-screenshot` there, which has `grim`
take the screen from Cage. On the Pi itself, `sudo kiosk-screenshot > screen.png` does the same.

The kiosk's Chromium also listens for DevTools on `127.0.0.1:9222`, on the Pi only. To inspect the page, open a tunnel
with `ssh -N -L 9222:127.0.0.1:9222 admin@the-max-mix.local`, then `chrome://inspect` in Chrome on your computer lists
the kiosk's page under Remote Target (add `localhost:9222` under Configure if it does not).

## Spotify Soloist

Each Pi also runs [Spotify Soloist](https://developer.spotify.com/documentation/soloist), Spotify's headless Spotify
Connect player, under the kiosk's own name, beside the app's own player for now. Its sound follows the speakers picked in
the app, like the app's own player (kiosk-audio routes its `soloist` stream). `kiosk-soloist-update.timer` installs the
latest build to `/usr/local/bin/soloist` five minutes after boot and then weekly, because a build stops working 90 days
after it was built; a new build takes over at the next kiosk start. Spotify does not allow passing the program on, so
every Pi downloads its own and it is never in the release bundle or the flash image.

Every person on the kiosk needs their own API key, made at
[developer.spotify.com/dashboard/soloist](https://developer.spotify.com/dashboard/soloist) with their own Spotify Premium
account, and saved on the countdown-server settings site, which keeps it by their Spotify ID. The Pi installs from a
public release, so no key ever comes with it, and countdown-server hands a key only to kiosk-audio, never to a web page.
The app tells kiosk-audio who is active (`POST /soloist/person`, with the device secret); kiosk-audio fetches that
person's key, holds it in memory only and runs Soloist with it and the person's own data folder,
`~kiosk/.local/state/soloist/people/<Spotify ID>` (`pi/kiosk-audio/soloist.ts`). Switching person restarts it with the
other key and folder. A person without a key gets no Soloist.

Every kiosk on one Spotify account needs a name of its own, because the app finds its Soloist in Spotify's device list
by name. It is `kiosk_name` in `/etc/the-max-mix/kiosk-vars.yml` (such as `kiosk_name: Kitchen`) or, without one, comes
from the host name: `the-max-mix-4` is **The Max Mix 4**, and any other host name goes in brackets, as in
**The Max Mix (kitchen-pi)**. The app shows whatever name Soloist reports.

The first time, the person picks the kiosk's name in the Spotify app on a phone on the same network; it signs in
and keeps that session in their folder. Its WebSocket control API listens on `127.0.0.1:7342` only. Check it with
`sudo journalctl _SYSTEMD_USER_UNIT=kiosk-audio.service | grep Soloist`, `journalctl -u kiosk-soloist-update` and
`sudo -u kiosk env STATE_DIRECTORY=/home/kiosk/.local/state/soloist/people/<Spotify ID> soloist ctl now`.

## Troubleshooting

`sudo kiosk-status` sums it up in one go: the installed version, the last update and the next check, which services run,
Chromium restarts by the watchdog and the app's errors from the last 7 days (`sudo kiosk-status 30` looks further back).

The kiosk logs go to the journal: `journalctl -u kiosk`, `journalctl -u kiosk-pull`, and the first boot's setup in `/var/log/cloud-init-output.log`. The journal is kept
on disk (up to `kiosk_journal_max_use`, 64 MB), so logs from before a reboot are there too: `journalctl --list-boots`,
`journalctl -b -1` for the previous boot, and `journalctl -b -1 | grep -i 'stop job'` for what held a shutdown up.
The `bootfs` partition holds `config.txt` and `cmdline.txt` (remove `quiet` and change `console=tty3` back to
`tty1` to see boot messages).

- **Black screen, no panel or app:** check that `kiosk.service` started on tty7.
- **The screen goes dark while music plays, or never goes dark:** the debug console's Screen row shows whether the app
  holds its wake lock, and `journalctl -u kiosk` shows `wlr-randr` errors from `kiosk-display`. Set
  `kiosk_screen_off_after: 0` to keep the output on for good.
- **The Wi-Fi, update, restart, reboot or speaker buttons do nothing:** the app talks to the kiosk service. Check
  `curl -s http://127.0.0.1:7341/speakers`, `journalctl _SYSTEMD_USER_UNIT=kiosk-audio.service` (as root) and
  `journalctl -b | grep polkit`.

## Still to verify

Checked on the first real Pi, with the setup then in a hand-copied `user-data`: the first boot with `network-config` on
the card, the first pull and reboot, and SSH. Still to check:

1. The ready-made image: Imager offers it from its list, its settings apply (host name, `admin`, Wi-Fi), the first-boot
   script runs once and the Pi reboots when it has finished.
2. After the first pull, the boot partition has no `network-config` or `user-data`, and the Pi still joins your Wi-Fi
   after a reboot.
3. Screen sleep: the Waveshare turns its backlight off when `kiosk-display off` disables the output, Chromium's wake
   lock keeps it on while music plays, and the first touch brings it back at 1024x600.
4. Spotify Soloist: once a person has saved their key, the player starts for them, shows in the Spotify app, signs in when picked,
   plays, and is still paired after a reboot; a new build from `kiosk-soloist-update` takes over at the next kiosk start.
