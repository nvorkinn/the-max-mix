import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Lock, RefreshCw, Wifi, WifiHigh, WifiLow, WifiOff, WifiZero } from 'lucide-react';
import { useLanguage } from '../../i18n/language';
import { useT } from '../../i18n/translate';
import { forgetWifi, joinWifi, savedWifi, scanWifi } from '../../utils/kioskWifi';
import type { WifiNetwork, WifiScan } from '../../utils/kioskWifi';
import { wifiLabel } from './wifi';
import type { WifiState } from './wifi';
import WifiJoinDialog from './WifiJoinDialog';
import type { WifiTarget } from './WifiJoinDialog';
import { WifiHotspotDialog } from './WifiPhoneDialogs';
import type { SetupEnd } from './WifiPhoneDialogs';

const BARS = [WifiZero, WifiZero, WifiLow, WifiHigh, Wifi] as const;

/**
 * The network the kiosk is on, the networks in range, and joining one: an open one at a tap, one with a password (or a
 * hidden one) in a dialog with the on-screen keyboard, or one a phone sends over the kiosk's own Hotspot. `onJoined`
 * follows every join, and every network forgotten, so the network shown is asked again. The buttons for the other ways
 * come above the list. Under it, the networks the kiosk keeps, each with Forget, so nobody's Wi-Fi password leaves with
 * it. The kiosk's service lists, joins and forgets them (utils/kioskWifi.ts).
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
  const network = wifiLabel(wifi, t);
  const Icon = wifi.state === 'disconnected' ? WifiOff : Wifi;
  // Undefined while the kiosk looks for networks.
  const [scan, setScan] = useState<WifiScan | undefined>();
  const [target, setTarget] = useState<WifiTarget | null>(null);
  const [phoneSetup, setPhoneSetup] = useState<'hotspot' | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const scanRef = useRef<AbortController | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const savedRef = useRef<AbortController | null>(null);
  const listSaved = useCallback(() => {
    savedRef.current?.abort();
    const controller = new AbortController();
    savedRef.current = controller;
    void savedWifi(controller.signal).then(names => {
      if (!controller.signal.aborted) setSaved(names);
    });
  }, []);
  useEffect(() => {
    listSaved();
    return () => savedRef.current?.abort();
  }, [listSaved]);
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
    listSaved();
    onJoined();
  };
  const forget = async (ssid: string) => {
    setJoinError(null);
    setForgetting(ssid);
    const result = await forgetWifi(ssid, language);
    setForgetting(null);
    if (!result.ok) setJoinError(result.error ?? t('wifi.unreachable'));
    listSaved();
    onJoined();
  };
  // The phone's setup is over by itself: joined, or not, and the page says why when the kiosk did.
  const phoneSetupEnded = (end: SetupEnd) => {
    setPhoneSetup(null);
    if (end.joined) {
      listSaved();
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

  const current = wifi.state === 'connected' ? wifi.ssid : null;
  const scanError = scan?.error === undefined ? null : (scan.error ?? t('wifi.unreachable'));
  const error = joinError ?? scanError;

  return (
    <div className="settings-stack">
      <div className="settings-box flex items-center gap-4">
        <span className="settings-box-icon">
          <Icon className="w-6 h-6" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="settings-box-title">{t('wifi.network')}</div>
          {network !== undefined && (
            <div
              data-testid="wifi-network"
              className={`settings-box-value truncate ${wifi.state === 'connected' ? '' : 'text-muted'}`}
            >
              {network}
            </div>
          )}
        </div>
      </div>
      <div className="wifi-actions">
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
          onClick={() => {
            setJoinError(null);
            refresh();
          }}
          className="button button-secondary"
        >
          <RefreshCw className="w-5 h-5 shrink-0" aria-hidden="true" />
          {t('wifi.refresh')}
        </button>
      </div>
      <section className="settings-group" aria-labelledby="wifi-networks-label">
        <h5 className="settings-group-title" id="wifi-networks-label">
          {t('wifi.networks')}
        </h5>
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
        {scan?.networks.length === 0 && scan.error === undefined && (
          <p className="text-muted">{t('wifi.no_networks')}</p>
        )}
        {scan !== undefined && scan.networks.length > 0 && (
          <ul className="wifi-networks">
            {scan.networks.map(choice => {
              const Bars = BARS[choice.bars] ?? WifiZero;
              const isCurrent = choice.ssid === current;
              return (
                <li key={choice.ssid}>
                  <button
                    type="button"
                    disabled={choice.security === 'unsupported' || connecting !== null}
                    aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => void choose(choice)}
                    className="settings-box wifi-network"
                  >
                    <span className="wifi-network-name">{choice.ssid}</span>
                    {isCurrent && <Check className="w-5 h-5 shrink-0 wifi-network-current" aria-hidden="true" />}
                    {choice.security === 'psk' && (
                      <Lock className="w-5 h-5 shrink-0 text-muted" aria-label={t('wifi.secured')} />
                    )}
                    {choice.security === 'unsupported' && (
                      <span className="text-muted shrink-0">{t('wifi.not_supported')}</span>
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
      </section>
      {saved.length > 0 && (
        <section className="settings-group" aria-labelledby="wifi-saved-label">
          <h5 className="settings-group-title" id="wifi-saved-label">
            {t('wifi.saved')}
          </h5>
          <ul className="wifi-networks">
            {saved.map(ssid => (
              <li key={ssid} className="settings-box wifi-network">
                <span className="wifi-network-name">{ssid}</span>
                <button
                  type="button"
                  disabled={forgetting !== null || connecting !== null}
                  aria-label={t('wifi.forget_name', { ssid })}
                  onClick={() => void forget(ssid)}
                  className="button button-secondary shrink-0"
                >
                  {t('wifi.forget')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {target && <WifiJoinDialog target={target} onJoined={joined} onClose={() => setTarget(null)} />}
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
