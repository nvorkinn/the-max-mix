// The kiosk playbook's file step. Ansible's copy and template modules start Python on the Pi for each file, about 2.5
// seconds a file even when nothing changed, so the playbook hands a part's files to this one program instead.
//
// Reads a JSON list from standard input. Each entry is a file: its path, its whole text, its mode in octal ('0644') and,
// for a file that must be checked before it takes effect, a command (its words as a list) in which %s is the new file, as
// with Ansible's validate. Every file is owned by root. A file that already has that text, mode and owner is left alone;
// any other is written next to it, checked, and renamed into place, so nothing reads half a file. Prints the path of each
// file it wrote, one a line, which the playbook reads to tell what changed.
import { execFileSync } from 'node:child_process';
import { chmodSync, chownSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

interface Entry {
  path: string;
  content: string;
  mode: string;
  validate?: string[];
}

function isCurrent(path: string, content: string, mode: number): boolean {
  try {
    const stat = lstatSync(path);
    return (
      stat.isFile() &&
      (stat.mode & 0o7777) === mode &&
      stat.uid === 0 &&
      stat.gid === 0 &&
      readFileSync(path, 'utf8') === content
    );
  } catch {
    return false;
  }
}

const entries = JSON.parse(readFileSync(0, 'utf8')) as Entry[];
for (const { path, content, mode, validate } of entries) {
  const wanted = Number.parseInt(mode, 8);
  if (isCurrent(path, content, wanted)) continue;
  const next = `${path}.kiosk-new`;
  try {
    writeFileSync(next, content);
    chownSync(next, 0, 0);
    chmodSync(next, wanted);
    if (validate) {
      const [command, ...args] = validate.map(word => word.replaceAll('%s', next));
      if (command) execFileSync(command, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    }
    renameSync(next, path);
  } catch (error) {
    rmSync(next, { force: true });
    throw error;
  }
  console.log(path);
}
