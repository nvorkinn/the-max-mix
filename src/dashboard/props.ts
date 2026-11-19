// The props of each Dashboard component in the redesign (the static page in public/dashboard-mockup): tab bar, weather
// block, hourly strip, notice board and the stops' departure boards. They are the contract between the components and the
// data layer, which maps countdown-server's answers (countdown-api's shapes) to them, so a component never reads the
// server's shapes and the data layer never knows how a component draws.
//
// Times are ISO strings as the server sends them, and each component that counts down or says how long ago is given
// `now`, so a fixture can drive the board with a simulated clock and a test can freeze it.

/** @public The tabs, in the order the tab bar shows them. */
export type TabId = 'spotify' | 'dashboard' | 'settings';

/** @public */
export interface TabBarProps {
  active: TabId;
  onSelect: (tab: TabId) => void;
  /** The person signed in to Spotify, shown as their picture or else their initial; null with nobody signed in. */
  person: { name: string; pictureUrl: string | null } | null;
  /** Opens search; null hides the button. */
  onSearch: (() => void) | null;
  /** For the clock, which the bar formats in `clockFormat`. */
  now: Date;
  clockFormat: '12h' | '24h';
  /** The Settings tab's extras. Puts the screen to sleep; null or absent hides the button. */
  onSleep?: (() => void) | null;
  /** Makes the person's picture open the person switcher, which calls this with whoever is picked. */
  onSwitchPerson?: ((spotifyId: string) => void) | null;
  /** Called once the clock has been held for two seconds (the debug console). */
  onClockHold?: (() => void) | null;
}

/** @public The kinds of weather drawn, each with its own icon (by day and by night where they differ). */
export type Sky = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder';

/** @public The periods the weather block rotates through, Now first. */
export type WeatherPeriod = 'now' | 'tonight' | 'tomorrow' | 'weekend';

/** @public One view of the weather block. */
export interface WeatherView {
  period: WeatherPeriod;
  /** Degrees Celsius, whole: now's temperature; tonight's low; tomorrow's and the weekend's high. */
  temperature: number;
  sky: Sky;
  /** Whether its sky is drawn by day (a sun) or by night (a moon); by day when left out. */
  isDay?: boolean;
  /** "Partly cloudy". */
  condition: string;
  /**
   * One short line the hourly strip doesn't already say ("Umbrella after 1pm"), or null to show none. The data layer
   * decides; the component never makes one up.
   */
  summary: string | null;
  /** The icon beside `summary`: an umbrella (the default) for rain, a sun for fine weather. */
  summaryIcon?: 'umbrella' | 'sun';
}

/** @public */
export interface WeatherBlockProps {
  /** The views to rotate through, Now first; a period with no forecast is left out. */
  views: WeatherView[];
}

/** @public The days after today, under the weather while the rail has room for them. */
export interface OutlookProps {
  /** Tomorrow first; empty with no forecast. */
  days: DayForecast[];
}

/** @public One hour of the hourly strip. */
export interface HourForecast {
  /** The start of the hour, as an ISO time in the place's offset. */
  time: string;
  /** Degrees Celsius, whole. */
  temperature: number;
  sky: Sky;
  isDay: boolean;
}

/** @public One day of the outlook under the weather. */
export interface DayForecast {
  /** The place's date, "2026-11-20". */
  date: string;
  /** Degrees Celsius, whole. */
  high: number;
  low: number;
  sky: Sky;
}

/** @public */
export interface HourlyStripProps {
  /** The coming hours, soonest first; the strip shows five. */
  hours: HourForecast[];
  /** When countdown-server last read the data the Dashboard shows, as an ISO time, for the "Updated" note. */
  updatedAt: string;
  /** True once the feed has dropped and the Dashboard is showing its last data. */
  stale: boolean;
  now: Date;
  clockFormat: '12h' | '24h';
}

/** @public What a notice is about, which picks its icon. */
export type NoticeKind =
  'weather-warning' | 'delays' | 'closure' | 'planned-works' | 'road-works' | 'bank-holiday' | 'bins' | 'parcel';

