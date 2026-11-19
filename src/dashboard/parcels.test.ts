import type { DeviceNotices, Parcel, ParcelList } from 'countdown-api';
import { describe, expect, it } from 'vitest';
import panels from '../../vendor/countdown-api/src/countdown_api/fixtures/device_panels.json';
import example from '../../vendor/countdown-api/src/countdown_api/fixtures/parcels.json';
import { toNoticeItem } from './dashboardProps';
import { boardNotices } from './notices';
import { parcelNotices } from './parcels';

// countdown-api's example parcels, as stored at 2026-10-17 12:00 UTC (13:00 in London): shoes out for delivery, a book
// delivered, a lamp due on Monday the 19th, a phone case held with no day and a gift ordered with no day.
const stored = example.value as unknown as ParcelList;
const NOW = new Date('2026-10-17T12:00:00Z');

const parcel = (more: Partial<Parcel>): Parcel => ({
  description: 'Desk lamp',
  carrier: 'Royal Mail',
  tracking_number: 'AB000000001GB',
  status: 'in_transit',
  expected_date: '2026-10-19',
  updated_at: '2026-10-16T17:05:00+00:00',
  ...more
});

const said = (parcels: readonly Parcel[]) => parcelNotices(parcels, NOW).map(notice => [notice.title, notice.summary]);

describe('parcelNotices', () => {
  it("walks countdown-api's example: each state its own notice, the ones that need looking at first", () => {
    const notices = parcelNotices(stored.parcels, NOW);

    expect(notices.map(notice => [notice.title, notice.summary, notice.severity])).toEqual([
      ['Parcel out for delivery', 'Running shoes', 'info'],
      ['Parcel needs attention', 'Phone case', 'info'],
      ['Parcel arriving Mon 19 Oct', 'Desk lamp', 'everyday'],
      ['Parcel on its way', 'Gift', 'everyday'],
      ['Parcel delivered', 'Book', 'everyday']
    ]);
    expect(notices.every(notice => notice.kind === 'parcel')).toBe(true);
    expect(notices[0]?.detail).toBe('Running shoes (DHL, JD0000000000000001)');
  });

  it('says today and tomorrow, and a late one or one with no day yet', () => {
    expect(
      said([
        parcel({ description: 'Lamp', expected_date: '2026-10-17' }),
        parcel({ description: 'Mug', expected_date: '2026-10-18' }),
        parcel({ description: 'Pen', expected_date: '2026-10-15' }),
        parcel({ description: 'Hat', status: 'ordered', expected_date: null })
      ])
    ).toEqual([
      ['Parcel late', 'Pen'],
      ['Parcel arriving today', 'Lamp'],
      ['Parcel arriving tomorrow', 'Mug'],
      ['Parcel on its way', 'Hat']
    ]);
  });

  it('counts several in one state or on one day, naming them in its line', () => {
    expect(
      said([
        parcel({ description: 'Lamp' }),
        parcel({ description: 'Mug', tracking_number: 'X2' }),
        parcel({ description: 'Shoes', status: 'out_for_delivery', tracking_number: 'X3' }),
        parcel({ description: 'Hat', status: 'out_for_delivery', tracking_number: 'X4' })
      ])
    ).toEqual([
      ['2 parcels out for delivery', 'Shoes, Hat'],
      ['2 parcels arriving Mon 19 Oct', 'Lamp, Mug']
    ]);
  });

  it('names a parcel with no description by its tracking number, and makes nothing of none', () => {
    expect(said([parcel({ description: ' ' })])).toEqual([['Parcel arriving Mon 19 Oct', 'AB000000001GB']]);
    expect(parcelNotices([], NOW)).toEqual([]);
  });

  it('shows as a parcel row, blue when it needs looking at and white otherwise', () => {
    const notices = parcelNotices(stored.parcels, NOW);
    const out = notices.at(0);
    const delivered = notices.at(-1);
    expect(out && toNoticeItem(out)).toMatchObject({ kind: 'parcel', severity: 'info' });
    expect(delivered && toNoticeItem(delivered)).toMatchObject({ kind: 'parcel', severity: 'everyday' });
  });
});

describe('the notice board', () => {
  const device = panels.notices as unknown as DeviceNotices;

  it('has the parcels the server sent after its other notices, and only them without a postcode', () => {
    const titles = (notices: DeviceNotices) => boardNotices(notices, NOW, '24h').map(notice => notice.title);

    expect(titles({ ...device, postcode: null })).toEqual([
      'Parcel out for delivery',
      'Parcel needs attention',
      'Parcel arriving Mon 19 Oct',
      'Parcel on its way',
      'Parcel delivered'
    ]);
    expect(titles(device)).toEqual(expect.arrayContaining(['Parcel out for delivery', 'Parcel delivered']));
    expect(titles({ ...device, postcode: null, parcels: null })).toEqual([]);
  });
});
