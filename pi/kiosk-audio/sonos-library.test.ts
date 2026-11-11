// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);
vi.mock('@svrooij/sonos', () => {
  const kitchen = { name: 'Kitchen', host: 'kitchen.lan', port: 1400, uuid: 'RINCON_K' };
  const lounge = { name: 'Lounge', host: 'lounge.lan', port: 1400, uuid: 'RINCON_L' };
  class SonosDevice {
    readonly host: string;
    constructor(host: string) {
      this.host = host;
    }
    GetZoneGroupState() {
      return Promise.resolve([{ groupId: 'g', name: 'Kitchen + 1', coordinator: kitchen, members: [kitchen, lounge] }]);
    }
    AddUriToQueue(uri: string) {
      calls.push(`${this.host} add ${uri}`);
      return Promise.resolve({ FirstTrackNumberEnqueued: 7, NumTracksAdded: 1, NewQueueLength: 7 });
    }
    SwitchToQueue() {
      calls.push(`${this.host} queue`);
      return Promise.resolve(true);
    }
    SeekTrack(track: number) {
      calls.push(`${this.host} seek ${track}`);
      return Promise.resolve(true);
    }
    Play() {
      calls.push(`${this.host} play`);
      return Promise.resolve(true);
    }
  }
  class SonosDeviceDiscovery {
    SearchOne() {
      return Promise.resolve({ host: 'lounge.lan', port: 1400 });
    }
  }
  return { SonosDevice, SonosDeviceDiscovery };
});

const { playWithLibrary, resumeQueue } = await import('./sonos-library.ts');

describe('sonos-library', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('queues the song on the coordinator of the room’s group, switches to the queue and plays from it', async () => {
    await playWithLibrary('lounge', 'spotify:track:1234567890123456789012');
    expect(calls).toEqual([
      'kitchen.lan add spotify:track:1234567890123456789012',
      'kitchen.lan queue',
      'kitchen.lan seek 7',
      'kitchen.lan play'
    ]);
  });

  it('switches the group to its queue and plays, for the test button', async () => {
    await resumeQueue('Kitchen');
    expect(calls).toEqual(['kitchen.lan queue', 'kitchen.lan play']);
  });

  it('says when no room has that name', async () => {
    await expect(resumeQueue('Attic')).rejects.toThrow('no room called Attic');
  });
});