/**
 * @public How much a notice matters, which picks its icon's colour: severe red (weather warnings, closures and
 * suspensions in force), disruption amber (delays), planned and info blue, everyday white (bins, parcels). A closure is
 * never less than disruption.
 */
export type NoticeSeverity = 'severe' | 'disruption' | 'planned' | 'info' | 'everyday';

/** @public One row of the notice board. */
export interface NoticeItem {
  /** Stable across updates, so a row isn't redrawn (or faded in again) when nothing about it changed. */
  id: string;
  kind: NoticeKind;
  severity: NoticeSeverity;
  /** A few words: "Northern line: Delays". */
  title: string;
  /** One short line: "Minor delays due to a signal fault". */
  summary: string;
  /** The full text, opened by tapping the row; null when there is no more to say, and then the row has no chevron. */
  detail: string | null;
}

/** @public */
export interface NoticeBoardProps {
  /** Most urgent first. Rows have a fixed height; those that don't fit page through. */
  notices: NoticeItem[];
}

/** What every departure row has. */
interface DepartureBase {
  /**
   * TfL's vehicleId (a bus's registration, a train's set number): rows are keyed by it, so a row follows its vehicle
   * when predictions reorder. Unique within a board.
   */
  vehicleId: string;
  destination: string;
  /** When it is due, as an ISO time; the board counts down from `now`. */
  expectedAt: string;
}

/** @public One departure on a stop's board, a bus, tram or train: a stop serving several modes mixes them. */
export interface Departure extends DepartureBase {
  /** Its mode: bus, tube, metro, tram, rail, water..., which picks how its line is drawn. */
  mode: string;
  /** The line's name or number: "Northern", "12", "RE11". */
  line: string;
  /** TfL's line id ("northern", "bakerloo"), which picks a Tube line's colour. */
  lineId: string;
  /** Under the destination: "Platform 1 · Northbound", "Stop E", or null when there's nothing to say. */
  detail: string | null;
  /**
   * Its clock time ("05:42") when it is only the timetable's, with no live prediction (the first trains while the
   * Tube is shut): the board shows that, dimmed, instead of counting down. Absent for a live departure.
   */
  scheduledAt?: string;
}

/**
 * @public The network a stop belongs to, which heads its board with its mark (TfL's roundel, Ruter's hash) and picks
 * how its lines are drawn: TfL's Tube lines as coloured pills and its buses as red route numbers; Norway's (Entur's)
 * lines as route numbers coloured by mode.
 */
export type Network = 'tfl' | 'entur';

/** @public A stop's board: its next departures, whatever their modes, soonest first. */
export interface StopBoardProps {
  network: Network;
  /** The stop, which heads the board ("Elephant & Castle"). */
  stopName: string;
  /** The letter on a bus stop's flag ("E"), shown by its name; null for a stop without one, or a hub of several. */
  stopLetter: string | null;
  /** Soonest first. The board shows the first four; the rest are waiting to move up. */
  departures: Departure[];
  now: Date;
  /** True once the feed has dropped and the board is showing its last departures. */
  stale: boolean;
}

/**
 * @public How a line is running, which picks its status's colour: severe red (closures, suspensions, severe delays),
 * disruption amber (delays, a reduced service), quiet for good service and for a line closed for the night.
 */
export type LineHealth = 'good' | 'closed' | 'disruption' | 'severe';

/** @public One line of the Tube status panel. */
export interface LineStatusItem {
  /** TfL's line id ("northern"), which picks the line's colour. */
  id: string;
  /** "Northern", "Elizabeth line". */
  name: string;
  /** "Good service", "Minor delays": the worst of the line's statuses in force now. */
  status: string;
  health: LineHealth;
}

/** @public The Tube status panel, shown in the notice board's place when it has nothing to say. */
export interface TubeStatusProps {
  /** Every Tube line and the Elizabeth line, in TfL's order. */
  lines: LineStatusItem[];
}

/** @public One stop's board along the bottom. */
export type DepartureBoardProps = { id: string } & StopBoardProps;
