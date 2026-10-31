#!/usr/bin/env python3
"""THE MAX MIX audio service: a small HTTP API on 127.0.0.1 that lists the AirPlay speakers PipeWire found and sends the
kiosk browser's audio to the ones chosen in the app. Standard library only.

  GET /v1/airplay                      → {"speakers": [{"id", "nodeId", "name", "selected"}], "selected": [...], "playing"}
  PUT /v1/airplay {"speakers": [id…]}  → the same, after routing; [] hands the audio back to the default output

It only listens on the loopback address, answers only requests whose Host is that address (no DNS rebinding) and, from a
browser, only the app's own origin (CORS, including Chrome's private network preflight). While speakers are chosen it
checks the links every few seconds, so a stream Chromium opens again or a speaker that comes back is routed too."""

import argparse
import json
import logging
import os
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from pipewire import PipeWire, PipeWireError, plan_routes

log = logging.getLogger('kiosk-audio')

DEFAULT_PORT = 47878
RECONCILE_SECONDS = 2.0
MAX_BODY_BYTES = 4096
MAX_SPEAKERS = 16
MAX_NAME_LENGTH = 256
API_PATH = '/v1/airplay'


def default_state_path():
    base = os.environ.get('XDG_STATE_HOME') or os.path.join(os.path.expanduser('~'), '.local', 'state')
    return os.path.join(base, 'the-max-mix', 'airplay.json')


class Router:
    """The chosen speakers (PipeWire node names, which stay the same when a speaker drops off and comes back) and the
    work of keeping the links in line with them. The choice is saved, so it survives a restart of the service."""

    def __init__(self, pipewire, state_path=None):
        self.pipewire = pipewire
        self.state_path = state_path
        self.lock = threading.Lock()
        self.speakers = self._load()

    def _load(self):
        if not self.state_path:
            return []
        try:
            with open(self.state_path, encoding='utf-8') as file:
                saved = json.load(file).get('speakers', [])
        except (OSError, ValueError, AttributeError):
            return []
        return valid_speakers(saved) or []

    def _save(self):
        if not self.state_path:
            return
        try:
            os.makedirs(os.path.dirname(self.state_path), exist_ok=True)
            temporary = self.state_path + '.tmp'
            with open(temporary, 'w', encoding='utf-8') as file:
                json.dump({'speakers': self.speakers}, file)
            os.replace(temporary, self.state_path)
        except OSError as error:
            log.warning('Could not save the speakers: %s', error)

    def status(self):
        graph = self.pipewire.graph()
        with self.lock:
            chosen = list(self.speakers)
        return {
            'speakers': [
                {'id': node.name, 'nodeId': node.id, 'name': node.description, 'selected': node.name in chosen}
                for node in graph.speakers
            ],
            'selected': chosen,
            'playing': bool(graph.players),
        }

    def choose(self, speakers):
        with self.lock:
            self.speakers = list(dict.fromkeys(speakers))
            self._save()
            # With no speakers the audio goes back to the default output once, then PipeWire's own policy is left alone.
            self._reconcile(self.speakers)
        return self.status()

    def reconcile(self):
        """One pass of the background loop; does nothing unless speakers are chosen."""
        with self.lock:
            if self.speakers:
                self._reconcile(self.speakers)

    def _reconcile(self, speakers):
        plan = plan_routes(self.pipewire.graph(), speakers)
        if plan:
            log.info('Routing: link %s, unlink %s', plan.connect, plan.disconnect)
            self.pipewire.apply(plan)


def valid_speakers(value):
    """The speaker list from a request or the saved file, or None when it is not a short list of short strings."""
    if not isinstance(value, list) or len(value) > MAX_SPEAKERS:
        return None
    if not all(isinstance(name, str) and 0 < len(name) <= MAX_NAME_LENGTH for name in value):
        return None
    return value


