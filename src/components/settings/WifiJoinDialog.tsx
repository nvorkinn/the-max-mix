import { useId, useRef, useState } from 'react';
import { useOnScreenKeyboard } from '../../hooks/useOnScreenKeyboard';
import { useLanguage } from '../../i18n/language';
import { useT } from '../../i18n/translate';
import { joinWifi } from '../../utils/kioskWifi';
import Modal from '../Modal';

/** What the dialog joins: a network from the list (by its name), or a hidden one, whose name is typed too. */
export type WifiTarget = { ssid: string; hidden: false } | { hidden: true };

/**
 * Asks for a network's password (and, for a hidden one, its name) on the on-screen keyboard, and joins it. Closes with
 * `onJoined` once the kiosk is on it; says the kiosk's reason when it is not, and stays open to try again.
 */
export default function WifiJoinDialog({
  target,
  onJoined,
  onClose
}: Readonly<{ target: WifiTarget; onJoined: () => void; onClose: () => void }>) {
  const t = useT();
  const language = useLanguage();
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [isShown, setIsShown] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Wi-Fi passwords are full of digits, so the keyboard keeps a row of them at the top.
  useOnScreenKeyboard(target.hidden ? nameRef : passwordRef, { hasNumberRow: true });

  const ssid = target.hidden ? name.trim() : target.ssid;
  // A listed network asks for a password, so it needs one; a hidden one may be open.
  const canConnect = connecting === null && ssid !== '' && (target.hidden || password !== '');

  const connect = async () => {
    if (!canConnect) return;
    (document.activeElement as HTMLElement | null)?.blur();
    setError(null);
    setConnecting(ssid);
    const security = password === '' && target.hidden ? 'open' : 'psk';
    const result = await joinWifi({ ssid, password, hidden: target.hidden, security }, language);
    setConnecting(null);
    if (result.ok) onJoined();
    else setError(result.error ?? t('wifi.unreachable'));
  };

  return (
    <Modal
      labelledBy={titleId}
      onClose={onClose}
      className="app-modal-panel search-dialog wifi-join border rounded-3xl p-6 shadow-2xl text-left select-none"
    >
      <div className="modal-header">
        <h3 id={titleId} className="text-lg font-semibold truncate">
          {target.hidden ? t('wifi.other') : t('wifi.join', { ssid: target.ssid })}
        </h3>
      </div>
      <form
        className="wifi-join-form"
        autoComplete="off"
        onSubmit={event => {
          event.preventDefault();
          void connect();
        }}
      >
        {target.hidden && (
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            aria-label={t('wifi.name')}
            placeholder={t('wifi.name')}
            spellCheck={false}
            disabled={connecting !== null}
            className="music-search w-full min-h-12 px-4 rounded-xl border text-sm"
          />
        )}
        <div className="wifi-join-password">
          <input
            ref={passwordRef}
            type={isShown ? 'text' : 'password'}
            value={password}
            onChange={event => setPassword(event.target.value)}
            aria-label={t('wifi.password')}
            placeholder={t('wifi.password')}
            spellCheck={false}
            disabled={connecting !== null}
            className="music-search w-full min-h-12 px-4 rounded-xl border text-sm"
          />
          <button
            type="button"
            // Pressing it must not take focus from the password box, which would close the on-screen keyboard.
            onPointerDown={event => event.preventDefault()}
            onMouseDown={event => event.preventDefault()}
            onClick={() => setIsShown(shown => !shown)}
            aria-pressed={isShown}
            className="button button-secondary"
          >
            {t(isShown ? 'wifi.hide' : 'wifi.show')}
          </button>
        </div>
        {connecting !== null && (
          <p role="status" className="text-muted">
            {t('wifi.connecting', { ssid: connecting })}
          </p>
        )}
        {error !== null && (
          <p role="alert" className="settings-error">
            {error}
          </p>
        )}
        <div className="search-dialog-actions">
          <button type="button" onClick={onClose} className="button button-secondary">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={!canConnect} className="button search-dialog-confirm">
            {t('wifi.connect')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
