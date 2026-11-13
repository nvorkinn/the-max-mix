import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getKnownSpeakers, rememberSpeaker } from './knownDevices';

const auth = vi.hoisted((): { activeId: string | null } => ({ activeId: 'nikolai' }));
vi.mock('./auth', () => ({ getActivePersonId: () => auth.activeId }));

const stored = (): unknown => JSON.parse(localStorage.getItem('maxmix.knownSpeakers') ?? 'null');

describe('spotify/knownDevices', () => {
  beforeEach(() => {
    localStorage.clear();
    auth.activeId = 'nikolai';
  });

  it('remembers speakers seen playing, most recent first, once each', () => {
    rememberSpeaker({ id: 'kitchen', name: 'Kitchen', type: 'Speaker', is_active: true, volume_percent: 20 });
    rememberSpeaker({ id: 'living', name: 'Living Room', type: 'Speaker' });
    rememberSpeaker({ id: 'kitchen', name: 'Kitchen', type: 'Speaker' });
    expect(getKnownSpeakers()).toEqual([
      { id: 'kitchen', name: 'Kitchen', type: 'Speaker' },
      { id: 'living', name: 'Living Room', type: 'Speaker' }
    ]);
  });

  it('keeps a separate list for each person', () => {
    rememberSpeaker({ id: 'kitchen', name: 'Kitchen', type: 'Speaker' });
    auth.activeId = 'anna';
    expect(getKnownSpeakers()).toEqual([]);
    rememberSpeaker({ id: 'bedroom', name: 'Bedroom', type: 'Speaker' });
    expect(getKnownSpeakers()).toEqual([{ id: 'bedroom', name: 'Bedroom', type: 'Speaker' }]);
    auth.activeId = 'nikolai';
    expect(getKnownSpeakers()).toEqual([{ id: 'kitchen', name: 'Kitchen', type: 'Speaker' }]);
    auth.activeId = null;
    expect(getKnownSpeakers()).toEqual([]);
  });

  it('moves the list kept before there were people to the active person', () => {
    const kitchen = { id: 'kitchen', name: 'Kitchen', type: 'Speaker' };
    localStorage.setItem('maxmix.knownSpeakers', JSON.stringify([kitchen]));
    auth.activeId = null;
    expect(getKnownSpeakers()).toEqual([kitchen]);
    rememberSpeaker({ id: 'living', name: 'Living Room', type: 'Speaker' });
    expect(stored()).toEqual([{ id: 'living', name: 'Living Room', type: 'Speaker' }, kitchen]);
    auth.activeId = 'nikolai';
    expect(getKnownSpeakers()).toEqual([{ id: 'living', name: 'Living Room', type: 'Speaker' }, kitchen]);
    expect(stored()).toEqual({ nikolai: [{ id: 'living', name: 'Living Room', type: 'Speaker' }, kitchen] });
  });

  it('skips phones, computers, devices without an id and nothing at all', () => {
    rememberSpeaker({ id: 'phone', name: 'iPhone', type: 'Smartphone' });
    rememberSpeaker({ id: 'web', name: 'THE MAX MIX', type: 'Computer' });
    rememberSpeaker({ id: null, name: 'Hidden', type: 'Speaker' });
    rememberSpeaker(undefined);
    expect(getKnownSpeakers()).toEqual([]);
  });

  it('keeps at most 20', () => {
    for (let index = 0; index < 25; index += 1) {
      rememberSpeaker({ id: `s${index}`, name: `S${index}`, type: 'Speaker' });
    }
    expect(getKnownSpeakers()).toHaveLength(20);
    expect(getKnownSpeakers()[0]?.id).toBe('s24');
  });

  it('reads nothing from unreadable or unavailable storage', () => {
    localStorage.setItem('maxmix.knownSpeakers', '{not json');
    expect(getKnownSpeakers()).toEqual([]);
    localStorage.setItem('maxmix.knownSpeakers', JSON.stringify({ nikolai: { id: 'x' } }));
    expect(getKnownSpeakers()).toEqual([]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => rememberSpeaker({ id: 'kitchen', name: 'Kitchen', type: 'Speaker' })).not.toThrow();
  });
});
