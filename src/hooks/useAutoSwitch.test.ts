import { describe, expect, it } from 'vitest';
import type { PersonOnKiosk } from '../spotify/auth';
import { whoToSwitchTo } from './useAutoSwitch';

const person = (spotifyId: string, phoneAddress: string, more: Partial<PersonOnKiosk> = {}): PersonOnKiosk => ({
  spotifyId,
  name: spotifyId,
  imageUrl: '',
  phoneAddress,
  active: false,
  signedIn: true,
  ...more
});
const heard = (...addresses: string[]) => addresses.map(address => ({ address, name: address, isHere: true }));

const nikolai = person('nikolai', 'AA:AA', { active: true });
const sam = person('sam', 'BB:BB');
const kim = person('kim', 'CC:CC');

describe('whoToSwitchTo', () => {
  it('switches to the one other person heard when the active person is not', () => {
    expect(whoToSwitchTo([nikolai, sam, kim], heard('bb:bb'))).toBe('sam');
  });

  it('stays when the active person is heard', () => {
    expect(whoToSwitchTo([nikolai, sam], heard('AA:AA', 'BB:BB'))).toBeNull();
  });

  it('stays when more than one other person is heard', () => {
    expect(whoToSwitchTo([nikolai, sam, kim], heard('BB:BB', 'CC:CC'))).toBeNull();
  });

  it('stays when nobody else is heard', () => {
    expect(whoToSwitchTo([nikolai, sam], [{ address: 'BB:BB', name: 'B', isHere: false }])).toBeNull();
  });

  it('stays when the active person has no phone linked', () => {
    expect(whoToSwitchTo([{ ...nikolai, phoneAddress: '' }, sam], heard('BB:BB'))).toBeNull();
  });

  it('does not switch to someone who is signed out', () => {
    expect(whoToSwitchTo([nikolai, { ...sam, signedIn: false }], heard('BB:BB'))).toBeNull();
  });
});
