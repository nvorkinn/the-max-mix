// Serves the progress of the Pi's updates (see README.md) to the app's settings, on the loopback address only:
//   node kiosk-update-status.ts     GET http://127.0.0.1:$KIOSK_UPDATE_STATUS_PORT/status
// It only reads the status file /usr/local/sbin/kiosk-pull writes; it starts and changes nothing.
import { createServer } from 'node:http';
import { respond } from './status.ts';

const port = Number(process.env['KIOSK_UPDATE_STATUS_PORT'] ?? '7457');
const origin = process.env['KIOSK_APP_ORIGIN'] ?? 'https://the-max-mix.vercel.app';
const file = process.env['KIOSK_UPDATE_STATUS'] ?? '/run/kiosk-update/status';

const server = createServer((request, response) => {
  void respond(
    {
      method: request.method ?? 'GET',
      path: new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
      host: request.headers.host,
      origin: request.headers.origin
    },
    { file, origin, port }
  ).then(answer => {
    response.writeHead(answer.code, answer.headers).end(answer.body);
  });
});
server.listen(port, '127.0.0.1');
