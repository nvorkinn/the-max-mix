import os
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import app  # noqa: E402
import controller  # noqa: E402
import logic  # noqa: E402
import nm  # noqa: E402
import page  # noqa: E402

TOKEN = 'a' * 24
WIFI_LIST = '*:Home\\:Net:80:WPA2\n:Home\\:Net:40:WPA2\n:Cafe:55:--\n::30:WPA2\n:Office:90:WPA2 WPA3\n'


class Validation(unittest.TestCase):
    def test_ssid(self):
        self.assertEqual(logic.validate_ssid('My Wi-Fi'), 'My Wi-Fi')
        for bad in ['', '   ', 'a\nb', 'a\x00b', 'x' * 33, 'é' * 17]:
            with self.assertRaises(logic.ValidationError):
                logic.validate_ssid(bad)

    def test_password(self):
        self.assertEqual(logic.validate_password(''), '')
        self.assertEqual(logic.validate_password('correct horse'), 'correct horse')
        self.assertEqual(logic.validate_password('f' * 64), 'f' * 64)
        for bad in ['short', 'x' * 65, 'abcdefgh\n', 'abcdefgh\x7f']:
            with self.assertRaises(logic.ValidationError):
                logic.validate_password(bad)

    def test_form_parsing(self):
        self.assertEqual(logic.parse_form(b'a=1&a=2&b=%26'), {'a': '1', 'b': '&'})
        with self.assertRaises(logic.ValidationError):
            logic.parse_form(b'\xff\xfe')
        with self.assertRaises(logic.ValidationError):
            logic.parse_form('&'.join(f'k{i}=1' for i in range(50)).encode())

    def test_connect_form_needs_password_for_a_secured_network(self):
        networks = [{'ssid': 'Home', 'secure': True}, {'ssid': 'Cafe', 'secure': False}]
        self.assertEqual(logic.validate_connect_form({'ssid': 'Cafe'}, networks), ('Cafe', '', False))
        self.assertEqual(
            logic.validate_connect_form({'ssid': 'Hidden', 'password': 'password1', 'hidden': 'yes'}, networks),
            ('Hidden', 'password1', True)
        )
        with self.assertRaises(logic.ValidationError):
            logic.validate_connect_form({'ssid': 'Home'}, networks)


class Nmcli(unittest.TestCase):
    def test_argument_lists_keep_hostile_input_as_single_items(self):
        ssid = 'a; rm -rf / $(x) `y`'
        argv = logic.argv_wifi_connect(ssid, 'p"w d\'1', True, 'wlan0')
        self.assertEqual(argv[:6], ['nmcli', '--wait', '45', 'device', 'wifi', 'connect'])
        self.assertIn(ssid, argv)
        self.assertIn('p"w d\'1', argv)
        self.assertEqual(argv[-2:], ['hidden', 'yes'])
        self.assertTrue(all(isinstance(item, str) for item in argv))

    def test_open_network_has_no_password_argument(self):
        self.assertNotIn('password', logic.argv_wifi_connect('Cafe', '', False, 'wlan0'))

    def test_hotspot_is_volatile_wpa2_and_shared(self):
        argv = logic.argv_hotspot_add('wlan0', 'ABCD2345')
        self.assertEqual(argv[3:5], ['save', 'no'])
        for pair in [('ipv4.method', 'shared'), ('802-11-wireless.mode', 'ap'), ('wifi-sec.key-mgmt', 'wpa-psk')]:
            self.assertEqual(argv[argv.index(pair[0]) + 1], pair[1])
        self.assertEqual(argv[argv.index('ipv4.addresses') + 1], '10.42.0.1/24')

    def test_secrets_are_redacted_in_logs(self):
        text = logic.describe_argv(logic.argv_wifi_connect('Home', 'hunter2hunter2', False, 'wlan0'))
        self.assertNotIn('hunter2', text)
        self.assertNotIn('ABCD2345', logic.describe_argv(logic.argv_hotspot_add('wlan0', 'ABCD2345')))

    def test_terse_parsing(self):
        self.assertEqual(logic.split_terse('a\\:b:c\\\\d::'), ['a:b', 'c\\d', '', ''])

    def test_wifi_list(self):
        networks = logic.parse_wifi_list(WIFI_LIST)
        self.assertEqual([n['ssid'] for n in networks], ['Home:Net', 'Office', 'Cafe'])
        self.assertTrue(networks[0]['in_use'])
        self.assertEqual(networks[0]['signal'], 80)
        self.assertFalse(networks[2]['secure'])

    def test_connections_and_device(self):
        rows = logic.parse_connections(
            'Wired:u1:802-3-ethernet:eth0\nHome:u2:802-11-wireless:wlan0\n' + logic.HOTSPOT_SSID + ':u3:802-11-wireless:wlan0\n'
        )
        self.assertEqual([r['name'] for r in logic.wifi_connections(rows)], ['Home'])
        self.assertEqual(logic.first_wifi_device('eth0:ethernet:connected\nwlan0:wifi:disconnected\n'), 'wlan0')
        self.assertIsNone(logic.first_wifi_device('wlan0:wifi:unmanaged\n'))

    def test_friendly_errors(self):
        self.assertIn('password', logic.friendly_error('Error: (7) Secrets were required, but not provided.'))
        self.assertIn('not found', logic.friendly_error('Error: No network with SSID "x" found.'))
        self.assertEqual(logic.friendly_error('boom'), 'Could not connect to that network.')


