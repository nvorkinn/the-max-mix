import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AUDIO_SERVICE_UNREACHABLE,
  AUDIO_SERVICE_URL,
  getAirPlayStatus,
  parseStatus,
  setAirPlaySpeakers
} from './airplay';

const reply = (body: unknown, status = 200) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(body, { status }));

afterEach(() => vi.unstubAllGlobals());

describe('parseStatus', () => {
  it('keeps well-formed speakers and drops the rest', () => {
    expect(
      parseStatus({
        speakers: [{ id: 'raop_sink.k', name: 'Kitchen', selected: true }, { id: 'raop_sink.x' }, { name: 'no id' }, 3],
        selected: ['raop_sink.k', 7],
        playing: true
      })
    ).toEqual({
      speakers: [
        { id: 'raop_sink.k', name: 'Kitchen', selected: true },
        { id: 'raop_sink.x', name: 'raop_sink.x', selected: false }
      ],
      selected: ['raop_sink.k'],
      playing: true
    });
  });

  it('tolerates missing lists and rejects what is not an object', () => {
    expect(parseStatus({})).toEqual({ speakers: [], selected: [], playing: false });
    expect(() => parseStatus(null)).toThrow(/unexpected reply/);
  });
});

describe('the audio service client', () => {
  it('reads the status from the loopback service', async () => {
    const fetchMock = reply({ speakers: [], selected: [], playing: false });
    await expect(getAirPlayStatus()).resolves.toEqual({ speakers: [], selected: [], playing: false });
    expect(fetchMock).toHaveBeenCalledWith(AUDIO_SERVICE_URL, expect.objectContaining({ method: 'GET' }));
    expect(AUDIO_SERVICE_URL).toBe('http://127.0.0.1:47878/v1/airplay');
  });

  it('sends the chosen speakers as JSON', async () => {
    const fetchMock = reply({ speakers: [], selected: ['a'], playing: true });
    await expect(setAirPlaySpeakers(['a'])).resolves.toMatchObject({ selected: ['a'] });
    expect(fetchMock).toHaveBeenCalledWith(
      AUDIO_SERVICE_URL,
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{"speakers":["a"]}'
      })
    );
  });

  it('explains a service that is not running', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(getAirPlayStatus()).rejects.toThrow(AUDIO_SERVICE_UNREACHABLE);
  });

  it('passes on the service error, or the status without one', async () => {
    reply({ error: 'PipeWire is not available' }, 503);
    await expect(getAirPlayStatus()).rejects.toThrow('AirPlay: PipeWire is not available.');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('oops', { status: 500 }));
    await expect(getAirPlayStatus()).rejects.toThrow('AirPlay: HTTP 500.');
  });
});
