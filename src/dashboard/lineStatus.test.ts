import { describe, expect, it } from 'vitest';
import type { DeviceNotices } from 'countdown-api';
import network from '../../vendor/countdown-api/src/countdown_api/fixtures/tfl_network.json';
import panels from '../../vendor/countdown-api/src/countdown_api/fixtures/device_panels.json';
import { groupLines, toLineStatus } from './lineStatus';

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

describe('groupLines', () => {
  it('gives each line with something wrong its own row, worst first, and collapses quiet lines sharing a status', () => {
    const lines = toLineStatus(NOTICES, NOW)?.lines ?? [];
    const delayed = { id: 'jubilee', name: 'Jubilee', status: 'Minor delays', health: 'disruption' as const };
    const severe = { id: 'victoria', name: 'Victoria', status: 'Severe delays', health: 'severe' as const };

    const rows = (items: typeof lines) =>
      groupLines(items).map(group => [group.status, group.lines.map(item => item.id).join(',')]);

    expect(rows(lines)).toEqual([
      ['Part closure', 'district'],
      ['Minor delays', 'central'],
      ['Service closed', 'waterloo-city'],
      ['Good service', 'bakerloo,circle,elizabeth,hammersmith-city,jubilee,metropolitan,northern,piccadilly,victoria']
    ]);
    const others = lines.filter(item => !['jubilee', 'victoria'].includes(item.id));
    expect(rows([...others, delayed, severe]).slice(0, 4)).toEqual([
      ['Part closure', 'district'],
      ['Severe delays', 'victoria'],
      ['Minor delays', 'central'],
      ['Minor delays', 'jubilee']
    ]);
    const closed = lines.map(item => ({ ...item, status: 'Service closed', health: 'closed' as const }));
    expect(rows(closed)).toEqual([['Service closed', lines.map(item => item.id).join(',')]]);
  });
});
