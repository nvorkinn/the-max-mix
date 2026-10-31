import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '../test/user';
import AirPlaySpeakerList from './AirPlaySpeakerList';

const airplay = vi.hoisted(() => ({
  listAudioOutputs: vi.fn(),
  watchAudioOutputs: vi.fn(),
  routeAudio: vi.fn(),
  getChosenSpeakers: vi.fn(),
  setChosenSpeakers: vi.fn()
}));
vi.mock('../audio/airplay', () => airplay);

let onDeviceChange: () => void = () => {
  // Replaced when the list subscribes.
};

beforeEach(() => {
  for (const mock of Object.values(airplay)) mock.mockReset();
  airplay.listAudioOutputs.mockResolvedValue(['Kitchen', 'Lounge']);
  airplay.getChosenSpeakers.mockReturnValue(['Kitchen']);
  airplay.watchAudioOutputs.mockImplementation((listener: () => void) => {
    onDeviceChange = listener;
    return vi.fn();
  });
});

describe('AirPlaySpeakerList', () => {
  it('lists the outputs and marks the chosen ones', async () => {
    render(<AirPlaySpeakerList isPlayerReady />);
    expect(await screen.findByRole('button', { name: /Lounge/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Kitchen/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('adds and removes speakers, remembering and routing each change', async () => {
    render(<AirPlaySpeakerList isPlayerReady />);
    await userEvent.click(await screen.findByRole('button', { name: /Lounge/ }));
    expect(airplay.setChosenSpeakers).toHaveBeenLastCalledWith(['Kitchen', 'Lounge']);
    expect(airplay.routeAudio).toHaveBeenLastCalledWith(['Kitchen', 'Lounge']);
    await userEvent.click(screen.getByRole('button', { name: /Kitchen/ }));
    expect(airplay.routeAudio).toHaveBeenLastCalledWith(['Lounge']);
  });

  it('keeps a chosen speaker that left the network, so it can be removed', async () => {
    airplay.listAudioOutputs.mockResolvedValue(['Lounge']);
    render(<AirPlaySpeakerList isPlayerReady />);
    const kitchen = await screen.findByRole('button', { name: /Kitchen/ });
    expect(kitchen).toHaveTextContent('Not on the network');
  });

  it('reads the outputs again when they change', async () => {
    airplay.listAudioOutputs.mockResolvedValueOnce([]);
    airplay.getChosenSpeakers.mockReturnValue([]);
    render(<AirPlaySpeakerList isPlayerReady />);
    expect(await screen.findByText(/Looking for AirPlay speakers/)).toBeInTheDocument();
    await act(async () => {
      onDeviceChange();
      await Promise.resolve();
    });
    expect(await screen.findByRole('button', { name: /Lounge/ })).toBeInTheDocument();
  });

  it('shows why the outputs could not be read', async () => {
    airplay.listAudioOutputs.mockRejectedValue(new Error('Not allowed'));
    render(<AirPlaySpeakerList isPlayerReady />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed');
  });

  it('cannot route before the tablet player is ready', async () => {
    render(<AirPlaySpeakerList isPlayerReady={false} />);
    expect(await screen.findByRole('button', { name: /Lounge/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/Play in this browser/);
  });
});
