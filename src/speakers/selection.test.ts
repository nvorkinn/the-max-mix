import { describe, expect, it } from 'vitest';
import { isTicked, sameChoice, sonosChoice, tabletChoice, toggleChoice } from './selection';

describe('toggleChoice', () => {
  it('makes this tablet and a Connect device a single choice', () => {
    const tablet = toggleChoice(null, 'tablet');
    expect(tablet).toEqual({ family: 'tablet', outputs: [] });
    expect(toggleChoice(tablet, 'tablet')).toBe(tablet);
    expect(toggleChoice(tablet, 'connect:dev1')).toEqual({ family: 'connect', id: 'dev1' });
    expect(toggleChoice({ family: 'connect', id: 'dev1' }, 'connect:dev2')).toEqual({ family: 'connect', id: 'dev2' });
  });

  it('adds up Sonos rooms, and outputs, within their own kind only', () => {
    const one = toggleChoice({ family: 'connect', id: 'dev1' }, 'sonos:Kitchen');
    const two = toggleChoice(one, 'sonos:Bath');
    expect(two).toEqual({ family: 'sonos', rooms: ['Bath', 'Kitchen'] });
    expect(toggleChoice(two, 'sonos:Kitchen')).toEqual({ family: 'sonos', rooms: ['Bath'] });
    const outputs = toggleChoice(toggleChoice(two, 'output:raop_sink.b'), 'output:bluez_output.a');
    expect(outputs).toEqual({ family: 'tablet', outputs: ['bluez_output.a', 'raop_sink.b'] });
    // A Sonos room starts over, leaving this tablet and its outputs.
    expect(toggleChoice(outputs, 'sonos:Kitchen')).toEqual({ family: 'sonos', rooms: ['Kitchen'] });
  });
});

describe('isTicked and sameChoice', () => {
  it('read a choice by selector, and compare choices by value', () => {
    const choice = tabletChoice(['raop_sink.b', 'raop_sink.a']);
    expect(isTicked(choice, 'tablet')).toBe(true);
    expect(isTicked(choice, 'output:raop_sink.a')).toBe(true);
    expect(isTicked(choice, 'output:raop_sink.c')).toBe(false);
    expect(isTicked(sonosChoice(['Kitchen']), 'sonos:Kitchen')).toBe(true);
    expect(isTicked({ family: 'connect', id: 'dev1' }, 'connect:dev1')).toBe(true);
    expect(isTicked(null, 'tablet')).toBe(false);
    expect(sameChoice(choice, tabletChoice(['raop_sink.a', 'raop_sink.b']))).toBe(true);
    expect(sameChoice(choice, tabletChoice([]))).toBe(false);
    expect(sameChoice(sonosChoice(['dev1']), { family: 'connect', id: 'dev1' })).toBe(false);
    expect(sameChoice(null, null)).toBe(true);
    expect(sameChoice(null, choice)).toBe(false);
  });
});
