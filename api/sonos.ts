// Sonos sign-in on the server (a Vercel function). Sonos's OAuth needs the app's client secret for every token request
// and has no PKCE, so the browser cannot ask Sonos itself: it comes here instead, and the secret stays in Vercel's
// environment (SONOS_CLIENT_ID, SONOS_CLIENT_SECRET). Nothing is stored here; the browser keeps the refresh token.
//
// GET  /api/sonos?state=…            sends the browser on to Sonos's sign-in page.
// POST /api/sonos {code}             swaps the code Sonos sent to /sonos/callback for tokens.
// POST /api/sonos {refreshToken}     gets a new access token.

const AUTHORIZE_URL = 'https://api.sonos.com/login/v3/oauth';
const TOKEN_URL = 'https://api.sonos.com/login/v3/oauth/access';
const SCOPE = 'playback-control-all';
/** The path Sonos sends the browser back to; register `<origin>/sonos/callback` in the Sonos developer portal. */
const CALLBACK_PATH = '/sonos/callback';
const STATE_PATTERN = /^[\w-]{16,128}$/;
const MAX_FIELD_LENGTH = 4096;

interface Credentials {
  clientId: string;
  clientSecret: string;
}

function credentials(): Credentials | null {
  const clientId = process.env['SONOS_CLIENT_ID'];
  const clientSecret = process.env['SONOS_CLIENT_SECRET'];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const NOT_CONFIGURED = 'Sonos is not set up: SONOS_CLIENT_ID and SONOS_CLIENT_SECRET are missing on the server.';

const errorReply = (status: number, error: string) => Response.json({ error }, { status });

const redirectUri = (request: Request): string => new URL(CALLBACK_PATH, request.url).href;

/** Sends the browser to Sonos's sign-in page, with the state the app made for this sign-in. */
export function GET(request: Request): Response {
  const state = new URL(request.url).searchParams.get('state');
  if (!state || !STATE_PATTERN.test(state)) return errorReply(400, 'Missing or invalid state.');
  const app = credentials();
  if (!app) return errorReply(503, NOT_CONFIGURED);
  const parameters = new URLSearchParams({
    client_id: app.clientId,
    response_type: 'code',
    state,
    scope: SCOPE,
    redirect_uri: redirectUri(request)
  });
  return Response.redirect(`${AUTHORIZE_URL}?${parameters}`, 302);
}

const field = (body: Record<string, unknown>, name: string): string | null => {
  const value = body[name];
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH ? value : null;
};

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The grant the app asked for: a sign-in code to swap, or a refresh token to use. */
function grantFor(body: Record<string, unknown> | null, request: Request): URLSearchParams | null {
  const code = body && field(body, 'code');
  if (code) return new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(request) });
  const refreshToken = body && field(body, 'refreshToken');
  return refreshToken ? new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }) : null;
}

async function readReply(reply: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await reply.json();
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Passes on only what the app needs from Sonos's token reply. */
async function relayTokens(reply: Response): Promise<Response> {
  const data = await readReply(reply);
  if (!reply.ok) {
    // invalid_grant: the code was used already, or the refresh token was revoked. The app then asks to sign in again.
    return data['error'] === 'invalid_grant'
      ? errorReply(401, 'invalid_grant')
      : errorReply(502, `Sonos refused the sign-in (${reply.status}).`);
  }
  const { access_token: accessToken, expires_in: expiresIn, refresh_token: refreshToken } = data;
  return typeof accessToken === 'string' && typeof expiresIn === 'number' && Number.isFinite(expiresIn)
    ? Response.json(
        { accessToken, expiresIn, ...(typeof refreshToken === 'string' && refreshToken && { refreshToken }) },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    : errorReply(502, 'Sonos returned an invalid token response.');
}

/** Asks Sonos for tokens with the app's secret. */
export async function POST(request: Request): Promise<Response> {
  // Only the app's own pages may use the secret: a browser always sends Origin on a cross-site POST.
  if (request.headers.get('origin') !== new URL(request.url).origin) return errorReply(403, 'Forbidden.');
  const app = credentials();
  if (!app) return errorReply(503, NOT_CONFIGURED);
  const grant = grantFor(await readBody(request), request);
  if (!grant) return errorReply(400, 'Send a code or a refreshToken.');
  const basic = btoa(`${app.clientId}:${app.clientSecret}`);
  let reply: Response;
  try {
    reply = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: grant,
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    return errorReply(502, 'Sonos could not be reached.');
  }
  return relayTokens(reply);
}