class Decisions(unittest.TestCase):
    def test_online(self):
        calls = []
        self.assertTrue(logic.decide_online('full\n', lambda: calls.append(1)))
        self.assertFalse(logic.decide_online('none', lambda: calls.append(1)))
        self.assertFalse(logic.decide_online('portal', lambda: calls.append(1)))
        self.assertEqual(calls, [])
        self.assertTrue(logic.decide_online('unknown', lambda: True))
        self.assertFalse(logic.decide_online('limited', lambda: False))

    def test_next_action(self):
        self.assertEqual(logic.next_action('booting', True, 1, 0), 'manage')
        self.assertEqual(logic.next_action('booting', False, 10, 10), 'wait')
        self.assertEqual(logic.next_action('booting', False, 30, 30), 'setup')
        self.assertEqual(logic.next_action('manage', False, 500, 119), 'stay')
        self.assertEqual(logic.next_action('manage', False, 500, 120), 'setup')
        self.assertEqual(logic.next_action('setup', True, 500, 0), 'manage')
        self.assertEqual(logic.next_action('setup', False, 500, 500), 'stay')
        self.assertEqual(logic.next_action('connecting', False, 500, 500), 'stay')

    def test_hotspot_password_and_qr_payload(self):
        password = logic.new_hotspot_password()
        self.assertEqual(len(password), 8)
        self.assertTrue(set(password) <= set(logic.HOTSPOT_PASSWORD_ALPHABET))
        self.assertEqual(logic.wifi_qr_payload('THE-MAX-MIX-SETUP', 'ABCD2345'), 'WIFI:T:WPA;S:THE-MAX-MIX-SETUP;P:ABCD2345;;')
        self.assertEqual(logic.wifi_qr_payload('a;b', 'c:d"e\\'), 'WIFI:T:WPA;S:a\\;b;P:c\\:d\\"e\\\\;;')

    def test_rate_limiter(self):
        now = [0.0]
        limiter = logic.RateLimiter(2, 60, lambda: now[0])
        self.assertTrue(limiter.allow())
        self.assertTrue(limiter.allow())
        self.assertFalse(limiter.allow())
        now[0] = 61
        self.assertTrue(limiter.allow())


class KioskUrl(unittest.TestCase):
    def test_choice_and_fallback(self):
        self.assertEqual(logic.choose_kiosk_url([]), logic.DEFAULT_KIOSK_URL)
        self.assertEqual(logic.choose_kiosk_url([{'KIOSK_URL': 'javascript:alert(1)'}]), logic.DEFAULT_KIOSK_URL)
        self.assertEqual(logic.choose_kiosk_url([{'KIOSK_URL': 'https://x"onload=1'}]), logic.DEFAULT_KIOSK_URL)
        self.assertEqual(
            logic.choose_kiosk_url([{}, {'KIOSK_URL': 'https://example.com/'}, {'KIOSK_URL': 'https://other/'}]),
            'https://example.com/'
        )
        self.assertEqual(logic.choose_kiosk_url([{'KIOSK_URL': 'http://127.0.0.1:3999'}]), 'http://127.0.0.1:3999')

    def test_env_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, 'env')
            with open(path, 'w', encoding='utf-8') as handle:
                handle.write('# comment\nKIOSK_URL="https://example.com/"\n\nOTHER=1\n')
            self.assertEqual(logic.read_env_file(path), {'KIOSK_URL': 'https://example.com/', 'OTHER': '1'})
            self.assertEqual(logic.read_env_file(os.path.join(directory, 'missing')), {})


