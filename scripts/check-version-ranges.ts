// Fails when package.json depends on a wildcard or `latest` version, which would make installs unreproducible.
// npm-package-json-lint has no rule for this (its range rules force one style, but this repository mixes ^, ~ and exact pins).
import { readFileSync } from 'node:fs';

const manifests = ['package.json'];
const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const floating = new Set(['', '*', 'x', 'latest', 'next', '>=0', '>=0.0.0']);

const problems: string[] = [];
for (const manifest of manifests) {
  const pkg = JSON.parse(readFileSync(new URL(`../${manifest}`, import.meta.url), 'utf8')) as Record<
    string,
    Record<string, string> | undefined
  >;
  for (const section of sections) {
    const dependencies = Object.entries(pkg[section] ?? {});
    for (const [name, range] of dependencies) {
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
