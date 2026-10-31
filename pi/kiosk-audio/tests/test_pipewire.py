import json
import logging
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import pipewire  # noqa: E402


def node(id_, name, media_class, **props):
    return {
        'id': id_,
        'type': 'PipeWire:Interface:Node',
        'info': {'props': {'node.name': name, 'media.class': media_class, **props}},
    }


def port(id_, node_id, direction, channel, monitor=False):
    return {
        'id': id_,
        'type': 'PipeWire:Interface:Port',
        'info': {
            'direction': direction,
            'props': {'node.id': node_id, 'audio.channel': channel, 'port.monitor': monitor},
        },
    }


def link(id_, output_port, input_port):
    return {
        'id': id_,
        'type': 'PipeWire:Interface:Link',
        'info': {'output-port-id': output_port, 'input-port-id': input_port},
    }


def dump(*extra, links=None):
    """The local output (40), two AirPlay speakers (50, 60) and Chromium (70) playing to the local output."""
    objects = [
        {
            'id': 30,
            'type': 'PipeWire:Interface:Metadata',
            'props': {'metadata.name': 'default'},
            'metadata': [
                {'subject': 0, 'key': 'default.audio.sink', 'type': 'Spa:String:JSON', 'value': {'name': 'alsa_output.hdmi'}}
            ],
        },
        node(40, 'alsa_output.hdmi', 'Audio/Sink', **{'node.description': 'Built-in Audio'}),
        port(41, 40, 'input', 'FL'),
        port(42, 40, 'input', 'FR'),
        port(43, 40, 'output', 'FL', monitor=True),
        node(50, 'raop_sink.Kitchen.local.192.168.1.20.7000', 'Audio/Sink', **{'node.description': 'Kitchen', 'raop.ip': '192.168.1.20'}),
        port(51, 50, 'input', 'FL'),
        port(52, 50, 'input', 'FR'),
        node(60, 'raop_sink.Lounge.local.192.168.1.21.7000', 'Audio/Sink', **{'node.description': 'lounge'}),
        port(61, 60, 'input', 'FL'),
        port(62, 60, 'input', 'FR'),
        node(70, 'Chromium', 'Stream/Output/Audio', **{'application.name': 'Chromium', 'application.process.binary': 'chromium'}),
        port(71, 70, 'output', 'FL'),
        port(72, 70, 'output', 'FR'),
        node(90, 'pavucontrol peak', 'Stream/Input/Audio'),
        port(91, 90, 'input', 'MONO'),
        {'id': 99, 'type': 'PipeWire:Interface:Node', 'info': None},
        'junk',
        *extra,
    ]
    objects += links if links is not None else [link(80, 71, 41), link(81, 72, 42), link(82, 71, 91)]
    return json.dumps(objects)


KITCHEN = 'raop_sink.Kitchen.local.192.168.1.20.7000'
LOUNGE = 'raop_sink.Lounge.local.192.168.1.21.7000'


class ParseTest(unittest.TestCase):
    def test_reads_speakers_players_and_the_default_sink(self):
        graph = pipewire.parse_dump(dump())
        self.assertEqual([n.description for n in graph.speakers], ['Kitchen', 'lounge'])
        self.assertEqual([n.id for n in graph.players], [70])
        self.assertEqual(graph.default_sink, 'alsa_output.hdmi')
        self.assertEqual(graph.ports_of(40, 'out'), [])  # the monitor port is left out
        self.assertEqual(len(graph.links), 3)

    def test_default_sink_as_a_json_string(self):
        meta = {
            'id': 31,
            'type': 'PipeWire:Interface:Metadata',
            'props': {'metadata.name': 'default'},
            'metadata': [{'key': 'default.audio.sink', 'value': '{"name": "other"}'}],
        }
        self.assertEqual(pipewire.parse_dump(dump(meta)).default_sink, 'other')

    def test_rejects_what_is_not_a_dump(self):
        for text in ('nope', '{}'):
            with self.assertRaises(pipewire.PipeWireError):
                pipewire.parse_dump(text)

    def test_a_sink_without_raop_markers_is_not_a_speaker(self):
        graph = pipewire.parse_dump(dump())
        self.assertFalse(graph.nodes[40].is_airplay)
        self.assertTrue(graph.nodes[60].is_airplay)  # by its name alone

    def test_only_browser_streams_are_players(self):
        other = node(100, 'mpv', 'Stream/Output/Audio', **{'application.name': 'mpv'})
        self.assertEqual([n.id for n in pipewire.parse_dump(dump(other)).players], [70])