class Checks(unittest.TestCase):
    def test_hosts(self):
        self.assertTrue(logic.host_allowed('127.0.0.1:8088', logic.KIND_LOOPBACK))
        self.assertTrue(logic.host_allowed('LocalHost:8088', logic.KIND_LOOPBACK))
        self.assertFalse(logic.host_allowed('evil.example:8088', logic.KIND_LOOPBACK))
        self.assertFalse(logic.host_allowed('10.42.0.1', logic.KIND_LOOPBACK))
        self.assertTrue(logic.host_allowed('10.42.0.1', logic.KIND_HOTSPOT))
        self.assertFalse(logic.host_allowed('127.0.0.1:8088', logic.KIND_HOTSPOT))

    def test_origin(self):
        host = '127.0.0.1:8088'
        self.assertTrue(logic.origin_allowed('http://127.0.0.1:8088', None, host))
        self.assertTrue(logic.origin_allowed(None, 'http://127.0.0.1:8088/', host))
        self.assertFalse(logic.origin_allowed('http://evil.example', None, host))
        self.assertFalse(logic.origin_allowed('null', None, host))
        self.assertFalse(logic.origin_allowed(None, 'http://127.0.0.1:8088.evil.example/', host))
        self.assertFalse(logic.origin_allowed(None, None, host))

    def test_csrf(self):
        self.assertTrue(logic.csrf_ok(f'tmm_csrf={TOKEN}', TOKEN))
        self.assertFalse(logic.csrf_ok(f'tmm_csrf={TOKEN}', 'b' * 24))
        self.assertFalse(logic.csrf_ok('', TOKEN))
        self.assertFalse(logic.csrf_ok(f'tmm_csrf={TOKEN}', ''))
        self.assertFalse(logic.csrf_ok('tmm_csrf=short', 'short'))

    def test_captive_probes(self):
        for path in ['/generate_204', '/hotspot-detect.html', '/connecttest.txt', '/ncsi.txt', '/GENERATE_204?x=1']:
            self.assertTrue(logic.is_captive_probe(path), path)
        self.assertFalse(logic.is_captive_probe('/'))


class FakeNm:
    def __init__(self):
        self.online = False
        self.connect_result = (True, '')
        self.saved = []
        self.calls = []
        self.networks = logic.parse_wifi_list(WIFI_LIST)
        self.hotspot_ok = True
        self.active = None

    def is_online(self):
        return self.online

    def wifi_device(self):
        return 'wlan0'

    def radio_on(self):
        pass

    def scan(self, ifname, rescan):
        return list(self.networks)

    def saved_wifi(self):
        return list(self.saved)

    def active_wifi(self):
        return self.active

    def connect(self, ssid, password, hidden, ifname):
        self.calls.append(('connect', ssid, password))
        if self.connect_result[0]:
            self.saved.append({'name': ssid, 'uuid': 'new-' + ssid, 'type': '802-11-wireless', 'device': ifname})
            self.online = True
        return self.connect_result

    def activate(self, uuid):
        self.calls.append(('activate', uuid))
        self.online = True
        return True

    def delete(self, uuid):
        self.calls.append(('delete', uuid))
        self.saved = [row for row in self.saved if row['uuid'] != uuid]
        return True

    def start_hotspot(self, ifname, password):
        self.calls.append(('hotspot', password))
        return self.hotspot_ok

    def stop_hotspot(self):
        self.calls.append(('hotspot-stop',))

    def start_bootstrap(self):
        self.calls.append(('bootstrap',))


