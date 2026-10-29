import { describe, it, expect } from 'vitest';
import { getDivaForUser, GLOBAL_DIVAS, MINIMALIST_AVATARS } from './divas.js';

describe('getDivaForUser', () => {
  it('is deterministic for the same user', () => {
    expect(getDivaForUser('alice')).toBe(getDivaForUser('alice'));
  });

  it('always returns a member of the neon roster by default', () => {
    for (const name of ['a', 'bob', 'Zoë', '12345', 'a much longer guest name']) {
      expect(GLOBAL_DIVAS).toContain(getDivaForUser(name));
    }
  });

  it('uses the roster for the selected theme', () => {
    expect(MINIMALIST_AVATARS).toContain(getDivaForUser('alice', 0, 'minimal'));
    expect(GLOBAL_DIVAS).toContain(getDivaForUser('alice', 0, 'unknown-theme'));
  });

  it('falls back to the index (wrapping) when there is no user', () => {
    expect(getDivaForUser(null, 2)).toBe(GLOBAL_DIVAS[2]);
    expect(getDivaForUser('', GLOBAL_DIVAS.length + 1)).toBe(GLOBAL_DIVAS[1]);
    expect(getDivaForUser(undefined, 1, 'minimal')).toBe(MINIMALIST_AVATARS[1]);
  });

  it('rosters have unique names and images', () => {
    for (const roster of [GLOBAL_DIVAS, MINIMALIST_AVATARS]) {
      expect(new Set(roster.map(d => d.name)).size).toBe(roster.length);
      expect(new Set(roster.map(d => d.image)).size).toBe(roster.length);
    }
  });
});
