import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getChosenSpeakers,
  listAudioOutputs,
  routeAudio,
  setChosenSpeakers,
  setSpeakerVolume,
  watchAudioOutputs
} from '../audio/airplay';
import type { AudioOutput } from '../audio/airplay';
import { SAFE_START_VOLUME } from '../audio/safeVolume';
import {
  findSonosOnPi,
  getKioskSonosLeader,
  getSonosNow,
  joinSonosGroup,
  leaveSonosGroup,
  setKioskSonosLeader,
  setSonosVolume,
  subscribeKioskSonosLeader,
  watchSonosOnPi
} from '../sonos/kiosk';
import type { PiSonosGroup } from '../sonos/kiosk';
import { getDevices } from '../spotify/api';
import { recordSpotifyRetryAfter, SpotifyApiError } from '../spotify/http';
import { getKnownSpeakers } from '../spotify/knownDevices';
import type { SpotifyDevice } from '../types';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';
import { sameChoice, sonosChoice, tabletChoice, toggleChoice } from './selection';
import type { SpeakerChoice, SpeakerKey } from './selection';

/** After Save, where the music plays is read again this often, at most CONFIRM_READS times, until it shows the change. */
const CONFIRM_MS = 1000;
const CONFIRM_READS = 8;
const NOT_CONFIRMED = 'The speakers did not take the change.';

/** A Spotify Connect device to list: `remembered` when Spotify left it out but the app has seen it playing. */
interface ConnectDevice extends SpotifyDevice {
  remembered: boolean;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** The rooms in the group the room leads (or is in), as the Pi last found them; just the room before that. */
function groupRooms(leader: string, groups: readonly PiSonosGroup[] | null): string[] {
  const group = groups?.find(entry => entry.rooms.some(room => room.name === leader));
  return group?.rooms.map(room => room.name) ?? [leader];
}

/** Turns the room's group down to SAFE_START_VOLUME when it is louder, before music starts on it. */
async function turnDownSonos(room: string): Promise<void> {
  const { volume } = await getSonosNow(room).catch(() => ({ volume: null }));
  if (volume !== null && volume > SAFE_START_VOLUME) await setSonosVolume(room, SAFE_START_VOLUME);
}

/** Starts the rooms in order from a group that is not the kiosk's: the first one plays, the others join it. */
async function startSonos(rooms: readonly string[], playOnSonos: (room: string) => Promise<void>): Promise<void> {
  const [first, ...rest] = rooms;
  if (!first) return;
  await turnDownSonos(first);
  await playOnSonos(first);
  setKioskSonosLeader(first);
  for (const room of rest) {
    // eslint-disable-next-line no-await-in-loop
    await turnDownSonos(room);
    // eslint-disable-next-line no-await-in-loop
    await joinSonosGroup(room, first);
  }
}

/** Adds and takes out rooms of the kiosk's playing group. Rooms join before any leave, so the music never stops. */
async function regroupSonos(leader: string, current: readonly string[], rooms: readonly string[]): Promise<void> {
  const joining = rooms.filter(name => !current.includes(name));
  const leaving = current.filter(name => !rooms.includes(name));
  for (const room of joining) {
    // eslint-disable-next-line no-await-in-loop
    await turnDownSonos(room);
    // eslint-disable-next-line no-await-in-loop
    await joinSonosGroup(room, leader);
  }
  for (const room of leaving) {
    // eslint-disable-next-line no-await-in-loop
    await leaveSonosGroup(room);
  }
  if (!rooms.includes(leader)) setKioskSonosLeader(rooms[0] ?? null);
}

/** What the page tells the selection, and the actions it already has for each kind of speaker. */
export interface SpeakerSelectionOptions {
  /** The kiosk, whose Pi lists the speaker outputs and Sonos rooms. */
  onKiosk: boolean;
  /** The Speakers view is showing: its lists are read when it opens and kept fresh while it shows. */
  open: boolean;
  browserDeviceId: string | null;
  /** The Spotify Connect device that plays now, as Spotify says. */
  playingDeviceId: string | null;
  /** The playing Sonos group's name, for the label. */
  sonosName: string | null;
  /** Moves Spotify's playback to a Connect device or to this tablet. */
  transfer: (deviceId: string) => Promise<unknown>;
  /** Starts the song on screen on a Sonos room, through the Pi. */
  playOnSonos: (room: string) => Promise<void>;
  /** Pauses the kiosk's Sonos group and lets it go. */
  leaveSonos: () => Promise<void>;
}

/**
 * The Speakers view's state: the speakers to list, where the music plays now (`confirmed`, from Spotify and the Pi only),
 * the draft the selectors change, and Save, which carries the draft out and waits until Spotify or the Pi shows it.
 */
export function useSpeakerSelection({
  onKiosk,
  open,
  browserDeviceId,
  playingDeviceId,
  sonosName,
  transfer,
  playOnSonos,
  leaveSonos
}: SpeakerSelectionOptions) {
  const [devices, setDevices] = useState<SpotifyDevice[] | null>(null);
  const [groups, setGroups] = useState<PiSonosGroup[] | null>(null);
  const [outputs, setOutputs] = useState<AudioOutput[] | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [draft, setDraft] = useState<SpeakerChoice | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leader = useSyncExternalStore(subscribeKioskSonosLeader, getKioskSonosLeader);

  const readDevices = useCallback(async () => {
    try {
      const { devices: list } = await getDevices();
      setDevices(list);
    } catch (caught) {
      if (caught instanceof SpotifyApiError) recordSpotifyRetryAfter(caught);
      debugLog('warn', 'speakers', `Reading Spotify's devices failed: ${errorMessage(caught)}`);
    }
  }, []);
  const readGroups = useCallback(async () => {
    try {
      const { groups: list } = await findSonosOnPi();
      setGroups(list);
    } catch (caught) {
      debugLog('warn', 'sonos', `Finding the Sonos rooms failed: ${errorMessage(caught)}`);
    }
  }, []);
  const readOutputs = useCallback(async () => {
    try {
      const answer = await listAudioOutputs();
      setOutputs(answer.outputs);
      setLegacy(answer.legacy);
    } catch (caught) {
      debugLog('warn', 'speakers', `Reading the speaker outputs failed: ${errorMessage(caught)}`);
    }
  }, []);

  const refresh = useCallback(() => {
    void readDevices();
    if (!onKiosk) return;
    void readGroups();
    void readOutputs();
  }, [onKiosk, readDevices, readGroups, readOutputs]);

  // Everything is read again each time the view opens.
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);
  // The outputs are kept fresh on the kiosk, since the label under the artwork says which of them play.
  useEffect(() => {
    if (!onKiosk) return;
    void readOutputs();
    return watchAudioOutputs(() => void readOutputs());
  }, [onKiosk, readOutputs]);
  // While the view shows, rooms joining or leaving (here or in the Sonos app) are read again as the Pi reports them.
  useEffect(() => {
    if (!onKiosk || !open) return;
    return watchSonosOnPi(change => {
      if (change === 'groups') void readGroups();
    });
  }, [onKiosk, open, readGroups]);