class FakeListeners:
    def __init__(self):
        self.up = False

    def start_hotspot(self, gateway):
        self.up = True
        return True

    def stop_hotspot(self):
        self.up = False


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def make_controller():
    clock = Clock()
    fake = FakeNm()
    listeners = FakeListeners()
    ctl = controller.Controller(fake, listeners, 'https://example.com/', clock, clock.sleep)
    return ctl, fake, listeners, clock


def wait_for_idle(ctl):
    for thread in threading.enumerate():
        if thread is not threading.current_thread() and thread.daemon:
            thread.join(5)
    return ctl.phase


class ControllerFlow(unittest.TestCase):
    def test_boot_without_network_opens_setup_after_the_wait(self):
        ctl, fake, listeners, clock = make_controller()
        ctl.tick()
        self.assertEqual(ctl.phase, 'booting')
        clock.now = 31
        ctl.tick()
        self.assertEqual(ctl.phase, 'setup')
        self.assertTrue(listeners.up)
        self.assertEqual(ctl.hotspot['ssid'], 'THE-MAX-MIX-SETUP')
        self.assertEqual(len(ctl.hotspot['password']), 8)

    def test_boot_with_network_goes_straight_to_manage(self):
        ctl, fake, listeners, _ = make_controller()
        fake.online = True
        ctl.tick()
        self.assertEqual(ctl.phase, 'manage')
        self.assertFalse(listeners.up)

    def test_losing_the_network_falls_back_after_two_minutes(self):
        ctl, fake, listeners, clock = make_controller()
        fake.online = True
        ctl.tick()
        fake.online = False
        clock.now = 100
        ctl.tick()
        clock.now = 219
        ctl.tick()
        self.assertEqual(ctl.phase, 'manage')
        clock.now = 221
        ctl.tick()
        self.assertEqual(ctl.phase, 'setup')
        self.assertIn('lost', ctl.notice['text'])

    def test_failed_connect_drops_the_profile_and_reopens_the_hotspot_with_a_new_password(self):
        ctl, fake, listeners, clock = make_controller()
        clock.now = 31
        ctl.tick()
        first = ctl.hotspot['password']
        fake.connect_result = (False, 'The password was not accepted.')
        fake.saved = [{'name': 'Home', 'uuid': 'old', 'type': '802-11-wireless', 'device': ''}]
        original_connect = fake.connect

        def connect_and_leave_a_profile(ssid, password, hidden, ifname):
            fake.saved.append({'name': ssid, 'uuid': 'half', 'type': '802-11-wireless', 'device': ''})
            return original_connect(ssid, password, hidden, ifname)

        fake.connect = connect_and_leave_a_profile
        self.assertEqual(ctl.connect('Home2', 'password1', False), 'started')
        wait_for_idle(ctl)
        self.assertEqual(ctl.phase, 'setup')
        self.assertIn(('delete', 'half'), fake.calls)
        self.assertNotIn(('delete', 'old'), fake.calls)
        self.assertNotEqual(ctl.hotspot['password'], first)
        self.assertIn('not accepted', ctl.notice['text'])
        self.assertTrue(listeners.up)

    def test_successful_connect_ends_setup_and_starts_the_bootstrap(self):
        ctl, fake, listeners, clock = make_controller()
        clock.now = 31
        ctl.tick()
        self.assertEqual(ctl.connect('Home', 'password1', False), 'started')
        wait_for_idle(ctl)
        self.assertEqual(ctl.phase, 'manage')
        self.assertFalse(listeners.up)
        self.assertEqual(ctl.notice['kind'], 'ok')
        self.assertIn(('bootstrap',), fake.calls)

    def test_failed_switch_restores_the_previous_network(self):
        ctl, fake, _, _ = make_controller()
        fake.online = True
        fake.active = {'name': 'Home', 'uuid': 'old', 'type': '802-11-wireless', 'device': 'wlan0'}
        fake.saved = [fake.active]
        ctl.tick()
        fake.connect_result = (False, 'The network did not answer in time.')
        self.assertEqual(ctl.connect('Other', 'password1', False), 'started')
        wait_for_idle(ctl)
        self.assertEqual(ctl.phase, 'manage')
        self.assertIn(('activate', 'old'), fake.calls)
        self.assertIn('restored', ctl.notice['text'])

    def test_connect_is_rate_limited_and_not_concurrent(self):
        ctl, fake, _, _ = make_controller()
        fake.online = True
        ctl.tick()
        ctl.phase = 'connecting'
        self.assertEqual(ctl.connect('A', 'password1', False), 'busy')
        ctl.phase = 'manage'
        for _ in range(5):
            self.assertTrue(ctl.connect_limiter.allow())
        self.assertEqual(ctl.connect('A', 'password1', False), 'rate')

    def test_hotspot_failure_is_retried(self):
        ctl, fake, listeners, clock = make_controller()
        fake.hotspot_ok = False
        clock.now = 31
        ctl.tick()
        self.assertEqual(ctl.phase, 'setup')
        self.assertIsNone(ctl.hotspot)
        fake.hotspot_ok = True
        clock.now = 50
        ctl.tick()
        self.assertIsNotNone(ctl.hotspot)

    def test_idle_setup_retries_saved_networks(self):
        ctl, fake, listeners, clock = make_controller()
        clock.now = 31
        ctl.tick()
        fake.saved = [{'name': 'Home', 'uuid': 'old', 'type': '802-11-wireless', 'device': ''}]
        clock.now = 700
        ctl.tick()
        self.assertEqual(ctl.phase, 'manage')
        self.assertIn(('activate', 'old'), fake.calls)


