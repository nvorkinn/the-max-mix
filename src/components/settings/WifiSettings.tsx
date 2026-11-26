import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, QrCode, RefreshCw, Trash2, Wifi, WifiHigh, WifiLow, WifiOff, WifiZero } from 'lucide-react';
import { useLanguage } from '../../i18n/language';
import { useT } from '../../i18n/translate';
import { hasCamera } from '../../utils/kioskCamera';
import { forgetWifi, joinWifi, scanWifi } from '../../utils/kioskWifi';
import type { WifiNetwork, WifiScan } from '../../utils/kioskWifi';
import ConfirmButton from '../ConfirmButton';
import SettingsSection from './SettingsSection';
import { wifiLabel } from './wifi';
import type { WifiState } from './wifi';
import WifiJoinDialog from './WifiJoinDialog';
import type { WifiTarget } from './WifiJoinDialog';
import { WifiHotspotDialog } from './WifiPhoneDialogs';
import type { SetupEnd } from './WifiPhoneDialogs';
import WifiScanDialog from './WifiScanDialog';

const BARS = [WifiZero, WifiZero, WifiLow, WifiHigh, Wifi] as const;

/**
 * The network the kiosk is on, large at the top with its signal, its address and Forget (on a second tap, since it drops
 * the connection); under it the other networks in range, strongest first, and joining one: an open one at a tap, one
 * with a password (or a hidden one, Other network) in a dialog with the on-screen keyboard, one a phone sends over
 * the kiosk's own Hotspot, or, on a kiosk with a camera, the one whose QR code is held up to it (Scan code, which leads
 * the page while the kiosk is on no network). The kiosk keeps only the network it is on, so there is no list of saved ones. `onJoined`
 * follows every join and every forget, so the network shown is asked again. The kiosk's service lists, joins and
 * forgets them (utils/kioskWifi.ts).
 */
