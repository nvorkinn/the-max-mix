# THE MAX MIX update status

Shows the Pi's updates in the app's settings, so that **Update now** says what it is doing: checking GitHub, downloading
a release, installing it (step by step), already up to date, installed and waiting for a restart, or failed and why.

1. `/usr/local/sbin/kiosk-pull` (run by `kiosk-pull.service`, by the **Update now** button through
   `kiosk-update-now.service`, and on the first boot) writes its progress to `/run/kiosk-update/status`, one `key=value`
   per line. It follows the output of `ansible-pull`: each `TASK [...]` line is an install step, and the number of steps
   of the last complete run (in `/var/lib/the-max-mix/update-steps`) is the total, so the app can show a progress bar.
2. `kiosk-update-status.service` runs `node kiosk-update-status.ts`, which answers `GET http://127.0.0.1:7457/status`
   (`kiosk_update_status_port`) with that file as JSON. It only answers requests addressed to `127.0.0.1` and lets only
   the app's origin (`kiosk_app_origin`) read the answer. It runs as a throwaway user, can only read, and may only talk
   to the loopback address.
3. The app asks it every second while its settings are open and an update runs, and every few seconds otherwise.
   Chromium lets the public app reach the loopback address because the Chromium policy allows the app's origin
   (`LocalNetworkAccessAllowedForUrls`), so no permission prompt appears on the kiosk.

A Pi without this service (an image older than the release that added it) shows the old message after **Update now**.

To see the status on the Pi: `curl -H 'Host: 127.0.0.1:7457' http://127.0.0.1:7457/status` or
`cat /run/kiosk-update/status`, and `journalctl -u kiosk-pull` for the whole output.
