# THE MAX MIX audio routing

Sends the kiosk browser's sound to AirPlay speakers (Sonos and other AirPlay 2 speakers that also accept RAOP) through
PipeWire. It is what the app's **AirPlay** mode under Speakers drives. There is no server: the app finds the speakers
through Chromium, and asks the Pi to route the sound with a `kiosk-audio://` link, the same way `kiosk-wifi://` opens
the Wi-Fi panel.

## The two playback modes

- **Spotify Connect** (the default): Spotify plays on the tablet's Web Playback SDK player, or on any Spotify Connect
  speaker it is moved to under Speakers. Switching to it opens `kiosk-audio://route`, which hands the sound back to the
  Pi's default output.
- **AirPlay**: playback stays on the tablet's own player, and the Pi links Chromium's PipeWire stream to every speaker
  picked in the app, all at once, and off the Pi's own output. Speakers can be added and removed while the music plays.

## How it works

1. **Discovery.** `libpipewire-module-raop-discover` (enabled by `/etc/pipewire/pipewire.conf.d/50-kiosk-raop.conf`)
   finds RAOP speakers through Avahi and makes a PipeWire sink for each, with `raop.latency.ms = 500`
   (`kiosk_raop_latency_ms`) so play, pause and skip reach the speakers quickly. Chromium sees each sink as an audio
   output (through pipewire-pulse), and the app lists them with `navigator.mediaDevices.enumerateDevices()`, updating on
   `devicechange`. Chromium only names outputs for a page with microphone permission, so the Chromium policy grants it
   to the app's origin (`AudioCaptureAllowedUrls`).
2. **Routing.** Picking speakers opens `kiosk-audio://route?speaker=Kitchen&speaker=Lounge` (the names Chromium shows,
   which are the sinks' descriptions). Chromium hands the link to `/usr/local/bin/kiosk-open-audio` (registered by
   `kiosk-audio.desktop` and `/etc/xdg/mimeapps.list`; only the app's origin may open it), which runs
   `node kiosk-audio.ts open <link>`. That saves the choice in `~/.local/state/the-max-mix/speakers.json` and links each
   of Chromium's channels to the same channel of every chosen sink with `pw-link`, before removing its links to other
   sinks, so the music does not drop out. Links to anything that is not a sink (a level meter) are left alone.
3. **Keeping it there.** The `kiosk-audio` user unit (`node kiosk-audio.ts watch`) reads the saved choice every 2
   seconds and routes again when needed, so a stream Chromium opens again, or a speaker that drops off the network and
   comes back, plays in the right place. If none of the chosen speakers is on the network, nothing changes.

The link only goes one way, so the app remembers the chosen speakers itself (`maxmix.airplaySpeakers` in its storage).

| File             | What it is                                                                       |
| ---------------- | -------------------------------------------------------------------------------- |
| `kiosk-audio.ts` | The program: `open <link>` (the link handler) and `watch` (the background unit). |
| `speakers.ts`    | Reading `kiosk-audio://route` links, the saved choice, and routing to it.        |
| `pipewire.ts`    | `pw-dump` parsing, the link plan, and running `pw-link`.                         |

It is TypeScript with Node's standard library only (no npm packages on the Pi): Node runs the `.ts` files directly, so
Ansible copies them as they are and nothing is built. That needs Node 22.18 or later, so the role installs Node
`kiosk_nodejs_major` (24, as in `.nvmrc`) from NodeSource's archive, since Debian trixie has Node 20. Its signing key is
pinned by checksum and unattended upgrades cover it.

## Security

- Nothing listens on the network. Only the app's origin may open `kiosk-audio://` links (the Chromium policy's
  `AutoLaunchProtocolsFromOrigins`).
- The handler accepts only `kiosk-audio://route` with at most 16 speaker names of up to 256 characters, and can only
  link the browser's stream to existing sinks. `pw-dump` and `pw-link` run by absolute path with an argument list; no
  shell is involved.
- Everything runs as the `kiosk` user, next to that user's PipeWire.

## On the device

- `systemctl --user -M kiosk@ status kiosk-audio` and `journalctl _SYSTEMD_USER_UNIT=kiosk-audio.service` (as root).
- `wpctl status` lists the AirPlay sinks; `pw-link -l` shows where Chromium's stream goes.
- As the kiosk user: `kiosk-open-audio 'kiosk-audio://route?speaker=Kitchen'` routes by hand.

## Tests

The Vitest suite (`npm test`) includes `pi/kiosk-audio/*.test.ts`, with `pw-dump` replies stubbed. It is type-checked
and linted with the repository's tooling rules (`tsconfig.node.json`).
