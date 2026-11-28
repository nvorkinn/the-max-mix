// cspell:ignore kilometer
import { useEffect, useId, useRef, useState } from 'react';
import { Bus, Check, CloudSun, LoaderCircle, MapPin, TrainFront } from 'lucide-react';
import type { NearbyPostcode, NoticeBoard } from 'countdown-api';
import { loadDeviceConfig, saveConfigSection } from '../../countdown/config';
import { findPostcode, metresBetween } from '../../countdown/location';
import type { Position } from '../../countdown/location';
import { locatePlace, nearbyStops, rememberStop } from '../../countdown/search';
import type { NearbyStop } from '../../countdown/search';
import { placeName } from '../../dashboard/arrivals';
import { useOnScreenKeyboard } from '../../hooks/useOnScreenKeyboard';
import { useLanguage } from '../../i18n/language';
import type { Language } from '../../i18n/language';
import { useT } from '../../i18n/translate';
import { FALLBACK_LINE_COLOURS, LINE_COLOURS } from '../dashboard/icons';
import CountryFlag from '../settings/CountryFlag';
import { noticeBoardFor, savedBoard } from '../settings/NoticeBoardDialog';
import StopLetter from '../settings/StopLetter';
import type { SetupLocationAnswer } from './useSetupLocation';

/** How long the postcode page waits for the background lookup, with a spinner, before it offers only the text box. */
export const LOOKING_MS = 15_000;
/** The most postcodes offered: the nearest, large, and the others in a grid of three across. */
const MOST_POSTCODES = 10;
/** The most stations and bus stops offered, so the page never scrolls: the rest are for Settings › Countdown. */
const MOST_STATIONS = 3;
const MOST_BUS_STOPS = 5;
/** The most of a bus stop's routes shown, the rest counted ("+3"). */
const MOST_ROUTES = 6;
/**
 * How near the background lookup's position a chosen postcode must be for the stops found there to be used, not asked
 * for again: near enough for every postcode it suggested, not for one typed from across town.
 */
const SAME_PLACE_METRES = 250;

function Spinner({ label }: Readonly<{ label?: string }>) {
  return (
    <div className="setup-wizard-center" role={label ? 'status' : undefined}>
      <LoaderCircle className="w-10 h-10 animate-spin text-accent" aria-hidden="true" />
      {label && <p className="setup-wizard-location-aside">{label}</p>}
    </div>
  );
}

/** A distance in metres as the stops show it: "140 m", or "1.2 km" from a kilometre on. */
function formatDistance(metres: number, language: Language): string {
  const isKilometres = metres >= 1000;
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: isKilometres ? 'kilometer' : 'meter',
    unitDisplay: 'short',
    maximumFractionDigits: isKilometres ? 1 : 0
  }).format(isKilometres ? metres / 1000 : Math.round(metres / 10) * 10);
}

/** What was chosen on the postcode page: the postcode, where it is (when known) and the weather's place (when found). */
interface Chosen {
  postcode: string;
  position: Position | null;
  place: string | null;
}

/**
 * The postcode typed: a large box with the on-screen keyboard up, which tells a UK or Norwegian postcode by its form,
 * and Use once it is one. Back goes to the postcodes found, when there are any.
 */
function TypedPostcode({
  error,
  onUse,
  onBack,
  onSkip
}: Readonly<{
  error: string | null;
  onUse: (board: NoticeBoard) => void;
  onBack?: (() => void) | undefined;
  onSkip: () => void;
}>) {
  const t = useT();
  const fieldId = useId();
  const hintId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');
  useOnScreenKeyboard(fieldRef, { hasNumberRow: true, isUppercase: true });
  const wanted = typed.trim() === '' ? null : noticeBoardFor(typed);
  const isWrong = typed.trim() !== '' && wanted === null;
  return (
    <form
      className="setup-wizard-location setup-wizard-location-typing"
      onSubmit={event => {
        event.preventDefault();
        if (wanted) onUse(wanted);
      }}
    >
      <label htmlFor={fieldId} className="setup-wizard-lead">
        {t('setup.location_type_title')}
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
            placeholder="SE17 2PU"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={isWrong}
            aria-describedby={isWrong ? hintId : undefined}
            className="music-search w-full rounded-xl border"
          />
        </div>
        {wanted && (
          <button type="submit" className="button search-dialog-confirm">
            {t('setup.location_use')}
          </button>
        )}
      </div>
      {isWrong && (
        <p id={hintId} className="setup-wizard-location-aside">
          {t('general.postcode_wrong')}
        </p>
      )}
      {error && (
        <p role="alert" className="settings-error status-danger">
          {error}
        </p>
      )}
      <div className="setup-wizard-location-ways">
        {onBack && (
          <button type="button" className="setup-wizard-other" onClick={onBack}>
            {t('common.back')}
          </button>
        )}
        <button type="button" className="setup-wizard-other" onClick={onSkip}>
          {t('setup.location_skip')}
        </button>
      </div>
    </form>
  );
}

