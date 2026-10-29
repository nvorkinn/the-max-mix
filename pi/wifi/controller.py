"""The portal's state machine: boot wait, setup mode (hotspot), manage mode, connecting and falling back."""

import logging
import threading
import time

import logic

log = logging.getLogger('the-max-mix-wifi')

IDLE_RETRY_SECONDS = 600
HOTSPOT_RETRY_SECONDS = 15
PHONE_GRACE_SECONDS = 3
SETTLE_SECONDS = 20


class Controller:
    """`listeners` opens and closes the hotspot-side HTTP listener (`start_hotspot(gateway)` returns True when it is
    up, `stop_hotspot()`); the loopback listener is the server's business. `clock` and `sleep` are injectable."""

    def __init__(self, nm, listeners, kiosk_url, clock=time.monotonic, sleep=time.sleep):
        self.nm = nm
        self.listeners = listeners
        self.kiosk_url = kiosk_url
        self.clock = clock
        self.sleep = sleep
        self.lock = threading.RLock()
        self.connect_limiter = logic.RateLimiter()
        self.phase = 'booting'
        self.hotspot = None
        self.networks = []
        self.notice = None
        self.ssid_prefill = ''
        self.ifname = None
        self.boot_started = clock()
        self.offline_since = None
        self.last_activity = clock()
        self.last_retry = clock()

    # ---- what the page shows ----

    def snapshot(self):
        with self.lock:
            view = {
                'phase': self.phase,
                'hotspot': dict(self.hotspot) if self.hotspot else None,
                'networks': list(self.networks),
                'notice': dict(self.notice) if self.notice else None,
                'ssid_prefill': self.ssid_prefill,
                'kiosk_url': self.kiosk_url,
                'current': None
            }
            managing = self.phase == 'manage'
        if managing:
            row = self.nm.active_wifi()
            if row:
                view['current'] = {'name': row['name'], 'ssid': row['name'], 'forgettable': True}
            else:
                view['current'] = {'name': 'Wired connection', 'ssid': '', 'forgettable': False}
        return view

    def touch(self):
        """Someone is using the portal: do not interrupt the setup network to retry saved networks."""
        with self.lock:
            self.last_activity = self.clock()

    def _notice(self, kind, text):
        with self.lock:
            self.notice = {'kind': kind, 'text': text}

    # ---- helpers ----

    def _ifname(self):
        if self.ifname is None:
            self.ifname = self.nm.wifi_device()
        return self.ifname

    def _wait_online(self, seconds):
        waited = 0
        while True:
            if self.nm.is_online():
                return True
            if waited >= seconds:
                return False
            self.sleep(2)
            waited += 2

    def _refresh_networks(self, rescan):
        ifname = self._ifname()
        networks = self.nm.scan(ifname, rescan) if ifname else None
        if networks:
            with self.lock:
                self.networks = networks
        return bool(networks)

    # ---- modes ----

    def enter_setup(self, notice=None):
        with self.lock:
            self.phase = 'setup'
            self.hotspot = None
            if notice:
                self.notice = notice
            self.last_retry = self.clock()
            self.last_activity = self.clock()
        ifname = self._ifname()
        if ifname is None:
            self._notice('error', 'No Wi-Fi adapter was found. Plug in an Ethernet cable.')
            return
        # Scanning while the access point is up is unreliable, so take the list now, before it starts.
        self._refresh_networks(True)
        password = logic.new_hotspot_password()
        if self.nm.start_hotspot(ifname, password) and self.listeners.start_hotspot(logic.GATEWAY):
            with self.lock:
                self.hotspot = {'ssid': logic.HOTSPOT_SSID, 'password': password, 'gateway': logic.GATEWAY}
            log.info('setup mode: hotspot %s is up', logic.HOTSPOT_SSID)
            return
        self.leave_setup()
        self._notice('error', 'The setup Wi-Fi network could not be started. Is Wi-Fi blocked or its country unset?')

    def leave_setup(self):
        self.listeners.stop_hotspot()
        self.nm.stop_hotspot()
        with self.lock:
            self.hotspot = None

    def _to_manage(self):
        self.leave_setup()
        with self.lock:
            self.phase = 'manage'
            self.offline_since = None
        self._refresh_networks(True)
        log.info('manage mode: network is up')

    def tick(self):
        """One supervisor step: look at the network and move between modes."""
        with self.lock:
            phase = self.phase
        if phase == 'connecting':
            return
        now = self.clock()
        online = self.nm.is_online()
        if online:
            self.offline_since = None
        elif self.offline_since is None:
            self.offline_since = now
        offline_for = 0 if self.offline_since is None else now - self.offline_since
        action = logic.next_action(phase, online, now - self.boot_started, offline_for)
        if action == 'manage':
            self._to_manage()
        elif action == 'setup':
            lost = phase == 'manage'
            log.info('no network (%s): entering setup mode', 'lost' if lost else 'at boot')
            self.enter_setup({'kind': 'info', 'text': 'The Pi lost its network. Choose one to reconnect.'} if lost else None)
        elif phase == 'setup':
            self._setup_housekeeping(now)

    def _setup_housekeeping(self, now):
        with self.lock:
            hotspot_down = self.hotspot is None
            idle = now - self.last_activity
            since_retry = now - self.last_retry
        if hotspot_down and since_retry >= HOTSPOT_RETRY_SECONDS:
            self.enter_setup()
        elif not hotspot_down and idle >= IDLE_RETRY_SECONDS and since_retry >= IDLE_RETRY_SECONDS:
            self._retry_saved()

    def _retry_saved(self):
        """The router may simply have booted slower than the Pi: when nobody is using the portal, try saved networks."""
        rows = self.nm.saved_wifi()[:3]
        with self.lock:
            self.last_retry = self.clock()
            if not rows:
                return
            self.phase = 'connecting'
        self.leave_setup()
        for row in rows:
            if self.nm.activate(row['uuid']) and self._wait_online(SETTLE_SECONDS):
                self._to_manage()
                return
        self.enter_setup()

    # ---- user actions ----

    def _start_job(self, target, *args):
        with self.lock:
            if self.phase not in ('setup', 'manage'):
                return False
            was_setup = self.phase == 'setup'
            self.phase = 'connecting'
            self.notice = None
        threading.Thread(target=target, args=(*args, was_setup), daemon=True).start()
        return True

    def can_connect(self):
        with self.lock:
            return self.phase in ('setup', 'manage')

    def connect(self, ssid, password, hidden):
        """Start connecting in the background: 'started', 'busy' or 'rate' (too many attempts)."""
        if not self.can_connect():
            return 'busy'
        if not self.connect_limiter.allow():
            return 'rate'
        with self.lock:
            self.ssid_prefill = ssid
        log.info('connect requested for network %r (hidden=%s)', ssid, hidden)
        return 'started' if self._start_job(self._connect_job, ssid, password, hidden) else 'busy'

    def _connect_job(self, ssid, password, hidden, was_setup):
        try:
            self._connect(ssid, password, hidden, was_setup)
        except Exception:  # noqa: BLE001 - the portal must survive anything and fall back to a known state
            log.exception('connect failed unexpectedly')
            self._after_failure(None, None, was_setup, 'Could not connect to that network.')

    def _connect(self, ssid, password, hidden, was_setup):
        if was_setup:
            self.sleep(PHONE_GRACE_SECONDS)
            self.leave_setup()
        before = {row['uuid'] for row in self.nm.saved_wifi()}
        previous = None if was_setup else self.nm.active_wifi()
        ifname = self._ifname()
        if ifname is None:
            ok, message = False, 'No Wi-Fi adapter was found.'
        else:
            ok, message = self.nm.connect(ssid, password, hidden, ifname)
        if ok and not self._wait_online(SETTLE_SECONDS):
            ok, message = False, 'Connected to the network, but it has no internet access.'
        if not ok:
            self._after_failure(previous, before, was_setup, message)
            return
        with self.lock:
            self.phase = 'manage'
            self.offline_since = None
            self.ssid_prefill = ''
            self.notice = {'kind': 'ok', 'text': f'Connected to {ssid}.'}
        log.info('connected to %r', ssid)
        self._refresh_networks(False)
        self.nm.start_bootstrap()

    def _after_failure(self, previous, before, was_setup, message):
        """Drop the profile the failed attempt created (the credentials are not kept), then go back to where we were.
        `before` holds the saved profile ids from before the attempt; None means unknown, and then nothing is deleted."""
        if before is not None:
            for row in self.nm.saved_wifi():
                if row['uuid'] not in before:
                    self.nm.delete(row['uuid'])
        if was_setup:
            self.enter_setup({'kind': 'error', 'text': f'{message} The setup network is back, with a new password.'})
            return
        restored = bool(previous) and self.nm.activate(previous['uuid']) and self._wait_online(SETTLE_SECONDS)
        with self.lock:
            self.phase = 'manage'
            self.notice = {
                'kind': 'error',
                'text': message + (' The previous network was restored.' if restored else ''),
            }

    def rescan(self):
        with self.lock:
            if self.phase not in ('setup', 'manage'):
                return
            setup = self.phase == 'setup'
        found = self._refresh_networks(True)
        if setup:
            self._notice(
                'info',
                'Searched again.' if found else 'Scanning is limited while the setup network runs. Showing the earlier list.',
            )

    def forget(self):
        """Delete the current Wi-Fi network; with no other connection the setup network opens."""
        with self.lock:
            if self.phase != 'manage':
                return False
        row = self.nm.active_wifi()
        if not row or not self._start_job(self._forget_job, row['uuid']):
            return False
        return True

    def _forget_job(self, uuid, _was_setup):
        self.nm.delete(uuid)
        if self.nm.is_online():
            with self.lock:
                self.phase = 'manage'
                self.notice = {'kind': 'info', 'text': 'Network forgotten. The Pi is still online through another connection.'}
            return
        self.enter_setup({'kind': 'info', 'text': 'Network forgotten. Choose a new one.'})
