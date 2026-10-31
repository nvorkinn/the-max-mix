import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The version shown in the settings: the release's version (release.yml sets it from the tag; 0.0.0 means no release)
 * and the short commit from Vercel's git integration (preview deploys). Either part can be missing.
 */
function appVersion(): string {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  const release = version === '0.0.0' ? '' : `v${version}`;
  const commit = process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7) ?? '';
  return release && commit ? `${release} (${commit})` : release || commit || 'dev';
}

export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion()) },
  css: { postcss: { plugins: [tailwindcss()] } },
  server: {
    // Spotify requires a loopback IP literal for http redirect URIs, so dev serves on exactly http://127.0.0.1:5173/
    // (register that address in the Spotify dashboard) and fails rather than moving to another port.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  preview: {
    // The same reason: `npm start` (vite preview) serves on exactly http://127.0.0.1:4173/.
    host: '127.0.0.1',
    port: 4173,
    strictPort: true
  }
});
