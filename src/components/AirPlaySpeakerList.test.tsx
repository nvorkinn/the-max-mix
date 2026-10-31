import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '../test/user';
import AirPlaySpeakerList from './AirPlaySpeakerList';

const airplay = vi.hoisted(() => ({ getAirPlayStatus: vi.fn(), setAirPlaySpeakers: vi.fn() }));
vi.mock('../audio/airplay', () => airplay);

const kitchen = { id: 'raop_sink.kitchen', name: 'Kitchen', selected: true };
const lounge = { id: 'raop_sink.lounge', name: 'Lounge', selected: false };
const status = { speakers: [kitchen, lounge], selected: [kitchen.id], playing: true };

beforeEach(() => {
  airplay.getAirPlayStatus.mockReset().mockResolvedValue(status);
  airplay.setAirPlaySpeakers.mockReset();
});

describe('AirPlaySpeakerList', () => {
  it('lists the speakers and marks the chosen ones', async () => {
    render(<AirPlaySpeakerList isPlayerReady />);
    expect(await screen.findByRole('button', { name: /Kitchen/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Lounge/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('adds and removes speakers', async () => {
    const both = {
      speakers: [kitchen, { ...lounge, selected: true }],
      selected: [kitchen.id, lounge.id],
      playing: true
    };
    airplay.setAirPlaySpeakers.mockResolvedValue(both);
    render(<AirPlaySpeakerList isPlayerReady />);
    await userEvent.click(await screen.findByRole('button', { name: /Lounge/ }));
    expect(airplay.setAirPlaySpeakers).toHaveBeenCalledWith([kitchen.id, lounge.id]);
    await waitFor(() => expect(screen.getByRole('button', { name: /Lounge/ })).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(screen.getByRole('button', { name: /Kitchen/ }));
    expect(airplay.setAirPlaySpeakers).toHaveBeenLastCalledWith([lounge.id]);
  });

  it('shows why a change failed', async () => {
    airplay.setAirPlaySpeakers.mockRejectedValue(new Error('AirPlay: PipeWire is not available.'));
    render(<AirPlaySpeakerList isPlayerReady />);
    await userEvent.click(await screen.findByRole('button', { name: /Lounge/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('PipeWire is not available');
  });

  it('shows a service that cannot be reached, then recovers on refresh', async () => {
    airplay.getAirPlayStatus.mockRejectedValueOnce(new Error('The AirPlay service on this device is not running.'));
    render(<AirPlaySpeakerList isPlayerReady />);
    expect(await screen.findByRole('alert')).toHaveTextContent('not running');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh AirPlay speakers' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('says it is still looking when no speaker is found', async () => {
    airplay.getAirPlayStatus.mockResolvedValue({ speakers: [], selected: [], playing: false });
    render(<AirPlaySpeakerList isPlayerReady />);
    expect(await screen.findByText(/Looking for AirPlay speakers/)).toBeInTheDocument();
  });

  it('cannot route before the tablet player is ready', async () => {
    render(<AirPlaySpeakerList isPlayerReady={false} />);
    expect(await screen.findByRole('button', { name: /Lounge/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/Play in this browser/);
  });

  it('reads the list again every few seconds', async () => {
    vi.useFakeTimers();
    try {
      render(<AirPlaySpeakerList isPlayerReady />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(airplay.getAirPlayStatus).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