def make_handler(router, port, origins):
    hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}

    class Handler(BaseHTTPRequestHandler):
        server_version = 'kiosk-audio'
        sys_version = ''

        def log_message(self, format, *args):  # noqa: A002 (the base class's name)
            log.debug('%s %s', self.address_string(), format % args)

        def _origin_allowed(self):
            origin = self.headers.get('Origin')
            # Programs on the Pi itself (curl) send no Origin; every browser does on a cross-origin request.
            return origin is None or origin in origins

        def _send(self, status, body=None, extra=None):
            payload = b'' if body is None else json.dumps(body).encode()
            self.send_response(status)
            origin = self.headers.get('Origin')
            if origin in origins:
                self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Cache-Control', 'no-store')
            for name, value in (extra or {}).items():
                self.send_header(name, value)
            if body is not None:
                self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            if payload:
                self.wfile.write(payload)

        def _refuse(self):
            """Wrong Host (a rebound DNS name), a foreign origin or an unknown path; True when refused."""
            if self.headers.get('Host') not in hosts:
                self._send(HTTPStatus.MISDIRECTED_REQUEST, {'error': 'Unknown host'})
                return True
            if not self._origin_allowed():
                self._send(HTTPStatus.FORBIDDEN, {'error': 'Origin not allowed'})
                return True
            if self.path.split('?', 1)[0] != API_PATH:
                self._send(HTTPStatus.NOT_FOUND, {'error': 'Not found'})
                return True
            return False

        def do_OPTIONS(self):  # noqa: N802 (http.server's naming)
            if self._refuse():
                return
            extra = {
                'Access-Control-Allow-Methods': 'GET, PUT',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '600',
            }
            # Chrome asks before a public page (the app on Vercel) may reach a loopback address.
            if self.headers.get('Access-Control-Request-Private-Network') == 'true':
                extra['Access-Control-Allow-Private-Network'] = 'true'
            self._send(HTTPStatus.NO_CONTENT, extra=extra)

        def do_GET(self):  # noqa: N802
            if self._refuse():
                return
            self._answer(router.status)

        def do_PUT(self):  # noqa: N802
            if self._refuse():
                return
            # A JSON content type makes a browser send the CORS preflight first, so no other site can fire this blind.
            if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
                self._send(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {'error': 'Send JSON'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                length = -1
            if not 0 < length <= MAX_BODY_BYTES:
                self._send(HTTPStatus.BAD_REQUEST, {'error': 'Missing or oversized body'})
                return
            try:
                body = json.loads(self.rfile.read(length))
            except ValueError:
                body = None
            speakers = valid_speakers(body.get('speakers')) if isinstance(body, dict) else None
            if speakers is None:
                self._send(HTTPStatus.BAD_REQUEST, {'error': 'Expected {"speakers": [names]}'})
                return
            self._answer(lambda: router.choose(speakers))

        def _answer(self, work):
            try:
                self._send(HTTPStatus.OK, work())
            except PipeWireError as error:
                log.warning('%s', error)
                self._send(HTTPStatus.SERVICE_UNAVAILABLE, {'error': 'PipeWire is not available'})

    return Handler


def reconcile_forever(router, stop, interval=RECONCILE_SECONDS):
    while not stop.wait(interval):
        try:
            router.reconcile()
        except PipeWireError as error:
            log.debug('%s', error)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n', 1)[0])
    parser.add_argument('--port', type=int, default=DEFAULT_PORT)
    parser.add_argument('--origin', action='append', default=[], help='an origin allowed to call the API (repeatable)')
    parser.add_argument('--state', default=default_state_path(), help='where the chosen speakers are saved')
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format='%(levelname)s %(message)s')

    router = Router(PipeWire(), args.state)
    stop = threading.Event()
    threading.Thread(target=reconcile_forever, args=(router, stop), daemon=True).start()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(router, args.port, frozenset(args.origin)))
    log.info('Listening on http://127.0.0.1:%s for %s', args.port, ', '.join(args.origin) or 'local programs only')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
