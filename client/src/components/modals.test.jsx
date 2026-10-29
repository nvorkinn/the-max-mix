import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '../test/user.js';

const api = vi.hoisted(() => ({ requestJSON: vi.fn() }));
vi.mock('../utils/api.js', () => api);

import QRCodeModalFull from './QRCodeModal.jsx';
import JamSettingsModalFull from './JamSettingsModal.jsx';
import SettingsModalFull from './SettingsModal.jsx';
import SpeakerSelectorModalFull from './SpeakerSelectorModal.jsx';
import { partialProps } from '../test/partialProps.js';
import { defined } from '../test/defined.js';

const QRCodeModal = partialProps(QRCodeModalFull);
const JamSettingsModal = partialProps(JamSettingsModalFull);
const SettingsModal = partialProps(SettingsModalFull);
const SpeakerSelectorModal = partialProps(SpeakerSelectorModalFull);

describe('QRCodeModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<QRCodeModal isOpen={false} remoteUrl="http://x" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the remote url as a link and closes on request', async () => {
    const onClose = vi.fn();
    const { container } = render(<QRCodeModal isOpen onClose={onClose} remoteUrl="http://192.168.1.5/remote" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'http://192.168.1.5/remote');
    expect(container.querySelector('svg[role="img"], svg')).toBeTruthy();
    await userEvent.click(defined(screen.getAllByRole('button')[0]));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('JamSettingsModal', () => {
  it('is hidden when closed and closable when open', async () => {
    const { rerender } = render(<JamSettingsModal isOpen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const onClose = vi.fn();
    rerender(<JamSettingsModal isOpen onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: /start a jam/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /close jam/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('SettingsModal', () => {
  const base = { isOpen: true, onClose: vi.fn(), onThemeChange: vi.fn() };

  it('renders nothing when closed', () => {
    render(<SettingsModal {...base} isOpen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('marks the current theme and reports theme changes', async () => {
    const onThemeChange = vi.fn();
    render(<SettingsModal {...base} onThemeChange={onThemeChange} currentTheme="minimal" authInfo={{}} />);
    expect(screen.getByRole('button', { name: /paper/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /studio/i })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: /studio/i }));
    expect(onThemeChange).toHaveBeenCalledWith('neon');
  });

  it('does not throw when no theme handler is given', async () => {
    render(<SettingsModal isOpen onClose={() => {}} authInfo={{}} />);
    await userEvent.click(screen.getByRole('button', { name: /paper/i }));
  });

  it('closes via the close button', async () => {
    const onClose = vi.fn();
    render(<SettingsModal {...base} onClose={onClose} authInfo={{}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    ['demo mode', { demoMode: true, configured: true }, /simulated/i, null],
    ['unconfigured', { configured: false }, /configure the spotify client id/i, null],
    ['signed out', { configured: true }, /sign in with a spotify premium/i, 'Log in with Spotify'],
    [
      'signed in',
      { configured: true, authenticated: true, playbackMode: 'remote' },
      /playback mode: remote/i,
      'Re-authenticate with Spotify'
    ]
  ])('explains the %s state', (_, authInfo, message, loginLabel) => {
    render(<SettingsModal {...base} authInfo={authInfo} />);
    expect(screen.getByText(message)).toBeInTheDocument();
    if (loginLabel) {
      expect(screen.getByRole('link', { name: loginLabel })).toHaveAttribute('href', '/api/auth/login');
    } else {
      expect(screen.queryByRole('link')).toBeNull();
    }
  });

  it('shows connected status only when authenticated', () => {
    const { rerender } = render(<SettingsModal {...base} authInfo={{ authenticated: true }} />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
    rerender(<SettingsModal {...base} authInfo={{ demoMode: true }} />);
    expect(screen.getByText('Demo mode')).toBeInTheDocument();
    rerender(<SettingsModal {...base} authInfo={{}} />);
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });
});

describe('SpeakerSelectorModal', () => {
  const devices = [
    { id: 'a', name: 'Kitchen', type: 'Speaker', volume_percent: 40, is_active: true },
    { id: 'b', name: 'Locked', is_restricted: true },
    { name: 'No id' }
  ];
  beforeEach(() => {
    api.requestJSON.mockReset();
  });

  it('does not fetch while closed', () => {
    render(<SpeakerSelectorModal isOpen={false} />);
    expect(api.requestJSON).not.toHaveBeenCalled();
  });

  it('lists devices and disables restricted or id-less ones', async () => {
    api.requestJSON.mockResolvedValue({ devices });
    render(<SpeakerSelectorModal isOpen onClose={() => {}} onSelectSpeaker={vi.fn()} />);
    const kitchen = await screen.findByRole('button', { name: /Kitchen/ });
    expect(kitchen).toBeEnabled();
    expect(kitchen).toHaveTextContent('Speaker / 40% volume');
    expect(kitchen).toHaveTextContent('Active');
    expect(screen.getByRole('button', { name: /Locked/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /No id/ })).toBeDisabled();
    expect(screen.getByText('Playback control restricted')).toBeInTheDocument();
  });

  it('shows an empty state when there are no devices', async () => {
    api.requestJSON.mockResolvedValue({});
    render(<SpeakerSelectorModal isOpen />);
    expect(await screen.findByText(/No available devices/)).toBeInTheDocument();
  });

  it('shows the error and clears devices when loading fails', async () => {
    api.requestJSON.mockImplementation(async () => {
      throw new Error('Spotify down');
    });
    render(<SpeakerSelectorModal isOpen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Spotify down');
    expect(screen.queryByText(/No available devices/)).toBeNull();
  });

  it('selects a device then refreshes the list', async () => {
    api.requestJSON.mockResolvedValue({ devices });
    const onSelectSpeaker = vi.fn().mockResolvedValue(undefined);
    render(<SpeakerSelectorModal isOpen onSelectSpeaker={onSelectSpeaker} />);
    await userEvent.click(await screen.findByRole('button', { name: /Kitchen/ }));
    expect(onSelectSpeaker).toHaveBeenCalledWith('a');
    await waitFor(() => expect(api.requestJSON).toHaveBeenCalledTimes(2));
  });

  it('surfaces a failed selection', async () => {
    api.requestJSON.mockResolvedValue({ devices });
    const onSelectSpeaker = vi.fn(async () => {
      throw new Error('Transfer failed');
    });
    render(<SpeakerSelectorModal isOpen onSelectSpeaker={onSelectSpeaker} />);
    await userEvent.click(await screen.findByRole('button', { name: /Kitchen/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Transfer failed');
  });

  it('offers this tablet only when it is not already listed', async () => {
    api.requestJSON.mockResolvedValue({ devices });
    const onSelectSpeaker = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<SpeakerSelectorModal isOpen browserDeviceId="a" onSelectSpeaker={onSelectSpeaker} />);
    await screen.findByRole('button', { name: /Kitchen/ });
    expect(screen.queryByRole('button', { name: 'Use this tablet' })).toBeNull();

    rerender(<SpeakerSelectorModal isOpen browserDeviceId="web-1" onSelectSpeaker={onSelectSpeaker} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Use this tablet' }));
    expect(onSelectSpeaker).toHaveBeenCalledWith('web-1');
  });

  it('refreshes on demand and closes', async () => {
    api.requestJSON.mockResolvedValue({ devices: [] });
    const onClose = vi.fn();
    render(<SpeakerSelectorModal isOpen onClose={onClose} isDemoMode />);
    await screen.findByText(/No available devices/);
    expect(screen.getByText(/Simulated device/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh devices' }));
    await waitFor(() => expect(api.requestJSON).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: 'Close speakers' }));
    expect(onClose).toHaveBeenCalled();
  });
});
