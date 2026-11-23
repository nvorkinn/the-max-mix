import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOLOIST, storeSoloistKey, SYSTEMCTL, validSoloistKey } from './soloist.ts';
import type { RunWithInput } from './soloist.ts';

const KEY = 'soloist-test-key-1234';

async function setUp() {
  const folder = await mkdtemp(path.join(tmpdir(), 'soloist-'));
  const stateDir = path.join(folder, 'soloist');
  const digestFile = path.join(folder, 'the-max-mix', 'soloist-key.sha256');
  const calls: { argv: string[]; input: string; env: NodeJS.ProcessEnv }[] = [];
  let setupCode = 0;
  const run: RunWithInput = async (argv, input, env) => {
    calls.push({ argv, input, env });
    if (setupCode === 0 && argv[0] === SOLOIST && argv[1] === 'setup-api-key') {
      await mkdir(path.join(stateDir, 'credentials'), { recursive: true });
      await writeFile(path.join(stateDir, 'credentials', 'key'), input);
    }
    return { code: argv[0] === SOLOIST ? setupCode : 0, stderr: setupCode === 0 ? '' : 'bad key' };
  };
  return {
    options: { stateDir, digestFile, run },
    calls,
    digestFile,
    failSetup: () => {
      setupCode = 1;
    }
  };
}

describe('validSoloistKey', () => {
  it('takes a key and nothing else', () => {
    expect(validSoloistKey({ api_key: KEY })).toBe(KEY);
    expect(validSoloistKey({ api_key: '' })).toBeNull();
    expect(validSoloistKey({ api_key: 'two words' })).toBeNull();
    expect(validSoloistKey({ api_key: 'x'.repeat(513) })).toBeNull();
    expect(validSoloistKey({ api_key: 42 })).toBeNull();
    expect(validSoloistKey(null)).toBeNull();
  });
});

describe('storeSoloistKey', () => {
  it('stores the key on standard input in the state folder and restarts the player', async () => {
    const { options, calls, digestFile } = await setUp();

    expect(await storeSoloistKey(KEY, options)).toBe('stored');

    expect(calls.map(call => call.argv)).toEqual([
      [SYSTEMCTL, '--user', 'stop', 'kiosk-soloist.service'],
      [SOLOIST, 'setup-api-key'],
      [SYSTEMCTL, '--user', 'start', 'kiosk-soloist.service']
    ]);
    const setup = calls[1];
    expect(setup?.input).toBe(`${KEY}\n`);
    expect(setup?.env['STATE_DIRECTORY']).toBe(options.stateDir);
    expect(calls.flatMap(call => call.argv).join(' ')).not.toContain(KEY);
    expect(await readFile(digestFile, 'utf8')).not.toContain(KEY);
  });

  it('leaves the same key alone, and stores a new one', async () => {
    const { options, calls } = await setUp();
    await storeSoloistKey(KEY, options);
    calls.length = 0;

    expect(await storeSoloistKey(KEY, options)).toBe('unchanged');
    expect(calls).toEqual([]);

    expect(await storeSoloistKey(`${KEY}-new`, options)).toBe('stored');
    expect(calls).toHaveLength(3);
  });

  it('fails without the key in its error, and notes nothing, when Soloist refuses it', async () => {
    const { options, failSetup, digestFile } = await setUp();
    failSetup();

    await expect(storeSoloistKey(KEY, options)).rejects.toThrow('soloist setup-api-key failed (1): bad key');
    await expect(readFile(digestFile, 'utf8')).rejects.toThrow();
  });
});
