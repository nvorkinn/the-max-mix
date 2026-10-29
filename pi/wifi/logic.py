"""Pure logic for the Wi-Fi setup portal.

Nothing here touches the network, the disk (except read_env_file) or NetworkManager, so all of it is unit tested
without a Pi: input validation, nmcli argument lists, nmcli output parsing, mode decisions and the request checks.
"""

import hmac
import re
import secrets
import time
from collections import deque
from http.cookies import CookieError, SimpleCookie
from urllib.parse import parse_qsl

PORTAL_PORT = 8088
LOOPBACK_HOST = '127.0.0.1'
HOTSPOT_PORT = 80
GATEWAY = '10.42.0.1'
HOTSPOT_SSID = 'THE-MAX-MIX-SETUP'
HOTSPOT_PASSWORD_LENGTH = 8
# No look-alike characters (0/O, 1/I): the password is read off a screen and typed by hand.
HOTSPOT_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
DEFAULT_KIOSK_URL = 'https://the-max-mix.vercel.app/'
BOOTSTRAP_UNIT = 'the-max-mix-bootstrap.service'

BOOT_WAIT_SECONDS = 30
OFFLINE_FALLBACK_SECONDS = 120
CONNECT_TIMEOUT_SECONDS = 45
MAX_BODY_BYTES = 4096
MAX_NETWORKS = 40
CSRF_COOKIE = 'tmm_csrf'

KIND_LOOPBACK = 'loopback'
KIND_HOTSPOT = 'hotspot'

# Paths the operating systems request to find out whether a network is a captive portal.
CAPTIVE_PATHS = frozenset(
    {
        '/generate_204',
        '/gen_204',
        '/hotspot-detect.html',
        '/library/test/success.html',
        '/success.txt',
        '/connecttest.txt',
        '/redirect',
        '/ncsi.txt',
        '/canonical.html',
        '/check_network_status.txt',
        '/fwlink',
        '/fwlink/',
        '/mobile/status.php',
        '/kindle-wifi/wifistub.html'
    }
)


class ValidationError(ValueError):
    """The form input is not acceptable. The message is safe to show to the user."""


# ---- input validation ----


def has_control_characters(text):
    return any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in text)


def validate_ssid(value):
    if not value or not value.strip():
        raise ValidationError('Enter the network name.')
    if has_control_characters(value):
        raise ValidationError('The network name contains characters that are not allowed.')
    if len(value.encode('utf-8')) > 32:
        raise ValidationError('A network name is at most 32 bytes long.')
    return value


def validate_password(value):
    """An empty password means an open network; the caller decides whether that is acceptable."""
    if value == '':
        return value
    if has_control_characters(value):
        raise ValidationError('The password contains characters that are not allowed.')
    if re.fullmatch(r'[0-9A-Fa-f]{64}', value):
        return value
    if not 8 <= len(value.encode('utf-8')) <= 63:
        raise ValidationError('A Wi-Fi password has 8 to 63 characters.')
    return value


def parse_form(body):
    """Decode an application/x-www-form-urlencoded body. The first value of a repeated field wins."""
    try:
        pairs = parse_qsl(body.decode('utf-8'), keep_blank_values=True, max_num_fields=12)
    except (UnicodeDecodeError, ValueError) as error:
        raise ValidationError('The form could not be read.') from error
    fields = {}
    for name, value in pairs:
        fields.setdefault(name, value)
    return fields


def validate_connect_form(fields, networks):
    """Return (ssid, password, hidden) or raise ValidationError. `networks` is the last scan result."""
    ssid = validate_ssid(fields.get('ssid', ''))
    password = validate_password(fields.get('password', ''))
    hidden = fields.get('hidden') == 'yes'
    known = next((network for network in networks if network['ssid'] == ssid), None)
    if password == '' and known is not None and known['secure']:
        raise ValidationError('This network needs a password.')
    return ssid, password, hidden


# ---- nmcli argument lists (never a shell string) ----


def argv_connectivity():
    return ['nmcli', '-t', 'networking', 'connectivity', 'check']


def argv_radio_on():
    return ['nmcli', 'radio', 'wifi', 'on']


def argv_devices():
    return ['nmcli', '-t', '-f', 'DEVICE,TYPE,STATE', 'device']


def argv_wifi_list(ifname, rescan):
    return [
        'nmcli',
        '-t',
        '-f',
        'IN-USE,SSID,SIGNAL,SECURITY',
        'device',
        'wifi',
        'list',
        'ifname',
        ifname,
        '--rescan',
        'yes' if rescan else 'no'
    ]


def argv_connections():
    return ['nmcli', '-t', '-f', 'NAME,UUID,TYPE,DEVICE', 'connection', 'show']


def argv_active_connections():
    return ['nmcli', '-t', '-f', 'NAME,UUID,TYPE,DEVICE', 'connection', 'show', '--active']