/**
 * The postcode page: where the screen is, as the nearest postcode found, large, and the other postcodes near it in a
 * grid under it, alphabetically (a spinner while the background lookup is still at it, for up to LOOKING_MS). A line
 * under them opens a box to type one that isn't listed. A postcode picked or typed is saved as the notice board's,
 * and the town or city at it as the weather's, which may fail without holding things up.
 */
function PostcodePage({
  found,
  onChosen,
  onSkip
}: Readonly<{ found: SetupLocationAnswer; onChosen: (chosen: Chosen) => void; onSkip: () => void }>) {
  const t = useT();
  const othersId = useId();
  const [isTyping, setIsTyping] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasWaited, setHasWaited] = useState(false);
  useEffect(() => {
    if (found !== undefined) return;
    const timer = setTimeout(() => setHasWaited(true), LOOKING_MS);
    return () => clearTimeout(timer);
  }, [found]);
  if (isSaving) return <Spinner />;
  if (found === undefined && !hasWaited) return <Spinner label={t('setup.location_looking')} />;

  const choose = async (board: NoticeBoard, known?: Position) => {
    if (!board.postcode) return;
    setIsSaving(true);
    setError(null);
    let position: Position | null = known ?? null;
    if (!known) {
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
    let place: string | null = null;
    if (position) {
      const here = await locatePlace(position).catch(() => null);
      if (here) {
        const weather = await saveConfigSection('weather', here.value);
        if ('saved' in weather) place = here.name;
      }
    }
    onChosen({ postcode: board.postcode, position, place });
  };
  const pick = (postcode: NearbyPostcode) =>
    void choose({ postcode: postcode.postcode, country: postcode.country, address: null }, postcode);

  const [nearest, ...others] = found?.location.postcodes.slice(0, MOST_POSTCODES) ?? [];
  if (isTyping || !nearest) {
    return (
      <TypedPostcode
        error={error}
        onUse={board => void choose(board)}
        onBack={nearest ? () => setIsTyping(false) : undefined}
        onSkip={onSkip}
      />
    );
  }
  const sorted = others.toSorted((a, b) => a.postcode.localeCompare(b.postcode));
  return (
    <div className="setup-wizard-location">
      <p className="setup-wizard-lead">{t('setup.location_where')}</p>
      <button type="button" className="setup-wizard-location-nearest" onClick={() => pick(nearest)}>
        <MapPin className="setup-wizard-location-pin" aria-hidden="true" />
        <span className="setup-wizard-location-nearest-text">
          <span className="setup-wizard-location-nearest-code">{nearest.postcode}</span>
          <span className="setup-wizard-location-nearest-label">{t('setup.location_nearest')}</span>
        </span>
      </button>
      {sorted.length > 0 && (
        <p className="setup-wizard-location-aside" id={othersId}>
          {t('setup.location_others')}
        </p>
      )}
      {sorted.length > 0 && (
        <ul className="setup-wizard-location-postcodes" aria-labelledby={othersId}>
          {sorted.map(postcode => (
            <li key={postcode.postcode}>
              <button type="button" className="setup-wizard-location-postcode" onClick={() => pick(postcode)}>
                {postcode.postcode}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="settings-error status-danger">
          {error}
        </p>
      )}
      <div className="setup-wizard-location-ways">
        <button type="button" className="setup-wizard-other" onClick={() => setIsTyping(true)}>
          {t('setup.location_type')}
        </button>
        <button type="button" className="setup-wizard-other" onClick={onSkip}>
          {t('setup.location_skip')}
        </button>
      </div>
    </div>
  );
}

/** TfL's id for a line as the search names it ("Hammersmith & City" is hammersmith-city), for its colour. */
function lineColours(name: string): readonly [string, string] {
  const id = name
    .toLowerCase()
    .replace(/ line$/, '')
    .replaceAll(' & ', '-')
    .replaceAll(' ', '-');
  return LINE_COLOURS[id] ?? FALLBACK_LINE_COLOURS;
}

/**
 * One stop, as a card that ticks or unticks it: a station's name (without "Underground Station") and its lines in
 * their colours; a bus stop's name, its letter in its red disc and its routes as red chips, as on the stop's flag. The
 * distance is in its corner.
 */
function StopCard({
  stop,
  isPicked,
  onToggle
}: Readonly<{ stop: NearbyStop; isPicked: boolean; onToggle: () => void }>) {
  const language = useLanguage();
  const isBus = stop.mode === 'bus';
  const routes = isBus ? stop.lines.slice(0, MOST_ROUTES) : stop.lines;
  const more = stop.lines.length - routes.length;
  return (
    <button type="button" aria-pressed={isPicked} onClick={onToggle} className="setup-wizard-location-stop">
      <span className="setup-wizard-location-stop-top">
        <span className="setup-wizard-location-stop-name">
          <span className="truncate">{placeName(stop.name)}</span>
          {stop.letter && <StopLetter letter={stop.letter} />}
        </span>
        <span className="setup-wizard-location-distance">{formatDistance(stop.distance, language)}</span>
        <span className="setup-wizard-location-tick" aria-hidden="true">
          {isPicked && <Check />}
        </span>
      </span>
      {routes.length > 0 && (
        <span className="setup-wizard-location-lines">
          {routes.map(line => {
            if (isBus) {
              return (
                <span key={line} className="setup-wizard-location-route">
                  {line}
                </span>
              );
            }
            const [background, color] = lineColours(line);
            return (
              <span key={line} className="setup-wizard-location-line" style={{ background, color }}>
                {line}
              </span>
            );
          })}
          {more > 0 && <span className="setup-wizard-location-more">+{more}</span>}
        </span>
      )}
    </button>
  );
}

function StopColumn({
  title,
  icon,
  stops,
  isPicked,
  onToggle
}: Readonly<{
  title: string;
  icon: React.ReactNode;
  stops: NearbyStop[];
  isPicked: (stop: NearbyStop) => boolean;
  onToggle: (stop: NearbyStop) => void;
}>) {
  const titleId = useId();
  return (
    <section className="setup-wizard-location-column" aria-labelledby={titleId}>
      <h3 id={titleId} className="setup-wizard-location-column-title">
        {icon}
        {title}
      </h3>
      <ul className="setup-wizard-location-stops">
        {stops.map(stop => (
          <li key={stop.key}>
            <StopCard stop={stop} isPicked={isPicked(stop)} onToggle={() => onToggle(stop)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The stops page: the stations and the bus stops nearest the postcode, side by side, a few of each so the page never
 * scrolls, none ticked; a tap ticks or unticks one. Continue saves those ticked as the Countdown's stops (with none
 * ticked it saves nothing); any others are for Settings › Countdown, as the page after says.
 */
function StopsPage({
  chosen,
  prefetched,
  onDone
}: Readonly<{ chosen: Chosen; prefetched: NearbyStop[] | null; onDone: (count: number) => void }>) {
  const t = useT();
  const { position } = chosen;
  // Undefined while they are being asked for.
  const [nearby, setNearby] = useState<NearbyStop[] | undefined>(prefetched ?? (position ? undefined : []));
  const [picked, setPicked] = useState<NearbyStop[]>([]);
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

  const stations = nearby.filter(stop => stop.mode !== 'bus').slice(0, MOST_STATIONS);
  const busStops = nearby.filter(stop => stop.mode === 'bus').slice(0, MOST_BUS_STOPS);
  const isPicked = (stop: NearbyStop) => picked.some(chosenStop => chosenStop.key === stop.key);
  const toggle = (stop: NearbyStop) =>
    setPicked(was => (isPicked(stop) ? was.filter(kept => kept.key !== stop.key) : [...was, stop]));
  const finish = async () => {
    if (picked.length === 0) {
      onDone(0);
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
    onDone(picked.length);
  };
  const hasStops = stations.length > 0 || busStops.length > 0;
  return (
    <div className="setup-wizard-location">
      <div className="setup-wizard-location-heading">
        <p className="setup-wizard-lead">{t('setup.location_stops')}</p>
        <p className="setup-wizard-location-aside">
          {t(hasStops ? 'setup.location_stops_tap' : 'setup.location_no_stops')}
        </p>
      </div>
      {hasStops && (
        <div
          className="setup-wizard-location-columns"
          data-columns={stations.length > 0 && busStops.length > 0 ? 2 : 1}
        >
          {stations.length > 0 && (
            <StopColumn
              title={t('setup.location_stations')}
              icon={<TrainFront aria-hidden="true" />}
              stops={stations}
              isPicked={isPicked}
              onToggle={toggle}
            />
          )}
          {busStops.length > 0 && (
            <StopColumn
              title={t('setup.location_bus_stops')}
              icon={<Bus aria-hidden="true" />}
              stops={busStops}
              isPicked={isPicked}
              onToggle={toggle}
            />
          )}
        </div>
      )}
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
    </div>
  );
}

/** The chapter's last page: what was set, and where in Settings to change it, or to add more stops. */
function DonePage({ chosen, stopCount, onDone }: Readonly<{ chosen: Chosen; stopCount: number; onDone: () => void }>) {
  const t = useT();
  return (
    <div className="setup-wizard-location">
      <span className="wifi-join-progress-mark">
        <Check aria-hidden="true" />
      </span>
      <p className="setup-wizard-lead" role="status">
        {t('setup.location_set')}
      </p>
      <ul className="setup-wizard-location-summary">
        <li>
          <MapPin aria-hidden="true" />
          {chosen.postcode}
        </li>
        {chosen.place && (
          <li>
            <CloudSun aria-hidden="true" />
            {chosen.place}
          </li>
        )}
        <li>
          <TrainFront aria-hidden="true" />
          {t('setup.location_stop_count', { count: stopCount })}
        </li>
      </ul>
      <p className="setup-wizard-location-aside setup-wizard-location-settings">{t('setup.location_in_settings')}</p>
      <button
        type="button"
        className="button search-dialog-confirm setup-wizard-button setup-wizard-location-continue"
        onClick={onDone}
      >
        {t('common.continue')}
      </button>
    </div>
  );
}

/**
 * The Location chapter: the postcode (the nearest the background lookup found, another near it, or one typed), which
 * sets the notice board and the weather; then the stations and bus stops near it for the Countdown; then what was set,
 * and that Settings changes it. Skip leaves all three as they are. `found` is the background lookup's answer
 * (useSetupLocation); its stops are used when the postcode is near where it placed the kiosk, else those near the
 * postcode are asked for.
 */
export default function SetupLocation({ found, onDone }: Readonly<{ found: SetupLocationAnswer; onDone: () => void }>) {
  type Step =
    { page: 'postcode' } | { page: 'stops'; chosen: Chosen } | { page: 'done'; chosen: Chosen; stops: number };
  const [step, setStep] = useState<Step>({ page: 'postcode' });
  if (step.page === 'postcode') {
    return <PostcodePage found={found} onChosen={chosen => setStep({ page: 'stops', chosen })} onSkip={onDone} />;
  }
  if (step.page === 'done') return <DonePage chosen={step.chosen} stopCount={step.stops} onDone={onDone} />;
  const { chosen } = step;
  const isNear = found && chosen.position && metresBetween(found.location, chosen.position) <= SAME_PLACE_METRES;
  return (
    <StopsPage
      chosen={chosen}
      prefetched={isNear ? found.stops : null}
      onDone={stops => setStep({ page: 'done', chosen, stops })}
    />
  );
}