  // Where the music plays now: a Sonos group the kiosk started, else this tablet with the outputs the Pi says it sends
  // the sound to (or, from an older Pi, the ones this page last chose), else the Connect device Spotify names.
  let confirmed: SpeakerChoice | null = null;
  if (leader) confirmed = sonosChoice(groupRooms(leader, groups));
  else if (browserDeviceId && playingDeviceId === browserDeviceId) {
    let linked: string[] = [];
    if (onKiosk) {
      linked = legacy || !outputs ? getChosenSpeakers() : outputs.filter(output => output.linked).map(o => o.id);
    }
    confirmed = tabletChoice(linked);
  } else if (playingDeviceId) confirmed = { family: 'connect', id: playingDeviceId };
  const confirmedRef = useRef(confirmed);
  useEffect(() => {
    confirmedRef.current = confirmed;
  });

  const shown = draft ?? confirmed;
  const dirty = draft !== null && !sameChoice(draft, confirmed);
  const toggle = (key: SpeakerKey) => {
    setError(null);
    const next = toggleChoice(shown, key);
    setDraft(sameChoice(next, confirmed) ? null : next);
  };

  /** Does what moving from `from` to `to` takes, without waiting for it to show. */
  const carryOut = async (from: SpeakerChoice | null, to: SpeakerChoice) => {
    // The tablet's outputs are handed back to the Pi's own output as soon as the music goes anywhere else.
    const routed = onKiosk && (from?.family === 'tablet' ? from.outputs.length : getChosenSpeakers().length) > 0;
    if (routed && to.family !== 'tablet') {
      routeAudio([], legacy);
      setChosenSpeakers([]);
    }
    if (to.family === 'sonos') {
      if (to.rooms.length === 0) await leaveSonos();
      else if (leader && from?.family === 'sonos') await regroupSonos(leader, from.rooms, to.rooms);
      else await startSonos(to.rooms, playOnSonos);
      return;
    }
    if (from?.family === 'sonos') await leaveSonos();
    if (to.family === 'connect') {
      await transfer(to.id);
      return;
    }
    if (browserDeviceId && from?.family !== 'tablet') await transfer(browserDeviceId);
    const before = from?.family === 'tablet' ? from.outputs : [];
    // A speaker that joins is turned down first, so one left loud does not blast.
    const known = outputs ?? [];
    for (const output of known) {
      const joins = to.outputs.includes(output.id) && !before.includes(output.id);
      if (joins && output.volume !== null && output.volume > SAFE_START_VOLUME) {
        setSpeakerVolume(output, SAFE_START_VOLUME);
      }
    }
    routeAudio(to.outputs, legacy);
    setChosenSpeakers(to.outputs);
  };

