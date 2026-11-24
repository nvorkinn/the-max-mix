// One Dashboard screen in Flutter, to measure flutter-pi against Chromium on the Pi. Fixture data only.
//
// What it draws, at 1280x800: the backdrop, the clock, a weather panel, the tube status panel and the departure board,
// each a frosted panel (backdrop blur). Every few seconds the board changes from one stop to the next, line by line,
// the way the web Dashboard's "slide" change does. Tapping a departure opens a dialog over a blurred screen.
//
// It prints its measurements to stdout, one line each:
//   first-frame <epoch ms>                 when the first frame reached the screen
//   change fps=<avg> low=<worst 1 s> gap=<worst frame gap ms> raster=<worst raster ms> frames=<n>
//   dialog fps=<avg> gap=<ms> raster=<ms> frames=<n>
import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

/// PROOF_IDLE=1 in the environment keeps the board still and no dialog opens: only the clock ticks.
final _idle = Platform.environment['PROOF_IDLE'] == '1';
const _changeEvery = Duration(seconds: 6);
const _lineMs = 600;
const _staggerMs = 120;
const _font = 'Plus Jakarta Sans';

void main() {
  runApp(const ProofApp());
  WidgetsBinding.instance.waitUntilFirstFrameRasterized.then((_) {
    stdout.writeln('first-frame ${DateTime.now().millisecondsSinceEpoch}');
  });
}

/// Counts the frames an animation produced and how long the slowest took, from its controller's ticks and the
/// engine's frame timings.
class FrameProbe {
  FrameProbe(this.label);
  final String label;
  final _clock = Stopwatch();
  final _ticks = <int>[];
  int _worstRasterUs = 0;
  bool _running = false;

  void _onTimings(List<FrameTiming> timings) {
    for (final t in timings) {
      _worstRasterUs = math.max(_worstRasterUs, t.rasterDuration.inMicroseconds);
    }
  }

  void start() {
    _ticks.clear();
    _worstRasterUs = 0;
    _clock
      ..reset()
      ..start();
    if (!_running) SchedulerBinding.instance.addTimingsCallback(_onTimings);
    _running = true;
  }

  void tick() {
    if (_running) _ticks.add(_clock.elapsedMicroseconds);
  }

  void stop() {
    if (!_running) return;
    _running = false;
    _clock.stop();
    // Timings arrive in batches after the frame; give the last batch a moment before reporting.
    Timer(const Duration(milliseconds: 200), () {
      SchedulerBinding.instance.removeTimingsCallback(_onTimings);
      _report();
    });
  }

  void _report() {
    if (_ticks.length < 2) return;
    final span = (_ticks.last - _ticks.first) / 1e6;
    final avg = (_ticks.length - 1) / span;
    var gap = 0;
    for (var i = 1; i < _ticks.length; i++) {
      gap = math.max(gap, _ticks[i] - _ticks[i - 1]);
    }
    // The fewest frames in any one-second window of the run (only when the run lasts a second or more).
    var low = double.nan;
    if (span >= 1) {
      var lowest = 1 << 30;
      var j = 0;
      for (var i = 0; i < _ticks.length; i++) {
        if (_ticks[i] + 1000000 > _ticks.last) break;
        while (j < _ticks.length && _ticks[j] < _ticks[i] + 1000000) {
          j++;
        }
        lowest = math.min(lowest, j - i);
      }
      low = lowest.toDouble();
    }
    stdout.writeln(
      '$label fps=${avg.toStringAsFixed(1)} low=${low.isNaN ? '-' : low.toStringAsFixed(0)} '
      'gap=${(gap / 1000).toStringAsFixed(1)} raster=${(_worstRasterUs / 1000).toStringAsFixed(1)} '
      'frames=${_ticks.length}',
    );
  }
}

class ProofApp extends StatelessWidget {
  const ProofApp({super.key});

  @override
  Widget build(BuildContext context) {
    return WidgetsApp(
      color: Color(0xFF000000),
      debugShowCheckedModeBanner: false,
      builder: _home,
    );
  }

  static Widget _home(BuildContext context, Widget? _) => const DefaultTextStyle(
    style: TextStyle(fontFamily: _font, color: Color(0xFFFFFFFF), fontSize: 18),
    child: Dashboard(),
  );
}

