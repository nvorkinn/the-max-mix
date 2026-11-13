import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { parseBluetoothReport } from '../utils/bluetoothMonitor';
import BluetoothDebug from './BluetoothDebug';

const audio = vi.hoisted(() => ({ scanBluetoothSpeakers: vi.fn(() => Promise.resolve([])) }));
vi.mock('../audio/bluetooth', () => audio);

const NOW = Date.now();
const REPORT = {
  adapter: {
    address: 'B8:27:EB:00:00:00',
    name: 'the-max-mix',
    powered: true,
    discoverable: false,
    pairable: true,
    discovering: true
  },
  devices: [
    {
      address: 'AA:BB:CC:DD:EE:01',
      name: 'Nikolai’s iPhone',
      addressType: 'public',
      icon: 'phone',
      paired: true,
      bonded: true,
      trusted: false,
      connected: false,
      rssi: -61,
      lastSeen: NOW - 12_000
    }
  ],
  nearby: 4,
  pairing: { state: 'waiting', secondsLeft: 95 },
  verbose: false,
  log: [
    { id: 1, time: NOW - 20_000, message: 'Watching B8:27:EB:00:00:00: powered on, 1 paired' },
    { id: 2, time: NOW - 12_000, message: 'Heard Nikolai’s iPhone (AA:BB:CC:DD:EE:01), -61 dBm' }
  ]
};

const json = (body: unknown, status = 200) =>
  Promise.resolve(Response.json(body, { status, headers: { 'Content-Type': 'application/json' } }));

function open() {
  const details = screen.getByText('Bluetooth').closest('details');
  if (!details) throw new Error('no section');
  details.open = true;
  fireEvent(details, new Event('toggle'));
}

describe('BluetoothDebug', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks the Pi nothing until the section is opened, then shows its adapter, devices and log', async () => {
    fetchMock.mockImplementation(() => json(REPORT));
    render(<BluetoothDebug />);
    expect(fetchMock).not.toHaveBeenCalled();
    open();
    expect(await screen.findByText('Nikolai’s iPhone')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/bluetooth/monitor', expect.anything());
    expect(screen.getByText('Unpaired nearby').nextSibling).toHaveTextContent('4');
    expect(screen.getByText('Scanning').nextSibling).toHaveTextContent('Yes');
    expect(screen.getByText('Pairing').nextSibling).toHaveTextContent('Waiting for a phone, 95 s left');
    expect(screen.getByText('-61 dBm')).toBeInTheDocument();
    expect(screen.getByText('Paired, bonded')).toBeInTheDocument();
    expect(screen.getByText(/^1[12] s ago$/)).toBeInTheDocument();
    const lines = screen.getByRole('list', { name: 'Bluetooth log, newest first' });
    expect(lines.firstChild).toHaveTextContent('Heard Nikolai’s iPhone');
  });

  it('says why when the Pi has no Bluetooth', async () => {
    fetchMock.mockImplementation(() => json({ error: 'Bluetooth is not available on this device.' }, 503));
    render(<BluetoothDebug />);
    open();
    expect(await screen.findByText('Bluetooth is not available on this device.')).toBeInTheDocument();
  });

  it('switches logging of unpaired devices, and scans', async () => {
    fetchMock.mockImplementation((_url, init) =>
      init?.method === 'POST' ? Promise.resolve(new Response(null, { status: 204 })) : json(REPORT)
    );
    render(<BluetoothDebug />);
    open();
    const verbose = await screen.findByRole('checkbox', { name: 'Log unpaired devices' });
    fireEvent.click(verbose);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:7341/bluetooth/monitor',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ verbose: true }) })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Scan for 8 s' }));
    expect(audio.scanBluetoothSpeakers).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Pair my phone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop pairing' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.map(([url]) => (typeof url === 'string' ? url : ''))).toEqual(
        expect.arrayContaining([
          'http://127.0.0.1:7341/bluetooth/pair-phone',
          'http://127.0.0.1:7341/bluetooth/pair-phone/stop'
        ])
      )
    );
  });

  it('reads an answer with missing or odd fields as empty', () => {
    expect(parseBluetoothReport({ devices: [{}], log: [{ id: 1, time: 'x', message: 'y' }], nearby: 'many' })).toEqual({
      adapter: null,
      pairing: { state: 'idle' },
      devices: [
        {
          address: '',
          name: '',
          addressType: '',
          icon: '',
          paired: false,
          bonded: false,
          trusted: false,
          connected: false,
          rssi: null,
          lastSeen: null
        }
      ],
      nearby: 0,
      verbose: false,
      log: []
    });
  });
});

describe('parseBluetoothReport pairing', () => {
  it('reads each pairing state', () => {
    const pairing = (value: unknown) => parseBluetoothReport({ pairing: value }).pairing;
    expect(pairing({ state: 'paired', phone: { name: 'iPhone', address: 'A', pairedAt: 1 } })).toEqual({
      state: 'paired',
      name: 'iPhone',
      address: 'A'
    });
    expect(pairing({ state: 'failed', error: 'No phone paired within 2 minutes.' })).toEqual({
      state: 'failed',
      error: 'No phone paired within 2 minutes.'
    });
    expect(pairing({ state: 'odd' })).toEqual({ state: 'idle' });
  });
});
