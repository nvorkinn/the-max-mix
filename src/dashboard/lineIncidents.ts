// The incidents panel's rows, from countdown-server's entur_stops (getNotices and the feed's notices event): each
// Entur stop's situations as countdown's Entur situations provider stored them, Entur's journey planner's own answer.
// Unlike the Tube's status, only problems are listed: Ruter marks a disruption an "incident" (a closure, delays, a
// diversion, a replacement bus) and what's only worth knowing "general" (real time not working, step-free access), and
// gives no status like TfL's, so the panel shows the operator's own summary beside the lines it's about.

import type { DeviceNotices, EnturStopNotices } from 'countdown-api';
import type { IncidentLine, LineIncident, LineIncidentsProps } from './props';

/** The parts of Entur's situation read here (the contract leaves Entur's answer open). */
interface EnturSituation {
  summary?: { value?: string | null; language?: string | null }[] | null;
  validityPeriod?: { startTime?: string | null; endTime?: string | null } | null;
  severity?: string | null;
  reportType?: string | null;
}

interface EnturLine {
  id?: string | null;
  publicCode?: string | null;
  transportMode?: string | null;
}

interface EnturStop {
  situations?: EnturSituation[] | null;
  /** A stop place's lines, by quay. */
  quays?: { lines?: (EnturLine & { situations?: EnturSituation[] | null })[] | null }[] | null;
  /** A quay's lines. */
  lines?: (EnturLine & { situations?: EnturSituation[] | null })[] | null;
  estimatedCalls?:
    { serviceJourney?: { line?: EnturLine | null } | null; situations?: EnturSituation[] | null }[] | null;
}

// Entur's severities that are worse than a disruption.
const SEVERE = new Set(['severe', 'verySevere']);
// The order the modes' lines are listed in, as the boards' route boxes are coloured.
const MODES = ['metro', 'tram', 'bus', 'rail', 'water', 'coach'];
const ENGLISH = new Set(['en', 'eng']);

/** The summary in English where Entur has it, else the first it has, each run of whitespace one space. */
function summary(situation: EnturSituation): string {
  const texts = (situation.summary ?? []).filter(text => text.value?.trim());
  const text = texts.find(each => ENGLISH.has((each.language ?? '').toLowerCase())) ?? texts[0];
  return (text?.value ?? '').replaceAll(/\s+/g, ' ').trim();
}

/** Whether a situation is an incident in force at `now`: begun (Entur says so), and not ended. */
function inForce(situation: EnturSituation, now: Date): boolean {
  if (situation.reportType !== 'incident') return false;
  const { startTime, endTime } = situation.validityPeriod ?? {};
  const time = now.getTime();
  return (!startTime || Date.parse(startTime) <= time) && (!endTime || time <= Date.parse(endTime));
}

const toLine = (line: EnturLine | null | undefined): IncidentLine | null =>
  line?.id && line.publicCode ? { id: line.id, code: line.publicCode, mode: line.transportMode ?? 'bus' } : null;

const modeRank = (mode: string) => (MODES.includes(mode) ? MODES.indexOf(mode) : MODES.length);
const byModeAndCode = (a: IncidentLine, b: IncidentLine) =>
  modeRank(a.mode) - modeRank(b.mode) || a.code.localeCompare(b.code, 'en', { numeric: true });

/** Each of a stop's situations with the line it's on (null for the stop's own): its lines' and its departures'. */
function stopSituations(stop: EnturStop): { situation: EnturSituation; line: IncidentLine | null }[] {
  const own = (stop.situations ?? []).map(situation => ({ situation, line: null }));
  const lines = [...(stop.quays ?? []).flatMap(quay => quay.lines ?? []), ...(stop.lines ?? [])];
  const onLines = lines.flatMap(line => (line.situations ?? []).map(situation => ({ situation, line: toLine(line) })));
  const onCalls = (stop.estimatedCalls ?? []).flatMap(call =>
    (call.situations ?? []).map(situation => ({ situation, line: toLine(call.serviceJourney?.line) }))
  );
  return [...own, ...onLines, ...onCalls];
}

const situationsOf = (stop: EnturStopNotices): EnturStop | null => {
  const data = stop.situations?.data as { stopPlace?: EnturStop | null; quay?: EnturStop | null } | undefined;
  return data?.stopPlace ?? data?.quay ?? null;
};

/**
 * The panel's incidents at `now`, or null when there are none (no Entur stops, nothing stored, or nothing wrong): one
 * per summary, however many of Entur's situations say it (Ruter writes a network-wide closure once per line) and
 * however many of the kiosk's stops it's at, with every line it's about.
 */
export function toLineIncidents(notices: DeviceNotices | null, now: Date): LineIncidentsProps | null {
  // An older countdown-server leaves entur_stops out.
  const stops: readonly EnturStopNotices[] | undefined = notices?.entur_stops;
  const found = (stops ?? []).flatMap(stop => {
    const answer = situationsOf(stop);
    return answer ? stopSituations(answer) : [];
  });
  const incidents = new Map<string, LineIncident>();
  for (const { situation, line } of found) {
    const text = summary(situation);
    if (!text || !inForce(situation, now)) continue;
    const health = SEVERE.has(situation.severity ?? '') ? 'severe' : 'disruption';
    const incident = incidents.get(text) ?? { key: text, text, health, lines: [] };
    if (health === 'severe') incident.health = health;
    if (line && incident.lines.every(each => each.id !== line.id)) incident.lines.push(line);
    incidents.set(text, incident);
  }
  const list = Array.from(incidents.values(), incident => ({
    ...incident,
    lines: incident.lines.toSorted(byModeAndCode)
  }));
  const severeFirst = (a: LineIncident, b: LineIncident) =>
    Number(b.health === 'severe') - Number(a.health === 'severe');
  return list.length > 0 ? { incidents: list.toSorted(severeFirst) } : null;
}
