// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SonosEventHub } from './sonos-events.ts';
import type { SonosChange, SonosEventSource, SonosService, SonosSpeaker } from './sonos-events.ts';

const speaker = (name: string): SonosSpeaker => ({ uuid: `RINCON_${name}`, name, host: `${name}.lan`, port: 1400 });
const KITCHEN = speaker('Kitchen');
const ignore = vi.fn();
const LOUNGE = speaker('Lounge');

/** A household whose leading speakers can change, and the subscriptions held on it. */
function household(leaders: SonosSpeaker[]) {
  const held = new Map<string, () => void>();
  const source: SonosEventSource = {
    coordinators: vi.fn(() => Promise.resolve([...leaders])),
    listen: (who, service: SonosService, onEvent) => {
      held.set(`${service} ${who.name}`, onEvent);
      return () => {
        held.delete(`${service} ${who.name}`);
      };
    }
  };
  const fire = (key: string) => {
    const onEvent = held.get(key);
    if (!onEvent) throw new Error(`not subscribed: ${key}`);
    onEvent();
  };
  return { source, held, fire, leaders };
}

describe('SonosEventHub', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes only while someone listens', async () => {
    const home = household([KITCHEN]);
    const hub = new SonosEventHub(home.source);
    expect(home.source.coordinators).not.toHaveBeenCalled();
    const stop = hub.add(ignore);
    const stopToo = hub.add(vi.fn());
    await hub.settled();
    expect(new Set(home.held.keys())).toEqual(new Set(['topology Kitchen', 'transport Kitchen', 'volume Kitchen']));
    stop();
    await hub.settled();
    expect(home.held.size).toBe(3);
    stopToo();
    await hub.settled();
    expect(home.held.size).toBe(0);
  });

  it('sends a burst of changes as one, of each kind', async () => {
    const home = household([KITCHEN]);
    const hub = new SonosEventHub(home.source);
    const changes: SonosChange[] = [];
    hub.add(change => {
      changes.push(change);
    });
    await hub.settled();
    home.fire('transport Kitchen');
    home.fire('volume Kitchen');
    home.fire('topology Kitchen');
    expect(changes).toEqual([]);
    await vi.advanceTimersByTimeAsync(250);
    expect(changes.toSorted((a, b) => a.localeCompare(b))).toEqual(['groups', 'now']);
    home.fire('transport Kitchen');
    await vi.advanceTimersByTimeAsync(250);
    expect(changes).toHaveLength(3);
  });

  it('follows the speakers that lead the groups as rooms join and leave', async () => {
    const home = household([KITCHEN, LOUNGE]);
    const hub = new SonosEventHub(home.source);
    hub.add(ignore);
    await hub.settled();
    expect(home.held.has('transport Lounge')).toBe(true);
    // Lounge joins Kitchen's group: it no longer leads one.
    home.leaders.splice(1);
    home.fire('topology Kitchen');
    await hub.settled();
    expect(new Set(home.held.keys())).toEqual(new Set(['topology Kitchen', 'transport Kitchen', 'volume Kitchen']));
  });

  it('says when it cannot find a speaker, and tries again on the next listener', async () => {
    const home = household([KITCHEN]);
    vi.mocked(home.source.coordinators).mockRejectedValueOnce(new Error('no speakers answered'));
    const log = vi.fn();
    const hub = new SonosEventHub(home.source, log);
    const stop = hub.add(ignore);
    await hub.settled();
    expect(log).toHaveBeenCalledWith('sonos: no speaker to follow: no speakers answered');
    expect(home.held.size).toBe(0);
    stop();
    hub.add(ignore);
    await hub.settled();
    expect(home.held.size).toBe(3);
  });
});
