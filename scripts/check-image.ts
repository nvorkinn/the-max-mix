// Checks the lists the image build reads (image/packages.txt, image/persist.list, image/units.txt) before a build finds
// the problem on a Pi: each line's format, no duplicates, no overlapping bind mounts, and that every unit in
// image/rootfs that can be enabled is. Prints each problem and exits 1 if there are any.
// Usage: node scripts/check-image.ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { checkPackages, checkPersistList, checkUnits, type RootfsUnit } from './image-lists.ts';

const IMAGE = path.join(import.meta.dirname, '..', 'image');

function rootfsUnits(): RootfsUnit[] {
  const units: RootfsUnit[] = [];
  for (const scope of ['system', 'user'] as const) {
    const folder = path.join(IMAGE, 'rootfs', 'etc', 'systemd', scope);
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    // Drop-in folders (ssh.service.d) are not units.
    for (const entry of entries.filter(candidate => candidate.isFile())) {
      const text = readFileSync(path.join(folder, entry.name), 'utf8');
      units.push({ name: entry.name, scope, hasInstall: /^\[Install\]\s*$/m.test(text) });
    }
  }
  return units;
}

const read = (name: string) => readFileSync(path.join(IMAGE, name), 'utf8');
const problems = [
  ...checkPackages(read('packages.txt')).map(problem => `image/packages.txt: ${problem}`),
  ...checkPersistList(read('persist.list')).map(problem => `image/persist.list: ${problem}`),
  ...checkUnits(read('units.txt'), rootfsUnits()).map(problem => `image/units.txt: ${problem}`)
];
for (const problem of problems) {
  console.error(problem);
}
if (problems.length > 0) {
  process.exitCode = 1;
} else {
  console.log('image/packages.txt, image/persist.list and image/units.txt are fine.');
}
