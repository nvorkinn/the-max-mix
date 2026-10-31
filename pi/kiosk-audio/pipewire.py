"""PipeWire through pw-dump and pw-link, without a shell. Reads the graph (nodes, ports, links and the default sink) from
`pw-dump` and works out which links send the browser's audio to the chosen AirPlay (RAOP) sinks. `run` is injectable so
tests stub it."""

import json
import logging
import os
import subprocess
from dataclasses import dataclass, field

log = logging.getLogger('kiosk-audio')

COMMAND_TIMEOUT_SECONDS = 10

# Chromium's audio reaches PipeWire through pipewire-pulse as an output stream named after the browser.
PLAYER_NAMES = ('chromium', 'chrome')


def command_environment():
    """A fixed environment, plus the runtime directory that holds the user's PipeWire socket."""
    env = {'LC_ALL': 'C', 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'}
    runtime = os.environ.get('XDG_RUNTIME_DIR')
    if runtime:
        env['XDG_RUNTIME_DIR'] = runtime
    return env


def run_command(argv, timeout=COMMAND_TIMEOUT_SECONDS):
    """Run a command without a shell. Returns (return code, stdout, stderr); 124 means it timed out, 127 that it could
    not start."""
    try:
        done = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=command_environment(),
        )
    except subprocess.TimeoutExpired:
        return 124, '', 'timed out'
    except OSError as error:
        return 127, '', str(error)
    return done.returncode, done.stdout, done.stderr


class PipeWireError(Exception):
    """PipeWire could not be read or changed."""


@dataclass(frozen=True)
class Node:
    id: int
    name: str
    description: str
    media_class: str
    props: dict = field(default_factory=dict, compare=False, hash=False)

    @property
    def is_sink(self):
        return self.media_class == 'Audio/Sink'

    @property
    def is_airplay(self):
        """A sink made by libpipewire-module-raop-sink (raop-discover names them raop_sink.<host>.<ip>.<port>)."""
        return self.is_sink and (self.name.startswith('raop_sink.') or any(key.startswith('raop.') for key in self.props))

    @property
    def is_player(self):
        """An output stream of the kiosk's browser, which is where the Web Playback SDK plays."""
        if self.media_class != 'Stream/Output/Audio':
            return False
        names = (self.props.get('application.process.binary', ''), self.props.get('application.name', ''))
        return any(player in str(name).lower() for name in names for player in PLAYER_NAMES)


@dataclass(frozen=True)
class Port:
    id: int
    node: int
    direction: str  # 'in' or 'out'
    channel: str
    monitor: bool = False


@dataclass(frozen=True)
class Link:
    id: int
    output_port: int
    input_port: int


@dataclass(frozen=True)
class Graph:
    nodes: dict
    ports: list
    links: list
    default_sink: str | None = None

    def node_named(self, name):
        return next((node for node in self.nodes.values() if node.name == name), None)

    def ports_of(self, node_id, direction):
        return [port for port in self.ports if port.node == node_id and port.direction == direction and not port.monitor]

    @property
    def speakers(self):
        """The AirPlay sinks, sorted by name for a stable list on screen."""
        return sorted((node for node in self.nodes.values() if node.is_airplay), key=lambda node: node.description.lower())

    @property
    def players(self):
        return [node for node in self.nodes.values() if node.is_player]


def _direction(value):
    return 'in' if str(value).startswith('in') else 'out'


def parse_dump(text):
    """The graph from `pw-dump` JSON. Objects that are malformed or were removed (no info) are skipped."""
    try:
        objects = json.loads(text)
    except ValueError as error:
        raise PipeWireError(f'pw-dump did not return JSON: {error}') from error
    if not isinstance(objects, list):
        raise PipeWireError('pw-dump did not return a list')
    nodes, ports, links, default_sink = {}, [], [], None
    for item in objects:
        if not isinstance(item, dict) or not isinstance(item.get('id'), int):
            continue
        kind = item.get('type', '')
        info = item.get('info') if isinstance(item.get('info'), dict) else {}
        props = info.get('props') if isinstance(info.get('props'), dict) else {}
        if kind == 'PipeWire:Interface:Node' and props:
            name = str(props.get('node.name', ''))
            description = str(props.get('node.description') or props.get('node.nick') or name)
            nodes[item['id']] = Node(item['id'], name, description, str(props.get('media.class', '')), props)
        elif kind == 'PipeWire:Interface:Port' and isinstance(props.get('node.id'), int):
            ports.append(
                Port(
                    item['id'],
                    props['node.id'],
                    _direction(info.get('direction', props.get('port.direction', 'out'))),
                    str(props.get('audio.channel', '')),
                    bool(props.get('port.monitor', False)),
                )
            )
        elif kind == 'PipeWire:Interface:Link':
            output_port, input_port = info.get('output-port-id'), info.get('input-port-id')
            if isinstance(output_port, int) and isinstance(input_port, int):
                links.append(Link(item['id'], output_port, input_port))
        elif kind == 'PipeWire:Interface:Metadata' and item.get('props', {}).get('metadata.name') == 'default':
            default_sink = _default_sink(item.get('metadata')) or default_sink
    return Graph(nodes, ports, links, default_sink)


