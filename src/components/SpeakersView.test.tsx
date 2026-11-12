import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { AudioOutput } from '../audio/airplay';
import { tabletChoice } from '../speakers/selection';
import type { SpeakerSelection } from '../speakers/useSpeakerSelection';
import SpeakersView from './SpeakersView';

const bluetooth = vi.hoisted(() => ({
  listBluetoothSpeakers: vi.fn(),
  scanBluetoothSpeakers: vi.fn(),
  connectBluetoothSpeaker: vi.fn(),
  forgetBluetoothSpeaker: vi.fn()
}));
const setSpeakerVolume = vi.hoisted(() => vi.fn());
vi.mock('../audio/bluetooth', () => bluetooth);
vi.mock('../audio/airplay', () => ({ setSpeakerVolume }));

const kitchen: AudioOutput = {
  id: 'raop_sink.Kitchen.local.7000',
  name: 'Kitchen',
  kind: 'airplay',
  volume: 40,
  linked: true
};
const boom: AudioOutput = {
  id: 'bluez_output.00_11_22_AA_BB_CC.1',
  name: 'Boom',
  kind: 'bluetooth',
  address: '00:11:22:AA:BB:CC',
  volume: null,
  linked: false
};

function selection(overrides: Partial<SpeakerSelection> = {}): SpeakerSelection {
  const confirmed = tabletChoice([kitchen.id]);
  return {
    connectDevices: [
      { id: 'dev1', name: 'Soundbar', remembered: false },
      { id: null, name: 'Hidden', remembered: false },
      { id: 'dev2', name: 'Locked', is_restricted: true, remembered: false }
    ],
    sonosRooms: ['Bath'],
    outputs: [boom, kitchen],
    confirmed,
    shown: confirmed,
    dirty: false,
    saving: false,
    error: null,
    toggle: vi.fn(),
    save: vi.fn(),
    refresh: vi.fn(),
    tabletPlaying: true,
    playingLabel: 'Kitchen',
    readOutputs: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

const flush = () => act(async () => {});

beforeEach(() => {
  for (const mock of Object.values(bluetooth)) mock.mockReset();
  bluetooth.listBluetoothSpeakers.mockResolvedValue([
    { address: '00:11:22:AA:BB:CC', name: 'Boom', paired: true, connected: true },
    { address: '11:22:33:44:55:66', name: 'Old', paired: true, connected: false },
    { address: '22:33:44:55:66:77', name: 'New', paired: false, connected: false }
  ]);
  bluetooth.connectBluetoothSpeaker.mockResolvedValue(undefined);
  bluetooth.forgetBluetoothSpeaker.mockResolvedValue(undefined);
  setSpeakerVolume.mockReset();
});

describe('SpeakersView', () => {
  it('lists this tablet, Connect devices and Sonos rooms, greying out the ones that cannot be picked', () => {
    const given = selection();
    render(<SpeakersView selection={given} onKiosk browserDeviceId="web-1" />);
    const tablet = screen.getByRole('checkbox', { name: 'This tablet' });
    expect(tablet).toBeChecked();
    expect(screen.getByText('Playing')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Hidden' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Locked' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bath' }));
    expect(given.toggle).toHaveBeenCalledWith('sonos:Bath');
    // Only the selector does anything: the name is not a button.
    fireEvent.click(screen.getByText('Soundbar'));
    expect(given.toggle).toHaveBeenCalledTimes(1);
  });

  it('has no tabs away from the kiosk', () => {
    render(<SpeakersView selection={selection()} onKiosk={false} browserDeviceId="web-1" />);
    expect(screen.queryByRole('group', { name: 'Kind of speaker' })).not.toBeInTheDocument();
  });

  it('shows every output on the AirPlay tab, and a volume slider in each playing one on request', () => {
    render(<SpeakersView selection={selection()} onKiosk browserDeviceId="web-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'AirPlay' }));
    expect(screen.getByRole('checkbox', { name: 'Kitchen' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Boom' })).not.toBeChecked();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Volumes' }));
    const slider = screen.getByRole('slider', { name: 'Kitchen volume' });
    expect(slider).toHaveValue('40');
    expect(screen.queryByRole('slider', { name: 'Boom volume' })).not.toBeInTheDocument();
    fireEvent.change(slider, { target: { value: '55' } });
    expect(setSpeakerVolume).toHaveBeenCalledWith(kitchen, 55);
    expect(slider).toHaveValue('55');
  });

  it('pairs, connects and forgets Bluetooth speakers, and ticks a connected one by its output', async () => {
    const given = selection();
    render(<SpeakersView selection={given} onKiosk browserDeviceId="web-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Bluetooth' }));
    await flush();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Boom' }));
    expect(given.toggle).toHaveBeenCalledWith(`output:${boom.id}`);
    // A speaker that is not connected has no output to send the sound to yet.
    expect(screen.getByRole('checkbox', { name: 'Old' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Connect Boom' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Disconnect/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Old' }));
    await flush();
    expect(bluetooth.connectBluetoothSpeaker).toHaveBeenCalledWith('11:22:33:44:55:66');
    expect(given.readOutputs).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Pair New' }));
    await flush();
    expect(bluetooth.connectBluetoothSpeaker).toHaveBeenCalledWith('22:33:44:55:66:77');
    expect(screen.queryByRole('button', { name: 'Forget New' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Forget Old' }));
    await flush();
    expect(bluetooth.forgetBluetoothSpeaker).toHaveBeenCalledWith('11:22:33:44:55:66');
    bluetooth.scanBluetoothSpeakers.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Find speakers' }));
    await flush();
    expect(bluetooth.scanBluetoothSpeakers).toHaveBeenCalled();
  });

  it('shows a failed Save in the list, and Connecting… on ticked speakers while it saves', () => {
    const shown = tabletChoice([kitchen.id, boom.id]);
    const { rerender } = render(
      <SpeakersView selection={selection({ shown, saving: true })} onKiosk browserDeviceId="web-1" />
    );
    fireEvent.click(screen.getByRole('button', { name: 'AirPlay' }));
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Kitchen' })).toBeDisabled();
    rerender(
      <SpeakersView
        selection={selection({ shown, error: 'The speakers did not take the change.' })}
        onKiosk
        browserDeviceId="web-1"
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The speakers did not take the change.');
  });
});