class Portal(unittest.TestCase):
    def setUp(self):
        self.ctl, self.fake, self.listeners, self.clock = make_controller()
        self.clock.now = 31
        self.ctl.tick()
        self.app = app.App(self.ctl)

    def get(self, path='/', host='127.0.0.1:8088', kind=logic.KIND_LOOPBACK, cookie=None):
        headers = {'host': host}
        if cookie:
            headers['cookie'] = cookie
        return self.app.handle(app.Request('GET', path, headers, b'', kind, '127.0.0.1'))

    def post(self, path, fields, host='127.0.0.1:8088', origin='http://127.0.0.1:8088', cookie=f'tmm_csrf={TOKEN}', kind=logic.KIND_LOOPBACK):
        body = '&'.join(f'{key}={value}' for key, value in fields.items()).encode()
        headers = {'host': host, 'content-type': 'application/x-www-form-urlencoded'}
        if origin:
            headers['origin'] = origin
        if cookie:
            headers['cookie'] = cookie
        return self.app.handle(app.Request('POST', path, headers, body, kind, '127.0.0.1'))

    def test_page_shows_the_hotspot_credentials_a_qr_code_and_security_headers(self):
        response = self.get()
        text = response.body.decode()
        self.assertEqual(response.status, 200)
        self.assertIn('THE-MAX-MIX-SETUP', text)
        self.assertIn(self.ctl.hotspot['password'], text)
        self.assertIn('<svg', text)
        headers = dict(response.headers)
        self.assertEqual(headers['X-Frame-Options'], 'DENY')
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertIn("default-src 'none'", headers['Content-Security-Policy'])
        self.assertIn('HttpOnly', headers['Set-Cookie'])
        self.assertNotIn('http://', text.replace('http://10.42.0.1/', '').replace('http://www.w3.org/2000/svg', ''))

    def test_unknown_host_is_rejected_on_loopback_and_redirected_on_the_hotspot(self):
        self.assertEqual(self.get(host='evil.example').status, 403)
        redirect = self.get(host='captive.apple.com', kind=logic.KIND_HOTSPOT)
        self.assertEqual(redirect.status, 302)
        self.assertEqual(dict(redirect.headers)['Location'], 'http://10.42.0.1/')

    def test_captive_probes_redirect_to_the_portal(self):
        for path in ['/generate_204', '/hotspot-detect.html', '/connecttest.txt']:
            response = self.get(path, host='10.42.0.1', kind=logic.KIND_HOTSPOT)
            self.assertEqual(response.status, 302, path)
            self.assertEqual(dict(response.headers)['Location'], 'http://10.42.0.1/')

    def test_post_checks(self):
        good = {'csrf': TOKEN, 'ssid': 'Home', 'password': 'password1'}
        self.assertEqual(self.post('/connect', {**good, 'csrf': 'b' * 24}).status, 403)
        self.assertEqual(self.post('/connect', good, cookie=None).status, 403)
        self.assertEqual(self.post('/connect', good, origin='http://evil.example').status, 403)
        self.assertEqual(self.post('/connect', good, origin=None).status, 403)
        self.assertEqual(self.post('/connect', good, host='evil.example').status, 403)
        self.assertEqual(self.post('/nope', good).status, 404)
        self.assertEqual(self.ctl.phase, 'setup')
        self.assertEqual(self.app.handle(app.Request('PUT', '/', {'host': '127.0.0.1:8088'})).status, 405)

    def test_oversized_and_invalid_bodies(self):
        big = {'csrf': TOKEN, 'ssid': 'x' * 5000}
        self.assertEqual(self.post('/connect', big).status, 413)
        response = self.post('/connect', {'csrf': TOKEN, 'ssid': 'a%00b', 'password': ''})
        self.assertEqual(response.status, 400)
        self.assertIn('not allowed', response.body.decode())

    def test_valid_connect_redirects_and_never_echoes_the_password(self):
        response = self.post('/connect', {'csrf': TOKEN, 'ssid': 'Home', 'password': 'password1'})
        self.assertEqual(response.status, 303)
        self.assertNotIn(b'password1', response.body)
        wait_for_idle(self.ctl)
        self.assertIn(('connect', 'Home', 'password1'), self.fake.calls)

    def test_loopback_gets_the_on_screen_keyboard_and_the_hotspot_does_not(self):
        self.assertIn('id="osk"', self.get().body.decode())
        self.assertNotIn('id="osk"', self.get(host='10.42.0.1', kind=logic.KIND_HOTSPOT).body.decode())

    def test_manage_page_links_back_to_the_kiosk(self):
        self.fake.online = True
        self.fake.active = {'name': 'Home', 'uuid': 'u', 'type': '802-11-wireless', 'device': 'wlan0'}
        self.ctl.tick()
        text = self.get().body.decode()
        self.assertIn('href="https://example.com/"', text)
        self.assertIn('Forget this network', text)

    def test_html_is_escaped(self):
        self.ctl.networks = [{'ssid': '<script>x</script>', 'signal': 50, 'secure': True, 'in_use': False}]
        text = self.get().body.decode()
        self.assertNotIn('<script>x', text)
        self.assertIn('&lt;script&gt;x', text)


