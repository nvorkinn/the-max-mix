import http.client
import json
import logging
import os
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import kiosk_audio  # noqa: E402
import pipewire  # noqa: E402
from test_pipewire import KITCHEN, LOUNGE, dump  # noqa: E402

ORIGIN = 'https://the-max-mix.vercel.app'


class FakePipeWire:
    """pw-dump replies with the test graph; applied plans are recorded."""

    def __init__(self, text=None):
        self.text = text or dump()
        self.applied = []
        self.fail = False

    def graph(self):
        if self.fail:
            raise pipewire.PipeWireError('down')
        return pipewire.parse_dump(self.text)

    def apply(self, plan):
        self.applied.append(plan)
        return True


class RouterTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.state = os.path.join(self.directory.name, 'state', 'airplay.json')

    def tearDown(self):
        self.directory.cleanup()

    def test_status_lists_the_speakers(self):
        status = kiosk_audio.Router(FakePipeWire()).status()
        self.assertEqual(
            status['speakers'],
            [
                {'id': KITCHEN, 'nodeId': 50, 'name': 'Kitchen', 'selected': False},
                {'id': LOUNGE, 'nodeId': 60, 'name': 'lounge', 'selected': False},
            ],
        )
        self.assertEqual(status['selected'], [])
        self.assertTrue(status['playing'])

    def test_choosing_routes_saves_and_keeps_checking(self):
        fake = FakePipeWire()
        router = kiosk_audio.Router(fake, self.state)
        status = router.choose([KITCHEN, KITCHEN])
        self.assertEqual(status['selected'], [KITCHEN])
        self.assertEqual(fake.applied[0].connect, [(71, 51), (72, 52)])
        router.reconcile()
        self.assertEqual(len(fake.applied), 2)  # the fake never changes, so the same links are asked for again
        # A new service picks the choice up again.
        self.assertEqual(kiosk_audio.Router(fake, self.state).speakers, [KITCHEN])

    def test_no_speakers_hands_back_once_then_leaves_pipewire_alone(self):
        fake = FakePipeWire()
        router = kiosk_audio.Router(fake, self.state)
        router.choose([])
        router.reconcile()
        self.assertEqual(fake.applied, [])  # Chromium already plays to the default output

    def test_a_broken_state_file_means_no_speakers(self):
        os.makedirs(os.path.dirname(self.state))
        with open(self.state, 'w', encoding='utf-8') as file:
            file.write('[1, 2]')
        self.assertEqual(kiosk_audio.Router(FakePipeWire(), self.state).speakers, [])

    def test_valid_speakers(self):
        self.assertEqual(kiosk_audio.valid_speakers(['a']), ['a'])
        for bad in ('a', [1], [''], ['x' * 300], ['a'] * 17, None):
            self.assertIsNone(kiosk_audio.valid_speakers(bad))


class ServerTest(unittest.TestCase):
    def setUp(self):
        logging.disable(logging.CRITICAL)
        self.fake = FakePipeWire()
        self.router = kiosk_audio.Router(self.fake)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), None)
        self.port = self.server.server_address[1]
        self.server.RequestHandlerClass = kiosk_audio.make_handler(self.router, self.port, frozenset([ORIGIN]))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        logging.disable(logging.NOTSET)

    def request(self, method, path='/v1/airplay', body=None, **headers):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        headers.setdefault('Host', f'127.0.0.1:{self.port}')
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        raw = response.read()
        connection.close()
        return response, json.loads(raw) if raw else None

    def put(self, payload, **headers):
        headers.setdefault('Content-Type', 'application/json')
        headers.setdefault('Origin', ORIGIN)
        return self.request('PUT', body=json.dumps(payload).encode(), **headers)

    def test_get_from_the_app(self):
        response, body = self.request('GET', Origin=ORIGIN)
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader('Access-Control-Allow-Origin'), ORIGIN)
        self.assertEqual(len(body['speakers']), 2)

    def test_get_from_a_local_program(self):
        response, _ = self.request('GET')
        self.assertEqual(response.status, 200)
        self.assertIsNone(response.getheader('Access-Control-Allow-Origin'))

    def test_refuses_other_origins_and_hosts(self):
        self.assertEqual(self.request('GET', Origin='https://evil.example')[0].status, 403)
        self.assertEqual(self.request('GET', Host=f'evil.example:{self.port}')[0].status, 421)
        self.assertEqual(self.request('GET', '/other')[0].status, 404)

    def test_preflight_allows_the_private_network_request(self):
        response, _ = self.request(
            'OPTIONS',
            Origin=ORIGIN,
            **{'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Private-Network': 'true'},
        )
        self.assertEqual(response.status, 204)
        self.assertEqual(response.getheader('Access-Control-Allow-Private-Network'), 'true')
        self.assertEqual(response.getheader('Access-Control-Allow-Methods'), 'GET, PUT')
        self.assertEqual(self.request('OPTIONS', Origin='https://evil.example')[0].status, 403)

    def test_put_routes_to_the_speakers(self):
        response, body = self.put({'speakers': [LOUNGE]})
        self.assertEqual(response.status, 200)
        self.assertEqual(body['selected'], [LOUNGE])
        self.assertEqual(self.fake.applied[0].connect, [(71, 61), (72, 62)])

    def test_put_checks_its_input(self):
        self.assertEqual(self.put({'speakers': [LOUNGE]}, **{'Content-Type': 'text/plain'})[0].status, 415)
        self.assertEqual(self.put({'speakers': 'all'})[0].status, 400)
        self.assertEqual(self.put(['x'])[0].status, 400)
        self.assertEqual(self.request('PUT', body=b'{', **{'Content-Type': 'application/json'})[0].status, 400)
        self.assertEqual(self.put({'speakers': ['x' * 256] * 16})[0].status, 400)  # over 4 KB
        self.assertEqual(self.fake.applied, [])

    def test_pipewire_down(self):
        self.fake.fail = True
        response, body = self.request('GET', Origin=ORIGIN)
        self.assertEqual(response.status, 503)
        self.assertEqual(body['error'], 'PipeWire is not available')


if __name__ == '__main__':
    unittest.main()
