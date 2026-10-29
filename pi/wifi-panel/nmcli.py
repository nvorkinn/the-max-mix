"""NetworkManager through nmcli, without Qt. Every command is an argument list (never a shell); `run` is injectable so
tests stub it. Passwords reach nmcli on stdin (`--ask`), never in argv, so they are not visible in `ps`."""

import logging
import subprocess
from dataclasses import dataclass

log = logging.getLogger('wifi-panel')

COMMAND_ENVIRONMENT = {'LC_ALL': 'C', 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'}
WIFI_TYPE = '802-11-wireless'
CONNECT_WAIT_SECONDS = 45
SCAN_TIMEOUT_SECONDS = 30

OPEN = 'open'
PSK = 'psk'
UNSUPPORTED = 'unsupported'

ERROR_WRONG_PASSWORD = 'Wrong password. Check it and try again.'
ERROR_NOT_FOUND = 'Network not found. Move closer to the router and refresh.'
ERROR_TIMEOUT = 'Timed out. The password may be wrong or the signal too weak.'
ERROR_DISABLED = 'Wi-Fi is turned off.'
ERROR_DENIED = 'Not allowed to change the network settings.'
ERROR_PASSWORD_LENGTH = 'The password must be 8 to 63 characters, or 64 hexadecimal digits.'
ERROR_NO_NMCLI = 'NetworkManager is not available.'
ERROR_GENERIC = 'Could not connect.'
ERROR_SCAN = 'Could not scan for networks.'


@dataclass(frozen=True)
class Network:
    ssid: str
    signal: int
    security: str

    @property
    def bars(self):
        return signal_bars(self.signal)


def run_command(argv, stdin=None, timeout=20):
    """Run a command without a shell. Returns (return code, stdout, stderr); 124 means it timed out, 127 that it
    could not start."""
    try:
        done = subprocess.run(
            argv,
            input=stdin if stdin is not None else '',
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=COMMAND_ENVIRONMENT,
        )
    except subprocess.TimeoutExpired:
        return 124, '', 'timed out'
    except OSError as error:
        return 127, '', str(error)
    return done.returncode, done.stdout, done.stderr


def split_terse(line):
    """Split one line of `nmcli -t` output on unescaped colons; `\\:` and `\\\\` are unescaped."""
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


def signal_bars(signal):
    """Map nmcli's 0 to 100 signal to 0 to 4 bars."""
    if signal >= 75:
        return 4
    if signal >= 55:
        return 3
    if signal >= 35:
        return 2
    return 1 if signal > 0 else 0


def classify_security(text):
    """open, psk (WPA/WPA2/WPA3 Personal) or unsupported (enterprise, WEP, anything else)."""
    value = text.strip()
    if value in ('', '--'):
        return OPEN
    if '802.1X' in value or 'WEP' in value:
        return UNSUPPORTED
    if 'WPA' in value:
        return PSK
    return UNSUPPORTED


def parse_scan(output):
    """Visible networks from `nmcli -t -f SSID,SIGNAL,SECURITY device wifi list`: hidden (empty) SSIDs skipped,
    duplicates collapsed to the strongest, sorted strongest first."""
    best = {}
    for line in output.splitlines():
        fields = split_terse(line)
        if len(fields) != 3 or not fields[0].strip():
            continue
        ssid, signal_text, security = fields
        try:
            signal = max(0, min(100, int(signal_text)))
        except ValueError:
            signal = 0
        known = best.get(ssid)
        if known is None or signal > known.signal:
            best[ssid] = Network(ssid, signal, classify_security(security))
    return sorted(best.values(), key=lambda network: (-network.signal, network.ssid.lower()))


def valid_psk(password):
    if len(password) == 64:
        return all(char in '0123456789abcdefABCDEF' for char in password)
    return 8 <= len(password) <= 63


def friendly_error(code, stderr):
    """A short message for the user from a failed nmcli call. Never echoes nmcli's text, which may name the SSID."""
    text = stderr.lower()
    if code == 124 or 'timeout expired' in text or 'timed out' in text:
        return ERROR_TIMEOUT
    if code == 127:
        return ERROR_NO_NMCLI
    if 'secrets were required' in text or 'no secrets' in text:
        return ERROR_WRONG_PASSWORD
    if 'psk' in text and 'invalid' in text:
        return ERROR_PASSWORD_LENGTH
    if 'no network with ssid' in text or 'could not be found' in text:
        return ERROR_NOT_FOUND
    if 'disabled' in text:
        return ERROR_DISABLED
    if 'not authorized' in text or 'insufficient privileges' in text:
        return ERROR_DENIED
    return ERROR_GENERIC


class ScanError(Exception):
    pass


class Nmcli:
    def __init__(self, run=run_command):
        self.run = run

    def _call(self, argv, stdin=None, timeout=20):
        code, out, err = self.run(argv, stdin, timeout)
        if code != 0:
            # The argv holds no secret, and neither does nmcli's stderr; the password only ever travels on stdin.
            log.info('%s exited %s: %s', ' '.join(argv[:4]), code, err.strip()[:160])
        return code, out, err

    def radio_on(self):
        self._call(['nmcli', 'radio', 'wifi', 'on'])

    def scan(self):
        code, out, err = self._call(
            ['nmcli', '-t', '-f', 'SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'yes'],
            timeout=SCAN_TIMEOUT_SECONDS,
        )
        if code != 0:
            raise ScanError(friendly_error(code, err) if code in (124, 127) or 'disabled' in err.lower() else ERROR_SCAN)
        return parse_scan(out)

    def _wifi_uuids(self, active):
        argv = ['nmcli', '-t', '-f', 'UUID,TYPE', 'connection', 'show']
        if active:
            argv.append('--active')
        code, out, _ = self._call(argv)
        if code != 0:
            return []
        rows = (split_terse(line) for line in out.splitlines())
        return [row[0] for row in rows if len(row) == 2 and row[1] == WIFI_TYPE]

    def connect(self, ssid, password, hidden=False, security=PSK):
        """(ok, message). The message is user-safe. A failed attempt deletes the profile it created and brings the
        previously active Wi-Fi connection back."""
        if hidden:
            security = PSK if password else OPEN
        if security == PSK and not valid_psk(password):
            return False, ERROR_PASSWORD_LENGTH
        if security not in (OPEN, PSK):
            return False, ERROR_GENERIC
        active_before = self._wifi_uuids(active=True)
        saved_before = set(self._wifi_uuids(active=False))

        argv = ['nmcli', '--wait', str(CONNECT_WAIT_SECONDS)]
        stdin = None
        if security == PSK:
            argv.append('--ask')
            stdin = password + '\n'
        argv += ['device', 'wifi', 'connect', ssid]
        if hidden:
            argv += ['hidden', 'yes']
        code, _, err = self._call(argv, stdin, CONNECT_WAIT_SECONDS + 15)
        if code == 0:
            return True, ''

        for uuid in self._wifi_uuids(active=False):
            if uuid not in saved_before:
                self._call(['nmcli', 'connection', 'delete', 'uuid', uuid])
        if active_before and not set(active_before) & set(self._wifi_uuids(active=True)):
            self._call(['nmcli', 'connection', 'up', 'uuid', active_before[0]], timeout=CONNECT_WAIT_SECONDS)
        return False, friendly_error(code, err)
