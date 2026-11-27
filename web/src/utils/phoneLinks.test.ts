import { describe, it, expect, vi, beforeEach } from 'vitest';
import { forgetUnlinkedPhone, setPersonPhone } from './phoneLinks';

const auth = vi.hoisted(() => ({
  people: [] as { spotifyId: string; phoneAddress: string }[],
  linkPhone: vi.fn(),
  peopleOnKiosk: vi.fn()
}));
const monitor = vi.hoisted(() => ({ forgetPhone: vi.fn() }));
vi.mock('../spotify/auth', () => auth);
vi.mock('./bluetoothMonitor', () => monitor);

describe('phoneLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.people = [
      { spotifyId: 'anna', phoneAddress: 'AA:01' },
      { spotifyId: 'olav', phoneAddress: 'AA:02' }
    ];
    auth.peopleOnKiosk.mockImplementation(() => auth.people);
    auth.linkPhone.mockImplementation((spotifyId: string, address: string) => {
      auth.people = auth.people.map(person =>
        person.spotifyId === spotifyId ? { ...person, phoneAddress: address } : person
      );
    });
    monitor.forgetPhone.mockResolvedValue(undefined);
  });

  it('has the Pi forget a phone nobody links any more, so it can pair again', () => {
    setPersonPhone('anna', '');
    expect(auth.linkPhone).toHaveBeenCalledWith('anna', '');
    expect(monitor.forgetPhone).toHaveBeenCalledWith('AA:01');
  });

  it('forgets the phone a newly linked one replaces', () => {
    setPersonPhone('anna', 'AA:03');
    expect(monitor.forgetPhone).toHaveBeenCalledWith('AA:01');
  });

  it('keeps a phone someone else still links, and one linked again', () => {
    setPersonPhone('anna', 'AA:02');
    setPersonPhone('olav', '');
    setPersonPhone('anna', 'aa:02');
    expect(monitor.forgetPhone).toHaveBeenCalledTimes(1);
    expect(monitor.forgetPhone).toHaveBeenCalledWith('AA:01');
  });

  it('forgets a removed person’s phone, and does nothing for no phone', () => {
    auth.people = auth.people.filter(person => person.spotifyId !== 'olav');
    forgetUnlinkedPhone('AA:02');
    forgetUnlinkedPhone('');
    expect(monitor.forgetPhone).toHaveBeenCalledTimes(1);
    expect(monitor.forgetPhone).toHaveBeenCalledWith('AA:02');
  });
});