// ---- Fixture data ---------------------------------------------------------------------------------------------------

class Departure {
  const Departure(this.line, this.colour, this.destination, this.minutes);
  final String line;
  final Color colour;
  final String destination;
  final int minutes;
}

class Board {
  const Board(this.stop, this.departures);
  final String stop;
  final List<Departure> departures;
}

const _northern = Color(0xFF000000);
const _bus = Color(0xFFDC241F);
const _overground = Color(0xFFFA7B05);

const _boards = [
  Board('Kentish Town', [
    Departure('Northern', _northern, 'Morden via Bank', 2),
    Departure('Northern', _northern, 'Kennington via Charing Cross', 4),
    Departure('Northern', _northern, 'Battersea Power Station', 7),
    Departure('Northern', _northern, 'Morden via Bank', 9),
    Departure('Northern', _northern, 'High Barnet', 12),
  ]),
  Board('Kentish Town West', [
    Departure('Mildmay', _overground, 'Stratford', 3),
    Departure('Mildmay', _overground, 'Richmond', 5),
    Departure('Mildmay', _overground, 'Clapham Junction', 11),
    Departure('Mildmay', _overground, 'Stratford', 18),
    Departure('Mildmay', _overground, 'Richmond', 20),
  ]),
  Board('Leighton Road', [
    Departure('134', _bus, 'Tottenham Court Road', 1),
    Departure('C2', _bus, 'Oxford Circus', 3),
    Departure('214', _bus, 'Moorgate', 6),
    Departure('134', _bus, 'North Finchley', 8),
    Departure('C2', _bus, 'Parliament Hill Fields', 14),
  ]),
];

const _lines = [
  ('Northern', _northern, 'Good service'),
  ('Victoria', Color(0xFF0098D4), 'Good service'),
  ('Central', Color(0xFFE32017), 'Minor delays'),
  ('Elizabeth', Color(0xFF6950A1), 'Good service'),
  ('Jubilee', Color(0xFFA0A5A9), 'Good service'),
  ('Mildmay', _overground, 'Part closure'),
];

// ---- Screen ---------------------------------------------------------------------------------------------------------

class Dashboard extends StatefulWidget {
  const Dashboard({super.key});

  @override
  State<Dashboard> createState() => _DashboardState();
}

class _DashboardState extends State<Dashboard> {
  int _board = 0;
  Departure? _open;
  Timer? _cycle;
  Timer? _autoOpen;

  @override
  void initState() {
    super.initState();
    if (!_idle) {
      _cycle = Timer.periodic(_changeEvery, (_) => setState(() => _board = (_board + 1) % _boards.length));
      // Opens a dialog half way between two changes, so the two animations are measured apart.
      _autoOpen = Timer.periodic(const Duration(seconds: 18), (_) {
        Timer(const Duration(seconds: 3), () => _show(_boards[_board].departures.first));
        Timer(const Duration(seconds: 5), _close);
      });
    }
  }

  @override
  void dispose() {
    _cycle?.cancel();
    _autoOpen?.cancel();
    super.dispose();
  }

  void _show(Departure d) => setState(() => _open = d);
  void _close() => setState(() => _open = null);

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        Image.asset('assets/backdrop.jpg', fit: BoxFit.cover),
        Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                height: 300,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(width: 330, child: Glass(child: Weather())),
                    const SizedBox(width: 20),
                    const SizedBox(width: 400, child: Glass(child: TubeStatus())),
                    const Spacer(),
                    const Clock(),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              Expanded(
                child: Glass(
                  child: DepartureBoard(board: _boards[_board], onTap: _show),
                ),
              ),
            ],
          ),
        ),
        DepartureDialog(departure: _open, onClose: _close),
      ],
    );
  }
}

/// A frosted panel: what is behind it blurred, under a faint white wash.
class Glass extends StatelessWidget {
  const Glass({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(22),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 12, sigmaY: 12),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: const Color(0x2E0B1020),
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: const Color(0x26FFFFFF)),
          ),
          child: Padding(padding: const EdgeInsets.all(22), child: child),
        ),
      ),
    );
  }
}

