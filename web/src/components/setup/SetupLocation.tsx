// cspell:ignore kilometer
import { useEffect, useId, useRef, useState } from 'react';
import { Check, LoaderCircle, Search } from 'lucide-react';
import type { NearbyPostcode, NoticeBoard } from 'countdown-api';
import { loadDeviceConfig, saveConfigSection } from '../../countdown/config';
import { findPostcode, metresBetween } from '../../countdown/location';
import type { Position } from '../../countdown/location';
import { locatePlace, nearbyStops, rememberStop } from '../../countdown/search';
import type { NearbyStop, StopResult } from '../../countdown/search';
import { useOnScreenKeyboard } from '../../hooks/useOnScreenKeyboard';
import { useLanguage } from '../../i18n/language';
import type { Language } from '../../i18n/language';
import { useT } from '../../i18n/translate';
import CountryFlag from '../settings/CountryFlag';
import { noticeBoardFor, savedBoard } from '../settings/NoticeBoardDialog';
import StopLetter from '../settings/StopLetter';
import StopSearch from '../settings/StopSearch';
import type { SetupLocationAnswer } from './useSetupLocation';

/** How long the postcode page waits for the background lookup, with a spinner, before it offers only the text box. */
export const LOOKING_MS = 15_000;
/** The most postcodes offered as buttons. */
const MOST_POSTCODES = 10;
/**
 * How near the background lookup's position a chosen postcode must be for the stops found there to be used, not asked
 * for again: near enough for every postcode it suggested, not for one typed from across town.
 */
const SAME_PLACE_METRES = 250;

function Spinner() {
  return (
    <div className="setup-wizard-center">
      <LoaderCircle className="w-10 h-10 animate-spin text-accent" aria-hidden="true" />
    </div>
  );
}

/** A distance in metres as the stop list shows it: "140 m", or "1.2 km" from a kilometre on. */
function formatDistance(metres: number, language: Language): string {
  const isKilometres = metres >= 1000;
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: isKilometres ? 'kilometer' : 'meter',
    unitDisplay: 'short',
    maximumFractionDigits: isKilometres ? 1 : 0
  }).format(isKilometres ? metres / 1000 : Math.round(metres / 10) * 10);
}

/**
 * The postcode page: the postcodes nearest the kiosk as large buttons (a spinner while the background lookup is still
 * at it, for up to LOOKING_MS), then a text box for one that isn't listed, and Skip. A postcode picked or typed is
 * saved as the notice board's, and the town or city at it as the weather's, which may fail without holding things up.
 */
