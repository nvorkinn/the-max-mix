import net from 'node:net';
import os from 'node:os';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostnameOf(hostHeader) {
  try {
    return new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Rejects requests whose Host header is not an IP address, localhost, this machine's name or a configured name. A web
 * page can point its own domain at the kiosk's address (DNS rebinding) and then read the API as if it were same-origin,
 * including the access token; browsers always send the page's own domain as Host, so unknown names are refused.
 */
export function hostGuard({ allowedHosts = [], machineName = os.hostname() } = {}) {
  const names = new Set([
    'localhost',
    machineName.toLowerCase(),
    `${machineName.toLowerCase()}.local`,
    ...allowedHosts.map(host => host.toLowerCase())
  ]);
  return (req, res, next) => {
    const hostname = hostnameOf(req.headers.host ?? '');
    if (hostname && (net.isIP(hostname) !== 0 || names.has(hostname))) return next();
    return res.status(403).json({
      error: 'Unrecognized host name. Open the app by IP address, localhost, or add the name to ALLOWED_HOSTS.'
    });
  };
}

function isCrossSite(req) {
  const site = req.get('Sec-Fetch-Site');
  if (site) return !['same-origin', 'none'].includes(site);
  const origin = req.get('Origin');
  if (origin === undefined) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true; // includes the opaque origin "null"
  }
}

/**
 * Protects state-changing requests from other websites. Browsers attach Sec-Fetch-Site (and Origin on POST) that a page
 * cannot forge, so a request is refused when it is marked cross-site, or, for older browsers without that header, when
 * its Origin differs from the Host it was sent to. It also requires a JSON body: a cross-site page can send text/plain
 * or form posts without a preflight, but not application/json.
 */
export function sameOriginWrites() {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (isCrossSite(req)) return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    if (!req.is('application/json')) {
      return res.status(415).json({ error: 'Send a JSON body with Content-Type: application/json.' });
    }
    return next();
  };
}
