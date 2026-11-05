import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  connectBluetoothSpeaker,
  forgetBluetoothSpeaker,
  listBluetoothSpeakers,
  scanBluetoothSpeakers
} from './bluetooth';

const speaker = { address: 'AA:BB:CC:DD:EE:FF', name: 'Kitchen speaker', paired: true, connected: false };

describe('audio/bluetooth', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const call = (index = 0) => ({
    url: String(fetchMock.mock.calls[index]?.[0]),
    init: (fetchMock.mock.calls[index]?.[1] ?? {}) as RequestInit
  });

  it('lists the speakers the kiosk knows, leaving out anything malformed', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ devices: [speaker, { address: 'x' }, null, { address: 'B', name: 'Bare' }] })
    );
    await expect(listBluetoothSpeakers()).resolves.toEqual([
      speaker,
      { address: 'B', name: 'Bare', paired: false, connected: false }
    ]);
    expect(call().url).toBe('http://127.0.0.1:7341/bluetooth/devices');
    fetchMock.mockResolvedValueOnce(Response.json({}));
    await expect(listBluetoothSpeakers()).resolves.toEqual([]);
  });

  it('scans with a POST', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ devices: [speaker] }));
    await expect(scanBluetoothSpeakers()).resolves.toEqual([speaker]);
    expect(call().url).toBe('http://127.0.0.1:7341/bluetooth/scan');
    expect(call().init.method).toBe('POST');
  });

  it('connects a speaker, and rejects with the kiosk’s message when it could not', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
    await expect(connectBluetoothSpeaker(speaker.address)).resolves.toBeUndefined();
    expect(call().url).toBe('http://127.0.0.1:7341/bluetooth/connect');
    const { init } = call();
    expect(JSON.parse(init.body as string)).toEqual({ address: speaker.address });

    fetchMock.mockResolvedValueOnce(Response.json({ ok: false, error: 'Could not pair.' }));
    await expect(connectBluetoothSpeaker(speaker.address)).rejects.toThrow('Could not pair.');
    fetchMock.mockResolvedValueOnce(Response.json({ ok: false }));
    await expect(connectBluetoothSpeaker(speaker.address)).rejects.toThrow('Could not connect.');
  });

  it('reports why the kiosk refused, or that it did not answer', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: 'Bluetooth is not available on this device.' }, { status: 503 })
    );
    await expect(listBluetoothSpeakers()).rejects.toThrow('Bluetooth is not available on this device.');
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    await expect(listBluetoothSpeakers()).rejects.toThrow('The kiosk could not do that (500).');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(listBluetoothSpeakers()).rejects.toThrow('The kiosk’s audio service did not answer: Failed to fetch');
  });

  it('forgets a speaker, even when the answer has no body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(forgetBluetoothSpeaker(speaker.address)).resolves.toBeUndefined();
    expect(call().url).toBe('http://127.0.0.1:7341/bluetooth/remove');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(forgetBluetoothSpeaker(speaker.address)).resolves.toBeUndefined();
  });
});
