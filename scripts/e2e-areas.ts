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
    sources: [
      /^web\/src\/components\/AlbumArtPlayer/,
      /^web\/src\/components\/(Person(Face|Switcher)|SongProof|QrCode)/,
      /^web\/src\/spotify\/songProof/,
      /^web\/src\/hooks\/use(Spotify|Sonos)Player/,
      /^web\/src\/spotify\/api\.ts$/,
      /^web\/src\/utils\/colorExtractor\.ts$/,
      /^web\/src\/hooks\/useLingers/
    ]
  },
  {
    tag: 'registration',
    title: 'First-time setup',
    sources: [
      /^web\/src\/countdown\//,
      /^web\/src\/hooks\/useDeviceConfig/,
      /^web\/src\/components\/setup\//,
      /^web\/src\/hooks\/useSoloistSignIn/,
      /^web\/src\/hooks\/(useSetupStatus|usePhoneSignIn)/,
      /^web\/src\/spotify\/soloistSignIn/,
      /^\.env\.(production|development)$/
    ]
  },
  {
    tag: 'music',
    title: 'Choose music',
    sources: [/^web\/src\/components\/MusicPicker/, /^web\/src\/hooks\/useOnScreenKeyboard/]
  },
  {
    tag: 'queue',
    title: 'Queue',
    sources: [
      /^web\/src\/components\/TrackQueue/,
      /^web\/src\/hooks\/useDragToReorder/,
      /^web\/src\/hooks\/useWholeRows/,
      /^web\/src\/components\/TrackImages/
    ]
  },
  {
    tag: 'lyrics',
    title: 'Lyrics',
    sources: [
      /^web\/src\/components\/LyricsPanel/,
      /^web\/src\/hooks\/useLyrics/,
      /^web\/src\/lyrics\//,
      /^web\/src\/utils\/lyricsStyle/
    ]
  },
  {
    tag: 'settings',
    title: 'Settings',
    sources: [
      /^web\/src\/components\/SettingsPanel/,
      /^web\/src\/components\/settings\//,
      /^web\/src\/components\/(KioskSystem|ConfirmButton|PhonePicker|PairPhoneSheet|PhonePairingView)/,
      /^web\/src\/hooks\/usePhonePairing/,
      /^web\/src\/hooks\/(useSavedPhones|useAutoSwitch)/,
      /^web\/src\/utils\/(themeColour|clockFormat|phoneLinks)/,
      /^web\/src\/sonos\//
    ]
  },
  {
    tag: 'speakers',
    title: 'Speakers',
    sources: [
      /^web\/src\/components\/SpeakersView/,
      /^web\/src\/speakers\//,
      /^web\/src\/spotify\/knownDevices/,
      /^web\/src\/hooks\/useAlongVolume/,
      /^web\/src\/audio\//
    ]
  },
  {
    tag: 'update',
    title: 'Software update',
    sources: [
      /^web\/src\/components\/Update(Prompt|Console)/,
      /^web\/src\/hooks\/useKioskUpdate/,
      /^web\/src\/utils\/kiosk(Service)?\.ts$/,
      /^server\/src\/update/
    ]
  },
  {
    tag: 'setup',
    title: 'Setup and signing in',
    sources: [/^web\/src\/components\/SpotifySetup/, /^web\/src\/spotify\/(auth|settings)\.ts$/]
  },
  {
    tag: 'status',
    title: 'Playback status and recovery',
    sources: [
      /^web\/src\/components\/(PlaybackNotice|OfflineBanner)/,
      /^web\/src\/hooks\/(useOnlineStatus|useSpotifyCooldown|useSpotifyPolling)/,
      /^web\/src\/spotify\/(http|polling)\.ts$/
    ]
  },
  { tag: 'dialogs', title: 'Dialogs', sources: [/^web\/src\/components\/Modal/] },
  {
    tag: 'debug',
    title: 'Debug console',
    sources: [
      /^web\/src\/components\/(DebugConsole|BluetoothDebug)/,
      /^web\/src\/utils\/(debugLog|httpLog|bluetoothMonitor)/
    ]
  },
  // No source file is only about these: the tests are found through the files they change, or through the areas above.
  { tag: 'appearance', title: 'Appearance of dialogs', sources: [] },
  { tag: 'visual', title: 'Screenshots', sources: [] },
  {
    tag: 'sleep',
    title: 'Screen sleep',
    sources: [
      /^web\/src\/components\/Sleep(Screen|Icon)/,
      /^web\/src\/hooks\/useScreenSleep/,
      /^web\/src\/hooks\/useIdle/,
      /^web\/src\/utils\/screenSleep/,
      /^web\/src\/utils\/quietHours/
    ]
  },
  {
    tag: 'layout',
    title: 'Layout',
    sources: [
      /^web\/src\/.*\.css$/,
      /^index\.html$/,
      /^web\/src\/components\/PanelNav/,
      /^web\/src\/components\/AppTabs/,
      /^web\/src\/components\/Dashboard/,
      /^web\/src\/components\/dashboard\//,
      /^web\/src\/dashboard\//,
      /^web\/src\/assets\/dashboard\//,
      /^web\/src\/assets\/fonts\//,
      /^web\/src\/hooks\/usePanelView/,
      /^web\/src\/hooks\/useHold/,
      /^web\/src\/utils\/arrivalsTransition/
    ],
    alsoAffects: ['visual', 'appearance']
  },
  // The page that holds everything above: a change to it can change any of them.
  {
    tag: 'app',
    title: 'The app as a whole',
    sources: [
      /^web\/src\/components\/(TabletView|TabBackdrop)\.tsx$/,
      /^web\/src\/(main|App)\.tsx$/,
      /^web\/vite\.config\.ts$/
    ],
    alsoAffects: ['player', 'queue', 'settings', 'update', 'status', 'dialogs', 'visual']
  }
];

/** The areas a change to `files` is about. */
export function areasFor(files: readonly string[]): Area[] {
  const direct = AREAS.filter(area => files.some(file => area.sources.some(source => source.test(file))));
  const tags = new Set(direct.flatMap(area => [area.tag, ...(area.alsoAffects ?? [])]));
  return AREAS.filter(area => tags.has(area.tag));
}

const isTestFile = (file: string) => /\.test\.(ts|tsx)$/.test(file) || file.startsWith('web/src/test/');
const isMapped = (file: string) => AREAS.some(area => area.sources.some(source => source.test(file)));

/** Changed files under web/src/ that belong to no area, so no browser test is known to be about them. */
export function unmappedSources(files: readonly string[]): string[] {
  return files.filter(file => file.startsWith('web/src/') && !isTestFile(file) && !isMapped(file));
}

const SPEC = /^e2e\/([^/]+\.spec\.ts)$/;

/** The test files (names inside e2e/) among `files`. */
export function changedSpecs(files: readonly string[]): string[] {
  return files.flatMap(file => SPEC.exec(file)?.[1] ?? []);
}
