#!/usr/bin/env bash
# Runs the proof with flutter-pi on the Pi in place of the kiosk and prints what it costs.
#
#   sudo ./measure.sh <bundle dir> <idle|active> [seconds]
#
# The kiosk must be stopped first (sudo systemctl stop kiosk): flutter-pi needs the screen to itself.
# Prints: time to first frame, memory (PSS) and average CPU over the run, and the app's own frame lines
# (see lib/main.dart). The app's output is kept in /tmp/flutter-proof-<mode>.log.
#
# FLUTTER_PI_ARGS adds flutter-pi options. the-max-mix-4's screen is a 1200x1920 panel turned on its side, which Cage
# shows at scale 1.5; to lay out at 1280x800 the same way: FLUTTER_PI_ARGS='-r 90 -d 211,337 --enable-impeller'.
set -euo pipefail

bundle=${1:?bundle dir}
mode=${2:?idle or active}
seconds=${3:-60}
log=/tmp/flutter-proof-$mode.log
flutter_pi=$bundle/flutter-pi
[[ -x $flutter_pi ]] || flutter_pi=$(command -v flutter-pi)

env=()
[[ $mode == idle ]] && env=(PROOF_IDLE=1)

start=$(date +%s%3N)
# shellcheck disable=SC2086 # FLUTTER_PI_ARGS is a list of options.
env "${env[@]}" "$flutter_pi" --release ${FLUTTER_PI_ARGS:-} "$bundle" >"$log" 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT

until grep -q '^first-frame' "$log"; do
  kill -0 "$pid" 2>/dev/null || { cat "$log"; exit 1; }
  sleep 0.05
done
first=$(awk '/^first-frame/ { print $2; exit }' "$log")
echo "first frame after $((first - start)) ms"

# Let it settle before measuring.
sleep 5
ticks() { awk '{ print $14 + $15 }' "/proc/$pid/stat"; }
hz=$(getconf CLK_TCK)
t0=$(ticks)
sleep "$seconds"
t1=$(ticks)
awk -v d=$((t1 - t0)) -v hz="$hz" -v s="$seconds" -v n="$(nproc)" \
  'BEGIN { c = 100 * d / hz / s; printf "cpu %.1f%% of one core, %.1f%% of all %d over %ds\n", c, c / n, n, s }'
echo "memory $(awk '/^Pss:/ { printf "%d MB PSS", $2 / 1024 }' "/proc/$pid/smaps_rollup"), $(awk '/^VmRSS:/ { printf "%d MB RSS", $2 / 1024 }' "/proc/$pid/status")"
grep -E '^(change|dialog) ' "$log" || true
