// Where the music plays, as the Speakers view picks it. Three kinds of choice exclude each other: a Spotify Connect device,
// a group of Sonos rooms handed the music (started by the Pi, not by Spotify), and this tablet, which stays Spotify's
// player, with either any mix of its speaker outputs (AirPlay and connected Bluetooth speakers, which the Pi routes this
// tablet's sound to) or Sonos rooms that play along with it (the Pi streams this tablet's sound to them). Ticking a Sonos
// room keeps this tablet ticked; unticking this tablet then hands the music over to the rooms. Ticking a speaker only
// changes a draft; Save carries it out (useSpeakerSelection.ts).

/** Where the music plays, or should. Lists are sorted, so two choices compare by value. */
export type SpeakerChoice =
  | { family: 'tablet'; outputs: string[]; rooms: string[] }
  | { family: 'connect'; id: string }
  | { family: 'sonos'; rooms: string[] };

/** What a selector stands for: this tablet, a Connect device, a Sonos room (by name) or a speaker output (by id). */
export type SpeakerKey = 'tablet' | `connect:${string}` | `sonos:${string}` | `output:${string}`;

const sorted = (values: Iterable<string>) => [...new Set(values)].toSorted((a, b) => a.localeCompare(b));

export function sameChoice(a: SpeakerChoice | null, b: SpeakerChoice | null): boolean {
  if (a === null || b === null) return a === b;
  const members = (choice: SpeakerChoice) => {
    if (choice.family === 'connect') return [choice.id];
    return choice.family === 'tablet' ? [...choice.outputs, '', ...choice.rooms] : choice.rooms;
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
  if (kind === 'sonos') return choice.family !== 'connect' && choice.rooms.includes(value);
  return choice.family === 'tablet' && choice.outputs.includes(value);
}

const toggled = (values: readonly string[], value: string) =>
  sorted(values.includes(value) ? values.filter(other => other !== value) : [...values, value]);

export const tabletChoice = (outputs: Iterable<string>, rooms: Iterable<string> = []): SpeakerChoice => ({
  family: 'tablet',
  outputs: sorted(outputs),
  rooms: sorted(rooms)
});
export const sonosChoice = (rooms: Iterable<string>): SpeakerChoice => ({ family: 'sonos', rooms: sorted(rooms) });

/** The choice after a tap on this tablet: with Sonos rooms it hands the music over to them, or takes it back. */
function toggleTablet(choice: SpeakerChoice | null): SpeakerChoice {
  if (choice?.family === 'tablet') return choice.rooms.length > 0 ? sonosChoice(choice.rooms) : choice;
  return tabletChoice([], choice?.family === 'sonos' ? choice.rooms : []);
}

/**
 * The choice after a tap on one selector. A Connect device is a single choice. A Sonos room joins this tablet (or the
 * rooms handed the music) and a speaker output joins this tablet, each adding up within its own kind; rooms and outputs
 * do not mix, so a tap on one kind starts over with that one.
 */
export function toggleChoice(choice: SpeakerChoice | null, key: SpeakerKey): SpeakerChoice {
  if (key === 'tablet') return toggleTablet(choice);
  const { kind, value } = splitKey(key);
  if (kind === 'connect') return { family: 'connect', id: value };
  if (kind === 'sonos') {
    if (choice?.family === 'sonos') return sonosChoice(toggled(choice.rooms, value));
    return tabletChoice([], choice?.family === 'tablet' ? toggled(choice.rooms, value) : [value]);
  }
  return tabletChoice(choice?.family === 'tablet' ? toggled(choice.outputs, value) : [value]);
}
