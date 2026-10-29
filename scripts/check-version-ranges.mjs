// Fails when a package.json depends on a wildcard or `latest` version, which would make installs unreproducible.
// npm-package-json-lint has no rule for this (its range rules force one style, but this repository mixes ^, ~ and exact pins).
import { readFileSync } from 'node:fs';

const manifests = ['package.json', 'client/package.json', 'server/package.json'];
const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const floating = new Set(['', '*', 'x', 'latest', 'next', '>=0', '>=0.0.0']);

/** @type {string[]} */
const problems = [];
for (const manifest of manifests) {
  /** @type {unknown} */
  const parsed = JSON.parse(readFileSync(new URL(`../${manifest}`, import.meta.url), 'utf8'));
  const pkg = /** @type {Record<string, Record<string, string> | undefined>} */ (parsed);
  for (const section of sections) {
    for (const [name, range] of Object.entries(pkg[section] ?? {})) {
      if (floating.has(range.trim().toLowerCase())) {
        problems.push(`${manifest}: ${section}.${name} uses the floating range "${range}"`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