class Qr(unittest.TestCase):
    def test_svg(self):
        svg = page.qr_svg('WIFI:T:WPA;S:THE-MAX-MIX-SETUP;P:ABCD2345;;')
        self.assertTrue(svg.startswith('<svg'))
        self.assertIn('<path', svg)


class Adapter(unittest.TestCase):
    def test_wrapper_uses_argument_lists_and_reports_friendly_errors(self):
        seen = []

        def run(argv, timeout):
            seen.append(argv)
            return 4, '', 'Error: Connection activation failed: (7) Secrets were required, but not provided.'

        adapter = nm.NetworkManager(run=run, probe=lambda url: False)
        ok, message = adapter.connect('Home', 'password1', False, 'wlan0')
        self.assertFalse(ok)
        self.assertIn('password', message)
        self.assertNotIn('password1', message)
        self.assertEqual(seen[0][0], 'nmcli')

    def test_online_uses_the_probe_only_when_networkmanager_cannot_say(self):
        probed = []

        def run(argv, timeout):
            return 0, 'limited\n', ''

        adapter = nm.NetworkManager(run=run, probe=lambda url: probed.append(url) or True, probe_url='https://example.com/')
        self.assertTrue(adapter.is_online())
        self.assertEqual(probed, ['https://example.com/'])

    def test_bootstrap_only_starts_when_the_unit_exists(self):
        calls = []

        def run(argv, timeout):
            calls.append(argv)
            return 0, ('the-max-mix-bootstrap.service enabled\n' if 'list-unit-files' in argv else ''), ''

        self.assertTrue(nm.NetworkManager(run=run).start_bootstrap())
        self.assertIn(['systemctl', 'start', '--no-block', 'the-max-mix-bootstrap.service'], calls)
        calls.clear()
        self.assertFalse(nm.NetworkManager(run=lambda argv, timeout: (0, '', '')).start_bootstrap())


if __name__ == '__main__':
    unittest.main()
