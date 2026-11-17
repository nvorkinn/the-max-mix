import { describe, expect, it } from 'vitest';
import type { DeviceNotices } from 'countdown-api';
import network from '../../vendor/countdown-api/src/countdown_api/fixtures/tfl_network.json';
import panels from '../../vendor/countdown-api/src/countdown_api/fixtures/device_panels.json';
import { toLineStatus } from './lineStatus';

const NOTICES = panels.notices as unknown as DeviceNotices;
// Within the example's statuses' periods.
const NOW = new Date('2026-09-25T12:00:00Z');

const withLines = (lines: object[]): DeviceNotices => ({
  ...NOTICES,
  tfl_network: { fetched_at: NOW.toISOString(), lines: lines as never[] }
});
const line = (...statuses: { statusSeverityDescription: string; validityPeriods?: object[] }[]) => ({
  id: 'northern',
  name: 'Northern',
  lineStatuses: statuses
});

describe('toLineStatus', () => {
  it("gives every line in TfL's order, each with its status in sentence case and how it looks", () => {
    const status = toLineStatus(NOTICES, NOW);

    expect(status?.lines).toHaveLength(network.value.lines.length);
    expect(status?.lines.map(item => item.id)).toEqual(network.value.lines.map(item => item.id));
    const byId = new Map(status?.lines.map(item => [item.id, item]));
    expect(byId.get('bakerloo')).toEqual({ id: 'bakerloo', name: 'Bakerloo', status: 'Good service', health: 'good' });
    expect(byId.get('central')).toMatchObject({ status: 'Minor delays', health: 'disruption' });
    expect(byId.get('district')).toMatchObject({ status: 'Part closure', health: 'severe' });
    expect(byId.get('waterloo-city')).toMatchObject({ status: 'Service closed', health: 'closed' });
    expect(byId.get('elizabeth')).toMatchObject({ name: 'Elizabeth line', health: 'good' });
  });

  it("shows the worst of a line's statuses in force now, and good service when none is", () => {
    const later = [{ fromDate: '2026-09-26T05:00:00Z', toDate: '2026-09-27T05:00:00Z' }];
    const status = (lineStatus: ReturnType<typeof line>) => toLineStatus(withLines([lineStatus]), NOW)?.lines[0];

    expect(
      status(line({ statusSeverityDescription: 'Minor Delays' }, { statusSeverityDescription: 'Part Suspended' }))
    ).toMatchObject({ status: 'Part suspended', health: 'severe' });
    expect(status(line({ statusSeverityDescription: 'Planned Closure', validityPeriods: later }))).toMatchObject({
      status: 'Good service',
      health: 'good'
    });
    expect(status(line({ statusSeverityDescription: 'Bus Service' }))).toMatchObject({ health: 'disruption' });
  });

  it('is null without the network: none stored, outside London, or an older server', () => {
    expect(toLineStatus(null, NOW)).toBeNull();
    expect(toLineStatus({ ...NOTICES, tfl_network: null }, NOW)).toBeNull();
    expect(toLineStatus({ ...NOTICES, tfl_network: undefined } as unknown as DeviceNotices, NOW)).toBeNull();
    expect(toLineStatus(withLines([]), NOW)).toBeNull();
  });
});