function PostcodePage({
  found,
  onChosen,
  onSkip
}: Readonly<{ found: SetupLocationAnswer; onChosen: (position: Position | null) => void; onSkip: () => void }>) {
  const t = useT();
  const fieldId = useId();
  const hintId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasWaited, setHasWaited] = useState(false);
  // Only once tapped: the keyboard would cover the postcodes otherwise.
  useOnScreenKeyboard(fieldRef, { focus: false, hasNumberRow: true, isUppercase: true });
  useEffect(() => {
    if (found !== undefined) return;
    const timer = setTimeout(() => setHasWaited(true), LOOKING_MS);
    return () => clearTimeout(timer);
  }, [found]);
  if (isSaving) return <Spinner />;

  const wanted = typed.trim() === '' ? null : noticeBoardFor(typed);
  const isWrong = typed.trim() !== '' && wanted === null;
  const postcodes = found?.location.postcodes.slice(0, MOST_POSTCODES) ?? [];

  const choose = async (board: NoticeBoard, known?: Position) => {
    setIsSaving(true);
    setError(null);
    let position: Position | null = known ?? null;
    if (!known && board.postcode) {
      const answer = await findPostcode(board.postcode);
      if (answer === 'unknown') {
        setError(t('setup.location_unknown'));
        setIsSaving(false);
        return;
      }
      // Not found for want of the server: the postcode is still saved, with no weather or stops near it to offer.
      position = answer === 'failed' ? null : answer;
    }
    // Loaded first, for the version a save sends back.
    const config = await loadDeviceConfig();
    const saved = config && (await saveConfigSection('notice_board', savedBoard(config.notice_board, board)));
    if (!saved || 'error' in saved) {
      setError(t('setup.location_failed'));
      setIsSaving(false);
      return;
    }
    if (position) {
      const place = await locatePlace(position).catch(() => null);
      if (place) await saveConfigSection('weather', place.value);
    }
    onChosen(position);
  };
  const pick = (postcode: NearbyPostcode) =>
    void choose({ postcode: postcode.postcode, country: postcode.country, address: null }, postcode);

  const isLooking = found === undefined && !hasWaited;
  return (
    <div className="setup-wizard-location">
      <p className="setup-wizard-lead">{t(postcodes.length > 0 ? 'setup.location_pick' : 'setup.location_lead')}</p>
      {isLooking && (
        <div className="setup-wizard-location-looking" role="status" aria-label={t('setup.location_looking')}>
          <LoaderCircle className="w-10 h-10 animate-spin text-accent" aria-hidden="true" />
        </div>
      )}
      {postcodes.length > 0 && (
        <ul className="setup-wizard-location-postcodes" aria-label={t('general.postcode')}>
          {postcodes.map(postcode => (
            <li key={postcode.postcode}>
              <button type="button" className="setup-wizard-location-postcode" onClick={() => pick(postcode)}>
                {postcode.postcode}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="setup-wizard-location-type"
        onSubmit={event => {
          event.preventDefault();
          if (wanted) void choose(wanted);
        }}
      >
        <label htmlFor={fieldId} className="setup-wizard-location-label">
          {t(postcodes.length > 0 ? 'setup.location_type' : 'setup.location_type_only')}
        </label>
        <div className="setup-wizard-location-field">
          <div className="postcode-field">
            {wanted?.country && <CountryFlag country={wanted.country} className="postcode-field-flag" />}
            <input
              ref={fieldRef}
              id={fieldId}
              type="text"
              value={typed}
              onChange={event => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={isWrong}
              aria-describedby={isWrong ? hintId : undefined}
              className="music-search w-full rounded-xl border"
            />
          </div>
          <button type="submit" disabled={wanted === null} className="button search-dialog-confirm">
            {t('setup.location_use')}
          </button>
        </div>
        {isWrong && (
          <p id={hintId} className="text-muted">
            {t('general.postcode_wrong')}
          </p>
        )}
      </form>
      {error && (
        <p role="alert" className="settings-error status-danger">
          {error}
        </p>
      )}
      <button type="button" className="setup-wizard-other" onClick={onSkip}>
        {t('setup.location_skip')}
      </button>
    </div>
  );
}

/** One stop on the stops page: a button that ticks or unticks it, with its name, letter, lines and distance. */
function StopRow({
  stop,
  distance,
  isPicked,
  onToggle
}: Readonly<{ stop: StopResult; distance?: number; isPicked: boolean; onToggle: () => void }>) {
  const language = useLanguage();
  return (
    <button
      type="button"
      aria-pressed={isPicked}
      onClick={onToggle}
      className="modal-option setup-wizard-location-stop rounded-xl border"
    >
      <span className="setup-wizard-location-tick" aria-hidden="true">
        {isPicked && <Check />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="stop-name font-semibold">
          <span className="truncate">{stop.name}</span>
          {stop.letter && <StopLetter letter={stop.letter} />}
        </span>
        {stop.detail && <span className="block text-muted truncate">{stop.detail}</span>}
      </span>
      {distance !== undefined && (
        <span className="setup-wizard-location-distance">{formatDistance(distance, language)}</span>
      )}
    </button>
  );
}

/**
 * The stops page: the stops nearest the postcode, none ticked, each ticked or unticked with a tap, and a search for any
 * other (the Countdown settings' stop search). With none near (outside London, or when they couldn't be had), only the
 * search. Continue saves those ticked as the Countdown's stops; with none ticked it saves nothing.
 */
function StopsPage({
  position,
  prefetched,
  onDone
}: Readonly<{ position: Position | null; prefetched: NearbyStop[] | null; onDone: () => void }>) {
  const t = useT();
  // Undefined while they are being asked for.
  const [nearby, setNearby] = useState<NearbyStop[] | undefined>(prefetched ?? (position ? undefined : []));
  const [picked, setPicked] = useState<StopResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAsking = nearby === undefined;
  useEffect(() => {
    if (!isAsking || !position) return;
    const controller = new AbortController();
    nearbyStops(position, controller.signal)
      .then(stops => {
        if (!controller.signal.aborted) setNearby(stops);
      })
      .catch(() => {
        if (!controller.signal.aborted) setNearby([]);
      });
    return () => controller.abort();
  }, [isAsking, position]);
  if (isAsking || isSaving) return <Spinner />;

  const isPicked = (stop: StopResult) => picked.some(chosen => chosen.key === stop.key);
  const add = (stop: StopResult) => setPicked(chosen => [...chosen, stop]);
  const remove = (stop: StopResult) => setPicked(chosen => chosen.filter(kept => kept.key !== stop.key));
  const toggle = (stop: StopResult) => (isPicked(stop) ? remove(stop) : add(stop));
  // Stops found in the search are listed after the ones near, ticked.
  const found = picked.filter(stop => nearby.every(near => near.key !== stop.key));

  const finish = async () => {
    if (picked.length === 0) {
      onDone();
      return;
    }
    setIsSaving(true);
    setError(null);
    const config = await loadDeviceConfig();
    const stops = picked.map(stop => stop.value);
    const saved = config && (await saveConfigSection('arrivals', { ...config.arrivals, stops }));
    if (!saved || 'error' in saved) {
      setError(t('setup.location_failed'));
      setIsSaving(false);
      return;
    }
    for (const stop of picked) rememberStop(stop);
    onDone();
  };

  const hasList = nearby.length > 0 || found.length > 0;
  return (
    <div className="setup-wizard-location">
      <p className="setup-wizard-lead">{t(hasList ? 'setup.location_stops' : 'setup.location_stops_search')}</p>
      {hasList && (
        <ul className="setup-wizard-location-stops" aria-label={t('setup.location_nearby')}>
          {nearby.map(stop => (
            <li key={stop.key}>
              <StopRow stop={stop} distance={stop.distance} isPicked={isPicked(stop)} onToggle={() => toggle(stop)} />
            </li>
          ))}
          {found.map(stop => (
            <li key={stop.key}>
              <StopRow stop={stop} isPicked onToggle={() => remove(stop)} />
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => setIsSearching(true)} className="countdown-search-button">
        <Search className="w-6 h-6 shrink-0" aria-hidden="true" />
        {t(hasList ? 'setup.location_search' : 'countdown.search')}
      </button>
      {error && (
        <p role="alert" className="settings-error status-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        className="button search-dialog-confirm setup-wizard-button setup-wizard-location-continue"
        onClick={() => void finish()}
      >
        {t('common.continue')}
      </button>
      {isSearching && (
        <StopSearch
          stops={picked.map(stop => stop.value)}
          onClose={() => setIsSearching(false)}
          onAdd={add}
          onRemove={remove}
        />
      )}
    </div>
  );
}

/**
 * The Location chapter: the postcode (from those the background lookup found near the kiosk, or typed), which sets the
 * notice board and the weather, then the stops near it for the Countdown. Skip leaves all three as they are.
 * `found` is the background lookup's answer (useSetupLocation); its stops are used when the postcode is near where it
 * placed the kiosk, else those near the postcode are asked for.
 */
export default function SetupLocation({ found, onDone }: Readonly<{ found: SetupLocationAnswer; onDone: () => void }>) {
  const [chosen, setChosen] = useState<{ position: Position | null } | null>(null);
  if (!chosen) return <PostcodePage found={found} onChosen={position => setChosen({ position })} onSkip={onDone} />;
  const { position } = chosen;
  const isNear = found && position && metresBetween(found.location, position) <= SAME_PLACE_METRES;
  return <StopsPage position={position} prefetched={isNear ? found.stops : null} onDone={onDone} />;
}
