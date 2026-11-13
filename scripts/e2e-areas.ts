// Which part of the app a source file belongs to, and so which browser tests (e2e/*.spec.ts, tagged with the same
// `@name`) are about a change to it. The pull request comment (screenshot-comment.ts) uses this to list "Tests for this
// change", and CI traces those tests only (e2e-traced.ts); add an area here when the app gets a feature, and tag its
// tests with the same tag.
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
    sources: [
      /^src\/components\/AlbumArtPlayer/,
      /^src\/components\/Person(Face|Switcher)/,
      /^src\/hooks\/use(Spotify|Sonos)Player/,
      /^src\/spotify\/api\.ts$/,
      /^src\/utils\/colorExtractor\.ts$/
    ]
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
      /^src\/components\/settings\//,
      /^src\/components\/(KioskSystem|ConfirmButton|PhonePicker)/,
      /^src\/hooks\/useSavedPhones/,
      /^src\/utils\/(theme|sun)/,
      /^src\/hooks\/useTheme/,
      /^src\/sonos\//
    ]
  },
  {
    tag: 'speakers',
    title: 'Speakers',
    sources: [/^src\/components\/SpeakersView/, /^src\/speakers\//, /^src\/spotify\/knownDevices/, /^src\/audio\//]
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
    sources: [/^src\/components\/(DebugConsole|BluetoothDebug)/, /^src\/utils\/(debugLog|httpLog|bluetoothMonitor)/]
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
    sources: [/^src\/.*\.css$/, /^index\.html$/, /^src\/components\/PanelNav/, /^src\/hooks\/usePanelView/],
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

const SPEC = /^e2e\/([^/]+\.spec\.ts)$/;

/** The test files (names inside e2e/) among `files`. */
export function changedSpecs(files: readonly string[]): string[] {
  return files.flatMap(file => SPEC.exec(file)?.[1] ?? []);
}

/** Which browser tests CI records a trace of: every one, or those with one of the tags or in one of the test files. */
export interface Traced {
  all: boolean;
  tags: string[];
  specs: string[];
}

// What every test runs through: the fakes and helpers beside the tests, and the Playwright configuration.
const isSharedByAllTests = (file: string) => /^e2e\/[^/]+\.ts$/.test(file) && !SPEC.test(file);

/**
 * The tests to trace for a change to `files`: the ones the pull request comment lists as being about it. Tracing costs
 * about a fifth of the run, and a trace of a passing test that the change does not touch is rarely opened. Every test
 * is traced when the change cannot be placed: an app file no area owns, or something all the tests share.
 */
export function tracedFor(files: readonly string[]): Traced {
  const isUnplaced = unmappedSources(files).length > 0 || files.some(file => isSharedByAllTests(file));
  return { all: isUnplaced, tags: areasFor(files).map(area => area.tag), specs: changedSpecs(files) };
}
