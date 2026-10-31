# Setting up a kiosk

A kiosk is stock Raspberry Pi OS Lite plus this repository's Ansible playbook. You flash the OS, cloud-init and the
playbook build the kiosk on your own Wi-Fi, and `kiosk-handover` scrubs your Wi-Fi before the Pi goes to its new home.
There, it shows the Wi-Fi panel so its owner can pick their own network.

Tested on a Raspberry Pi 4 Model B with a Waveshare 7-inch 1024x600 HDMI and USB touch screen. A Pi 5 should work the
same; the playbook boots it with the 4 KB-page kernel (`kernel=kernel8.img`) for Widevine.

## What you need

- Raspberry Pi OS Lite (64-bit, trixie) and a recent [Raspberry Pi Imager](https://www.raspberrypi.com/software/).
- A Wi-Fi network you control, or Ethernet, for the first boot.
- An SSH key on the GitHub account in `kiosk_admin_github_user` (see "Maintenance over SSH"), for `kiosk-handover`.

## Set up

1. Flash Raspberry Pi OS Lite with Imager. Skip its customisation (OS settings), or set only the Wi-Fi.
2. Take the card out and put it back in, then open its boot partition (`bootfs`) on your computer:
   - copy [`user-data`](user-data) over the `user-data` there (Imager's would create a different user). Keep the name
     exactly `user-data`, with no extension, as plain text;
   - unless Imager already wrote your Wi-Fi, copy [`network-config.example`](network-config.example) to `network-config`
     and fill in your network name and password. With Ethernet, leave it out;
   - or, to keep your Wi-Fi off the card, put `network-config` on a USB stick formatted as FAT with the label `CIDATA`,
     next to a copy of `user-data` and a `meta-data` file holding one line, `instance-id: the-max-mix-1`. cloud-init's
     NoCloud source reads a drive with that label at boot. Unplug it after the first boot.
3. Put the card in the Pi, connect the screen and power it on. cloud-init names the Pi `the-max-mix`, creates the
   locked `kiosk` user and starts `kiosk-first-pull.service`. That installs Ansible and runs the playbook from the latest
   GitHub release, the same run the Pi's update timer repeats later, then reboots. Expect 15 to 30 minutes. It tries again every minute
   until it has worked (`journalctl -u kiosk-first-pull`).
4. After the reboot the kiosk starts. On its first run Chromium downloads Widevine, the module Spotify needs, and the
   kiosk restarts by itself once that is done (`kiosk-widevine.path`), a minute or two later. Test it: sign in to
   Spotify, play something, try the speakers.

## Hand it over

Over SSH (`ssh admin@the-max-mix.local`), run:

```sh
sudo kiosk-handover
```

It asks for `yes`, then:

- forgets every Wi-Fi network and removes cloud-init's copies of yours: `network-config` and `user-data` on the boot
  partition, the netplan file made from them, and cloud-init's cache;
- turns cloud-init off (`/etc/cloud/cloud-init.disabled`), so it never applies the setup network again;
- clears the kiosk's Chromium profile (your Spotify login; the downloaded Widevine stays), the chosen speakers and the
  logs;
- powers off. The admin SSH keys and the paired Bluetooth keyboard and mouse stay.

Your SSH session drops when the Wi-Fi goes; the rest still runs. At its new home the Pi finds no network and shows the
Wi-Fi panel. `--no-poweroff` starts the kiosk again instead, for trying it out.

## How the kiosk runs

1. A black Plymouth splash covers the boot. The Wi-Fi country (GB), locale (`en_GB.UTF-8`) and time zone
   (`Europe/London`) come from the playbook.
2. `kiosk.service` starts [Cage](https://github.com/cage-kiosk/cage), a single-app Wayland compositor, on tty7 as the
   `kiosk` user. Cage runs `/usr/local/bin/kiosk-session` forever.
3. `kiosk-session` waits up to 30 seconds for NetworkManager to report full connectivity (a check against
   `network-test.debian.org`, set in `/etc/NetworkManager/conf.d/20-connectivity.conf`). If it does, it runs Chromium; if
   not, it runs `/usr/local/bin/wifi-panel` until it connects. The panel offers Cancel only when a connection already
   works.
4. `kiosk-pull.timer` runs `ansible-pull` three minutes after boot and then every six hours (or at once from the app's
   Update now button), applying the playbook only when there is a new release. A failed run only logs
   (`journalctl -u kiosk-pull`). A pull that changed kiosk files makes `kiosk-restart.timer` restart the kiosk at 04:30.
5. The screen sleeps. The app keeps it on while music plays and for the idle minutes chosen in its settings (5 by
   default), by holding a screen wake lock that Chromium passes to Cage. After that, the app shows a black sleep screen
   and lets go. A minute later without a touch (`kiosk_screen_off_after`), `swayidle` runs `kiosk-display off`, which
   turns the HDMI output off with `wlr-randr`. The next touch turns it on again, and that tap only dismisses the sleep
   screen. Music that starts while the screen sleeps wakes it through the kiosk service (`POST /display/wake`). The Wi-Fi panel holds no
   wake lock, so it goes dark after a minute without a touch.

The app's Wi-Fi button (shown with `?kiosk=1`) sends `POST /wifi` to the kiosk service on 127.0.0.1 (pi/kiosk-audio), which
creates `/run/kiosk/show-wifi` and stops Chromium. The session loop then runs
the panel and starts Chromium again afterwards. Nothing watches the network while Chromium runs.

The playbook also sets, among other things:

- no password for any account (the `kiosk` user is locked and not in `sudo`);
- SSH for the `admin` account only, by key only, with `sudo` (see "Maintenance over SSH");
- `kiosk` manages NetworkManager connections without sudo through `/etc/polkit-1/rules.d/50-kiosk-networkmanager.rules`;
- PipeWire, `pipewire-pulse` and WirePlumber, and AirPlay speakers through Avahi;
- `unattended-upgrades` for Debian security updates and the Raspberry Pi archive (Chromium, kernel);
- `config.txt` and the kernel command line for the 1024x600 screen, a quiet boot and no cursor. The mode is forced to
  1024x600 on both HDMI ports; change `video=` in `cmdline.txt` for another screen. The screen is not rotated.

## Maintenance over SSH

The `admin` account has no password, so the only way in is SSH with a key: `ssh admin@the-max-mix.local`. Its keys are
the public keys of the GitHub account in `kiosk_admin_github_user` (`https://github.com/nvorkinn.keys`), which every
pull fetches again, so add your key on GitHub (Settings > SSH and GPG keys) and it reaches the Pi at its next pull.
`admin` uses `sudo` without a password. Password and root logins are off (`/etc/ssh/sshd_config.d/10-kiosk.conf`). Set
`kiosk_ssh_enabled: false` to turn SSH off.

After reflashing a Pi, your computer still remembers the old host key: `ssh-keygen -R the-max-mix.local` (or the Pi's
address) clears it.

## Troubleshooting

The kiosk logs go to the journal: `journalctl -u kiosk`, `journalctl -u kiosk-pull`, `journalctl -u kiosk-first-pull`.
The `bootfs` partition holds `config.txt` and `cmdline.txt` (remove `quiet splash` and change `console=tty3` back to
`tty1` to see boot messages).

- **The player says "Failed to initialize player":** Widevine is missing or not loaded yet. Check that
  `/home/kiosk/.config/chromium/WidevineCdm/` has a version folder, then `sudo systemctl restart kiosk`.
- **Black screen, no panel or app:** check that `kiosk.service` started on tty7.
- **Panel never offers Cancel / always appears:** the connectivity check failed. `network-test.debian.org` must be reachable
  over plain HTTP; a captive portal that needs a browser login is not supported.
- **The screen goes dark while music plays, or never goes dark:** the debug console's Screen row shows whether the app
  holds its wake lock, and `journalctl -u kiosk` shows `wlr-randr` errors from `kiosk-display`. Set
  `kiosk_screen_off_after: 0` to keep the output on for good.
- **The Wi-Fi, update, restart, reboot or speaker buttons do nothing:** the app talks to the kiosk service. Check
  `curl -s http://127.0.0.1:7341/speakers`, `journalctl _SYSTEMD_USER_UNIT=kiosk-audio.service` (as root) and
  `journalctl -b | grep polkit`. Chromium 156 may also need its `LocalNetworkAccessAllowedForUrls` policy (`chrome://policy`).

## Still to verify

Checked on the first real Pi: the first boot from this `user-data` with `network-config` on the card, the first pull
and reboot, SSH, and Widevine after a restart. Still to check:

1. A `CIDATA` USB stick is read. Pi OS also points cloud-init at the boot partition.
2. `kiosk-widevine.path` restarts the kiosk by itself after the first Widevine download.
3. After `kiosk-handover`, `nmcli connection show` lists no Wi-Fi, `/etc/netplan/` has no Wi-Fi file, and the next boot
   shows the Wi-Fi panel.
4. On a Pi 5, Widevine plays with the 4 KB-page kernel (`getconf PAGESIZE` prints 4096).
5. Screen sleep: the Waveshare turns its backlight off when `kiosk-display off` disables the output, Chromium's wake
   lock keeps it on while music plays, and the first touch brings it back at 1024x600.
