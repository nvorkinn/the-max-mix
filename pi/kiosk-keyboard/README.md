# THE MAX MIX sign-in keyboard

A small Chromium extension that shows an on-screen keyboard on Spotify's sign-in pages, so the kiosk can sign in to
Spotify with the touch screen alone, without a Bluetooth keyboard. It also clears Spotify's own sign-in when the app
signs out (see [Sign-out](#sign-out)).

## Why an extension

Signing in leaves the app: Chromium goes to `accounts.spotify.com`, and the email and password are typed on Spotify's
own page. The app cannot draw a keyboard there. A system keyboard cannot help either, because Cage (the compositor) has
none of the Wayland protocols an on-screen keyboard needs. So the extension draws its own keyboard on the page.

## What it does

- It runs only on `https://accounts.spotify.com/*`, `https://challenge.spotify.com/*` (the manifest's
  `matches`).
  "Continue with Google", Apple or Facebook leave those hosts, so those pages get no keyboard.
- When a text field gets focus, the keyboard appears at the bottom of the screen (262 pixels high), the page gets the
  same room at the bottom, and the field scrolls into view. It hides when no field has focus, or on **Done**.
- Three layouts: letters (with a one-shot Shift, `@` and `.`), digits and symbols, and more symbols.
- Keys type with the browser's own editing command (`insertText`), which fires the same trusted input events as a key
  press, so Spotify's form sees the text. Each key acts on touch and keeps the focus in the field.
- The keyboard stores nothing and sends nothing. It runs in the extension's isolated world, inside a shadow root, so
  the page's styles do not reach it.

## Sign-out

The app's Sign out forgets the app's own Spotify tokens, but Chromium still holds Spotify's sign-in cookies, so the next
"Log in with Spotify" would skip the password and go straight to the approval page as the same person. So on the kiosk
the app posts `{ type: 'maxmix:forget-sign-ins' }` to its window before it reloads. `sign-out.ts`, a content script on
the app's pages only, passes that to `background.ts`, which clears the cookies and storage of every site except the app
(`browsingData`, the extension's one permission): Spotify, and Google, Apple or Facebook when one of them was used to
sign in. It then answers `{ type: 'maxmix:sign-ins-forgotten' }`. The app reloads after the answer, or after 3 seconds
without one. `sudo kiosk-handover` removes the whole Chromium profile, so it needs none of this.

## In the app

The app's music picker (Choose music, Search tab) bundles `keyboard.ts` itself on the kiosk and starts it inside its
dialog, since a modal dialog makes the rest of the page untouchable. While the keyboard shows it sets
`--keyboard-height` on the page, and the app's dialogs move up above it. The extension is not involved there.

## Files

| File            | Role                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `manifest.json` | Manifest V3: the content script and the pages it runs on.                                        |
| `loader.ts`     | The content script. Content scripts cannot be modules, so it imports `keyboard.js` by its URL.   |
| `keyboard.ts`   | The keyboard: layouts, typing, showing and hiding.                                               |
| `sign-out.ts`   | Content script on the app's pages: passes the app's sign-out to `background.ts`.                 |
| `background.ts` | Service worker: clears every other site's cookies and storage on that request.                   |
| `build.ts`      | Strips the types (Node's `stripTypeScriptTypes`), copies the manifest and adds the app's origin. |

## Install

The Ansible role in [`ansible/roles/kiosk`](../../ansible/roles/kiosk) copies these files to
`/opt/the-max-mix/kiosk-keyboard/src` and runs `node build.ts` with the app's origin, which writes the extension to
`/opt/the-max-mix/kiosk-keyboard/extension`. `kiosk-session` starts Chromium with `--load-extension` pointing there.
Chrome turned that switch off by default in 2025, so `kiosk-session` also passes
`--disable-features=DisableLoadExtensionCommandLineSwitch`.

To try it on a computer: `node pi/kiosk-keyboard/build.ts pi/kiosk-keyboard /tmp/kiosk-keyboard`, then load
`/tmp/kiosk-keyboard` as an unpacked extension in Chromium and open the Spotify sign-in page.

## Tests

`npm test` runs `keyboard.test.ts` (in jsdom, which has no editing commands, so the fallback that sets the value is
what types there) and `build.test.ts`.
