import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getChosenSpeakers,
  listAudioOutputs,
  routeAudio,
  routeLink,
  setChosenSpeakers,
  watchAudioOutputs
} from './airplay';

const output = (deviceId: string, label: string, kind: MediaDeviceKind = 'audiooutput') =>
  ({ deviceId, label, kind, groupId: '' }) as MediaDeviceInfo;

function stubMediaDevices(devices: MediaDeviceInfo[]) {
  const mediaDevices = {
    enumerateDevices: vi.fn().mockResolvedValue(devices),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  };
  vi.stubGlobal('navigator', { mediaDevices });
  return mediaDevices;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('listAudioOutputs', () => {
  it('lists the named outputs once each, without the virtual ones or inputs', async () => {
    stubMediaDevices([
      output('default', 'Default - Built-in Audio'),
      output('communications', 'Communications'),
      output('a', 'Living Room'),
      output('b', 'Kitchen'),
      output('c', 'Kitchen'),
      output('d', ''),
      output('e', 'Monitor of Kitchen', 'audioinput')
    ]);
    await expect(listAudioOutputs()).resolves.toEqual(['Kitchen', 'Living Room']);
  });

  it('follows outputs appearing and going away', () => {
    const mediaDevices = stubMediaDevices([]);
    const onChange = vi.fn();
    const stop = watchAudioOutputs(onChange);
    expect(mediaDevices.addEventListener).toHaveBeenCalledWith('devicechange', onChange);
    stop();
    expect(mediaDevices.removeEventListener).toHaveBeenCalledWith('devicechange', onChange);
  });
});

describe('routing links', () => {
  it('names every speaker, or none for the Pi’s own output', () => {
    expect(routeLink(['Kitchen', 'Living Room & Bar'])).toBe(
      'kiosk-audio://route?speaker=Kitchen&speaker=Living+Room+%26+Bar'
    );
    expect(routeLink([])).toBe('kiosk-audio://route');
  });

  it('opens the link as a navigation', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    routeAudio(['Kitchen']);
    expect(assign).toHaveBeenCalledWith('kiosk-audio://route?speaker=Kitchen');
  });
});

describe('the chosen speakers', () => {
  it('are remembered', () => {
    expect(getChosenSpeakers()).toEqual([]);
    setChosenSpeakers(['Kitchen']);
    expect(getChosenSpeakers()).toEqual(['Kitchen']);
  });

  it('ignore anything malformed in storage', () => {
    localStorage.setItem('maxmix.airplaySpeakers', '{');
    expect(getChosenSpeakers()).toEqual([]);
    localStorage.setItem('maxmix.airplaySpeakers', '["Kitchen", 3]');
    expect(getChosenSpeakers()).toEqual(['Kitchen']);
    localStorage.setItem('maxmix.airplaySpeakers', '{"a": 1}');
    expect(getChosenSpeakers()).toEqual([]);
  });
});
