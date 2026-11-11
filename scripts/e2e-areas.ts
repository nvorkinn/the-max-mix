// Which part of the app a source file belongs to, and so which browser tests (e2e/*.spec.ts, tagged with the same
// `@name`) are about a change to it. The pull request comment (screenshot-comment.ts) uses this to list "Tests for this
// change"; add an area here when the app gets a feature, and tag its tests with the same tag.
//
// An area with no tests is deliberate: it is how the comment says "nothing in a browser covers this yet".

export interface Area {
  /** The Playwright tag, without the @. */
  tag: string;
  title: string;
  /** Source files (paths from the repository root) that belong to it. */
  sources: RegExp[];
  /** Other areas a change to these files can also affect. */
  alsoAffects?: string[];
}

export const AREAS: Area[] = [
  {
    tag: 'player',
    title: 'Player',
    sources: [/^src\/components\/AlbumArtPlayer/, /^src\/hooks\/use(Spotify|Sonos)Player/, /^src\/spotify\/api\.ts$/]
  },
  {
    tag: 'music',
    title: 'Choose music',
    sources: [/^src\/components\/MusicPicker/]
  },
  {
    tag: 'queue',
    title: 'Queue',
    sources: [/^src\/components\/TrackQueue/, /^src\/hooks\/useDragToReorder/, /^src\/components\/TrackImages/]
  },
  {
    tag: 'lyrics',
    title: 'Lyrics',
    sources: [/^src\/components\/LyricsPanel/, /^src\/hooks\/useLyrics/, /^src\/lyrics\//]
  },
  {
    tag: 'settings',
    title: 'Settings',
    sources: [
      /^src\/components\/SettingsModal/,
      /^src\/components\/KioskSystem/,
      /^src\/utils\/themeColour/,
      /^src\/sonos\//
    ]
  },
  {
    tag: 'speakers',
    title: 'Speakers',
    sources: [
      /^src\/components\/SpeakerDrawer/,
      /^src\/components\/AirPlaySpeakerList/,
      /^src\/components\/BluetoothSpeakers/,
      /^src\/components\/SonosKioskList/,
      /^src\/spotify\/knownDevices/,
      /^src\/audio\//
    ]
  },
  {
    tag: 'update',
    title: 'Software update',
    sources: [
      /^src\/components\/Update(Prompt|Console)/,
      /^src\/hooks\/useKioskUpdate/,
      /^src\/utils\/kiosk(Service)?\.ts$/,
      /^pi\/kiosk-audio\/update/
    ]
  },
  {
    tag: 'setup',
    title: 'Setup and signing in',
    sources: [/^src\/components\/SpotifySetup/, /^src\/spotify\/(auth|settings)\.ts$/]
  },
  {
    tag: 'status',
    title: 'Playback status and recovery',
    sources: [
      /^src\/components\/(PlaybackNotice|OfflineBanner)/,
      /^src\/hooks\/(useOnlineStatus|useSpotifyCooldown|useSpotifyPolling)/,
      /^src\/spotify\/(http|polling)\.ts$/
    ]
  },
  { tag: 'dialogs', title: 'Dialogs', sources: [/^src\/components\/Modal/] },
  {
    tag: 'debug',
    title: 'Debug console',
    sources: [/^src\/components\/DebugConsole/, /^src\/utils\/(debugLog|httpLog)/]
  },
  // No source file is only about these: the tests are found through the files they change, or through the areas above.
  { tag: 'appearance', title: 'Appearance of dialogs', sources: [] },
  { tag: 'visual', title: 'Screenshots', sources: [] },
  {
    tag: 'sleep',
    title: 'Screen sleep',
    sources: [/^src\/components\/Sleep(Screen|Icon)/, /^src\/hooks\/useScreenSleep/, /^src\/utils\/screenSleep/]
  },
  {
    tag: 'layout',
    title: 'Layout',
    sources: [/^src\/.*\.css$/, /^index\.html$/],
    alsoAffects: ['visual', 'appearance']
  },
  // The page that holds everything above: a change to it can change any of them.
  {
    tag: 'app',
    title: 'The app as a whole',
    sources: [/^src\/components\/TabletView\.tsx$/, /^src\/(main|App)\.tsx$/, /^vite\.config\.ts$/],
    alsoAffects: ['player', 'queue', 'settings', 'update', 'status', 'dialogs', 'visual']
  }
];

/** The areas a change to `files` is about. */
export function areasFor(files: readonly string[]): Area[] {
  const direct = AREAS.filter(area => files.some(file => area.sources.some(source => source.test(file))));
  const tags = new Set(direct.flatMap(area => [area.tag, ...(area.alsoAffects ?? [])]));
  return AREAS.filter(area => tags.has(area.tag));
}

const isTestFile = (file: string) => /\.test\.(ts|tsx)$/.test(file) || file.startsWith('src/test/');
const isMapped = (file: string) => AREAS.some(area => area.sources.some(source => source.test(file)));

/** Changed files under src/ that belong to no area, so no browser test is known to be about them. */
export function unmappedSources(files: readonly string[]): string[] {
  return files.filter(file => file.startsWith('src/') && !isTestFile(file) && !isMapped(file));
}
