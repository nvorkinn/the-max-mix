import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '../../test/user';
import { LanguageContext } from '../../i18n/language';
import WifiSettings from './WifiSettings';
import { SETUP_POLL_MS } from './WifiPhoneDialogs';

const wifi = vi.hoisted(() => ({
  scanWifi: vi.fn(),
  startHotspot: vi.fn(),
  stopHotspot: vi.fn(),
  hotspotStatus: vi.fn()
}));
vi.mock('../../utils/kioskWifi', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils/kioskWifi')>()),
  ...wifi
}));

const HOTSPOT = { ssid: 'THE MAX MIX setup', password: 'ABCDE23456', url: 'http://10.42.0.1/' };
interface RenderOptions {
  onJoined?: () => void;
  language?: 'en' | 'nb';
  onPhoneSetup?: (isActive: boolean) => void;
}

const poll = () => act(() => vi.advanceTimersByTimeAsync(SETUP_POLL_MS));

function renderWifi({ onJoined = vi.fn(), language = 'en', onPhoneSetup = vi.fn() }: RenderOptions = {}) {
  return render(
    <LanguageContext value={language}>
      <WifiSettings
        wifi={{ state: 'connected', ssid: 'Home', address: null }}
        onJoined={onJoined}
        onPhoneSetup={onPhoneSetup}
      />
    </LanguageContext>
  );
}

describe('Settings › Wi-Fi over the hotspot', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    wifi.scanWifi.mockResolvedValue({ networks: [] });
    wifi.startHotspot.mockResolvedValue({ ok: true, info: HOTSPOT });
    wifi.stopHotspot.mockResolvedValue(undefined);
    wifi.hotspotStatus.mockResolvedValue({ state: 'waiting' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('shows step 1 (the code that joins the hotspot), then only step 2 (the code that opens its page) once a phone is on it, and closes once the kiosk joined the network the phone chose', async () => {
    const onJoined = vi.fn();
    const onPhoneSetup = vi.fn();
    renderWifi({ onJoined, onPhoneSetup });
    expect(onPhoneSetup).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Use your phone' }));
    // Settings stays up while the phone is used, however long nobody touches the screen.
    expect(onPhoneSetup).toHaveBeenLastCalledWith(true);
    const dialog = screen.getByRole('dialog', { name: 'Hotspot' });
    expect(within(dialog).getByText('Starting…')).toBeInTheDocument();
    expect(await within(dialog).findByTestId('hotspot-name')).toHaveTextContent('THE MAX MIX setup');
    expect(within(dialog).getByTestId('hotspot-password')).toHaveTextContent('ABCDE23456');
    expect(within(dialog).getByRole('img', { name: 'QR code that joins the hotspot' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('img', { name: 'QR code that opens the setup page' })).not.toBeInTheDocument();
    const steps = within(dialog).getAllByRole('listitem');
    expect(steps.map(step => step.getAttribute('aria-current'))).toEqual(['step', null]);
    expect(steps[0]).toHaveTextContent('Join the hotspot');
    expect(steps[1]).toHaveTextContent('Open the setup page');
    expect(within(dialog).queryByText('Waiting for your phone…')).not.toBeInTheDocument();

    wifi.hotspotStatus.mockResolvedValue({ state: 'connected' });
    await poll();
    expect(within(dialog).getByRole('img', { name: 'QR code that opens the setup page' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('img', { name: 'QR code that joins the hotspot' })).not.toBeInTheDocument();
    expect(steps.map(step => step.getAttribute('aria-current'))).toEqual([null, 'step']);
    expect(steps[0]).toHaveTextContent('Phone connected');
    expect(within(dialog).queryByTestId('hotspot-password')).not.toBeInTheDocument();

    wifi.hotspotStatus.mockResolvedValue({ state: 'joining', ssid: 'Home' });
    await poll();
    expect(within(dialog).getByTestId('hotspot-joining')).toHaveTextContent('Home');
    expect(within(dialog).queryByText('The phone chose a network. Joining it…')).not.toBeInTheDocument();
    wifi.hotspotStatus.mockResolvedValue({ state: 'joined' });
    await poll();
    expect(onJoined).toHaveBeenCalledOnce();
    expect(onPhoneSetup).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('dialog', { name: 'Hotspot' })).not.toBeInTheDocument();
    expect(wifi.stopHotspot).not.toHaveBeenCalled();
  });

  it('closes when the kiosk could not join, says why on the page, and looks for networks again', async () => {
    const onJoined = vi.fn();
    renderWifi({ onJoined });
    await userEvent.click(screen.getByRole('button', { name: 'Use your phone' }));
    const dialog = screen.getByRole('dialog', { name: 'Hotspot' });
    await within(dialog).findByTestId('hotspot-name');
    wifi.scanWifi.mockClear();
    wifi.hotspotStatus.mockResolvedValue({ state: 'failed', error: 'Could not join Home: Wrong password.' });
    await poll();
    expect(screen.queryByRole('dialog', { name: 'Hotspot' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not join Home: Wrong password.');
    expect(wifi.scanWifi).toHaveBeenCalledOnce();
    expect(onJoined).not.toHaveBeenCalled();
    wifi.hotspotStatus.mockClear();
    await poll();
    expect(wifi.hotspotStatus).not.toHaveBeenCalled();
    // It ended by itself, so there is nothing to stop.
    expect(wifi.stopHotspot).not.toHaveBeenCalled();
  });

  it('closes when the hotspot ended by itself', async () => {
    renderWifi();
    await userEvent.click(screen.getByRole('button', { name: 'Use your phone' }));
    await within(screen.getByRole('dialog', { name: 'Hotspot' })).findByTestId('hotspot-name');
    wifi.hotspotStatus.mockResolvedValue({ state: 'ended' });
    await poll();
    expect(screen.queryByRole('dialog', { name: 'Hotspot' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ends the hotspot on Back, then looks for networks again', async () => {
    let stopped: () => void = () => {};
    wifi.stopHotspot.mockImplementationOnce(() => new Promise<void>(resolve => (stopped = resolve)));
    renderWifi();
    expect(wifi.scanWifi).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Use your phone' }));
    const dialog = screen.getByRole('dialog', { name: 'Hotspot' });
    await within(dialog).findByTestId('hotspot-name');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(wifi.stopHotspot).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Hotspot' })).not.toBeInTheDocument();
    expect(screen.getByText('Looking for networks…')).toBeInTheDocument();
    expect(wifi.scanWifi).toHaveBeenCalledOnce();
    stopped();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(wifi.scanWifi).toHaveBeenCalledTimes(2);
  });

  it("says the kiosk's reason when the hotspot would not start", async () => {
    wifi.startHotspot.mockResolvedValue({ ok: false, error: 'There is no Wi-Fi adapter to make a hotspot with.' });
    renderWifi();
    await userEvent.click(screen.getByRole('button', { name: 'Use your phone' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('There is no Wi-Fi adapter to make a hotspot with.');
    expect(screen.queryByTestId('hotspot-name')).not.toBeInTheDocument();
  });

  it('ends a hotspot that only finished starting after the dialog closed', async () => {
    let started: (result: unknown) => void = () => {};
    wifi.startHotspot.mockImplementationOnce(() => new Promise(resolve => (started = resolve)));
    renderWifi();
    await userEvent.click(screen.getByRole('button', { name: 'Use your phone' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Hotspot' })).getByRole('button', { name: 'Back' })
    );
    expect(wifi.stopHotspot).toHaveBeenCalledOnce();
    started({ ok: true, info: HOTSPOT });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(wifi.stopHotspot).toHaveBeenCalledTimes(2);
  });
});
