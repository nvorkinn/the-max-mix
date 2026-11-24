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

interface PersistEntry {
  number: number;
  target: string;
  source: string;
}

const isPlainTarget = (target: string) =>
  target !== '/' && target.startsWith('/') && !target.endsWith('/') && path.posix.normalize(target) === target;

const isPlainSource = (source: string) =>
  source !== '.' &&
  !source.startsWith('/') &&
  !source.endsWith('/') &&
  !source.split('/').includes('..') &&
  path.posix.normalize(source) === source;

function persistLineProblems({ number, target, source }: PersistEntry, kind: string | undefined): string[] {
  const problems: string[] = [];
  if (kind !== 'dir' && kind !== 'file') {
    problems.push(`line ${number}: the kind is dir or file, not "${kind}"`);
  }
  if (!isPlainTarget(target)) {
    problems.push(`line ${number}: "${target}" is not a plain absolute path`);
  } else if (SYSTEM_OWNED.some(outer => isWithin(target, outer))) {
    problems.push(`line ${number}: ${target} cannot be kept on /data`);
  }
  if (!isPlainSource(source)) {
    problems.push(`line ${number}: "${source}" is not a plain path under /data`);
  }
  return problems;
}

const doOverlap = (a: string, b: string) => isWithin(a, b) || isWithin(b, a);

// Two lines for one place, or one inside the other: which bind mount wins would depend on their order.
function overlapProblems(entries: PersistEntry[]): string[] {
  return entries.flatMap((entry, index) =>
    entries
      .slice(0, index)
      .flatMap(earlier => [
        ...(doOverlap(entry.target, earlier.target)
          ? [`line ${entry.number}: ${entry.target} overlaps ${earlier.target} on line ${earlier.number}`]
          : []),
        ...(doOverlap(entry.source, earlier.source)
          ? [`line ${entry.number}: ${entry.source} overlaps ${earlier.source} on line ${earlier.number}`]
          : [])
      ])
  );
}

export function checkPersistList(text: string): string[] {
  const problems: string[] = [];
  const entries: PersistEntry[] = [];
  for (const { number, words } of meaningfulLines(text)) {
    const [kind, target = '', source = ''] = words;
    if (words.length === 3) {
      const entry = { number, target, source };
      problems.push(...persistLineProblems(entry, kind));
      entries.push(entry);
    } else {
      problems.push(`line ${number}: expected KIND PATH SOURCE, got "${words.join(' ')}"`);
    }
  }
  return [...problems, ...overlapProblems(entries)];
}

/** A unit file in the image's rootfs (etc/systemd/system or etc/systemd/user), and whether it can be enabled. */
export interface RootfsUnit {
  name: string;
  scope: 'system' | 'user';
  hasInstall: boolean;
}

const UNIT_TYPES = new Set(['.service', '.socket', '.timer', '.mount', '.automount', '.path', '.target', '.swap']);
const ACTIONS = ['enable', 'enable-global', 'mask'];

// systemd's unit name characters, with at most one @ (a template's instance).
const isUnitName = (unit: string) =>
  UNIT_TYPES.has(path.extname(unit)) && /^[\w:.@\\-]+$/.test(unit) && unit.split('@').length <= 2;

/** What is wrong with listing one of the image's own units with this action. */
function ownUnitProblem(own: RootfsUnit, action: string): string | undefined {
  // A mask needs no unit file, and a bad action is reported on its own.
  if (action === 'mask' || !ACTIONS.includes(action)) {
    return undefined;
  }
  if (!own.hasInstall) {
    return `${own.name} has no [Install] section, so it cannot be enabled`;
  }
  const expected = own.scope === 'user' ? 'enable-global' : 'enable';
  return action === expected ? undefined : `${own.name} is a ${own.scope} unit, so its action is ${expected}`;
}

function unitLineProblems(number: number, action: string, unit: string): string[] {
  const problems: string[] = [];
  if (!ACTIONS.includes(action)) {
    problems.push(`line ${number}: the action is ${ACTIONS.join(', ')}, not "${action}"`);
  }
  if (!isUnitName(unit)) {
    problems.push(`line ${number}: "${unit}" is not a unit name`);
  }
  return problems;
}

export function checkUnits(text: string, rootfsUnits: RootfsUnit[]): string[] {
  const problems: string[] = [];
  const listed = new Map<string, number>();
  for (const { number, words } of meaningfulLines(text)) {
    const [action = '', unit = ''] = words;
    const earlier = listed.get(unit);
    if (words.length !== 2) {
      problems.push(`line ${number}: expected ACTION UNIT, got "${words.join(' ')}"`);
    } else if (earlier === undefined) {
      listed.set(unit, number);
      problems.push(...unitLineProblems(number, action, unit));
      const own = rootfsUnits.find(candidate => candidate.name === unit);
      const ownProblem = own && ownUnitProblem(own, action);
      if (ownProblem) {
        problems.push(`line ${number}: ${ownProblem}`);
      }
    } else {
      problems.push(...unitLineProblems(number, action, unit), `line ${number}: ${unit} is already on line ${earlier}`);
    }
  }
  const unlisted = rootfsUnits.filter(unit => unit.hasInstall && !listed.has(unit.name));
  return [
    ...problems,
    ...unlisted.map(unit => `${unit.name} has an [Install] section but is not listed, so nothing would start it`)
  ];
}
