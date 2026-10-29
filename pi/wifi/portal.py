#!/usr/bin/env python3
"""THE MAX MIX Wi-Fi setup portal: the HTTP listeners, and the entry point that runs the supervisor loop.

Standard library plus nmcli only; it works offline. Run as root by the-max-mix-wifi.service.
"""

import glob
import logging
import signal
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import app
import controller
import logic
import nm

log = logging.getLogger('the-max-mix-wifi')

BOOTSTRAP_ENV = '/etc/the-max-mix/bootstrap.env'
SOCKET_TIMEOUT_SECONDS = 15


def make_handler(application, kind):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'MaxMixWifi'
        sys_version = ''
        protocol_version = 'HTTP/1.0'
        timeout = SOCKET_TIMEOUT_SECONDS

        def _serve(self):
            length = self.headers.get('Content-Length')
            body = b''
            if self.command == 'POST':
                if length is None or not length.isdigit() or int(length) > logic.MAX_BODY_BYTES:
                    self.send_error(413)
                    return
                body = self.rfile.read(int(length))
            request = app.Request(
                method=self.command,
                path=self.path,
                headers={name.lower(): value for name, value in self.headers.items()},
                body=body,
                kind=kind,
                client=self.client_address[0]
            )
            response = application.handle(request)
            self.send_response(response.status)
            for name, value in response.headers:
                self.send_header(name, value)
            self.send_header('Content-Length', str(len(response.body)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(response.body)

        do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _serve

        def log_message(self, format, *args):  # noqa: A002 - signature fixed by the base class
            # Method, path and status only: never headers, cookies or bodies.
            log.info('%s %s %s', self.client_address[0], kind, format % args if args else format)

    return Handler


class Listeners:
    """The loopback listener runs for ever; the hotspot listener only while setup mode is active."""

    def __init__(self):
        self.application = None
        self.loopback = None
        self.hotspot = None

    def _serve(self, address, kind):
        server = ThreadingHTTPServer(address, make_handler(self.application, kind))
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return server

    def start_loopback(self):
        self.loopback = self._serve((logic.LOOPBACK_HOST, logic.PORTAL_PORT), logic.KIND_LOOPBACK)

    def start_hotspot(self, gateway):
        if self.hotspot is not None:
            return True
        try:
            self.hotspot = self._serve((gateway, logic.HOTSPOT_PORT), logic.KIND_HOTSPOT)
        except OSError:
            log.exception('could not listen on %s:%s', gateway, logic.HOTSPOT_PORT)
            return False
        return True

    def stop_hotspot(self):
        server, self.hotspot = self.hotspot, None
        if server is not None:
            server.shutdown()
            server.server_close()


def kiosk_url():
    candidates = [logic.read_env_file(BOOTSTRAP_ENV)]
    for path in sorted(glob.glob('/home/*/.config/the-max-mix/kiosk.env')):
        candidates.append(logic.read_env_file(path))
    return logic.choose_kiosk_url(candidates)


def main():
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s', stream=sys.stdout)
    url = kiosk_url()
    listeners = Listeners()
    network = nm.NetworkManager(probe_url=url)
    ctl = controller.Controller(network, listeners, url)
    listeners.application = app.App(ctl)
    stop = threading.Event()

    def on_signal(_number, _frame):
        stop.set()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    network.radio_on()
    listeners.start_loopback()
    log.info('portal listening on http://%s:%s/ (kiosk address %s)', logic.LOOPBACK_HOST, logic.PORTAL_PORT, url)
    try:
        while not stop.is_set():
            try:
                ctl.tick()
            except Exception:  # noqa: BLE001 - keep supervising whatever goes wrong in one step
                log.exception('supervisor step failed')
            stop.wait(3 if ctl.phase == 'booting' else 10)
    finally:
        ctl.leave_setup()
    return 0


if __name__ == '__main__':
    sys.exit(main())
