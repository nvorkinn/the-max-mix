import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import nmcli  # noqa: E402

SCAN = (
    'Home\\:Net:80:WPA2\n'
    'Home\\:Net:40:WPA2\n'
    'Cafe:55:--\n'
    ':30:WPA2\n'
    'Office:90:WPA2 WPA3\n'
    'Campus:70:WPA2 802.1X\n'
    'Back\\\\slash:20:WPA1 WPA2\n'
    'Broken line\n'
    'Odd:abc:WPA2\n'
)

WIFI_ROWS = 'aaaa-1:802-11-wireless\nbbbb-2:802-3-ethernet\ncccc-3:802-11-wireless\n'


class Stub:
    """Stands in for `nmcli`: replies are matched on a leading slice of argv, and every call is recorded."""

    def __init__(self, replies):
        self.replies = replies
        self.calls = []

    def __call__(self, argv, stdin=None, timeout=20):
        self.calls.append((list(argv), stdin))
        for prefix, reply in self.replies:
            if argv[: len(prefix)] == prefix:
                return reply(argv) if callable(reply) else reply
        return 0, '', ''

    def called(self, *prefix):
        return [argv for argv, _ in self.calls if argv[: len(prefix)] == list(prefix)]


class Parsing(unittest.TestCase):
    def test_split_terse_unescapes(self):
        self.assertEqual(nmcli.split_terse('a\\:b:c'), ['a:b', 'c'])
        self.assertEqual(nmcli.split_terse('a\\\\:b'), ['a\\', 'b'])
        self.assertEqual(nmcli.split_terse('::'), ['', '', ''])

    def test_signal_bars(self):
        self.assertEqual([nmcli.signal_bars(s) for s in (0, 1, 34, 35, 54, 55, 74, 75, 100)], [0, 1, 1, 2, 2, 3, 3, 4, 4])

    def test_security(self):
        for text, kind in [
            ('', nmcli.OPEN),
            ('--', nmcli.OPEN),
            ('WPA2', nmcli.PSK),
            ('WPA2 WPA3', nmcli.PSK),
            ('WPA3', nmcli.PSK),
            ('WPA2 802.1X', nmcli.UNSUPPORTED),
            ('WEP', nmcli.UNSUPPORTED),
            ('OWE', nmcli.UNSUPPORTED),
        ]:
            self.assertEqual(nmcli.classify_security(text), kind, text)

    def test_parse_scan(self):
        networks = nmcli.parse_scan(SCAN)
        self.assertEqual(
            [(n.ssid, n.signal, n.security) for n in networks],
            [
                ('Office', 90, nmcli.PSK),
                ('Home:Net', 80, nmcli.PSK),
                ('Campus', 70, nmcli.UNSUPPORTED),
                ('Cafe', 55, nmcli.OPEN),
                ('Back\\slash', 20, nmcli.PSK),
                ('Odd', 0, nmcli.PSK),
            ],
        )
        self.assertEqual([n.bars for n in networks], [4, 4, 3, 3, 1, 0])

    def test_parse_scan_empty(self):
        self.assertEqual(nmcli.parse_scan(''), [])

    def test_psk_validation(self):
        self.assertTrue(nmcli.valid_psk('12345678'))
        self.assertTrue(nmcli.valid_psk('x' * 63))
        self.assertTrue(nmcli.valid_psk('ab12' * 16))
        self.assertFalse(nmcli.valid_psk('short'))
        self.assertFalse(nmcli.valid_psk('x' * 64))
        self.assertFalse(nmcli.valid_psk('x' * 65))


class Errors(unittest.TestCase):
    def test_mapping(self):
        for code, text, expected in [
            (1, 'Error: Connection activation failed: (7) Secrets were required, but not provided.', nmcli.ERROR_WRONG_PASSWORD),
            (1, "Error: No network with SSID 'x' found.", nmcli.ERROR_NOT_FOUND),
            (1, 'Error: Timeout expired (45 seconds)', nmcli.ERROR_TIMEOUT),
            (124, 'timed out', nmcli.ERROR_TIMEOUT),
            (127, 'No such file', nmcli.ERROR_NO_NMCLI),
            (1, 'Error: Wi-Fi is disabled', nmcli.ERROR_DISABLED),
            (1, 'Error: Failed to add/activate: Not authorized to control networking.', nmcli.ERROR_DENIED),
            (1, '802-11-wireless-security.psk: property is invalid', nmcli.ERROR_PASSWORD_LENGTH),
            (1, 'something else', nmcli.ERROR_GENERIC),
        ]:
            self.assertEqual(nmcli.friendly_error(code, text), expected, text)


