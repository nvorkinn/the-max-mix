// Trims package.json to what the browser tests need: the dependencies, plus the devDependencies that build and serve
// the app and run Playwright. The E2E workflow runs this before `npm install`, which then drops everything else from
// the lockfile's tree and installs the rest at its locked versions, a third of the full node_modules. The change is
// only for that checkout and is never committed. A new build-time package (a Vite plugin, say) must be added here.
import { readFileSync, writeFileSync } from 'node:fs';

const needed = new Set(['@playwright/test', '@tailwindcss/postcss', '@vitejs/plugin-react', 'tailwindcss', 'vite']);

const packagePath = new URL('../package.json', import.meta.url);
const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as { devDependencies: Record<string, string> };
const all = Object.entries(manifest.devDependencies);
manifest.devDependencies = Object.fromEntries(all.filter(([name]) => needed.has(name)));
const kept = Object.keys(manifest.devDependencies);
writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Kept ${kept.join(', ')}; dropped ${all.length - kept.length} devDependencies.`);