TextStyle _weight(double size, double weight, {Color? colour}) => TextStyle(
  fontSize: size,
  fontWeight: FontWeight.values[((weight / 100).round() - 1).clamp(0, 8)],
  fontVariations: [ui.FontVariation('wght', weight)],
  color: colour,
);

class Clock extends StatefulWidget {
  const Clock({super.key});

  @override
  State<Clock> createState() => _ClockState();
}

class _ClockState extends State<Clock> {
  late Timer _timer;
  DateTime _now = DateTime.now();

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => setState(() => _now = DateTime.now()));
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  static const _days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  static const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  @override
  Widget build(BuildContext context) {
    String two(int n) => n.toString().padLeft(2, '0');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text('${two(_now.hour)}:${two(_now.minute)}', style: _weight(96, 800)),
        Text('${_days[_now.weekday - 1]} ${_now.day} ${_months[_now.month - 1]}', style: _weight(26, 600)),
      ],
    );
  }
}

class Weather extends StatelessWidget {
  const Weather({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('London', style: _weight(22, 700)),
        const SizedBox(height: 8),
        Text('9°', style: _weight(84, 800)),
        Text('Light rain, clearing later', style: _weight(20, 500, colour: const Color(0xCCFFFFFF))),
        const Spacer(),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            for (final (h, t) in [('10', 9), ('12', 11), ('14', 12), ('16', 10), ('18', 8)])
              Column(children: [Text(h, style: _weight(16, 600)), Text('$t°', style: _weight(20, 700))]),
          ],
        ),
      ],
    );
  }
}

class LinePill extends StatelessWidget {
  const LinePill(this.name, this.colour, {super.key, this.width = 120});
  final String name;
  final Color colour;
  final double width;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      padding: const EdgeInsets.symmetric(vertical: 5),
      decoration: BoxDecoration(
        color: colour,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0x40FFFFFF)),
      ),
      child: Center(heightFactor: 1, child: Text(name, style: _weight(16, 700))),
    );
  }
}

