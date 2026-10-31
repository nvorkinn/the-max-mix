import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IDLE, parseStatus, readStatus, respond } from './status.ts';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const ORIGIN = 'https://the-max-mix.vercel.app';
const options = { file: '/nonexistent/status', origin: ORIGIN, port: 7457 };
const request = { method: 'GET', path: '/status', host: '127.0.0.1:7457', origin: ORIGIN };

describe('parseStatus', () => {
  it('reads what kiosk-pull writes', () => {
    const text = `state=installing\nref=v1.14.0\ncommit=${COMMIT}\nstarted=100\nupdated=160\nstep=12\ntotal=80\ndetail=Install "Node.js" = latest\n`;
    expect(parseStatus(text)).toEqual({
      state: 'installing',
      ref: 'v1.14.0',
      commit: COMMIT,
      started: 100,
      updated: 160,
      step: 12,
      total: 80,
      detail: 'Install "Node.js" = latest'
    });
  });

  it('reads an unknown state as idle and drops malformed fields', () => {
    expect(parseStatus('state=rebooting\n')).toEqual(IDLE);
    expect(parseStatus('')).toEqual(IDLE);
    const status = parseStatus('state=failed\nref=../../etc passwd\ncommit=xyz\nstarted=-1\nstep=1e3\ndetail=a\u0007b');
    expect(status).toMatchObject({ ref: '', commit: '', started: 0, step: 0, detail: 'a b' });
  });
});

describe('readStatus', () => {
  it('is idle without a status file', async () => {
    expect(await readStatus('/nonexistent/status')).toEqual(IDLE);
  });

  it('reads the status file', async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), 'kiosk-update-')), 'status');
    await writeFile(file, 'state=up-to-date\nref=v1.13.0\n');
    expect(await readStatus(file)).toMatchObject({ state: 'up-to-date', ref: 'v1.13.0' });
  });
});

describe('respond', () => {
  it('lets the app read the status', async () => {
    const answer = await respond(request, options);
    expect(answer.code).toBe(200);
    expect(answer.headers).toMatchObject({ 'Access-Control-Allow-Origin': ORIGIN, 'Cache-Control': 'no-store' });
    expect(JSON.parse(answer.body)).toEqual(IDLE);
  });

  it('does not let another site read it', async () => {
    const answer = await respond({ ...request, origin: 'https://evil.example' }, options);
    expect(answer.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('answers only requests addressed to the loopback address', async () => {
    expect((await respond({ ...request, host: 'evil.example:7457' }, options)).code).toBe(421);
    expect((await respond({ ...request, host: undefined }, options)).code).toBe(421);
  });

  it('grants the private network preflight and refuses everything else', async () => {
    const preflight = await respond({ ...request, method: 'OPTIONS' }, options);
    expect(preflight.code).toBe(204);
    expect(preflight.headers['Access-Control-Allow-Private-Network']).toBe('true');
    expect((await respond({ ...request, method: 'POST' }, options)).code).toBe(405);
    expect((await respond({ ...request, path: '/' }, options)).code).toBe(404);
  });
});
