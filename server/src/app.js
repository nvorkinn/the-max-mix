import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { createDemo } from './demo.js';
import { hostGuard, sameOriginWrites } from './requestGuards.js';
import { SpotifyError } from './spotify.js';

// Requests per minute per client address. The UI polls playback and the queue every few seconds, so these are far above
// normal use; they exist to keep a misbehaving client on the network from hammering the server or Spotify's API.
const DEFAULT_RATE_LIMITS = { windowMs: 60_000, api: 600, auth: 20, pages: 300 };

/**
 * The parsed JSON body; Express leaves it undefined when the request had none, which then fails validation.
 * @param {import('express').Request} req
 */
const bodyOf = req => {
  /** @type {unknown} */
  const body = req.body;
  return /** @type {Record<string, unknown>} */ (typeof body === 'object' && body !== null ? body : {});
};

/**
 * @param {{
 *   config: Pick<ReturnType<typeof import('./config.js').parseConfig>, 'port' | 'playbackMode' | 'demoMode' | 'allowedHosts'>,
 *   spotify: import('./spotify.js').SpotifyService,
 *   distPath?: string,
 *   rateLimits?: Partial<typeof DEFAULT_RATE_LIMITS>
 * }} options
 */
export function createApp({
  config,
  spotify,
  distPath = fileURLToPath(new URL('../../client/dist', import.meta.url)),
  rateLimits = {}
}) {
  const limits = { ...DEFAULT_RATE_LIMITS, ...rateLimits };
  /** @param {number} limit */
  const limiter = limit =>
    rateLimit({
      windowMs: limits.windowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, res) => res.status(429).json({ error: 'Too many requests. Try again in a moment.' })
    });
  const app = express();
  const demo = createDemo();
  app.disable('x-powered-by');
  app.use(hostGuard({ allowedHosts: config.allowedHosts }));
  app.use('/api', sameOriginWrites());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', limiter(limits.api));
  app.use('/api/auth', limiter(limits.auth));
  /** @type {import('express').RequestHandler} */
  const noStore = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    return next();
  };
  app.use('/api', noStore);
  /** @param {(req: import('express').Request, res: import('express').Response) => unknown} handler */
  const route =
    handler =>
    /** @type {import('express').RequestHandler} */
    (req, res, next) =>
      Promise.resolve(handler(req, res)).catch(next);
  const liveOnly = () => {
    if (config.demoMode) {
      throw new SpotifyError('Turn off DEMO_MODE and restart the server to connect to Spotify.', 409);
    }
  };
  const demoOnly = () => {
    if (!config.demoMode) {
      throw new SpotifyError(
        'Spotify does not expose live queue reordering or non-destructive play-now. Manage the queue in Spotify.',
        409
      );
    }
  };
  /**
   * @param {unknown} value
   * @param {number} min
   * @param {number} max
   * @param {string} label
   * @returns {asserts value is number}
   */
  function requireInteger(value, min, max, label) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw new SpotifyError(`${label} must be an integer between ${min} and ${max}.`, 400);
    }
  }

  app.get('/api/health', (_req, res) => {
    const ready = existsSync(path.join(distPath, 'index.html'));
    res.status(ready ? 200 : 503).json({ ready, error: ready ? null : 'Frontend build missing. Run npm run build.' });
  });
  app.get('/api/info', (_req, res) =>
    res.json({
      name: 'THE MAX MIX',
      port: config.port,
      playbackMode: config.playbackMode,
      demoMode: config.demoMode,
      spotifyConfigured: spotify.isConfigured(),
      spotifyAuthenticated: !config.demoMode && spotify.isAuthenticated()
    })
  );
  app.get(
    '/api/token',
    route(async (_req, res) => {
      const token = config.demoMode ? null : await spotify.getValidAccessToken();
      res.json({
        token: config.playbackMode === 'browser' ? token : null,
        authenticated: Boolean(token),
        configured: spotify.isConfigured(),
        demoMode: config.demoMode,
        playbackMode: config.playbackMode
      });
    })
  );
  app.get(
    '/api/auth/login',
    route((req, res) => {
      liveOnly();
      const state = randomBytes(32).toString('hex');
      const url = spotify.getAuthUrl(state);
      res.cookie('spotify_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 600000 });
      res.redirect(url);
    })
  );
  app.get(
    '/api/auth/callback',
    route(async (req, res) => {
      liveOnly();
      const expected = /** @type {Record<string, unknown>} */ (req.cookies)['spotify_oauth_state'];
      const supplied = req.query['state'];
      res.clearCookie('spotify_oauth_state', { httpOnly: true, sameSite: 'lax', secure: req.secure });
      if (
        typeof expected !== 'string' ||
        typeof supplied !== 'string' ||
        Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
        !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
      ) {
        throw new SpotifyError('Spotify sign-in expired or has an invalid state. Start again from Settings.', 400);
      }
      if (req.query['error']) return res.redirect('/?auth_error=Spotify%20sign-in%20was%20declined.');
      if (typeof req.query['code'] !== 'string' || !req.query['code']) {
        throw new SpotifyError('Missing Spotify authorization code.', 400);
      }
      await spotify.handleAuthCallback(req.query['code'], supplied);
      res.redirect('/');
    })
  );

  app.get(
    '/api/spotify/current',
    route(async (_req, res) => res.json(config.demoMode ? demo.playback : await spotify.getPlaybackState()))
  );
  app.get(
    '/api/queue',
    route(async (_req, res) => {
      if (config.demoMode) return res.json({ currently_playing: demo.playback.item, queue: demo.queue });
      const data = await spotify.getQueue();
      return res.json({ currently_playing: data?.currently_playing ?? null, queue: data?.queue ?? [] });
    })
  );
  app.get(
    '/api/spotify/devices',
    route(async (_req, res) =>
      res.json(config.demoMode ? { devices: [demo.playback.device] } : await spotify.getDevices())
    )
  );
  app.post(
    '/api/transfer',
    route(async (req, res) => {
      const { deviceId, play = false } = bodyOf(req);
      if (typeof deviceId !== 'string' || !deviceId || typeof play !== 'boolean') {
        throw new SpotifyError('A deviceId and a boolean play value are required.', 400);
      }
      if (config.demoMode) {
        if (deviceId !== demo.playback.device.id) throw new SpotifyError('Demo device not found.', 404);
        demo.playback.is_playing = play;
      } else {
        await spotify.transferPlayback(deviceId, play);
      }
      res.json({ success: true });
    })
  );
  app.post(
    '/api/queue/reorder',
    route((req, res) => {
      demoOnly();
      const submitted = bodyOf(req)['queue'];
      const reordered = Array.isArray(submitted)
        ? submitted.map((/** @type {{ id?: unknown } | null | undefined} */ track) =>
            demo.queue.find(existing => existing.id === track?.id)
          )
        : [];
      if (
        reordered.length !== demo.queue.length ||
        new Set(reordered).size !== demo.queue.length ||
        reordered.includes(undefined)
      ) {
        throw new SpotifyError('Reordering requires each existing demo track exactly once.', 400);
      }
      // Validated above: every submitted id matched exactly one existing demo track, and none twice.
      demo.queue = /** @type {import('./demo.js').DemoTrack[]} */ (reordered);
      res.json({ queue: demo.queue });
    })
  );
  app.post(
    '/api/queue/play-now',
    route((req, res) => {
      demoOnly();
      const index = demo.queue.findIndex(track => track.id === bodyOf(req)['trackId']);
      if (index < 0) throw new SpotifyError('Demo track not found.', 404);
      const [track] = demo.queue.splice(index, 1);
      if (!track) throw new SpotifyError('Demo track not found.', 404);
      demo.history.push(demo.playback.item);
      demo.playback.item = track;
      demo.playback.progress_ms = 0;
      demo.playback.is_playing = true;
      res.json({ remainingQueue: demo.queue });
    })
  );
  for (const action of /** @type {const} */ (['play', 'pause', 'next', 'previous'])) {
    app.post(
      `/api/spotify/${action}`,
      route(async (_req, res) => {
        if (!config.demoMode) {
          await spotify[action]();
        } else if (action === 'play' || action === 'pause') {
          demo.playback.is_playing = action === 'play';
        } else {
          const source = action === 'next' ? demo.queue : demo.history;
          if (!source.length) throw new SpotifyError(`No ${action} demo track available.`, 409);
          // source is non-empty (checked above), so shift/pop always yield a track.
          const target = /** @type {import('./demo.js').DemoTrack} */ (
            action === 'next' ? source.shift() : source.pop()
          );
          if (action === 'next') demo.history.push(demo.playback.item);
          else demo.queue.unshift(demo.playback.item);
          demo.playback.item = target;
          demo.playback.progress_ms = 0;
        }
        res.json({ success: true });
      })
    );
  }
  app.post(
    '/api/spotify/seek',
    route(async (req, res) => {
      const position = bodyOf(req)['position_ms'];
      requireInteger(position, 0, Number.MAX_SAFE_INTEGER, 'position_ms');
      if (config.demoMode) demo.playback.progress_ms = Math.min(position, demo.playback.item.duration_ms);
      else await spotify.seek(position);
      res.json({ success: true });
    })
  );
  app.post(
    '/api/spotify/volume',
    route(async (req, res) => {
      const volume = bodyOf(req)['volume_percent'];
      requireInteger(volume, 0, 100, 'volume_percent');
      if (config.demoMode) demo.playback.device.volume_percent = volume;
      else await spotify.setVolume(volume);
      res.json({ success: true });
    })
  );

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API not found.' }));
  app.use(limiter(limits.pages));
  app.use(express.static(distPath));
  app.get('/{*splat}', (_req, res, next) => {
    res.sendFile(path.join(distPath, 'index.html'), error => {
      if (error) next(new SpotifyError('Frontend build missing. Run npm run build.', 503));
    });
  });
  /**
   * @param {Error & { status?: number, retryAfter?: string | null }} error
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  const errorHandler = (error, req, res, next) => {
    console.error(`${req.method} ${req.path}: ${error.message}`);
    if (res.headersSent) return next(error);
    if (error.retryAfter) res.set('Retry-After', error.retryAfter);
    return res.status(error.status || 500).json({ error: error.message });
  };
  app.use(errorHandler);
  return app;
}