def argv_wifi_connect(ssid, password, hidden, ifname, timeout=CONNECT_TIMEOUT_SECONDS):
    argv = ['nmcli', '--wait', str(timeout), 'device', 'wifi', 'connect', ssid]
    if password:
        argv += ['password', password]
    argv += ['ifname', ifname]
    if hidden:
        argv += ['hidden', 'yes']
    return argv


def argv_connection_up(uuid, timeout=CONNECT_TIMEOUT_SECONDS):
    return ['nmcli', '--wait', str(timeout), 'connection', 'up', 'uuid', uuid]


def argv_connection_delete(uuid):
    return ['nmcli', 'connection', 'delete', 'uuid', uuid]


def argv_hotspot_delete():
    return ['nmcli', 'connection', 'delete', 'id', HOTSPOT_SSID]


def argv_hotspot_add(ifname, password):
    """A volatile (`save no`) WPA2 access point that NetworkManager runs with its own DHCP server and dnsmasq."""
    return [
        'nmcli',
        'connection',
        'add',
        'save',
        'no',
        'type',
        'wifi',
        'ifname',
        ifname,
        'con-name',
        HOTSPOT_SSID,
        'autoconnect',
        'no',
        '802-11-wireless.ssid',
        HOTSPOT_SSID,
        '802-11-wireless.mode',
        'ap',
        '802-11-wireless.band',
        'bg',
        'ipv4.method',
        'shared',
        'ipv4.addresses',
        f'{GATEWAY}/24',
        'ipv6.method',
        'disabled',
        'wifi-sec.key-mgmt',
        'wpa-psk',
        'wifi-sec.proto',
        'rsn',
        'wifi-sec.pairwise',
        'ccmp',
        'wifi-sec.group',
        'ccmp',
        'wifi-sec.psk',
        password
    ]


def argv_hotspot_up(ifname, timeout=30):
    return ['nmcli', '--wait', str(timeout), 'connection', 'up', 'id', HOTSPOT_SSID, 'ifname', ifname]


def argv_hotspot_down():
    return ['nmcli', 'connection', 'down', 'id', HOTSPOT_SSID]


def argv_bootstrap_known():
    return ['systemctl', 'list-unit-files', BOOTSTRAP_UNIT, '--no-legend']


def argv_bootstrap_start():
    return ['systemctl', 'start', '--no-block', BOOTSTRAP_UNIT]


def describe_argv(argv):
    """The argument list as a log line, with every secret replaced."""
    shown = []
    hide_next = False
    for item in argv:
        shown.append('***' if hide_next else item)
        hide_next = item in ('password', 'wifi-sec.psk')
    return ' '.join(shown)


# ---- nmcli output ----


def split_terse(line):
    """Split one line of `nmcli -t` output: fields are separated by ':' and ':' and '\\' inside one are escaped."""
    fields = []
    current = []
    index = 0
    while index < len(line):
        char = line[index]
        if char == '\\' and index + 1 < len(line):
            current.append(line[index + 1])
            index += 2
            continue
        if char == ':':
            fields.append(''.join(current))
            current = []
        else:
            current.append(char)
        index += 1
    fields.append(''.join(current))
    return fields


def parse_wifi_list(output):
    """Visible networks, strongest first, one entry per name. Hidden (nameless) networks are skipped."""
    best = {}
    for line in output.splitlines():
        fields = split_terse(line)
        if len(fields) < 4 or not fields[1]:
            continue
        in_use, ssid, signal, security = fields[0], fields[1], fields[2], fields[3]
        entry = {
            'ssid': ssid,
            'signal': int(signal) if signal.isdigit() else 0,
            'secure': security not in ('', '--'),
            'in_use': in_use == '*'
        }
        previous = best.get(ssid)
        if previous is None or entry['signal'] > previous['signal']:
            entry['in_use'] = entry['in_use'] or (previous is not None and previous['in_use'])
            best[ssid] = entry
        elif entry['in_use']:
            previous['in_use'] = True
    networks = sorted(best.values(), key=lambda network: (not network['in_use'], -network['signal'], network['ssid']))
    return networks[:MAX_NETWORKS]


def parse_connections(output):
    rows = []
    for line in output.splitlines():
        fields = split_terse(line)
        if len(fields) >= 4:
            rows.append({'name': fields[0], 'uuid': fields[1], 'type': fields[2], 'device': fields[3]})
    return rows


def wifi_connections(rows):
    return [row for row in rows if row['type'] == '802-11-wireless' and row['name'] != HOTSPOT_SSID]


def first_wifi_device(output):
    for line in output.splitlines():
        fields = split_terse(line)
        if len(fields) >= 3 and fields[1] == 'wifi' and not fields[2].startswith('unmanaged'):
            return fields[0]
    return None


