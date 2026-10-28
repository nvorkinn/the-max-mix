// Installs the Husky git hooks. Runs from the root `prepare` script and never fails an install:
// it does nothing outside a git checkout (release tarballs, CI without .git) or without husky (--omit=dev).
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
process.chdir(root);
if (!existsSync('.git')) process.exit(0);

let install;
try {
  install = require('husky').default;
} catch {
  process.exit(0);
}
const message = install();
if (message) console.warn(message);
