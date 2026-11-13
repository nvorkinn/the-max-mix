# THE MAX MIX sign-in keyboard

A small Chromium extension that shows an on-screen keyboard on Spotify's sign-in pages, so the kiosk can sign in to
Spotify with the touch screen alone, without a Bluetooth keyboard. It also draws a button back to the app on every page
outside the app, so no page is a dead end.

## Why an extension

Signing in leaves the app: Chromium goes to `accounts.spotify.com`, and the email and password are typed on Spotify's
own page. The app cannot draw a keyboard there. A system keyboard cannot help either, because Cage (the compositor) has
none of the Wayland protocols an on-screen keyboard needs. So the extension draws its own keyboard on the page.

## The way back

The kiosk has no address bar and no back button. Sign-in leaves the app, and so does anything that goes wrong there (a
redirect address Spotify does not know shows only an error on a white page) and any link on those pages. `back.ts` runs
on every `http` and `https` page except the app and the kiosk's own pages on `127.0.0.1` (the Wi-Fi setup), and draws a
**Back to THE MAX MIX** button in the top right corner. Chromium starts on the app, so the button goes to the first
entry of the history, which is the app at the address the kiosk gave it.

Chromium's own error pages (no connection, for example) run no extension scripts, so they get no button: there the
kiosk-audio watchdog brings the app back, after 3 minutes without a heartbeat.

## What it does

- The keyboard runs only on `https://accounts.spotify.com/*`, `https://challenge.spotify.com/*` (the manifest's
  `matches`).
  "Continue with Google", Apple or Facebook leave those hosts, so those pages get no keyboard (only the button back).
- When a text field gets focus, the keyboard appears at the bottom of the screen (262 pixels high), the page gets the
  same room at the bottom, and the field scrolls into view. It hides when no field has focus, or on **Done**.
- Three layouts: letters (with a one-shot Shift, `@` and `.`), digits and symbols, and more symbols.
- The Wi-Fi setup page asks for a row of digits that stays at the top (`hasNumberRow`), for passwords: five rows, 290
  pixels high, with the letters and one page holding every other ASCII symbol.
- Keys type with the browser's own editing command (`insertText`), which fires the same trusted input events as a key
  press, so Spotify's form sees the text. Each key acts on touch and keeps the focus in the field.
- It has no permissions, stores nothing and sends nothing. It runs in the extension's isolated world, inside a shadow
  root, so the page's styles do not reach it.

## In the app

The app's music picker (Choose music, Search tab) bundles `keyboard.ts` itself on the kiosk and starts it inside its
dialog, since a modal dialog makes the rest of the page untouchable. While the keyboard shows it sets
`--keyboard-height` on the page, and the app's dialogs move up above it. The extension is not involved there.

## Files

| File            | Role                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `manifest.json` | Manifest V3: the content scripts and the pages they run on.                                       |
| `back.ts`       | The content script for every page outside the app: the button back to the app.                    |
| `loader.ts`     | The content script. Content scripts cannot be modules, so it imports `keyboard.js` by its URL.    |
| `keyboard.ts`   | The keyboard: layouts, typing, showing and hiding.                                                |
| `build.ts`      | Strips the types with Node's own `stripTypeScriptTypes` and writes the manifest. No npm packages. |

## Install

The Ansible role in [`ansible/roles/kiosk`](../../ansible/roles/kiosk) copies these files to
`/opt/the-max-mix/kiosk-keyboard/src` and runs `node build.ts` with the app's origin (`kiosk_app_origin`, which
the build leaves out of the pages that get the button), which writes the extension to
`/opt/the-max-mix/kiosk-keyboard/extension`. `kiosk-session` starts Chromium with `--load-extension` pointing there.
Chrome turned that switch off by default in 2025, so `kiosk-session` also passes
`--disable-features=DisableLoadExtensionCommandLineSwitch`.

To try it on a computer:
`node pi/kiosk-keyboard/build.ts pi/kiosk-keyboard /tmp/kiosk-keyboard https://the-max-mix.vorkinn.org`, then load
`/tmp/kiosk-keyboard` as an unpacked extension in Chromium and open the Spotify sign-in page.

## Tests

`npm test` runs `keyboard.test.ts` (in jsdom, which has no editing commands, so the fallback that sets the value is
what types there), `back.test.ts` and `build.test.ts`.
