// Builds the sign-in keyboard extension on the Pi (the Ansible role runs it): strips the TypeScript types from the
// scripts with Node's own stripper, so Chromium can load them, and copies the manifest. No npm package is needed.
//   node build.ts <source folder> <extension folder>
// Prints "changed" when it wrote a file, so a run that changes nothing reports nothing (and restarts nothing).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Source file -> the file Chromium loads.
const FILES: Record<string, string> = {
  'manifest.json': 'manifest.json',
  'loader.ts': 'loader.js',
  'keyboard.ts': 'keyboard.js'
};

async function readIfThere(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** Builds the extension into `destination`. Resolves true when any file was written. */
export async function build(source: string, destination: string): Promise<boolean> {
  await mkdir(destination, { recursive: true });
  const written = await Promise.all(
    Object.entries(FILES).map(async ([from, to]) => {
      const text = await readFile(path.join(source, from), 'utf8');
      const output = from.endsWith('.ts') ? stripTypeScriptTypes(text) : text;
      const target = path.join(destination, to);
      if ((await readIfThere(target)) === output) return false;
      await writeFile(target, output);
      return true;
    })
  );
  return written.includes(true);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [source, destination] = process.argv.slice(2);
  if (source === undefined || destination === undefined) {
    console.error('usage: node build.ts <source folder> <extension folder>');
    process.exit(2);
  }
  if (await build(source, destination)) console.log('changed');
}
