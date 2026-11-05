// Relays the app's Sonos Control API calls (a Vercel function). Sonos's control endpoint is not meant to be called from a
// web page, so the browser sends its calls here with its own access token, and this passes them on unchanged. It holds no
// secret and stores nothing; only the few paths the app uses are relayed.
//
// GET  /api/sonos-control?path=/households
// GET  /api/sonos-control?path=/households/{id}/groups
// GET  /api/sonos-control?path=/groups/{id}/groupVolume
// POST /api/sonos-control?path=/groups/{id}/groupVolume  {"volume": 0-100}

const CONTROL_URL = 'https://api.ws.sonos.com/control/api/v1';
// Sonos ids look like Sonos_abc.def or a player id with a colon.
const GROUP_VOLUME = /^\/groups\/[\w.:-]{1,128}\/groupVolume$/;
const READABLE = [/^\/households$/, /^\/households\/[\w.:-]{1,128}\/groups$/, GROUP_VOLUME];
const WRITABLE = [GROUP_VOLUME];
const MAX_BODY_LENGTH = 1024;

const errorReply = (status: number, error: string) => Response.json({ error }, { status });

/** The Sonos path asked for, when it is one this relay passes on for that method. */
function pathOf(request: Request, allowed: RegExp[]): string | null {
  const path = new URL(request.url).searchParams.get('path');
  return path && allowed.some(pattern => pattern.test(path)) ? path : null;
}

async function relay(request: Request, path: string, body?: string): Promise<Response> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return errorReply(401, 'Missing Sonos access token.');
  let reply: Response;
  try {
    reply = await fetch(`${CONTROL_URL}${path}`, {
      method: request.method,
      headers: { Authorization: authorization, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      ...(body !== undefined && { body }),
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    return errorReply(502, 'Sonos could not be reached.');
  }
  return new Response(await reply.text(), {
    status: reply.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export function GET(request: Request): Promise<Response> | Response {
  const path = pathOf(request, READABLE);
  return path ? relay(request, path) : errorReply(400, 'Unsupported Sonos path.');
}

export async function POST(request: Request): Promise<Response> {
  // Only the app's own pages may send changes: a browser always sends Origin on a cross-site POST.
  if (request.headers.get('origin') !== new URL(request.url).origin) return errorReply(403, 'Forbidden.');
  const path = pathOf(request, WRITABLE);
  if (!path) return errorReply(400, 'Unsupported Sonos path.');
  const body = await request.text();
  return body.length <= MAX_BODY_LENGTH ? relay(request, path, body) : errorReply(413, 'Request too large.');
}
