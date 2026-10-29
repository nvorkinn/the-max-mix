# THE MAX MIX Wi-Fi setup portal

A small service for the Raspberry Pi kiosk. On first boot the Pi has no internet, so it cannot run `ansible-pull`; this
portal lets the owner enter Wi-Fi credentials from the Pi's touchscreen or from a phone, and later switch networks from
the kiosk. It runs fully offline (Python 3 standard library, `nmcli` and NetworkManager's dnsmasq only; no Node, no
downloads at runtime), so it can be baked into an OS image before any network exists.

## Install

As root, on a live Pi or inside an image-build chroot (idempotent):

```bash
sudo pi/wifi/install.sh
```

It copies the Python files to `/opt/the-max-mix/wifi`, installs the captive DNS rule
`/etc/NetworkManager/dnsmasq-shared.d/the-max-mix-captive.conf`, installs and enables `the-max-mix-wifi.service`, and
(on a running systemd) restarts it. It installs `dnsmasq-base` with apt if the `dnsmasq` binary is missing (NetworkManager's
hotspot needs it; the full `dnsmasq` service would clash with it and must not be installed). Only a copy of the files is
needed, not the repository.

Wi-Fi must be usable: set the Wi-Fi country in the image (`raspi-config nonint do_wifi_country GB`, or Raspberry Pi Imager),
or the radio stays blocked and NetworkManager cannot start the hotspot.

## Modes

The portal always listens on `http://127.0.0.1:8088/`, for the kiosk's own Chromium.

1. **Boot:** for up to 30 seconds it waits for NetworkManager to report real internet (`nmcli networking connectivity check`;
   if NetworkManager cannot say, an HTTPS request to the kiosk address decides). Ethernet counts.
2. **Setup mode** (no internet after 30 seconds, or the network is lost for more than 2 minutes later): it scans for
   networks, then starts a WPA2 hotspot named `THE-MAX-MIX-SETUP` with a random 8-character password, new every time. The
   page at `http://127.0.0.1:8088/` shows the name, the password and a `WIFI:` QR code. The portal also listens on the
   hotspot gateway `10.42.0.1` port 80, where every DNS name resolves (the dnsmasq rule) and the usual captive-portal
   probe URLs (`/generate_204`, `/hotspot-detect.html`, `/connecttest.txt` and others) redirect to the page, so a phone
   that joins the hotspot offers to "sign in".
3. **Connect:** the form takes a network (pick one from the list or type a name, including hidden networks), a password
   (empty for open networks) and a Connect button. The portal tears the hotspot down, connects with a 45-second limit
   and checks for real internet. On failure it deletes the profile that attempt created (the credentials are not kept)
   and reopens the hotspot with a new password. On success the connection stays in NetworkManager as a system connection
   with autoconnect, the page says **Connected** with a link back to THE MAX MIX, setup mode ends, and
   `systemctl start --no-block the-max-mix-bootstrap.service` runs if that unit exists.
4. **Manage mode** (internet works): `http://127.0.0.1:8088/` shows the current network, the scan list and the same form
   to switch. If the new network fails, the new profile is deleted and the previous connection is brought back up.
   **Forget this network** deletes the current Wi-Fi profile; with no other connection, setup mode opens.

The link target comes from `KIOSK_URL` in `/etc/the-max-mix/bootstrap.env`, else `~/.config/the-max-mix/kiosk.env` of a
desktop user, else `https://the-max-mix.vercel.app/`.

The kiosk's Settings page links to `http://127.0.0.1:8088/` (a top-level navigation).

### What a phone sees

When Connect is pressed from a phone, the hotspot goes away and the phone loses it, so the phone cannot be told the
result. The page says so; the result shows on the Pi's screen (**Connected**, or the hotspot back with a new password,
which the phone must join again).

If the Pi is in setup mode with a saved Wi-Fi network and nobody has touched the portal for 10 minutes, it closes the
hotspot and tries the saved networks once (a router that booted slower than the Pi). A new hotspot password follows if that
fails.

## Touchscreen text entry

