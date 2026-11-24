// The checks for the image's lists (image/packages.txt, image/persist.list, image/units.txt), which the image build
// reads. Each check takes the file's text and returns its problems, one message each, or none. check-image.ts runs them
// in CI; this file only parses.
import path from 'node:path';

interface Line {
  /** 1-based, for messages. */
  number: number;
  words: string[];
}

/** The lines that say something: no blank lines, and # starts a comment. */
function meaningfulLines(text: string): Line[] {
  return text
    .split('\n')
    .map((raw, index) => ({ number: index + 1, words: raw.replace(/#.*/, '').trim().split(/\s+/).filter(Boolean) }))
    .filter(line => line.words.length > 0);
}

// Debian's rule for a package name: lower case letters, digits and + - . only, at least two long, starting with a letter
// or digit.
const PACKAGE = /^[a-z0-9][a-z0-9+.-]+$/;

export function checkPackages(text: string): string[] {
  const problems: string[] = [];
  const seen = new Map<string, number>();
  for (const { number, words } of meaningfulLines(text)) {
    if (words.length !== 1) {
      problems.push(`line ${number}: one package a line, not "${words.join(' ')}"`);
      continue;
    }
    const [entry = ''] = words;
    const name = entry.replace(/^-/, '');
    if (!PACKAGE.test(name)) {
      problems.push(`line ${number}: "${entry}" is not a package name`);
    } else if (seen.has(name)) {
      problems.push(`line ${number}: ${name} is already on line ${seen.get(name)}`);
    } else {
      seen.set(name, number);
    }
  }
  return problems;
}

// Paths the kernel or systemd own, or /data itself: binding over them would hide what they hold.
const SYSTEM_OWNED = ['/data', '/dev', '/proc', '/run', '/sys', '/tmp'];

const isWithin = (inner: string, outer: string) => inner === outer || inner.startsWith(`${outer}/`);

export function checkPersistList(text: string): string[] {
  const problems: string[] = [];
  const entries: { number: number; target: string; source: string }[] = [];
  for (const { number, words } of meaningfulLines(text)) {
    const [kind, target = '', source = ''] = words;
    if (words.length !== 3) {
      problems.push(`line ${number}: expected KIND PATH SOURCE, got "${words.join(' ')}"`);
      continue;
    }
    if (kind !== 'dir' && kind !== 'file') {
      problems.push(`line ${number}: the kind is dir or file, not "${kind}"`);
    }
    if (!target.startsWith('/') || target === '/' || path.posix.normalize(target) !== target || target.endsWith('/')) {
      problems.push(`line ${number}: "${target}" is not a plain absolute path`);
    } else if (SYSTEM_OWNED.some(outer => isWithin(target, outer))) {
      problems.push(`line ${number}: ${target} cannot be kept on /data`);
    }
    if (
      source.startsWith('/') ||
      path.posix.normalize(source) !== source ||
      source.endsWith('/') ||
      source === '.' ||
      source.split('/').includes('..')
    ) {
      problems.push(`line ${number}: "${source}" is not a plain path under /data`);
    }
    entries.push({ number, target, source });
  }
  // Two lines for one place, or one inside the other: which bind mount wins would depend on their order.
  for (const [index, entry] of entries.entries()) {
    for (const earlier of entries.slice(0, index)) {
      if (isWithin(entry.target, earlier.target) || isWithin(earlier.target, entry.target)) {
        problems.push(`line ${entry.number}: ${entry.target} overlaps ${earlier.target} on line ${earlier.number}`);
      }
      if (isWithin(entry.source, earlier.source) || isWithin(earlier.source, entry.source)) {
        problems.push(`line ${entry.number}: ${entry.source} overlaps ${earlier.source} on line ${earlier.number}`);
      }
    }
  }
  return problems;
}

/** A unit file in the image's rootfs (etc/systemd/system or etc/systemd/user), and whether it can be enabled. */
export interface RootfsUnit {
  name: string;
  scope: 'system' | 'user';
  hasInstall: boolean;
}

const UNIT = /^[A-Za-z0-9:_.\\-]+(@[A-Za-z0-9:_.\\-]*)?\.(service|socket|timer|mount|automount|path|target|swap)$/;
const ACTIONS = ['enable', 'enable-global', 'mask'];

export function checkUnits(text: string, rootfsUnits: RootfsUnit[]): string[] {
  const problems: string[] = [];
  const listed = new Map<string, { number: number; action: string }>();
  for (const { number, words } of meaningfulLines(text)) {
    const [action = '', unit = ''] = words;
    if (words.length !== 2) {
      problems.push(`line ${number}: expected ACTION UNIT, got "${words.join(' ')}"`);
      continue;
    }
    if (!ACTIONS.includes(action)) {
      problems.push(`line ${number}: the action is ${ACTIONS.join(', ')}, not "${action}"`);
    }
    if (!UNIT.test(unit)) {
      problems.push(`line ${number}: "${unit}" is not a unit name`);
    }
    const earlier = listed.get(unit);
    if (earlier) {
      problems.push(`line ${number}: ${unit} is already on line ${earlier.number}`);
      continue;
    }
    listed.set(unit, { number, action });
    const own = rootfsUnits.find(candidate => candidate.name === unit);
    if (own && action !== 'mask') {
      if (!own.hasInstall) {
        problems.push(`line ${number}: ${unit} has no [Install] section, so it cannot be enabled`);
      } else if ((own.scope === 'user') !== (action === 'enable-global')) {
        problems.push(
          `line ${number}: ${unit} is a ${own.scope} unit, so its action is ${own.scope === 'user' ? 'enable-global' : 'enable'}`
        );
      }
    }
  }
  for (const unit of rootfsUnits) {
    if (unit.hasInstall && !listed.has(unit.name)) {
      problems.push(`${unit.name} has an [Install] section but is not listed, so nothing would start it`);
    }
  }
  return problems;
}
