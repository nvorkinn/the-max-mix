// Builds the kiosk's extension on the Pi (the Ansible role runs it): strips the TypeScript types from the scripts with
// Node's own stripper, so Chromium can load them, and writes the manifest with the app's own address left out of the
// pages that get the back button. No npm package is needed.
//   node build.ts <source folder> <extension folder> <the app's origin>
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
  'back.ts': 'back.js'
};

interface Manifest {
  content_scripts: { js: string[]; exclude_matches?: string[] }[];
}

/** The manifest with the app left out of the pages that get the back button (back.ts). */
function manifestFor(text: string, appOrigin: string): string {
  const manifest = JSON.parse(text) as Manifest;
  for (const script of manifest.content_scripts) {
    if (script.js.includes('back.js')) script.exclude_matches = [...(script.exclude_matches ?? []), `${appOrigin}/*`];
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function output(file: string, text: string, appOrigin: string): string {
  if (file === 'manifest.json') return manifestFor(text, appOrigin);
  return file.endsWith('.ts') ? stripTypeScriptTypes(text) : text;
}

async function readIfThere(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Builds the extension into `destination`, for a kiosk whose app is at `appUrl` (only its origin is used). Resolves to
 * the files it wrote: none when all were up to date.
 */
export async function build(source: string, destination: string, appUrl: string): Promise<string[]> {
  const appOrigin = new URL(appUrl).origin;
  await mkdir(destination, { recursive: true });
  const written = await Promise.all(
    Object.entries(FILES).map(async ([from, to]) => {
      const text = await readFile(path.join(source, from), 'utf8');
      const built = output(from, text, appOrigin);
      const target = path.join(destination, to);
      if ((await readIfThere(target)) === built) return [];
      await writeFile(target, built);
      return [to];
    })
  );
  return written.flat();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [source, destination, appUrl] = process.argv.slice(2);
  if (source === undefined || destination === undefined || appUrl === undefined) {
    console.error("usage: node build.ts <source folder> <extension folder> <the app's origin>");
    process.exit(2);
  }
  if ((await build(source, destination, appUrl)).length > 0) console.log('changed');
}