  /** Reads again what shows the change, until it does; whether it did. */
  const confirm = async (target: SpeakerChoice): Promise<boolean> => {
    for (let read = 0; read < CONFIRM_READS; read += 1) {
      if (sameChoice(confirmedRef.current, target)) return true;
      if (target.family === 'sonos') void readGroups();
      if (onKiosk && target.family === 'tablet') void readOutputs();
      // eslint-disable-next-line no-await-in-loop
      await wait(CONFIRM_MS);
    }
    return sameChoice(confirmedRef.current, target);
  };

  const save = async () => {
    if (!draft || saving) return;
    const target = draft;
    setSaving(true);
    setError(null);
    try {
      await carryOut(confirmedRef.current, target);
      // Taking every Sonos room out stops the music there; nothing else is left to show it.
      const stopped = target.family === 'sonos' && target.rooms.length === 0;
      if (!stopped && !(await confirm(target))) throw new Error(NOT_CONFIRMED);
      setDraft(null);
    } catch (caught) {
      if (caught instanceof SpotifyApiError) recordSpotifyRetryAfter(caught);
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
      void readDevices();
    }
  };

  // Spotify's list leaves out some speakers (Sonos among them), even while they play; the ones seen playing are added.
  // A Connect device named like a Sonos room is that speaker, listed once, as the room.
  const listed = devices ?? [];
  const names = new Set(listed.flatMap(device => [device.id, device.name.toLowerCase()]));
  const remembered = getKnownSpeakers().filter(
    device => !names.has(device.id) && !names.has(device.name.toLowerCase())
  );
  const sonosRooms = (groups ?? [])
    .flatMap(group => group.rooms.map(room => room.name))
    .toSorted((a, b) => a.localeCompare(b));
  const roomNames = new Set(sonosRooms.map(name => name.toLowerCase()));
  const connectDevices: ConnectDevice[] = [
    ...listed.map(device => ({ ...device, remembered: false })),
    ...remembered.map(device => ({ ...device, remembered: true }))
  ].filter(device => device.id !== browserDeviceId && !roomNames.has(device.name.toLowerCase()));

  let playingLabel: string | undefined;
  if (leader) playingLabel = sonosName ?? 'Sonos';
  else if (confirmed?.family === 'tablet') {
    const [only] = confirmed.outputs;
    if (confirmed.outputs.length === 0) playingLabel = 'This tablet';
    else if (only !== undefined && confirmed.outputs.length === 1) {
      playingLabel = outputs?.find(output => output.id === only)?.name ?? only;
    } else playingLabel = `${confirmed.outputs.length} speakers`;
  }

  return {
    connectDevices,
    sonosRooms,
    outputs: outputs ?? [],
    confirmed,
    shown,
    dirty,
    saving,
    error,
    toggle,
    save,
    refresh,
    /** This tablet plays, so its outputs (AirPlay, Bluetooth) can be chosen. */
    tabletPlaying: confirmed?.family === 'tablet',
    playingLabel,
    readOutputs
  };
}

export type SpeakerSelection = ReturnType<typeof useSpeakerSelection>;
