# Setting up a kiosk with cloud-init

Another way to set up a kiosk: flash stock Raspberry Pi OS Lite, let cloud-init and the playbook build the kiosk on
your own Wi-Fi, then scrub your Wi-Fi before the Pi goes to its new home. There is no image to build. The
[pi-gen image](../image/README.md) stays until this has worked on a real Pi.

> Nobody has run this on a real Pi yet. See "Still to verify" below.

## What you need

- Raspberry Pi OS Lite (64-bit, trixie) and a recent [Raspberry Pi Imager](https://www.raspberrypi.com/software/).
- A Wi-Fi network you control, or Ethernet, for the first boot.
- An SSH key on the GitHub account in `kiosk_admin_github_user` (see
  [Maintenance over SSH](../image/README.md#maintenance-over-ssh)), for `kiosk-handover`.

## Set up

1. Flash Raspberry Pi OS Lite with Imager. Skip its customisation (OS settings), or set only the Wi-Fi.
2. Open the SD card's boot partition on your computer and:
   - copy [`user-data`](user-data) over the `user-data` there (Imager's would create a different user);
   - unless Imager already wrote your Wi-Fi, copy [`network-config.example`](network-config.example) to `network-config`
     and fill in your network name and password. With Ethernet, leave it out.
   - or, to keep your Wi-Fi off the card, put `network-config` on a USB stick formatted as FAT with the label `CIDATA`,
     next to a copy of `user-data` and a `meta-data` file holding one line, `instance-id: the-max-mix-1`. cloud-init's
     NoCloud source reads a drive with that label at boot. Unplug it after the first boot. Pi OS also points cloud-init
     at the boot partition, so check on the first run that the stick is read.
3. Put the card in the Pi, connect the screen and power it on. cloud-init names the Pi `the-max-mix`, creates the
   locked `kiosk` user and starts `kiosk-first-pull.service`. That installs Ansible and runs the playbook from `stable`,
   the same run the Pi's update timer repeats later, then reboots. Expect 15 to 30 minutes. It tries again every minute
   until it has worked (`journalctl -u kiosk-first-pull`, once you can log in).
4. After the reboot the kiosk starts. On its first run Chromium downloads Widevine, the module Spotify needs, and the
   kiosk restarts by itself once that is done (kiosk-widevine.path), a minute or two later. Test it: sign in to Spotify, play something, try the speakers.

## Hand it over

Over SSH (`ssh admin@the-max-mix.local`), run:

```sh
sudo kiosk-handover
```

It asks for `yes`, then:

- forgets every Wi-Fi network and removes cloud-init's copies of yours: `network-config` and `user-data` on the boot
  partition, the netplan file made from them, and cloud-init's cache;
- turns cloud-init off (`/etc/cloud/cloud-init.disabled`), so it never applies the setup network again;
- clears the kiosk's Chromium profile (your Spotify login), the chosen speakers and the logs;
- powers off. The admin SSH keys and the paired Bluetooth keyboard and mouse stay.

Your SSH session drops when the Wi-Fi goes; the rest still runs. At its new home the Pi finds no network and shows the
Wi-Fi panel, as a fresh image does. `--no-poweroff` starts the kiosk again instead, for trying it out.

## Still to verify

On the first real run, check:

1. That Pi OS's first boot accepts this `user-data` without asking for a user on the screen, reads a `CIDATA` stick if you use one, and brings Wi-Fi up from
   `network-config`, with the country set by `regulatory-domain`.
2. That `kiosk-first-pull` finishes and the kiosk starts after its reboot, with Widevine working (Chromium, kernel and
   Widevine come from the Raspberry Pi archive, as in the image).
3. That after `kiosk-handover`, `nmcli connection show` lists no Wi-Fi, `/etc/netplan/` has no Wi-Fi file, and the next
   boot shows the Wi-Fi panel.
