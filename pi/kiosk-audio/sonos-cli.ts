// Sonos through sonoscli (https://sonoscli.sh, installed by the playbook as SONOS_CLI), one of the two ways sonos.ts
// talks to the speakers. Each call runs the program once (no shell, the room as one --name=… argument); it finds the
// speakers on the home network itself. sonoscli has no seek command, so seeking is refused this way.
import { execFile } from 'node:child_process';
import { fetchArt, parseTime, SonosError, spotifyTrackUri } from './sonos-shared.ts';
import type { SonosGroup, SonosNowPlaying, SonosOperations } from './sonos-shared.ts';

const SONOS_CLI = '/usr/local/bin/sonos';
/** How long sonoscli may look for the speakers and talk to them; the process gets a little more. */
const CLI_TIMEOUT = '15s';
const PROCESS_TIMEOUT_MS = 25_000;
const MAX_MESSAGE = 200;

export type RunCli = (argv: string[]) => Promise<{ code: number; stdout?: string; stderr: string }>;

/** sonoscli with these arguments, then the room as one --name=… argument and the time it may take. */
const cli = (room: string | null, ...args: string[]): string[] => [
  SONOS_CLI,
  ...args,
  ...(room === null ? [] : [`--name=${room}`]),
  `--timeout=${CLI_TIMEOUT}`
];

/** `sonos open`: the room's group plays the item, from its Sonos queue; the URI goes after `--`. */
export const sonosCommand = ({ room, uri }: { room: string; uri: string }): string[] => [
  ...cli(room, 'open'),
  '--',
  uri
];

/** `sonos play`: resume whatever the room's group has loaded. */
export const resumeCommand = (room: string): string[] => cli(room, 'play');

/** `sonos group status`: the household's groups and their rooms, as JSON. */
export const groupsCommand: string[] = cli(null, 'group', 'status', '--format=json');

export function failureMessage(stderr: string): string {
  const line = stderr
    .split('\n')
    .map(text => text.replace(/^(Error|error):\s*/, '').trim())
    .find(Boolean);
  return line ? `Sonos: ${line.slice(0, MAX_MESSAGE)}` : 'Sonos did not do that.';
}

export const runCli: RunCli = ([file = '', ...args]) =>
  new Promise(resolve => {
    // sonoscli keeps its settings and a cache of speaker names under the kiosk user's home.
    const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: process.env['HOME'] ?? '' };
    // The caller passes SONOS_CLI, an absolute path; PATH is only passed on.
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    execFile(file, args, { env, timeout: PROCESS_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (!error) resolve({ code: 0, stdout, stderr });
      else if (error.code === 'ENOENT') resolve({ code: 127, stderr: 'sonoscli is not installed on this Pi yet.' });
      else if (error.killed) resolve({ code: 124, stderr: 'the speaker did not answer in time.' });
      else resolve({ code: typeof error.code === 'number' ? error.code : 1, stderr });
    });
  });

/** Runs sonoscli; its output when it succeeded, else a SonosError with why. */
export async function runOrFail(run: RunCli, argv: string[]): Promise<string> {
  const { code, stdout = '', stderr } = await run(argv);
  if (code === 0) return stdout;
  console.warn(`sonos: ${argv.slice(1, 3).join(' ')} failed (${code}): ${stderr.trim()}`);
  throw new SonosError(failureMessage(stderr));
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Output that must be JSON; a SonosError when it is not. */
function parseJson(stdout: string, what: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(stdout) as unknown);
  } catch (error) {
    throw new SonosError(`Sonos: sonoscli did not say ${what}.`, { cause: error });
  }
}

/** The groups in `sonos group status --format=json` output: {"groups": [{"id", "members": [{"name", "uuid", …}]}]}. */
export function parseCliGroups(stdout: string): SonosGroup[] {
  const groups = parseJson(stdout, 'which groups there are')['groups'];
  if (!Array.isArray(groups)) throw new SonosError('Sonos: sonoscli did not say which groups there are.');
  return groups.flatMap((entry): SonosGroup[] => {
    const group = asRecord(entry);
    const id = asText(group['id']);
    const members = Array.isArray(group['members']) ? group['members'].map(member => asRecord(member)) : [];
    const rooms = members
      .toSorted((a, b) => Number(b['isCoordinator'] === true) - Number(a['isCoordinator'] === true))
      .map(member => ({ id: asText(member['uuid']), name: asText(member['name']) }))
      .filter(room => room.id && room.name);
    return id && rooms.length > 0 ? [{ id, rooms }] : [];
  });
}

/**
 * `sonos status --format=json` ({"transport": {"State"}, "position": {"TrackURI", "TrackDuration", "RelTime"},
 * "nowPlaying": {"title", "artist", "album", "uri", "albumArtURI"}, …}) and `sonos group volume get` ({"volume"}).
 */
export function parseCliStatus(status: string, volume: string): SonosNowPlaying {
  const reply = parseJson(status, 'what plays');
  const state = asText(asRecord(reply['transport'])['State']);
  const position = asRecord(reply['position']);
  const playing = asRecord(reply['nowPlaying']);
  const name = asText(playing['title']);
  const artist = asText(playing['artist']);
  const album = asText(playing['album']);
  const durationMs = parseTime(asText(position['TrackDuration']));
  const uri = spotifyTrackUri(asText(playing['uri']), asText(position['TrackURI']));
  const level = parseJson(volume, 'the volume')['volume'];
  return {
    playing: state === 'PLAYING' || state === 'TRANSITIONING',
    positionMs: parseTime(asText(position['RelTime'])) ?? 0,
    track: name
      ? {
          name,
          ...(artist && { artist }),
          ...(album && { album }),
          ...(durationMs && { durationMs }),
          ...(uri && { uri }),
          art: Boolean(asText(reply['albumArtURL']))
        }
      : null,
    volume: typeof level === 'number' ? level : null,
    canSeek: false
  };
}

const ACTIONS = { play: 'play', pause: 'pause', next: 'next', previous: 'prev' } as const;

/** The calls, each running sonoscli through `run`. */
export function cliOperations(run: RunCli = runCli): SonosOperations {
  const status = (room: string) => runOrFail(run, cli(room, 'status', '--format=json'));
  return {
    groups: async () => parseCliGroups(await runOrFail(run, groupsCommand)),
    play: async (room, uri) => {
      await runOrFail(run, sonosCommand({ room, uri }));
    },
    now: async room => {
      const [reply, volume] = await Promise.all([
        status(room),
        runOrFail(run, cli(room, 'group', 'volume', 'get', '--format=json'))
      ]);
      return parseCliStatus(reply, volume);
    },
    control: async (room, action) => {
      if (action === 'seek') throw new SonosError('Sonos: sonoscli cannot move to a point in the song.');
      await runOrFail(run, cli(room, ACTIONS[action]));
    },
    volume: async (room, volume) => {
      await runOrFail(run, cli(room, 'group', 'volume', 'set', String(volume)));
    },
    joinGroup: async (room, to) => {
      await runOrFail(run, cli(room, 'group', 'join', `--to=${to}`));
    },
    leaveGroup: async room => {
      await runOrFail(run, cli(room, 'group', 'unjoin'));
    },
    art: async room => {
      const reply = parseJson(await status(room), 'what plays');
      const url = asText(reply['albumArtURL']);
      const ip = asText(asRecord(reply['device'])['ip']);
      return url && ip ? fetchArt(url, `http://${ip}:1400`) : null;
    }
  };
}
