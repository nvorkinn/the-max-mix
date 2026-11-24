# kiosk-shell

The kiosk's window: a minimal Tauri v2 program that shows the app in one full-screen WebKitGTK view under Cage, in
place of Chromium.

## Contract

- Installs as `/usr/local/bin/kiosk-shell`.
- Takes the app's address as its only argument (`kiosk-shell http://127.0.0.1:7341/...`), opens one full-window view on
  it and exits when the window closes. Exit code 2 means no or a bad address.
- kiosk-session runs it in place of Chromium and writes its pid to `/run/kiosk/app.pid`, which the kiosk-audio
  watchdog reads to stop it when the app stops sending heartbeats.
- Nothing else talks to the shell; the app keeps talking only to kiosk-audio.
- Runtime needs `libwebkit2gtk-4.1-0` (and what it pulls in).

## What it does besides showing the page

- Refuses navigation away from the app's origin, except to Spotify (`*.spotify.com`) and countdown-server
  (`*.countdown.run`, `*.countdown.build`) over https.
- One finger at a time: WebKitGTK zooms the page on a two-finger pinch whatever the page does with the touches, and
  leaves it zoomed, so the shell drops every finger after the first. The app has no two-finger gestures.
- No context menu, no back/forward swipe; media plays without a tap first; permission requests (location,
  notifications, the wake lock) are granted, since only those sites load.
- Keeps the screen on while the app holds a wake lock. WebKitGTK sends the wake lock to the session bus's
  `org.freedesktop.ScreenSaver`, which nothing provides under Cage, so the shell owns that name and holds a Wayland idle
  inhibitor on its window while any inhibit is held (`src/awake.rs`). swayidle in kiosk-session then leaves the screen
  on, as it did for Chromium. The kiosk user's session bus must be running (it is, with `PAMName=login`).
- WebKit keeps the app's storage under `~/.local/share/org.vorkinn.the-max-mix.kiosk/`.

## Building

On a Pi (or a Debian arm64 container) with `build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev
libsoup-3.0-dev libssl-dev` and a Rust toolchain:

```bash
cargo build --release
cargo test
```