class PlanTest(unittest.TestCase):
    def test_routes_to_every_chosen_speaker_and_off_the_local_output(self):
        plan = pipewire.plan_routes(pipewire.parse_dump(dump()), [KITCHEN, LOUNGE])
        self.assertEqual(plan.connect, [(71, 51), (71, 61), (72, 52), (72, 62)])
        # The peak meter's link (82) is not to a sink, so it stays.
        self.assertEqual(plan.disconnect, [80, 81])

    def test_nothing_to_do_once_routed(self):
        routed = [link(83, 71, 51), link(84, 72, 52)]
        self.assertFalse(pipewire.plan_routes(pipewire.parse_dump(dump(links=routed)), [KITCHEN]))

    def test_drops_a_speaker_that_is_no_longer_chosen(self):
        routed = [link(83, 71, 51), link(84, 72, 52), link(85, 71, 61), link(86, 72, 62)]
        plan = pipewire.plan_routes(pipewire.parse_dump(dump(links=routed)), [LOUNGE])
        self.assertEqual((plan.connect, plan.disconnect), ([], [83, 84]))

    def test_no_speakers_hands_back_to_the_default_output(self):
        routed = [link(83, 71, 51), link(84, 72, 52)]
        plan = pipewire.plan_routes(pipewire.parse_dump(dump(links=routed)), [])
        self.assertEqual((plan.connect, plan.disconnect), ([(71, 41), (72, 42)], [83, 84]))

    def test_leaves_the_music_alone_when_no_chosen_speaker_is_there(self):
        self.assertFalse(pipewire.plan_routes(pipewire.parse_dump(dump()), ['raop_sink.Gone']))

    def test_mono_sides(self):
        mono_out = [pipewire.Port(1, 9, 'out', 'MONO')]
        stereo = [pipewire.Port(2, 8, 'in', 'FL'), pipewire.Port(3, 8, 'in', 'FR')]
        self.assertEqual(pipewire._pair_ports(mono_out, stereo), [(1, 2), (1, 3)])
        stereo_out = [pipewire.Port(4, 9, 'out', 'FL'), pipewire.Port(5, 9, 'out', 'FR')]
        self.assertEqual(pipewire._pair_ports(stereo_out, [pipewire.Port(6, 8, 'in', 'MONO')]), [(4, 6), (5, 6)])
        self.assertEqual(pipewire._pair_ports([], stereo), [])


class Stub:
    def __init__(self, replies=None):
        self.replies = replies or {}
        self.calls = []

    def __call__(self, argv, timeout=10):
        self.calls.append(list(argv))
        return self.replies.get(argv[0], (0, '', ''))


class PipeWireTest(unittest.TestCase):
    def setUp(self):
        logging.disable(logging.CRITICAL)

    def tearDown(self):
        logging.disable(logging.NOTSET)

    def test_reads_the_graph_with_pw_dump(self):
        stub = Stub({'pw-dump': (0, dump(), '')})
        self.assertEqual(len(pipewire.PipeWire(stub).graph().speakers), 2)
        self.assertEqual(stub.calls, [['pw-dump', '--no-colors']])

    def test_a_failed_pw_dump_is_an_error(self):
        with self.assertRaises(pipewire.PipeWireError):
            pipewire.PipeWire(Stub({'pw-dump': (1, '', 'no daemon')})).graph()

    def test_links_before_unlinking(self):
        stub = Stub()
        self.assertTrue(pipewire.PipeWire(stub).apply(pipewire.Plan([(71, 51)], [80])))
        self.assertEqual(stub.calls, [['pw-link', '71', '51'], ['pw-link', '--disconnect', '80']])

    def test_reports_failures_but_an_existing_link_is_fine(self):
        exists = Stub({'pw-link': (1, '', 'failed to link ports: File exists')})
        self.assertTrue(pipewire.PipeWire(exists).apply(pipewire.Plan([(71, 51)], [])))
        broken = Stub({'pw-link': (1, '', 'no such port')})
        self.assertFalse(pipewire.PipeWire(broken).apply(pipewire.Plan([(71, 51)], [80])))

    def test_run_command_without_a_program(self):
        code, _, _ = pipewire.run_command(['/nonexistent/program'])
        self.assertEqual(code, 127)


if __name__ == '__main__':
    unittest.main()
