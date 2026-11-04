// Fails when src/index.css styles a class that no source file mentions, which means dead CSS.
// A class counts as used when its name appears in any non-test file under src/, or when it starts with the fixed prefix
// of a template literal such as `debug-entry-${level}`, which builds its variants at run time.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const srcDir = new URL('../src/', import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(file));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(file);
  }
  return files;
}

const source = sourceFiles(srcDir)
  .map(file => readFileSync(file, 'utf8'))
  .join('\n');

// Selector lines end in `{` or `,`; declarations end in `;`, so values such as `0.5s` are never mistaken for classes.
const selectorLines = readFileSync(path.join(srcDir, 'index.css'), 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => (line.endsWith('{') || line.endsWith(',')) && !line.startsWith('/*') && !line.startsWith('*'));
const classes = new Set(
  selectorLines.flatMap(line => line.match(/\.[a-zA-Z_][\w-]*/g) ?? []).map(name => name.slice(1))
);

// The class-name characters just before each `${` form the fixed prefix.
const prefixes = source
  .split('${')
  .slice(0, -1)
  .map(chunk => {
    let start = chunk.length;
    while (start > 0 && /[\w-]/.test(chunk.charAt(start - 1))) start--;
    return chunk.slice(start);
  })
  .filter(prefix => prefix.endsWith('-'));
const isUsed = (name: string) => source.includes(name) || prefixes.some(prefix => name.startsWith(prefix));

const unused = [...classes].filter(name => !isUsed(name)).toSorted((a, b) => a.localeCompare(b));
if (unused.length > 0) {
  const list = unused.map(name => `  .${name}`).join('\n');
  console.error(`Unused CSS classes in src/index.css:\n${list}`);
  process.exit(1);
}