def _default_sink(entries):
    for entry in entries if isinstance(entries, list) else []:
        if isinstance(entry, dict) and entry.get('key') == 'default.audio.sink':
            value = entry.get('value')
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                except ValueError:
                    return None
            if isinstance(value, dict) and isinstance(value.get('name'), str):
                return value['name']
    return None


def _pair_ports(outputs, inputs):
    """Output port → input port pairs: by channel name, else in order; a mono side feeds or takes every channel."""
    if not outputs or not inputs:
        return []
    if len(outputs) == 1:
        return [(outputs[0].id, port.id) for port in inputs]
    if len(inputs) == 1:
        return [(port.id, inputs[0].id) for port in outputs]
    by_channel = {port.channel: port for port in inputs if port.channel}
    pairs = []
    for index, port in enumerate(outputs):
        target = by_channel.get(port.channel) or (inputs[index] if index < len(inputs) else None)
        if target is not None:
            pairs.append((port.id, target.id))
    return pairs


@dataclass(frozen=True)
class Plan:
    connect: list  # (output port id, input port id)
    disconnect: list  # link ids

    def __bool__(self):
        return bool(self.connect or self.disconnect)


def plan_routes(graph, speakers):
    """The changes that send every browser stream to exactly these AirPlay sinks (by node name), or, with no speakers, back
    to the default sink only. Links to anything other than a sink (a recorder, a visualiser) are left alone. When none of
    the chosen speakers is on the network, nothing changes, so the music is never cut off by a speaker that went away."""
    if speakers:
        targets = [node for node in graph.speakers if node.name in set(speakers)]
    else:
        default = graph.node_named(graph.default_sink) if graph.default_sink else None
        targets = [default] if default is not None and default.is_sink else []
    if not targets:
        return Plan([], [])

    port_node = {port.id: port.node for port in graph.ports}
    connect, disconnect = [], []
    for player in graph.players:
        outputs = graph.ports_of(player.id, 'out')
        wanted = {pair for sink in targets for pair in _pair_ports(outputs, graph.ports_of(sink.id, 'in'))}
        output_ids = {port.id for port in outputs}
        existing = set()
        for link in graph.links:
            if link.output_port not in output_ids:
                continue
            pair = (link.output_port, link.input_port)
            existing.add(pair)
            target = graph.nodes.get(port_node.get(link.input_port))
            if pair not in wanted and target is not None and target.is_sink:
                disconnect.append(link.id)
        connect.extend(sorted(wanted - existing))
    return Plan(connect, sorted(disconnect))


class PipeWire:
    def __init__(self, run=run_command):
        self.run = run

    def graph(self):
        code, out, err = self.run(['pw-dump', '--no-colors'])
        if code != 0:
            raise PipeWireError(f'pw-dump failed ({code}): {err.strip()}')
        return parse_dump(out)

    def apply(self, plan):
        """Makes the new links before removing the old ones, so the music does not drop out in between. Returns True when
        every change worked; a link that already exists or is already gone counts as done next time round."""
        ok = True
        for output_port, input_port in plan.connect:
            code, _, err = self.run(['pw-link', str(output_port), str(input_port)])
            if code != 0 and 'File exists' not in err:
                log.warning('pw-link %s %s failed: %s', output_port, input_port, err.strip())
                ok = False
        for link in plan.disconnect:
            code, _, err = self.run(['pw-link', '--disconnect', str(link)])
            if code != 0:
                log.warning('pw-link --disconnect %s failed: %s', link, err.strip())
                ok = False
        return ok
