"""Request handling without sockets: a Request goes in, a Response comes out, so every check is unit tested."""

import secrets
from dataclasses import dataclass, field

import logic
import page


@dataclass
class Request:
    method: str
    path: str
    headers: dict  # lower-case names
    body: bytes = b''
    kind: str = logic.KIND_LOOPBACK
    client: str = '127.0.0.1'


@dataclass
class Response:
    status: int
    headers: list = field(default_factory=list)
    body: bytes = b''


SECURITY_HEADERS = [
    ('Cache-Control', 'no-store'),
    ('X-Frame-Options', 'DENY'),
    ('X-Content-Type-Options', 'nosniff'),
    ('Referrer-Policy', 'no-referrer')
]


def _respond(status, headers=(), body=b''):
    return Response(status, [*SECURITY_HEADERS, *headers], body)


def _text(status, message):
    return _respond(
        status,
        [('Content-Type', 'text/html; charset=utf-8'), ('Content-Security-Policy', "default-src 'none'")],
        page.render_text(message).encode('utf-8')
    )


def _redirect(location, status=303, headers=()):
    return _respond(status, [('Location', location), *headers])


class App:
    def __init__(self, controller):
        self.controller = controller

    def handle(self, request):
        method = request.method.upper()
        path = request.path.split('?', 1)[0]
        host = request.headers.get('host', '')
        if not logic.host_allowed(host, request.kind):
            # Captive-portal probes arrive with the Host of whatever site the phone tried; send them to the portal.
            if request.kind == logic.KIND_HOTSPOT and method in ('GET', 'HEAD'):
                return _redirect(logic.portal_url(), 302)
            return _text(403, 'Forbidden')
        if method not in ('GET', 'HEAD', 'POST'):
            return _text(405, 'Method not allowed')
        if request.kind == logic.KIND_HOTSPOT and method != 'POST' and logic.is_captive_probe(path):
            return _redirect(logic.portal_url(), 302)
        if method == 'POST':
            return self._post(request, path, host)
        if path == '/':
            return self._index(request)
        if path == '/healthz':
            return _text(200, 'ok')
        return _text(404, 'Not found')

    def _csrf_for(self, request):
        existing = logic.cookie_value(request.headers.get('cookie', ''))
        if logic.valid_csrf_token_shape(existing):
            return existing, []
        token = logic.new_csrf_token()
        return token, [('Set-Cookie', f'{logic.CSRF_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict')]

    def _index(self, request, notice=None, status=200):
        if request.kind == logic.KIND_HOTSPOT or request.client != logic.LOOPBACK_HOST:
            self.controller.touch()
        view = self.controller.snapshot()
        if notice:
            view['notice'] = notice
        token, cookie = self._csrf_for(request)
        nonce = secrets.token_urlsafe(12)
        html = page.render_index(view, token, nonce, request.kind == logic.KIND_LOOPBACK)
        policy = (
            f"default-src 'none'; style-src 'nonce-{nonce}'; script-src 'nonce-{nonce}'; img-src data:; "
            "form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
        )
        headers = [('Content-Type', 'text/html; charset=utf-8'), ('Content-Security-Policy', policy), *cookie]
        return _respond(status, headers, b'' if request.method.upper() == 'HEAD' else html.encode('utf-8'))

    def _post(self, request, path, host):
        if path not in ('/connect', '/rescan', '/forget'):
            return _text(404, 'Not found')
        headers = request.headers
        if not logic.origin_allowed(headers.get('origin'), headers.get('referer'), host):
            return _text(403, 'Forbidden')
        if not headers.get('content-type', '').lower().startswith('application/x-www-form-urlencoded'):
            return _text(415, 'Unsupported content type')
        if len(request.body) > logic.MAX_BODY_BYTES:
            return _text(413, 'Request too large')
        try:
            fields = logic.parse_form(request.body)
        except logic.ValidationError as error:
            return _text(400, str(error))
        if not logic.csrf_ok(headers.get('cookie', ''), fields.get('csrf', '')):
            return _text(403, 'Forbidden')
        self.controller.touch()
        if path == '/rescan':
            self.controller.rescan()
        elif path == '/forget':
            self.controller.forget()
        else:
            return self._connect(request, fields)
        return _redirect('/')

    def _connect(self, request, fields):
        try:
            ssid, password, hidden = logic.validate_connect_form(fields, self.controller.snapshot()['networks'])
        except logic.ValidationError as error:
            return self._index(request, {'kind': 'error', 'text': str(error)}, 400)
        outcome = self.controller.connect(ssid, password, hidden)
        if outcome == 'rate':
            return _text(429, 'Too many attempts. Wait a minute and try again.')
        if outcome == 'busy':
            return _text(409, 'The Pi is busy. Go back and try again in a moment.')
        return _redirect('/')
