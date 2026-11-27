// Fails when package.json depends on a wildcard or `latest` version, which would make installs unreproducible, and when
// the root package.json and the Pi server's (server/package.json) disagree on a version: the root lists the server's
// packages again so its tests and type check run from the root, and the Pi must run what was tested.
// npm-package-json-lint has no rule for this (its range rules force one style, but this repository mixes ^, ~ and exact pins).
import { readFileSync } from 'node:fs';

const ROOT = 'package.json';
const SERVER = 'server/package.json';
const manifests = [ROOT, SERVER, 'web/package.json'];
const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const floating = new Set(['', '*', 'x', 'latest', 'next', '>=0', '>=0.0.0']);

type Manifest = Record<string, Record<string, string> | undefined>;

function read(manifest: string): Manifest {
  return JSON.parse(readFileSync(new URL(`../${manifest}`, import.meta.url), 'utf8')) as Manifest;
}

const problems: string[] = [];
for (const manifest of manifests) {
  const pkg = read(manifest);
  for (const section of sections) {
    const dependencies = Object.entries(pkg[section] ?? {});
    for (const [name, range] of dependencies) {
      if (floating.has(range.trim().toLowerCase())) {
        problems.push(`${manifest}: ${section}.${name} uses the floating range "${range}"`);
      }
    }
  }
}

const root = read(ROOT);
const rootVersions = new Map(sections.flatMap(section => Object.entries(root[section] ?? {})));
const serverVersions = Object.entries(read(SERVER)['dependencies'] ?? {});
for (const [name, range] of serverVersions) {
  const rootRange = rootVersions.get(name);
  if (rootRange === range) continue;
  const found = rootRange === undefined ? 'no such package' : `"${rootRange}"`;
  problems.push(`${SERVER}: ${name} is "${range}", but ${ROOT} has ${found}`);
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
