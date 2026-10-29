// Installs the Husky git hooks. Runs from the `prepare` script and never fails an install:
// it does nothing outside a git checkout (release tarballs, CI without .git) or without husky (--omit=dev).
import { existsSync } from 'node:fs';
import path from 'node:path';

process.chdir(path.join(import.meta.dirname, '..'));
if (!existsSync('.git')) process.exit(0);

let husky: typeof import('husky');
try {
  husky = await import('husky');
} catch {
  process.exit(0);
}
const message = husky.default();
if (message) console.warn(message);
