import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '../../test/user';
import { LanguageContext } from '../../i18n/language';
import WifiSettings from './WifiSettings';
import type { WifiState } from './wifi';

const kiosk = vi.hoisted(() => ({
  scanWifi: vi.fn(),
  joinWifi: vi.fn(),
  hasCamera: vi.fn(),
  decodeQr: vi.fn()
}));
vi.mock('../../utils/kioskWifi', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils/kioskWifi')>()),
  scanWifi: kiosk.scanWifi,
  joinWifi: kiosk.joinWifi
}));
vi.mock('../../utils/kioskCamera', () => ({
  CAMERA_STREAM: 'http://kiosk.test/camera/stream',
  hasCamera: kiosk.hasCamera
}));
vi.mock('../../utils/qrDecode', () => ({ decodeQr: kiosk.decodeQr }));

const HOME: WifiState = { state: 'connected', ssid: 'Home', address: null };
const OFFLINE: WifiState = { state: 'disconnected', address: null };
const HOME_CODE = 'WIFI:T:WPA;S:Attic;P:battery staple;H:true;;';

/** Lets the dialog look at the camera's picture `times` times. */
const look = (times = 1) => act(() => vi.advanceTimersByTimeAsync(400 * times));

function renderWifi(wifi: WifiState = HOME, onJoined = vi.fn()) {
  render(
    <LanguageContext value="en">
      <WifiSettings wifi={wifi} onJoined={onJoined} />
    </LanguageContext>
  );
  return onJoined;
}

async function openScan() {
  await userEvent.click(await screen.findByRole('button', { name: 'Scan code' }));
}

describe('Settings › Wi-Fi with a camera', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    kiosk.scanWifi.mockResolvedValue({ networks: [] });
    kiosk.hasCamera.mockResolvedValue(true);
    kiosk.decodeQr.mockResolvedValue(null);
    kiosk.joinWifi.mockResolvedValue({ ok: true });
    // jsdom loads no pictures and has no canvas: the picture has a size, and the canvas hands back a frame.
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(640);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(480);
    const context = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ width: 640, height: 480 })) };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('offers Scan code only on a kiosk with a camera', async () => {
    kiosk.hasCamera.mockResolvedValue(false);
    renderWifi();
    await screen.findByText('No networks found.');
    expect(screen.queryByRole('button', { name: 'Scan code' })).not.toBeInTheDocument();
  });

  it('leads with it while the kiosk is on no network', async () => {
    renderWifi(OFFLINE);
    expect(await screen.findByText(/Show it to the camera/)).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Scan code' })).toHaveLength(1);
  });

  it('joins the network whose code is held up to the camera, and says so before it closes', async () => {
    const onJoined = renderWifi();
    await openScan();
    expect(screen.getByRole('img', { name: 'What the camera sees' })).toHaveAttribute(
      'src',
      'http://kiosk.test/camera/stream'
    );
    await look();
    expect(kiosk.joinWifi).not.toHaveBeenCalled();
    kiosk.decodeQr.mockResolvedValue(HOME_CODE);
    await look();
    expect(kiosk.joinWifi).toHaveBeenCalledExactlyOnceWith(
      { ssid: 'Attic', password: 'battery staple', hidden: true, security: 'psk' },
      'en'
    );
    // The camera's picture goes once the code is read; the dialog stays to say how it went.
    expect(screen.queryByRole('img', { name: 'What the camera sees' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Successfully connected to Attic.');
    expect(onJoined).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onJoined).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a spinner with the network while the kiosk joins it', async () => {
    renderWifi();
    await openScan();
    kiosk.joinWifi.mockReturnValue(new Promise<never>(() => {}));
    kiosk.decodeQr.mockResolvedValue(HOME_CODE);
    await look();
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to Attic…');
    expect(screen.getByRole('button', { name: 'Continue', hidden: true })).toBeDisabled();
  });

  it('says so when the code is not a Wi-Fi code, or for a network it cannot join', async () => {
    renderWifi();
    await openScan();
    kiosk.decodeQr.mockResolvedValue('https://example.com/');
    await look();
    expect(screen.getByRole('alert')).toHaveTextContent('That is not a Wi-Fi code.');
    kiosk.decodeQr.mockResolvedValue('WIFI:T:WEP;S:Old;P:abcde;;');
    await look();
    expect(screen.getByRole('alert')).toHaveTextContent('This kind of network is not supported.');
    expect(kiosk.joinWifi).not.toHaveBeenCalled();
  });

  it('says why the kiosk could not join, and goes back to the camera at Try again', async () => {
    const onJoined = renderWifi();
    await openScan();
    kiosk.joinWifi.mockResolvedValue({ ok: false, error: 'Wrong password.' });
    kiosk.decodeQr.mockResolvedValue(HOME_CODE);
    await look(3);
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong password.');
    expect(kiosk.joinWifi).toHaveBeenCalledOnce();
    expect(onJoined).not.toHaveBeenCalled();
    kiosk.decodeQr.mockResolvedValue(null);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('img', { name: 'What the camera sees' })).toBeInTheDocument();
  });

  it('stops looking when it is closed', async () => {
    renderWifi();
    await openScan();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    kiosk.decodeQr.mockClear();
    await look(3);
    expect(kiosk.decodeQr).not.toHaveBeenCalled();
  });
});