class Scan(unittest.TestCase):
    def test_scan_argv_and_result(self):
        run = Stub([(['nmcli', '-t'], (0, SCAN, ''))])
        networks = nmcli.Nmcli(run).scan()
        self.assertEqual(networks[0].ssid, 'Office')
        self.assertEqual(
            run.calls[0][0],
            ['nmcli', '-t', '-f', 'SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'yes'],
        )

    def test_scan_failure(self):
        with self.assertRaises(nmcli.ScanError) as caught:
            nmcli.Nmcli(Stub([(['nmcli'], (1, '', 'boom'))])).scan()
        self.assertEqual(str(caught.exception), nmcli.ERROR_SCAN)
        with self.assertRaises(nmcli.ScanError) as caught:
            nmcli.Nmcli(Stub([(['nmcli'], (1, '', 'Error: Wi-Fi is disabled'))])).scan()
        self.assertEqual(str(caught.exception), nmcli.ERROR_DISABLED)


class Connect(unittest.TestCase):
    def client(self, connect_reply, saved_after=WIFI_ROWS, active_after='cccc-3:802-11-wireless\n'):
        """Before the attempt cccc-3 is active and aaaa-1, cccc-3 are saved; `saved_after` and `active_after` follow it."""
        state = {'connected': False}

        def show(argv):
            if state['connected']:
                return 0, active_after if '--active' in argv else saved_after, ''
            return 0, ('cccc-3:802-11-wireless\n' if '--active' in argv else WIFI_ROWS), ''

        def connect(argv):
            state['connected'] = True
            return connect_reply

        run = Stub([(['nmcli', '-t', '-f', 'UUID,TYPE', 'connection', 'show'], show), (['nmcli', '--wait'], connect)])
        return nmcli.Nmcli(run), run

    def test_password_goes_on_stdin_not_argv(self):
        client, run = self.client((0, '', ''))
        self.assertEqual(client.connect('Home', 's3cretpass', security=nmcli.PSK), (True, ''))
        argv, stdin = next(call for call in run.calls if call[0][:2] == ['nmcli', '--wait'])
        self.assertEqual(argv, ['nmcli', '--wait', '45', '--ask', 'device', 'wifi', 'connect', 'Home'])
        self.assertEqual(stdin, 's3cretpass\n')
        self.assertFalse(any('s3cretpass' in part for call, _ in run.calls for part in call))

    def test_open_network_has_no_ask(self):
        client, run = self.client((0, '', ''))
        self.assertTrue(client.connect('Cafe', '', security=nmcli.OPEN)[0])
        self.assertEqual(run.called('nmcli', '--wait')[0], ['nmcli', '--wait', '45', 'device', 'wifi', 'connect', 'Cafe'])

    def test_hidden_network(self):
        client, run = self.client((0, '', ''))
        self.assertTrue(client.connect('Ghost', 'longenough', hidden=True)[0])
        self.assertIn('--ask', run.called('nmcli', '--wait')[0])
        self.assertEqual(run.called('nmcli', '--wait')[0][-3:], ['Ghost', 'hidden', 'yes'])
        client, run = self.client((0, '', ''))
        self.assertTrue(client.connect('Ghost', '', hidden=True)[0])
        self.assertNotIn('--ask', run.called('nmcli', '--wait')[0])

    def test_rejects_bad_input_without_calling_nmcli(self):
        client, run = self.client((0, '', ''))
        self.assertEqual(client.connect('Home', 'short', security=nmcli.PSK), (False, nmcli.ERROR_PASSWORD_LENGTH))
        self.assertEqual(client.connect('Corp', 'whatever1', security=nmcli.UNSUPPORTED), (False, nmcli.ERROR_GENERIC))
        self.assertEqual(run.calls, [])

    def test_failure_cleans_up_and_restores_old_connection(self):
        client, run = self.client(
            (1, '', 'Error: Connection activation failed: (7) Secrets were required, but not provided.'),
            saved_after=WIFI_ROWS + 'dddd-4:802-11-wireless\n',
            active_after='',
        )
        self.assertEqual(client.connect('Home', 'wrongpass1'), (False, nmcli.ERROR_WRONG_PASSWORD))
        self.assertEqual(run.called('nmcli', 'connection', 'delete'), [['nmcli', 'connection', 'delete', 'uuid', 'dddd-4']])
        self.assertEqual(run.called('nmcli', 'connection', 'up'), [['nmcli', 'connection', 'up', 'uuid', 'cccc-3']])

    def test_failure_leaves_a_still_active_connection_alone(self):
        client, run = self.client((1, '', "Error: No network with SSID 'Home' found."))
        self.assertEqual(client.connect('Home', 'wrongpass1'), (False, nmcli.ERROR_NOT_FOUND))
        self.assertEqual(run.called('nmcli', 'connection', 'delete'), [])
        self.assertEqual(run.called('nmcli', 'connection', 'up'), [])

    def test_failure_without_previous_connection(self):
        run = Stub([(['nmcli', '--wait'], (124, '', 'timed out'))])
        self.assertEqual(nmcli.Nmcli(run).connect('Home', 'longenough'), (False, nmcli.ERROR_TIMEOUT))
        self.assertEqual(run.called('nmcli', 'connection', 'up'), [])


if __name__ == '__main__':
    unittest.main()
