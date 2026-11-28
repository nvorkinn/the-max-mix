// Copies the setup wizard's drawn phones into countdown-server, whose pages the owner's phone goes through during
// setup, so the phone shows the same drawings as the kiosk beside it: what to pick in Spotify, how to open Bluetooth.
//
//   npm run export-phone-drawings --workspace web -- ../countdown-server
//
// It renders the components (src/components/setup/) to markup, in English as the phone's pages are, and writes them
// as Jinja macros to broker/templates/_phone_drawings.html, with their stylesheet (phone-drawings.css) beside the
// server's other third-party files. Run it after changing a drawing and commit what it writes there, too.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import type { FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = process.argv[2];
if (server === undefined) {
  console.error('Usage: npm run export-phone-drawings --workspace web -- <countdown-server checkout>');
  process.exit(1);
}

const web = new URL('..', import.meta.url).pathname;
// Stands in for the kiosk's name while rendering, so the macro can put the page's own in its place.
const DEVICE = 'PHONE-DRAWINGS-DEVICE';

const vite = await createServer({ root: web, configFile: false, logLevel: 'error', server: { middlewareMode: true } });
const load = async (name: string) =>
  ((await vite.ssrLoadModule(`/src/components/setup/${name}.tsx`)) as { default: FunctionComponent<object> }).default;
const markup = async (name: string, props: object = {}) => renderToStaticMarkup(createElement(await load(name), props));
const pickInSpotify = (await markup('PickInSpotify', { device: DEVICE })).replace(DEVICE, '{{ device }}');
const openBluetooth = await markup('OpenBluetooth');
await vite.close();

const macros = `{# Made by the-max-mix's web/scripts/export-phone-drawings.ts from its setup wizard's drawings: change them there
   and run it again rather than editing this file. Each needs static/vendor/the-max-mix/phone_drawings.css. #}
{% macro pick_in_spotify(device) -%}
${pickInSpotify}
{%- endmacro %}
{% macro open_bluetooth() -%}
${openBluetooth}
{%- endmacro %}
`;

// What the kiosk's stylesheet gives the drawings besides their own rules: Tailwind's base for icons, the spin of the
// one that turns, and the kiosk's reduced motion, which leaves each drawing on its end.
const base = `
.spotify-pick svg,
.wifi-share svg {
  display: block;
}
.spotify-pick .animate-spin,
.wifi-share .animate-spin {
  animation: phone-drawings-spin 1s linear infinite;
}
@keyframes phone-drawings-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spotify-pick *,
  .wifi-share * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
`;
const css = `/* Made by the-max-mix's web/scripts/export-phone-drawings.ts from its phone-drawings.css. */
${readFileSync(path.join(web, 'src/components/setup/phone-drawings.css'), 'utf8')}${base}`;

const templates = path.join(server, 'broker/templates');
const vendorDir = path.join(server, 'broker/static/vendor/the-max-mix');
mkdirSync(vendorDir, { recursive: true });
writeFileSync(path.join(templates, '_phone_drawings.html'), macros);
writeFileSync(path.join(vendorDir, 'phone_drawings.css'), css);
console.log(`Wrote ${path.join(templates, '_phone_drawings.html')} and ${path.join(vendorDir, 'phone_drawings.css')}`);
