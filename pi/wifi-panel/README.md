# THE MAX MIX Wi-Fi setup panel

A small native Qt app for the kiosk. Cage shows it when the Pi is offline, or when the user taps the app's Wi-Fi
button. It lists the visible networks (name, signal, lock), asks for the password on the Qt Virtual Keyboard and joins
the network with `nmcli`. It is PySide6 and QML only: no network access at runtime, no pip.

It does not replace `pi/wifi/` (the older Python hotspot portal).

## What it does

- Scans with `nmcli -t -f SSID,SIGNAL,SECURITY device wifi list --rescan yes` and parses the escaped terse output
  (`\:` and `\\` inside names). Hidden (empty) names are skipped, duplicates collapse to the strongest signal.
- WPA/WPA2/WPA3 Personal and open networks can be joined. Enterprise (802.1X) and WEP networks are listed dimmed as
  "Not supported" and cannot be tapped.
- Tapping an open network connects at once; a secured one opens the password form. **Other…** joins a hidden network by
  name (an empty password means an open network).
- Connecting shows a spinner (nmcli waits at most 45 seconds). A failure (wrong password, network not found, timeout)
  shows a message and stays on screen. A failed attempt deletes the profile it created and reactivates the Wi-Fi
  connection that was active before.
- Success exits with code 0.

The password reaches nmcli on stdin (`nmcli --ask device wifi connect <ssid>`), never in argv, so `ps` does not show it.
It is not logged. Every nmcli call is an argument list; no shell is involved.

## Flags and exit codes

| Flag           | Effect                                                               |
| -------------- | -------------------------------------------------------------------- |
| `--can-cancel` | Shows a Cancel button. Cancel exits with code 2 and changes nothing. |
| `--windowed`   | A 1024x600 window instead of full screen (development).              |

| Exit code | Meaning                              |
| --------- | ------------------------------------ |
| 0         | Connected                            |
| 1         | The interface could not be started   |
| 2         | Cancelled (only with `--can-cancel`) |

Without `--can-cancel` there is no way to leave except connecting.

## Install

The Ansible role in [`ansible/roles/kiosk`](../../ansible/roles/kiosk) installs it: the apt packages in
[`packages.txt`](packages.txt) (Raspberry Pi OS trixie, arm64; PySide6 6.8 is in the Debian archive), the files in this
directory into `/opt/the-max-mix/wifi-panel`, and the launcher `/usr/local/bin/wifi-panel`. A change here reaches a deployed
Pi through its `ansible-pull` timer.

## Running

On the kiosk (Cage, as the `kiosk` user, which manages NetworkManager through a polkit rule):

```bash
QT_QPA_PLATFORM=wayland QT_IM_MODULE=qtvirtualkeyboard wifi-panel --can-cancel
```

The app sets `QT_IM_MODULE=qtvirtualkeyboard` itself when it is unset. On a dev machine with the Debian/Ubuntu packages
(or `pip install PySide6`) and NetworkManager:

```bash
QT_QPA_PLATFORM=xcb python3 pi/wifi-panel/wifi_panel.py --windowed --can-cancel
```

`QT_QPA_PLATFORM=offscreen` runs without a display, but nothing can be seen or tapped.

## Virtual keyboard under Wayland

The keyboard is the `InputPanel` item drawn inside the app's own window, so it needs no Wayland input-method protocol
from Cage. Only the `qtvirtualkeyboard` platform input context plugin (`qt6-virtualkeyboard-plugin`) has to load, which
`QT_IM_MODULE=qtvirtualkeyboard` asks for. The card sits in the part of the screen above the keyboard, so the password
field stays visible. This has not been tried in a Cage session yet.

## Tests

`npm run test:wifi-panel` runs the unittest suite in `tests/`. `nmcli.py` has no Qt dependency and the tests stub the
command runner: scan parsing, signal and security mapping, error mapping and the connect flow (password on stdin,
clean-up and restore after a failure). The QML interface is not tested automatically.
