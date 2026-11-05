import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getKnownSpeakers, rememberSpeaker } from './knownDevices';

describe('spotify/knownDevices', () => {
  beforeEach(() => {
    localStorage.clear();
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
    localStorage.setItem('maxmix.knownSpeakers', JSON.stringify({ id: 'x' }));
    expect(getKnownSpeakers()).toEqual([]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => rememberSpeaker({ id: 'kitchen', name: 'Kitchen', type: 'Speaker' })).not.toThrow();
  });
});
