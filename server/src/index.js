import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { SpotifyService } from './spotify.js';

const config = loadConfig();
const spotify = new SpotifyService(config);
if (!config.demoMode) await spotify.initialize();
const app = createApp({ config, spotify });
const server = app.listen(config.port, config.host, () => {
  console.log(`THE MAX MIX listening on http://${config.host}:${config.port}`);
  console.log(`Mode: ${config.demoMode ? 'demo (simulated playback)' : config.playbackMode}`);
});
server.on('error', error => {
  console.error(`Server failed: ${error.message}`);
  process.exitCode = 1;
});
const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
