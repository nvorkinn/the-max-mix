import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { handoverFile, parseHandover } from './handover.ts';

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});

describe('parseHandover', () => {
  it("takes the app's own string items", () => {
    expect(parseHandover({ items: { 'maxmix.people': '[]', 'maxmix.deviceId': 'abc' } })).toEqual({
      'maxmix.people': '[]',
      'maxmix.deviceId': 'abc'
    });
    expect(parseHandover({ items: {} })).toEqual({});
  });

  it('refuses anything else', () => {
    expect(parseHandover(null)).toBeNull();
    expect(parseHandover({ items: [] })).toBeNull();
    expect(parseHandover({ items: { 'other.key': 'x' } })).toBeNull();
    expect(parseHandover({ items: { 'maxmix.people': 1 } })).toBeNull();
    const many = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`maxmix.item${index}`, '']));
    expect(parseHandover({ items: many })).toBeNull();
  });
});

describe('handoverFile', () => {
  it('keeps the items for the kiosk user only, and deletes them', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'handover-'));
    folders.push(folder);
    const file = path.join(folder, 'state', 'handover.json');
    const store = handoverFile(file);
    expect(await store.read()).toBeNull();
    await store.save({ 'maxmix.deviceId': 'abc' });
    expect(await store.read()).toEqual({ 'maxmix.deviceId': 'abc' });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await store.remove();
    expect(await store.read()).toBeNull();
  });
});
