// Where the music plays, as the Speakers view picks it. Three kinds of choice exclude each other: a Spotify Connect device,
// a group of Sonos rooms (started by the Pi, not by Spotify), and this tablet with any mix of its speaker outputs
// (AirPlay and connected Bluetooth speakers, which the Pi routes this tablet's sound to). Ticking a speaker only changes a
// draft; Save carries it out (useSpeakerSelection.ts).

/** Where the music plays, or should. Lists are sorted, so two choices compare by value. */
export type SpeakerChoice =
  { family: 'tablet'; outputs: string[] } | { family: 'connect'; id: string } | { family: 'sonos'; rooms: string[] };

/** What a selector stands for: this tablet, a Connect device, a Sonos room (by name) or a speaker output (by id). */
export type SpeakerKey = 'tablet' | `connect:${string}` | `sonos:${string}` | `output:${string}`;

const sorted = (values: Iterable<string>) => [...new Set(values)].toSorted((a, b) => a.localeCompare(b));

export function sameChoice(a: SpeakerChoice | null, b: SpeakerChoice | null): boolean {
  if (a === null || b === null) return a === b;
  const members = (choice: SpeakerChoice) => {
    if (choice.family === 'connect') return [choice.id];
    return choice.family === 'tablet' ? choice.outputs : choice.rooms;
  };
  return a.family === b.family && members(a).join('\n') === members(b).join('\n');
}

function splitKey(key: Exclude<SpeakerKey, 'tablet'>): { kind: string; value: string } {
  const colon = key.indexOf(':');
  return { kind: key.slice(0, colon), value: key.slice(colon + 1) };
}

/** Whether the choice has this selector ticked. */
export function isTicked(choice: SpeakerChoice | null, key: SpeakerKey): boolean {
  if (!choice) return false;
  if (key === 'tablet') return choice.family === 'tablet';
  const { kind, value } = splitKey(key);
  if (kind === 'connect') return choice.family === 'connect' && choice.id === value;
  if (kind === 'sonos') return choice.family === 'sonos' && choice.rooms.includes(value);
  return choice.family === 'tablet' && choice.outputs.includes(value);
}

const toggled = (values: readonly string[], value: string) =>
  sorted(values.includes(value) ? values.filter(other => other !== value) : [...values, value]);

/**
 * The choice after a tap on one selector. This tablet and a Connect device are a single choice, so tapping one that is
 * ticked changes nothing. Sonos rooms and speaker outputs add up within their own kind; a tap on another kind starts
 * over with that one.
 */
export function toggleChoice(choice: SpeakerChoice | null, key: SpeakerKey): SpeakerChoice {
  if (key === 'tablet') return choice?.family === 'tablet' ? choice : { family: 'tablet', outputs: [] };
  const { kind, value } = splitKey(key);
  if (kind === 'connect') return { family: 'connect', id: value };
  if (kind === 'sonos') {
    return { family: 'sonos', rooms: choice?.family === 'sonos' ? toggled(choice.rooms, value) : [value] };
  }
  return { family: 'tablet', outputs: choice?.family === 'tablet' ? toggled(choice.outputs, value) : [value] };
}

export const tabletChoice = (outputs: Iterable<string>): SpeakerChoice => ({
  family: 'tablet',
  outputs: sorted(outputs)
});
export const sonosChoice = (rooms: Iterable<string>): SpeakerChoice => ({ family: 'sonos', rooms: sorted(rooms) });
