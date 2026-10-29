"""NetworkManager through nmcli. Every command is an argument list; `run` is injectable so tests stub it."""

import logging
import socket
import ssl
import subprocess
import urllib.parse

import logic

log = logging.getLogger('the-max-mix-wifi')

COMMAND_ENVIRONMENT = {'LC_ALL': 'C', 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'}


def run_command(argv, timeout=20):
    """Run a command without a shell. Returns (return code, stdout, stderr); 124 means it timed out."""
    try:
        done = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            stdin=subprocess.DEVNULL,
            env=COMMAND_ENVIRONMENT
        )
    except subprocess.TimeoutExpired:
        return 124, '', 'timed out'
    except OSError as error:
        return 127, '', str(error)
    return done.returncode, done.stdout, done.stderr


def https_probe(url, timeout=5.0):
    """True when a HTTPS request to `url` gets any answer. A certificate that is merely not valid *yet* (a Pi without
    a clock) or expired still proves the internet is there; any other TLS failure may be a captive portal."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != 'https' or not parts.hostname:
        return False
    try:
        context = ssl.create_default_context()
        with socket.create_connection((parts.hostname, parts.port or 443), timeout=timeout) as raw:
            with context.wrap_socket(raw, server_hostname=parts.hostname) as secure:
                secure.sendall(f'HEAD / HTTP/1.0\r\nHost: {parts.hostname}\r\nConnection: close\r\n\r\n'.encode('ascii'))
                return bool(secure.recv(16))
    except ssl.SSLCertVerificationError as error:
        return error.verify_code in (9, 10)
    except (OSError, ssl.SSLError, UnicodeError):
        return False


class NetworkManager:
    def __init__(self, run=run_command, probe=https_probe, probe_url=logic.DEFAULT_KIOSK_URL):
        self.run = run
        self.probe = probe
        self.probe_url = probe_url

    def _call(self, argv, timeout=20):
        code, out, err = self.run(argv, timeout)
        if code != 0:
            log.info('%s -> exit %s %s', logic.describe_argv(argv), code, err.strip()[:200])
        return code, out, err

    def is_online(self):
        code, out, _ = self.run(logic.argv_connectivity(), 15)
        state = out if code == 0 else 'unknown'
        return logic.decide_online(state, lambda: self.probe(self.probe_url))

    def wifi_device(self):
        code, out, _ = self._call(logic.argv_devices())
        return logic.first_wifi_device(out) if code == 0 else None

    def radio_on(self):
        self._call(logic.argv_radio_on())

    def scan(self, ifname, rescan):
        """Visible networks, or None when nmcli could not list them (the caller keeps its last list)."""
        code, out, _ = self._call(logic.argv_wifi_list(ifname, rescan), 25)
        return logic.parse_wifi_list(out) if code == 0 else None

    def saved_wifi(self):
        code, out, _ = self._call(logic.argv_connections())
        return logic.wifi_connections(logic.parse_connections(out)) if code == 0 else []

    def active_wifi(self):
        code, out, _ = self._call(logic.argv_active_connections())
        if code != 0:
            return None
        rows = logic.wifi_connections(logic.parse_connections(out))
        return rows[0] if rows else None

    def connect(self, ssid, password, hidden, ifname):
        """(ok, message). The message is user-safe and never contains the password."""
        code, _, err = self._call(logic.argv_wifi_connect(ssid, password, hidden, ifname), logic.CONNECT_TIMEOUT_SECONDS + 15)
        if code == 0:
            return True, ''
        return False, logic.friendly_error(err)

    def activate(self, uuid):
        code, _, _ = self._call(logic.argv_connection_up(uuid, 25), 40)
        return code == 0

    def delete(self, uuid):
        return self._call(logic.argv_connection_delete(uuid))[0] == 0

    def start_hotspot(self, ifname, password):
        self.stop_hotspot()
        self.radio_on()
        if self._call(logic.argv_hotspot_add(ifname, password))[0] != 0:
            return False
        if self._call(logic.argv_hotspot_up(ifname), 45)[0] != 0:
            self.stop_hotspot()
            return False
        return True

    def stop_hotspot(self):
        self._call(logic.argv_hotspot_down())
        self._call(logic.argv_hotspot_delete())

    def start_bootstrap(self):
        """Start the image's ansible-pull unit if it exists. Never blocks."""
        code, out, _ = self._call(logic.argv_bootstrap_known())
        if code == 0 and logic.BOOTSTRAP_UNIT in out:
            self._call(logic.argv_bootstrap_start())
            return True
        return False