export default function WifiSettings({
  wifi,
  onJoined,
  onPhoneSetup
}: Readonly<{
  wifi: WifiState;
  onJoined: () => void;
  /** Whether a setup from a phone is under way, so the kiosk does not leave Settings while the phone is used. */
  onPhoneSetup?: ((isActive: boolean) => void) | undefined;
}>) {
  const t = useT();
  const language = useLanguage();
  // Undefined while the kiosk looks for networks.
  const [scan, setScan] = useState<WifiScan | undefined>();
  const [target, setTarget] = useState<WifiTarget | null>(null);
  const [phoneSetup, setPhoneSetup] = useState<'hotspot' | null>(null);
  const [canScan, setCanScan] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void hasCamera(controller.signal).then(found => {
      if (!controller.signal.aborted) setCanScan(found);
    });
    return () => controller.abort();
  }, []);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const forgettingRef = useRef(false);
  const scanRef = useRef<AbortController | null>(null);
  const onPhoneSetupRef = useRef(onPhoneSetup);
  useEffect(() => {
    onPhoneSetupRef.current = onPhoneSetup;
  });
  const isPhoneSetup = phoneSetup !== null;
  useEffect(() => {
    if (!isPhoneSetup) return;
    onPhoneSetupRef.current?.(true);
    return () => onPhoneSetupRef.current?.(false);
  }, [isPhoneSetup]);

  const search = useCallback(() => {
    scanRef.current?.abort();
    const controller = new AbortController();
    scanRef.current = controller;
    void scanWifi(language, controller.signal).then(found => {
      if (!controller.signal.aborted) setScan(found);
    });
  }, [language]);
  useEffect(() => {
    search();
    return () => scanRef.current?.abort();
  }, [search]);
  const refresh = () => {
    setScan(undefined);
    search();
  };

  const joined = () => {
    setTarget(null);
    setIsScanning(false);
    onJoined();
  };
  const forget = async (ssid: string) => {
    if (forgettingRef.current) return;
    forgettingRef.current = true;
    setJoinError(null);
    const result = await forgetWifi(ssid, language);
    forgettingRef.current = false;
    if (!result.ok) setJoinError(result.error ?? t('wifi.unreachable'));
    onJoined();
  };
  // The phone's setup is over by itself: joined, or not, and the page says why when the kiosk did.
  const phoneSetupEnded = (end: SetupEnd) => {
    setPhoneSetup(null);
    if (end.joined) {
      onJoined();
    } else {
      setJoinError(end.error ?? null);
      // The hotspot had the radio, so the list is asked again now that the kiosk is back on its network.
      refresh();
    }
  };

  const choose = async (choice: WifiNetwork) => {
    setJoinError(null);
    if (choice.security === 'psk') {
      setTarget({ ssid: choice.ssid, hidden: false });
      return;
    }
    setConnecting(choice.ssid);
    const result = await joinWifi({ ssid: choice.ssid, password: '', hidden: false, security: 'open' }, language);
    setConnecting(null);
    if (result.ok) joined();
    else setJoinError(result.error ?? t('wifi.unreachable'));
  };

  const scanCode = () => {
    setJoinError(null);
    setIsScanning(true);
  };

  const current = wifi.state === 'connected' ? wifi.ssid : null;
  const scanError = scan?.error === undefined ? null : (scan.error ?? t('wifi.unreachable'));
  const error = joinError ?? scanError;
  // The others, strongest first; the one the kiosk is on is at the top of the page instead.
  const others = (scan?.networks ?? []).filter(choice => choice.ssid !== current).toSorted((a, b) => b.bars - a.bars);

  return (
    <div className="settings-stack">
      <CurrentNetwork wifi={wifi} scan={scan} onForget={ssid => void forget(ssid)} />
      {canScan && wifi.state === 'disconnected' && (
        <section className="wifi-scan-lead" aria-label={t('wifi.scan')}>
          <QrCode className="w-9 h-9 shrink-0" aria-hidden="true" />
          <p>{t('wifi.scan_lead')}</p>
          <button type="button" disabled={connecting !== null} onClick={scanCode} className="button shrink-0">
            {t('wifi.scan')}
          </button>
        </section>
      )}
      <SettingsSection
        id="wifi-others-label"
        title={t('wifi.others')}
        className="wifi-others"
        aside={
          <div className="wifi-others-actions">
            {canScan && wifi.state !== 'disconnected' && (
              <button
                type="button"
                disabled={connecting !== null}
                onClick={scanCode}
                className="button button-secondary"
              >
                {t('wifi.scan')}
              </button>
            )}
            <button
              type="button"
              disabled={connecting !== null}
              onClick={() => {
                setJoinError(null);
                setTarget({ hidden: true });
              }}
              className="button button-secondary"
            >
              {t('wifi.other')}
            </button>
            <button
              type="button"
              disabled={connecting !== null}
              onClick={() => {
                setJoinError(null);
                setPhoneSetup('hotspot');
              }}
              className="button button-secondary"
            >
              {t('wifi.hotspot')}
            </button>
            <button
              type="button"
              disabled={scan === undefined || connecting !== null}
              aria-label={t('wifi.refresh')}
              onClick={() => {
                setJoinError(null);
                refresh();
              }}
              className="button button-secondary wifi-refresh"
            >
              <RefreshCw className="w-5 h-5 shrink-0" aria-hidden="true" />
            </button>
          </div>
        }
      >
        {error !== null && (
          <p role="alert" className="settings-error">
            {error}
          </p>
        )}
        {connecting !== null && (
          <p role="status" className="text-muted">
            {t('wifi.connecting', { ssid: connecting })}
          </p>
        )}
        {scan === undefined && <p className="text-muted">{t('wifi.searching')}</p>}
        {scan !== undefined && others.length === 0 && scan.error === undefined && (
          <p className="text-muted">{t('wifi.no_networks')}</p>
        )}
        {others.length > 0 && (
          <ul className="wifi-networks">
            {others.map(choice => {
              const Bars = BARS[choice.bars] ?? WifiZero;
              return (
                <li key={choice.ssid}>
                  <button
                    type="button"
                    disabled={choice.security === 'unsupported' || connecting !== null}
                    onClick={() => void choose(choice)}
                    className="wifi-network"
                  >
                    <span className="wifi-network-name">{choice.ssid}</span>
                    {choice.security === 'psk' && (
                      <Lock className="w-5 h-5 shrink-0 text-muted" aria-label={t('wifi.secured')} />
                    )}
                    {choice.security === 'unsupported' && (
                      <span className="wifi-network-note shrink-0">{t('wifi.not_supported')}</span>
                    )}
                    <Bars
                      className="w-6 h-6 shrink-0"
                      role="img"
                      aria-label={t('wifi.signal', { bars: choice.bars })}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>
      {target && <WifiJoinDialog target={target} onJoined={joined} onClose={() => setTarget(null)} />}
      {isScanning && <WifiScanDialog onJoined={joined} onClose={() => setIsScanning(false)} />}
      {phoneSetup === 'hotspot' && (
        <WifiHotspotDialog
          onEnd={phoneSetupEnded}
          onClose={stopped => {
            setPhoneSetup(null);
            // The hotspot had the radio, so the list is asked again once the kiosk is back on its network.
            setScan(undefined);
            void stopped.then(search);
          }}
        />
      )}
    </div>
  );
}

/**
 * The network the kiosk is on: its name large, its signal (once the scan has found it), Connected with the kiosk's
 * address, and Forget. Off a network it says so, with nothing to forget; while the kiosk is still asked, only its icon.
 */
function CurrentNetwork({
  wifi,
  scan,
  onForget
}: Readonly<{ wifi: WifiState; scan: WifiScan | undefined; onForget: (ssid: string) => void }>) {
  const t = useT();
  const label = wifiLabel(wifi, t);
  const isConnected = wifi.state === 'connected';
  const seen = isConnected ? scan?.networks.find(choice => choice.ssid === wifi.ssid) : undefined;
  let Icon = WifiOff;
  if (seen) Icon = BARS[seen.bars] ?? WifiZero;
  else if (isConnected) Icon = Wifi;
  const address = wifi.state === 'connected' ? wifi.address : null;
  return (
    <section className={`wifi-current ${isConnected ? 'is-connected' : ''}`} aria-label={t('wifi.current')}>
      <span className="wifi-current-icon">
        {seen ? (
          <Icon className="w-9 h-9" role="img" aria-label={t('wifi.signal', { bars: seen.bars })} />
        ) : (
          <Icon className="w-9 h-9" aria-hidden="true" />
        )}
      </span>
      <div className="wifi-current-about">
        {label !== undefined && (
          <div data-testid="wifi-network" className="wifi-current-name truncate">
            {label}
          </div>
        )}
        {isConnected && (
          <div className="wifi-current-status">
            {address === null ? t('wifi.connected') : t('wifi.connected_address', { address })}
          </div>
        )}
      </div>
      {wifi.state === 'connected' && (
        <ConfirmButton
          label={t('wifi.forget')}
          confirmLabel={t('wifi.forget_confirm')}
          className="wifi-forget shrink-0"
          icon={<Trash2 className="w-5 h-5 shrink-0" aria-hidden="true" />}
          onConfirm={() => onForget(wifi.ssid)}
        />
      )}
    </section>
  );
}
