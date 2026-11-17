// cspell:ignore linjen
import { describe, expect, it } from 'vitest';
import { say } from './messages';

describe('say', () => {
  it("names a line by TfL's mode: a Tube line, a bus route or several, any other by its own name", () => {
    expect(say('notice.line.label', { mode: 'tube', count: 1, lines: 'Northern' })).toBe('Northern line');
    expect(say('notice.line.label', { mode: 'bus', count: 1, lines: '333' })).toBe('Bus 333');
    expect(say('notice.line.label', { mode: 'bus', count: 2, lines: '333, 415' })).toBe('Buses 333, 415');
    expect(say('notice.line.label', { mode: 'dlr', count: 1, lines: 'DLR' })).toBe('DLR');
    expect(say('notice.line.label', { mode: '', count: 1, lines: 'Tram' })).toBe('Tram');
  });

  it('says what is wrong on a line in a word or two', () => {
    const status = (key: string) => say('notice.line.status', { status: key });
    expect(
      ['suspended', 'part_suspended', 'severe_delays', 'issues', 'closed', 'part_closed', 'not_running'].map(key =>
        status(key)
      )
    ).toEqual(['Suspended', 'Part suspended', 'Severe delays', 'Issues', 'Closed', 'Part closed', 'Not running']);
    expect(status('anything else')).toBe('Disrupted');
    expect(say('notice.line.title', { label: 'Northern line', status: 'Severe delays' })).toBe(
      'Northern line: Severe delays'
    );
  });

  it('says a weather warning by its colour and what it warns of, and until when', () => {
    expect(say('notice.weather.title')).toBe('Weather warning');
    expect(say('notice.weather.warning', { colour: 'red', hazard: 'wind' })).toBe('Red warning: wind');
    expect(say('notice.weather.warning', { colour: 'amber', hazard: 'rain' })).toBe('Amber warning: rain');
    expect(say('notice.weather.warning', { colour: 'yellow', hazard: 'fog' })).toBe('Yellow warning: fog');
    expect(say('notice.weather.warning', { colour: '', hazard: 'snow' })).toBe('Warning: snow');
    expect(say('notice.until', { when: 'Fri 21:00' })).toBe('until Fri 21:00');
  });

  it('says the next bank holiday and its day', () => {
    expect(say('notice.holiday.title')).toBe('Upcoming bank holiday');
    expect(say('notice.holiday.summary', { when: 'Fri 25 Dec', name: 'Christmas Day' })).toBe(
      'Fri 25 Dec – Christmas Day'
    );
    expect(say('notice.day.today')).toBe('Today');
    expect(say('notice.day.tomorrow')).toBe('Tomorrow');
  });

  it("puts an argument in as it is, whatever of ICU's own characters it has", () => {
    const odd = "St. Paul's {now} #1 '{' }{ ''";
    expect(say('notice.holiday.summary', { when: odd, name: odd })).toBe(`${odd} – ${odd}`);
    expect(say('notice.line.label', { mode: 'bus', count: 2, lines: odd })).toBe(`Buses ${odd}`);
    expect(say('notice.until', { when: odd })).toBe(`until ${odd}`);
  });

  it('says the same in another language of the catalog, each compiled once', () => {
    expect(say('notice.day.today', {}, 'nb')).toBe('I dag');
    expect(say('notice.line.label', { mode: 'tube', count: 1, lines: 'Northern' }, 'nb')).toBe('Northern-linjen');
    expect(say('notice.day.today')).toBe('Today');
  });
});
