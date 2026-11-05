# Browser tests

[Playwright](https://playwright.dev) tests of the built app, with Spotify (and, for the kiosk, the Pi's local service and
GitHub) faked. They check what the unit tests cannot: layout, focus, stacking of dialogs and whole journeys in a real
browser. Run them with `npm run build && npm run test:e2e`.

## One file for each feature

| File                 | Feature (tag)                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `app.spec.ts`        | The app as a whole (`@app`): loads without errors, zoom                                                       |
| `player.spec.ts`     | Player controls (`@player`): play/pause, seek, next/previous, shuffle, repeat, like, volume                   |
| `queue.spec.ts`      | The queue (`@queue`)                                                                                          |
| `lyrics.spec.ts`     | Lyrics (`@lyrics`)                                                                                            |
| `speakers.spec.ts`   | Speakers (`@speakers`): the drawer and AirPlay on the kiosk                                                   |
| `settings.spec.ts`   | Settings (`@settings`): colour, polling, screen sleep, kiosk-only buttons                                     |
| `sleep.spec.ts`      | Screen sleep (`@sleep`): sleep button, idle sleep, polling while asleep                                       |
| `dialogs.spec.ts`    | Focus and dismissal of the dialogs: Settings, Speakers, debug (`@dialogs`)                                    |
| `update.spec.ts`     | Software update (`@update`): popup, streamed console, restart, failure                                        |
| `setup.spec.ts`      | Setup and signing in (`@setup`)                                                                               |
| `status.spec.ts`     | Playback status (`@status`): errors, offline, rate limits and the quota, trouble with the tablet's own player |
| `appearance.spec.ts` | Colours and contrast of dialogs (`@appearance`)                                                               |
| `layout.spec.ts`     | What fits the 1024x600 screen: touch targets, long names, fonts (`@layout`)                                   |
| `visual.spec.ts`     | Screenshots compared with `screenshots/` (`@visual`, CI only)                                                 |

Each file is one `test.describe('<Feature>', { tag: '@feature' }, …)`, so the report reads _Feature › what it checks_,
and a test can carry further tags (`test('…', { tag: '@queue' }, …)`). `fake-spotify.ts` is the shared fake account (and counts its playback reads); `fake-spotify-sdk.ts` fakes the Web Playback SDK (this tablet's own player, which tests make drop or block
autoplay); `clock.ts` moves a faked clock for the tests
that count polling or wait out an idle timer.

## Finding the tests for a pull request

The pull request comment (made by `scripts/screenshot-comment.ts`) has a **Tests for this change** section: it maps the
files the PR changes to features with `scripts/e2e-areas.ts`, and lists those features' tests with their result and a
link to each in the Playwright report. In the report itself, type a tag such as `@update` in the search box to see one
feature's tests.

When you add a feature:

1. Add an area for it to `scripts/e2e-areas.ts` (its source files and a tag), so changes to it find its tests.
2. Tag its tests with the same tag. A feature with an area but no tests shows up in the comment as _no browser test
   covers it yet_: that is on purpose, and the unit tests in `scripts/e2e-areas.test.ts` keep the tags and areas in step.
