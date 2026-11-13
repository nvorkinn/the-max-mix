// Builds the sign-in keyboard extension on the Pi (the Ansible role runs it): strips the TypeScript types from the
// scripts with Node's own stripper, so Chromium can load them, and copies the manifest. No npm package is needed.
//   node build.ts <source folder> <extension folder> [app origin]
// With the app's origin (kiosk_app_origin), the manifest also runs sign-out.js on the app's pages, so that signing out
// of the app can clear Spotify's own sign-in (background.js).
// Prints "changed" when it wrote a file, so a run that changes nothing reports nothing (and restarts nothing).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
// Experimental, but in every Node 24, and nothing else strips types without an npm package.
// eslint-disable-next-line n/no-unsupported-features/node-builtins -- see above
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Source file -> the file Chromium loads.
const FILES: Record<string, string> = {
  'manifest.json': 'manifest.json',
  'loader.ts': 'loader.js',
  'keyboard.ts': 'keyboard.js',
  'background.ts': 'background.js',
  'sign-out.ts': 'sign-out.js'
};

/** The manifest with a content script for the app's pages at `appOrigin` added, when there is one. */
function manifestFor(text: string, appOrigin: string | undefined): string {
  if (appOrigin === undefined) return text;
  if (new URL(appOrigin).origin !== appOrigin) throw new Error(`Not an origin: ${appOrigin}`);
  const manifest = JSON.parse(text) as { content_scripts: unknown[] };
  manifest.content_scripts.push({ matches: [`${appOrigin}/*`], js: ['sign-out.js'], run_at: 'document_start' });
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function readIfThere(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** Builds the extension into `destination`. Resolves to the files it wrote: none when all were up to date. */
export async function build(source: string, destination: string, appOrigin?: string): Promise<string[]> {
  await mkdir(destination, { recursive: true });
  const written = await Promise.all(
    Object.entries(FILES).map(async ([from, to]) => {
      const text = await readFile(path.join(source, from), 'utf8');
      const output = from.endsWith('.ts') ? stripTypeScriptTypes(text) : manifestFor(text, appOrigin);
      const target = path.join(destination, to);
      if ((await readIfThere(target)) === output) return [];
      await writeFile(target, output);
      return [to];
    })
  );
  return written.flat();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [source, destination, appOrigin] = process.argv.slice(2);
  if (source === undefined || destination === undefined) {
    console.error('usage: node build.ts <source folder> <extension folder> [app origin]');
    process.exit(2);
  }
  if ((await build(source, destination, appOrigin)).length > 0) console.log('changed');
}
