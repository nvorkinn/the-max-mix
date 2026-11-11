// Sonos through the @svrooij/sonos library (https://sonos-ts.svrooij.io), one of the two ways sonos.ts talks to the
// speakers. It finds a speaker on the home network (SSDP) once, then asks that speaker for the household's groups each
// time, searching again only when it stops answering. Commands go to the coordinator of the group a room is in. No event
// subscriptions: those would open a listening port on the Pi.
import { SonosDevice, SonosDeviceDiscovery } from '@svrooij/sonos';
import { fetchArt, formatTime, parseTime, spotifyTrackUri } from './sonos-shared.ts';
import type { SonosGroup, SonosOperations } from './sonos-shared.ts';

const DISCOVERY_SECONDS = 5;

type ZoneGroups = Awaited<ReturnType<SonosDevice['GetZoneGroupState']>>;
type ZoneGroup = ZoneGroups[number];
type ZoneMember = ZoneGroup['coordinator'];

/** The speaker last found answering, so the next call need not search the network again. */
const known: { speaker: { host: string; port: number } | null } = { speaker: null };

/** Forgets the speaker found (for tests). */
export function forgetSpeaker(): void {
  known.speaker = null;
}

/** The household's groups, read from the speaker found before or, when that one does not answer, a newly found one. */
async function zoneGroups(): Promise<ZoneGroups> {
  if (known.speaker) {
    try {
      return await new SonosDevice(known.speaker.host, known.speaker.port).GetZoneGroupState();
    } catch {
      known.speaker = null;
    }
  }
  const found = await new SonosDeviceDiscovery().SearchOne(DISCOVERY_SECONDS);
  const groups = await new SonosDevice(found.host, found.port).GetZoneGroupState();
  known.speaker = { host: found.host, port: found.port };
  return groups;
}

/** The group's id and its visible rooms (not e.g. surrounds), the leading room first. */
const roomsOf = (group: ZoneGroup): SonosGroup => ({
  id: group.groupId,
  rooms: [group.coordinator, ...group.members.filter(member => member.uuid !== group.coordinator.uuid)]
    .filter(member => !member.Invisible)
    .map(member => ({ id: member.uuid, name: member.name }))
});

const deviceOf = ({ host, port, uuid, name }: ZoneMember) => new SonosDevice(host, port, uuid, name);

/** The group a room is in (by its name, ignoring case), and the room itself. */
async function groupOf(room: string): Promise<{ group: ZoneGroup; member: ZoneMember }> {
  const wanted = room.toLowerCase();
  const groups = await zoneGroups();
  for (const group of groups) {
    const member = group.members.find(entry => entry.name.toLowerCase() === wanted);
    if (member) return { group, member };
  }
  throw new Error(`no room called ${room} on this network.`);
}

/** The group that plays the room: its coordinator, as a device to send commands to. */
async function coordinatorFor(room: string): Promise<SonosDevice> {
  return deviceOf((await groupOf(room)).group.coordinator);
}

/**
 * Plays a Spotify item the way sonoscli's `open` does: adds it to the group's Sonos queue, makes the queue what the group
 * plays, goes to the first added track and plays.
 */
async function play(room: string, uri: string): Promise<void> {
  const device = await coordinatorFor(room);
  const added = await device.AddUriToQueue(uri, 0, false);
  await device.SwitchToQueue();
  await device.SeekTrack(added.FirstTrackNumberEnqueued);
  await device.Play();
}

/** SwitchToQueue() then Play(): makes the group's own Sonos queue its source and plays whatever is in it. */
export async function resumeQueue(room: string): Promise<void> {
  const device = await coordinatorFor(room);
  await device.SwitchToQueue();
  await device.Play();
}

async function readVolume(device: SonosDevice): Promise<number | null> {
  try {
    return (await device.GroupRenderingControlService.GetGroupVolume({ InstanceID: 0 })).CurrentVolume;
  } catch {
    return null;
  }
}

export const library: SonosOperations = {
  groups: async () => (await zoneGroups()).map(group => roomsOf(group)),
  play,
  now: async room => {
    const device = await coordinatorFor(room);
    const [transport, position, volume] = await Promise.all([
      device.AVTransportService.GetTransportInfo(),
      device.AVTransportService.GetPositionInfo(),
      readVolume(device)
    ]);
    const meta = typeof position.TrackMetaData === 'object' ? position.TrackMetaData : null;
    const durationMs = parseTime(position.TrackDuration);
    const uri = spotifyTrackUri(meta?.TrackUri, position.TrackURI);
    return {
      playing: ['PLAYING', 'TRANSITIONING'].includes(transport.CurrentTransportState),
      positionMs: parseTime(position.RelTime) ?? 0,
      track: meta?.Title
        ? {
            name: meta.Title,
            ...(meta.Artist && { artist: meta.Artist }),
            ...(meta.Album && { album: meta.Album }),
            ...(durationMs && { durationMs }),
            ...(uri && { uri }),
            art: Boolean(meta.AlbumArtUri)
          }
        : null,
      volume,
      canSeek: true
    };
  },
  control: async (room, action, positionMs) => {
    const device = await coordinatorFor(room);
    switch (action) {
      case 'play': {
        await device.Play();
        break;
      }
      case 'pause': {
        await device.Pause();
        break;
      }
      case 'next': {
        await device.Next();
        break;
      }
      case 'previous': {
        await device.Previous();
        break;
      }
      default: {
        await device.SeekPosition(formatTime(positionMs));
      }
    }
  },
  volume: async (room, volume) => {
    const device = await coordinatorFor(room);
    await device.GroupRenderingControlService.SetGroupVolume({ InstanceID: 0, DesiredVolume: volume });
  },
  joinGroup: async (room, to) => {
    const [{ member }, { group }] = await Promise.all([groupOf(room), groupOf(to)]);
    if (group.members.some(entry => entry.uuid === member.uuid)) return;
    await deviceOf(member).AVTransportService.SetAVTransportURI({
      InstanceID: 0,
      CurrentURI: `x-rincon:${group.coordinator.uuid}`,
      CurrentURIMetaData: ''
    });
  },
  leaveGroup: async room => {
    const { group, member } = await groupOf(room);
    if (group.members.every(entry => entry.uuid === member.uuid)) return;
    await deviceOf(member).AVTransportService.BecomeCoordinatorOfStandaloneGroup({ InstanceID: 0 });
  },
  art: async room => {
    const { coordinator } = (await groupOf(room)).group;
    const position = await deviceOf(coordinator).AVTransportService.GetPositionInfo();
    const url = typeof position.TrackMetaData === 'object' ? position.TrackMetaData.AlbumArtUri : undefined;
    return url ? fetchArt(url, `http://${coordinator.host}:${coordinator.port}`) : null;
  }
};