class TubeStatus extends StatelessWidget {
  const TubeStatus({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Tube status', style: _weight(22, 700)),
        const SizedBox(height: 6),
        for (final (name, colour, status) in _lines)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Row(
              children: [
                LinePill(name, colour),
                const SizedBox(width: 14),
                Text(
                  status,
                  style: _weight(
                    18,
                    status == 'Good service' ? 500 : 700,
                    colour: status == 'Good service' ? const Color(0xCCFFFFFF) : const Color(0xFFFFC94D),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

// ---- The departure board and its change -----------------------------------------------------------------------------

/// The board's lines (its heading, then each departure). When the stop changes, each line's old content slides up and
/// out of its row as the new one slides up in, the heading first and each line a beat later.
class DepartureBoard extends StatefulWidget {
  const DepartureBoard({super.key, required this.board, required this.onTap});
  final Board board;
  final ValueChanged<Departure> onTap;

  @override
  State<DepartureBoard> createState() => _DepartureBoardState();
}

class _DepartureBoardState extends State<DepartureBoard> with SingleTickerProviderStateMixin {
  static const _rows = 6;
  static final _total = Duration(milliseconds: _lineMs + (_rows - 1) * _staggerMs);
  late final AnimationController _change = AnimationController(vsync: this, duration: _total, value: 1);
  final _probe = FrameProbe('change');
  Board? _previous;

  @override
  void initState() {
    super.initState();
    _change.addListener(_probe.tick);
    _change.addStatusListener((s) {
      if (s == AnimationStatus.completed) _probe.stop();
    });
  }

  @override
  void didUpdateWidget(DepartureBoard old) {
    super.didUpdateWidget(old);
    if (old.board != widget.board) {
      _previous = old.board;
      _probe.start();
      _change.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _change.dispose();
    super.dispose();
  }

  /// How far line `i` is through its own change, 0 to 1, smoothstepped like the web's easing.
  double _progress(int i) {
    final ms = _change.value * _total.inMilliseconds - i * _staggerMs;
    final t = (ms / _lineMs).clamp(0.0, 1.0);
    return t * t * (3 - 2 * t);
  }

  Widget _line(int i, double height, Widget? Function(Board) build) {
    final now = build(widget.board);
    final before = _previous == null ? null : build(_previous!);
    return SizedBox(
      height: height,
      child: ClipRect(
        child: AnimatedBuilder(
          animation: _change,
          builder: (context, _) {
            final p = _progress(i);
            if (p >= 1 || before == null) return now ?? const SizedBox.shrink();
            return Stack(
              children: [
                Transform.translate(offset: Offset(0, -height * p), child: before),
                Transform.translate(offset: Offset(0, height * (1 - p)), child: now),
              ],
            );
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, size) {
        final rowHeight = size.maxHeight / (_rows + 0.4);
        return Column(
          children: [
            _line(
              0,
              rowHeight * 1.4,
              (b) => Align(alignment: Alignment.centerLeft, child: Text(b.stop, style: _weight(34, 800))),
            ),
            for (var i = 0; i < _rows - 1; i++)
              _line(i + 1, rowHeight, (b) {
                final d = b.departures[i];
                return GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => widget.onTap(d),
                  child: Row(
                    children: [
                      LinePill(d.line, d.colour, width: 130),
                      const SizedBox(width: 20),
                      Expanded(child: Text(d.destination, style: _weight(28, 650), overflow: TextOverflow.ellipsis)),
                      Text(d.minutes <= 1 ? 'Due' : '${d.minutes} min', style: _weight(30, 800)),
                    ],
                  ),
                );
              }),
          ],
        );
      },
    );
  }
}

// ---- Dialog ---------------------------------------------------------------------------------------------------------

/// A departure's details over the whole screen blurred. Fades and scales in; a tap anywhere closes it.
class DepartureDialog extends StatefulWidget {
  const DepartureDialog({super.key, required this.departure, required this.onClose});
  final Departure? departure;
  final VoidCallback onClose;

  @override
  State<DepartureDialog> createState() => _DepartureDialogState();
}

class _DepartureDialogState extends State<DepartureDialog> with SingleTickerProviderStateMixin {
  late final AnimationController _fade = AnimationController(vsync: this, duration: const Duration(milliseconds: 350));
  final _probe = FrameProbe('dialog');
  Departure? _shown;

  @override
  void initState() {
    super.initState();
    _fade.addListener(_probe.tick);
    _fade.addStatusListener((s) {
      if (s == AnimationStatus.completed || s == AnimationStatus.dismissed) _probe.stop();
      if (s == AnimationStatus.dismissed) setState(() => _shown = null);
    });
  }

  @override
  void didUpdateWidget(DepartureDialog old) {
    super.didUpdateWidget(old);
    if (widget.departure != null && widget.departure != old.departure) {
      _shown = widget.departure;
      _probe.start();
      _fade.forward();
    } else if (widget.departure == null && old.departure != null) {
      _probe.start();
      _fade.reverse();
    }
  }

  @override
  void dispose() {
    _fade.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final d = _shown;
    if (d == null) return const SizedBox.shrink();
    return GestureDetector(
      onTap: widget.onClose,
      child: AnimatedBuilder(
        animation: _fade,
        builder: (context, child) {
          final t = Curves.easeOutCubic.transform(_fade.value);
          return BackdropFilter(
            filter: ui.ImageFilter.blur(sigmaX: 18 * t, sigmaY: 18 * t),
            child: ColoredBox(
              color: Color.fromRGBO(0, 0, 0, 0.35 * t),
              child: Center(
                child: Opacity(
                  opacity: t,
                  child: Transform.scale(scale: 0.94 + 0.06 * t, child: child),
                ),
              ),
            ),
          );
        },
        child: Container(
          width: 560,
          padding: const EdgeInsets.all(32),
          decoration: BoxDecoration(
            color: const Color(0xE6141A2B),
            borderRadius: BorderRadius.circular(26),
            border: Border.all(color: const Color(0x33FFFFFF)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              LinePill(d.line, d.colour, width: 150),
              const SizedBox(height: 18),
              Text(d.destination, style: _weight(36, 800)),
              const SizedBox(height: 8),
              Text(
                d.minutes <= 1 ? 'Due now' : 'In ${d.minutes} minutes',
                style: _weight(24, 600, colour: const Color(0xCCFFFFFF)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
