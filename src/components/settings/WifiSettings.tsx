import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Lock, RefreshCw, Wifi, WifiHigh, WifiLow, WifiOff, WifiZero } from 'lucide-react';
import { useLanguage } from '../../i18n/language';
import { useT } from '../../i18n/translate';
import { joinWifi, scanWifi } from '../../utils/kioskWifi';
import type { WifiNetwork, WifiScan } from '../../utils/kioskWifi';
import { wifiLabel } from './wifi';
import type { WifiState } from './wifi';
import WifiJoinDialog from './WifiJoinDialog';
import type { WifiTarget } from './WifiJoinDialog';

const BARS = [WifiZero, WifiZero, WifiLow, WifiHigh, Wifi] as const;

/**
 * The network the kiosk is on, the networks in range, and joining one: an open one at a tap, one with a password (or a
 * hidden one) in a dialog with the on-screen keyboard. `onJoined` follows every join, so the network shown is asked
 * again. The kiosk's service lists and joins them (utils/kioskWifi.ts).
 */
export default function WifiSettings({ wifi, onJoined }: Readonly<{ wifi: WifiState; onJoined: () => void }>) {
  const t = useT();
  const language = useLanguage();
  const network = wifiLabel(wifi, t);
  const Icon = wifi.state === 'disconnected' ? WifiOff : Wifi;
  // Undefined while the kiosk looks for networks.
  const [scan, setScan] = useState<WifiScan | undefined>();
  const [target, setTarget] = useState<WifiTarget | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const scanRef = useRef<AbortController | null>(null);

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
    onJoined();
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
      </section>
      {target && <WifiJoinDialog target={target} onJoined={joined} onClose={() => setTarget(null)} />}
    </div>
  );
}
