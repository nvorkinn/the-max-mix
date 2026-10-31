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

beforeEach(async () => {
  const saved = await vi.importActual<typeof import('../audio/airplay')>('../audio/airplay');
  localStorage.clear();
  saved.setChosenSpeakers(['Kitchen']);
  for (const mock of Object.values(airplay)) mock.mockReset();
  airplay.listAudioOutputs.mockResolvedValue(['Kitchen', 'Lounge']);
  airplay.getChosenSpeakers.mockImplementation(saved.getChosenSpeakers);
  airplay.setChosenSpeakers.mockImplementation(saved.setChosenSpeakers);
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
    expect(screen.getByRole('button', { name: /Kitchen/ })).toHaveTextContent('Selected');
    expect(screen.getByRole('button', { name: /Kitchen/ })).toHaveTextContent('Available on this network');
    expect(screen.queryByText('Playing here')).not.toBeInTheDocument();
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
    expect(kitchen).toHaveTextContent('Selected');
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
    const kitchen = screen.getByRole('button', { name: /Kitchen/ });
    expect(kitchen).toHaveTextContent('Selected');
    expect(kitchen).toHaveTextContent('Availability unknown');
    expect(kitchen).not.toHaveTextContent('Not on the network');
  });

  it('cannot route before the tablet player is ready', async () => {
    render(<AirPlaySpeakerList isPlayerReady={false} />);
    const lounge = await screen.findByRole('button', { name: /Lounge/ });
    expect(lounge).toBeDisabled();
    await userEvent.click(lounge);
    expect(airplay.setChosenSpeakers).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/Play in this browser/);
    expect(screen.getByRole('button', { name: /Kitchen/ })).toHaveTextContent('Selected');
    expect(screen.queryByText('Playing here')).not.toBeInTheDocument();
    expect(airplay.routeAudio).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', ['Lounge']],
    ['available', ['Kitchen', 'Lounge']]
  ])('removes an %s saved speaker while unready and remembers it when reopened without routing', async (_, outputs) => {
    airplay.listAudioOutputs.mockResolvedValue(outputs);
    const { unmount } = render(<AirPlaySpeakerList isPlayerReady={false} />);
    await screen.findByRole('button', { name: /Lounge/ });
    const kitchen = screen.getByRole('button', { name: /Kitchen/ });
    expect(kitchen).toBeEnabled();
    expect(kitchen).toHaveTextContent('Selected');
    expect(kitchen).toHaveTextContent(outputs.includes('Kitchen') ? 'Available on this network' : 'Not on the network');
    await userEvent.click(kitchen);
    expect(airplay.setChosenSpeakers).toHaveBeenCalledExactlyOnceWith([]);
    expect(localStorage.getItem('maxmix.airplaySpeakers')).toBe('[]');
    unmount();
    render(<AirPlaySpeakerList isPlayerReady />);
    await screen.findByRole('button', { name: /Lounge/ });
    expect(screen.queryByRole('button', { name: /Kitchen/, pressed: true })).not.toBeInTheDocument();
    expect(Boolean(screen.queryByRole('button', { name: /Kitchen/ }))).toBe(outputs.includes('Kitchen'));
    expect(airplay.routeAudio).not.toHaveBeenCalled();
  });

  it('routes back to the Pi output when the last saved speaker is removed with a ready player', async () => {
    render(<AirPlaySpeakerList isPlayerReady />);
    await userEvent.click(await screen.findByRole('button', { name: /Kitchen/ }));
    expect(airplay.setChosenSpeakers).toHaveBeenCalledExactlyOnceWith([]);
    expect(airplay.routeAudio).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('removes only the chosen speaker without routing the remaining selection while unready', async () => {
    localStorage.setItem('maxmix.airplaySpeakers', '["Kitchen","Lounge"]');
    render(<AirPlaySpeakerList isPlayerReady={false} />);
    await userEvent.click(await screen.findByRole('button', { name: /Kitchen/ }));
    expect(airplay.setChosenSpeakers).toHaveBeenCalledExactlyOnceWith(['Lounge']);
    expect(screen.getByRole('button', { name: /Lounge/ })).toHaveTextContent('Selected');
    expect(screen.getByRole('button', { name: /Kitchen/ })).toBeDisabled();
    expect(airplay.routeAudio).not.toHaveBeenCalled();
  });

  it('can clear a saved speaker before discovery finishes without confirming absence or routing', async () => {
    airplay.listAudioOutputs.mockImplementation(() => new Promise(() => {}));
    render(<AirPlaySpeakerList isPlayerReady={false} />);
    const kitchen = screen.getByRole('button', { name: /Kitchen/ });
    expect(kitchen).toHaveTextContent('Checking availability');
    expect(kitchen).not.toHaveTextContent('Not on the network');
    await userEvent.click(kitchen);
    expect(airplay.setChosenSpeakers).toHaveBeenCalledExactlyOnceWith([]);
    expect(airplay.routeAudio).not.toHaveBeenCalled();
  });

  it('does not report a saved speaker as absent while discovery is pending', () => {
    airplay.listAudioOutputs.mockImplementation(() => new Promise(() => {}));
    render(<AirPlaySpeakerList isPlayerReady />);
    const kitchen = screen.getByRole('button', { name: /Kitchen/ });
    expect(kitchen).toHaveTextContent('Selected');
    expect(kitchen).toHaveTextContent('Checking availability');
    expect(kitchen).not.toHaveTextContent('Not on the network');
  });
});