The page carries its own on-screen keyboard (letters, shift, digits and symbols, backspace, space, hide), shown on the
loopback page only when a text field is focused. It needs nothing from the operating system, so it works in kiosk
Chromium without extra packages. Raspberry Pi OS also ships `squeekboard` for labwc, but whether Chromium in kiosk mode
raises it depends on the Chromium build (`--enable-wayland-ime`) and has not been verified here, so it is neither
installed nor enabled; the page keyboard sets `inputmode="none"` on its fields to avoid two keyboards at once. A physical
keyboard works as well, and the phone and QR path needs no keyboard on the Pi at all.

## Limits

- Scanning while the hotspot is up is unreliable on the Pi's Wi-Fi chip. The list is taken just before the hotspot
  starts and **Search again** tries a fresh scan, falling back to the earlier list. Type the name if a network is missing.
- Only WPA/WPA2/WPA3 personal and open networks, no 802.1X (enterprise) and no captive-portal sign-in pages on the
  upstream network (such a network reports "portal" and is treated as not online).
- The password reaches `nmcli` as an argument, so it is visible in the process list of the Pi for the seconds that call
  runs. The Pi has no other users; the hotspot password and QR code are the only secrets the page shows.
- The captive DNS rule applies to every NetworkManager "shared" connection on the machine; the kiosk uses none other.

## Security

Run by systemd as root with hardening (`NoNewPrivileges`, a tight capability set, `ProtectSystem=strict`, `PrivateTmp`,
`ProtectHome=read-only` and more; see `the-max-mix-wifi.service`).

- Loopback listener on `127.0.0.1:8088`; the hotspot listener binds only the gateway address, only in setup mode.
- The `Host` header must be `127.0.0.1:8088` or `localhost:8088` (loopback) or the gateway (hotspot); anything else gets
  403, or on the hotspot a redirect to the portal (which is what captive-portal probes look like).
- Every POST needs a matching CSRF cookie (`HttpOnly`, `SameSite=Strict`) and form field, and an `Origin` (or `Referer`)
  naming the same host.
- Input is validated strictly; `nmcli` is only ever called with an argument list, never a shell.
- Connect attempts are limited to 5 a minute and one at a time; request bodies are capped at 4 KiB.
- `X-Frame-Options: DENY`, `Cache-Control: no-store`, a strict Content-Security-Policy with nonces, no external assets.
- Passwords are never logged; logged `nmcli` commands show `***`.

## Troubleshooting

```bash
journalctl -u the-max-mix-wifi -f
systemctl status the-max-mix-wifi
nmcli device wifi list
nmcli connection show
curl -s http://127.0.0.1:8088/healthz
```

- No hotspot: check `nmcli radio wifi`, `rfkill list` and that the Wi-Fi country is set.
- Phone joins but gets no sign-in prompt: open `http://10.42.0.1/` by hand.
- A hardening option breaks something on a device: relax it with `systemctl edit the-max-mix-wifi` rather than editing the unit.
- Delete a stuck profile: `nmcli connection delete id THE-MAX-MIX-SETUP`.

## Tests

The logic (validation, `nmcli` argument lists and output parsing, mode decisions, captive redirects, CSRF, Host and Origin
checks, the controller's flows with `nmcli` stubbed) is covered without a Pi:

```bash
npm run test:wifi
```

### Testing on a real Pi

1. Install, then remove the Ethernet cable and any saved Wi-Fi (`nmcli connection delete id <name>`) and reboot.
2. After about 30 seconds `THE-MAX-MIX-SETUP` appears. `http://127.0.0.1:8088/` on the Pi shows the password and QR code.
3. Join from an iPhone and an Android phone (scan the QR code): the sign-in sheet should open the portal by itself.
4. Connect with a wrong password: the hotspot returns with a new password. Connect with the right one: the Pi shows
   **Connected** and `the-max-mix-bootstrap.service` starts if present.
5. From the page on the Pi, switch to another network, and try a wrong password: the old network must come back.
6. Switch the router off for more than 2 minutes: the hotspot reappears.

## Vendored code

`qrcodegen.py` is Project Nayuki's QR Code generator library 1.8.0 (MIT licence; the notice is at the top of the file),
with only whitespace changes to follow the repository's `.editorconfig`.
