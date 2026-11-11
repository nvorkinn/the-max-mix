// Sonos through the @svrooij/sonos library (https://sonos-ts.svrooij.io), the second way sonos.ts can play a song. It
// finds one speaker on the home network (SSDP), reads the household's groups from it, and talks to the coordinator of the
// group the room is in. No event subscriptions: those would open a listening port on the Pi.
import { SonosDevice, SonosDeviceDiscovery } from '@svrooij/sonos';

const DISCOVERY_SECONDS = 5;

/** The group that plays the room: its coordinator, as a device to send commands to. */
async function coordinatorFor(room: string): Promise<SonosDevice> {
  const found = await new SonosDeviceDiscovery().SearchOne(DISCOVERY_SECONDS);
  const groups = await new SonosDevice(found.host, found.port).GetZoneGroupState();
  const wanted = room.toLowerCase();
  const group = groups.find(entry => entry.members.some(member => member.name.toLowerCase() === wanted));
  if (!group) throw new Error(`no room called ${room} on this network.`);
  const { host, port, uuid, name } = group.coordinator;
  return new SonosDevice(host, port, uuid, name);
}

/**
 * Plays a Spotify item the way sonoscli's `open` does: adds it to the group's Sonos queue, makes the queue what the group
 * plays, goes to the first added track and plays.
 */
export async function playWithLibrary(room: string, uri: string): Promise<void> {
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