def friendly_error(stderr):
    text = stderr.lower()
    if 'secrets were required' in text or 'password' in text or '802.1x' in text:
        return 'The password was not accepted.'
    if 'no network with ssid' in text:
        return 'That network was not found. Check the name, or tick "Hidden network".'
    if 'timeout' in text or 'timed out' in text:
        return 'The network did not answer in time.'
    return 'Could not connect to that network.'


# ---- mode decisions ----


def decide_online(nm_state, probe):
    """True when the Pi can reach the internet. `probe` is only called when NetworkManager cannot say."""
    state = nm_state.strip().lower()
    if state == 'full':
        return True
    if state in ('none', 'portal'):
        return False
    return bool(probe())


def next_action(phase, online, boot_elapsed, offline_for):
    """What the supervisor does next: 'wait', 'stay', 'manage' or 'setup'."""
    if phase == 'booting':
        if online:
            return 'manage'
        return 'setup' if boot_elapsed >= BOOT_WAIT_SECONDS else 'wait'
    if phase == 'manage':
        return 'setup' if offline_for >= OFFLINE_FALLBACK_SECONDS else 'stay'
    if phase == 'setup':
        return 'manage' if online else 'stay'
    return 'stay'


# ---- setup network ----


def new_hotspot_password():
    return ''.join(secrets.choice(HOTSPOT_PASSWORD_ALPHABET) for _ in range(HOTSPOT_PASSWORD_LENGTH))


def wifi_qr_payload(ssid, password):
    def escape(text):
        return re.sub(r'([\\;,:"])', r'\\\1', text)

    return f'WIFI:T:WPA;S:{escape(ssid)};P:{escape(password)};;'


# ---- kiosk address ----


def read_env_file(path):
    """KEY=VALUE lines of an env file (comments, blank lines and surrounding quotes ignored); {} if unreadable."""
    values = {}
    try:
        with open(path, encoding='utf-8') as handle:
            lines = handle.read().splitlines()
    except OSError:
        return values
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, _, value = line.partition('=')
        values[key.strip()] = value.strip().strip('\'"')
    return values


def valid_kiosk_url(url):
    if not url or re.search(r'[\s\'"<>\\]', url) or has_control_characters(url):
        return False
    return bool(re.match(r'(https://[^/]+|http://(127\.0\.0\.1|localhost)(:\d+)?)(/|$)', url))


def choose_kiosk_url(candidates):
    """The first valid KIOSK_URL out of env-file contents, else the hosted app. Only http(s) links are ever shown."""
    for values in candidates:
        url = values.get('KIOSK_URL', '')
        if valid_kiosk_url(url):
            return url
    return DEFAULT_KIOSK_URL


# ---- request checks ----


def allowed_hosts(kind, gateway=GATEWAY):
    if kind == KIND_HOTSPOT:
        return {gateway, f'{gateway}:{HOTSPOT_PORT}'}
    return {f'{LOOPBACK_HOST}:{PORTAL_PORT}', f'localhost:{PORTAL_PORT}'}


def host_allowed(host, kind, gateway=GATEWAY):
    return (host or '').strip().lower() in allowed_hosts(kind, gateway)


def origin_allowed(origin, referer, host):
    """A POST must come from this very page: Origin, or failing that Referer, names the host it was sent to."""
    base = f'http://{host.strip().lower()}'
    if origin:
        return origin.strip().lower() == base
    if referer:
        return referer.strip().lower().startswith(base + '/')
    return False


def portal_url(gateway=GATEWAY):
    return f'http://{gateway}/'


def is_captive_probe(path):
    return path.split('?', 1)[0].lower() in CAPTIVE_PATHS


def new_csrf_token():
    return secrets.token_urlsafe(24)


def valid_csrf_token_shape(token):
    return bool(token) and re.fullmatch(r'[A-Za-z0-9_-]{20,64}', token) is not None


def cookie_value(header, name=CSRF_COOKIE):
    if not header:
        return None
    jar = SimpleCookie()
    try:
        jar.load(header)
    except CookieError:
        return None
    morsel = jar.get(name)
    return morsel.value if morsel else None


def csrf_ok(cookie_header, field_value):
    cookie = cookie_value(cookie_header)
    if not valid_csrf_token_shape(cookie) or not field_value:
        return False
    return hmac.compare_digest(cookie.encode('utf-8'), field_value.encode('utf-8'))


class RateLimiter:
    """At most `limit` events in any `window` seconds."""

    def __init__(self, limit=5, window=60.0, clock=time.monotonic):
        self.limit = limit
        self.window = window
        self.clock = clock
        self.events = deque()

    def allow(self):
        now = self.clock()
        while self.events and now - self.events[0] >= self.window:
            self.events.popleft()
        if len(self.events) >= self.limit:
            return False
        self.events.append(now)
        return True
