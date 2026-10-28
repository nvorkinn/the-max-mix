import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SpotifyError } from './spotify.js';
import { createDemo } from './demo.js';
import { hostGuard, sameOriginWrites } from './requestGuards.js';

// Requests per minute per client address. The UI polls playback and the queue every few seconds, so these are far above
// normal use; they exist to keep a misbehaving client on the network from hammering the server or Spotify's API.
const DEFAULT_RATE_LIMITS = { windowMs: 60_000, api: 600, auth: 20, pages: 300 };

export function createApp({
  config,
  spotify,
  distPath = fileURLToPath(new URL('../../client/dist', import.meta.url)),
  rateLimits = {}
}) {
  const limits = { ...DEFAULT_RATE_LIMITS, ...rateLimits };
  const limiter = limit =>
    rateLimit({
      windowMs: limits.windowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (req, res) => res.status(429).json({ error: 'Too many requests. Try again in a moment.' })
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
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const route = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
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
  const requireInteger = (value, min, max, label) => {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new SpotifyError(`${label} must be an integer between ${min} and ${max}.`, 400);
    }
  };

  app.get('/api/health', (req, res) => {
    const ready = existsSync(path.join(distPath, 'index.html'));
    res.status(ready ? 200 : 503).json({ ready, error: ready ? null : 'Frontend build missing. Run npm run build.' });
  });
  app.get('/api/info', (req, res) =>
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
    route(async (req, res) => {
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
      const expected = req.cookies.spotify_oauth_state;
      const supplied = req.query.state;
      res.clearCookie('spotify_oauth_state', { httpOnly: true, sameSite: 'lax', secure: req.secure });
      if (
        typeof expected !== 'string' ||
        typeof supplied !== 'string' ||
        Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
        !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
      ) {
        throw new SpotifyError('Spotify sign-in expired or has an invalid state. Start again from Settings.', 400);
      }
      if (req.query.error) return res.redirect('/?auth_error=Spotify%20sign-in%20was%20declined.');
      if (typeof req.query.code !== 'string' || !req.query.code) {
        throw new SpotifyError('Missing Spotify authorization code.', 400);
      }
      await spotify.handleAuthCallback(req.query.code);
      res.redirect('/');
    })
  );

  app.get(
    '/api/spotify/current',
    route(async (req, res) => res.json(config.demoMode ? demo.playback : await spotify.getPlaybackState()))
  );
  app.get(
    '/api/queue',
    route(async (req, res) => {
      if (config.demoMode) return res.json({ currently_playing: demo.playback.item, queue: demo.queue });
      const data = await spotify.getQueue();
      res.json({ currently_playing: data?.currently_playing || null, queue: data?.queue || [] });
    })
  );
  app.get(
    '/api/spotify/devices',
    route(async (req, res) =>
      res.json(config.demoMode ? { devices: [demo.playback.device] } : await spotify.spotifyFetch('/me/player/devices'))
    )
  );
  app.post(
    '/api/transfer',
    route(async (req, res) => {
      const { deviceId, play = false } = req.body;
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
      const queue = req.body.queue;
      if (
        !Array.isArray(queue) ||
        queue.length !== demo.queue.length ||
        new Set(queue.map(track => track?.id)).size !== demo.queue.length ||
        queue.some(track => !demo.queue.some(existing => existing.id === track?.id))
      ) {
        throw new SpotifyError('Reordering requires each existing demo track exactly once.', 400);
      }
      demo.queue = queue.map(track => demo.queue.find(existing => existing.id === track.id));
      res.json({ queue: demo.queue });
    })
  );
  app.post(
    '/api/queue/play-now',
    route((req, res) => {
      demoOnly();
      const index = demo.queue.findIndex(track => track.id === req.body.trackId);
      if (index < 0) throw new SpotifyError('Demo track not found.', 404);
      demo.history.push(demo.playback.item);
      [demo.playback.item] = demo.queue.splice(index, 1);
      demo.playback.progress_ms = 0;
      demo.playback.is_playing = true;
      res.json({ remainingQueue: demo.queue });
    })
  );
  for (const action of ['play', 'pause', 'next', 'previous']) {
    app.post(
      `/api/spotify/${action}`,
      route(async (req, res) => {
        if (!config.demoMode) {
          await spotify[action]();
        } else if (action === 'play' || action === 'pause') {
          demo.playback.is_playing = action === 'play';
        } else {
          const source = action === 'next' ? demo.queue : demo.history;
          if (!source.length) throw new SpotifyError(`No ${action} demo track available.`, 409);
          const target = action === 'next' ? source.shift() : source.pop();
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
      const position = req.body.position_ms;
      requireInteger(position, 0, Number.MAX_SAFE_INTEGER, 'position_ms');
      if (config.demoMode) demo.playback.progress_ms = Math.min(position, demo.playback.item.duration_ms);
      else await spotify.seek(position);
      res.json({ success: true });
    })
  );
  app.post(
    '/api/spotify/volume',
    route(async (req, res) => {
      const volume = req.body.volume_percent;
      requireInteger(volume, 0, 100, 'volume_percent');
      if (config.demoMode) demo.playback.device.volume_percent = volume;
      else await spotify.setVolume(volume);
      res.json({ success: true });
    })
  );

  app.use('/api', (req, res) => res.status(404).json({ error: 'API not found.' }));
  app.use(limiter(limits.pages));
  app.use(express.static(distPath));
  app.get('/{*splat}', (req, res, next) => {
    res.sendFile(path.join(distPath, 'index.html'), error => {
      if (error) next(new SpotifyError('Frontend build missing. Run npm run build.', 503));
    });
  });
  app.use((error, req, res, next) => {
    console.error(`${req.method} ${req.path}: ${error.message}`);
    if (res.headersSent) return next(error);
    if (error.retryAfter) res.set('Retry-After', error.retryAfter);
    res.status(error.status || 500).json({ error: error.message });
  });
  return app;
}
