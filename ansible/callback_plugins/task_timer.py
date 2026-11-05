"""Prints how far the playbook has got as each task starts, and at the end how long it took and which tasks were slowest.

Ansible loads callback plugins that sit next to the playbook, so this runs for ansible-pull and for a hand run alike.
ansible-core does not include ansible.posix's profile_tasks, and the Pi installs only ansible-core, so this small one stands
in for it. The summary lands in the journal (journalctl -u kiosk-pull) and in the update output the app shows.

The progress lines ("Ansible progress: 12/84") drive the bar on the app's update screen. Ansible does not know the total
up front, as include_tasks files are read while the play runs, so the total starts as the play's own tasks and grows by
the tasks of each file when it is included. Handlers are not counted."""

from __future__ import annotations

import time

from ansible.parsing.dataloader import DataLoader
from ansible.playbook.block import Block
from ansible.plugins.callback import CallbackBase

DOCUMENTATION = """
    name: task_timer
    type: notification
    short_description: Print the slowest tasks and the total time at the end of a run.
    description:
      - Times every task and handler, then prints the slowest ones and the total.
"""

# How many of the slowest tasks the summary lists, and the shortest task worth listing.
TOP_TASKS = 15
MIN_SECONDS = 0.5
PROGRESS = "Ansible progress: {done}/{total}"


def _count_compiled(items):
    """Counts the tasks that will start among a play's compiled blocks (rescue tasks only run when something fails)."""
    count = 0
    for item in items:
        if isinstance(item, Block):
            count += _count_compiled(item.block) + _count_compiled(item.always)
        # Ansible adds a flush_handlers task of its own after each section; it does not show as a task that starts.
        elif not getattr(item, "implicit", False):
            count += 1
    return count


def _count_file(entries):
    """The same count for the tasks of an included file, as read from its YAML."""
    count = 0
    for entry in entries or []:
        if isinstance(entry, dict) and "block" in entry:
            count += _count_file(entry["block"]) + _count_file(entry.get("always"))
        elif isinstance(entry, dict):
            count += 1
    return count


class CallbackModule(CallbackBase):
    CALLBACK_VERSION = 2.0
    CALLBACK_TYPE = "notification"
    CALLBACK_NAME = "task_timer"
    # Runs without being listed in callbacks_enabled, so no setting on the Pi has to change.
    CALLBACK_NEEDS_ENABLED = False

    def __init__(self):
        super().__init__()
        self._started = time.monotonic()
        self._current = None
        self._current_start = self._started
        # Task name -> seconds, summed over a task's hosts and loop items.
        self._seconds = {}
        self._done = 0
        self._total = 0

    def _finish_current(self):
        now = time.monotonic()
        if self._current is not None:
            self._seconds[self._current] = self._seconds.get(self._current, 0.0) + now - self._current_start
        self._current_start = now

    def _start(self, task):
        self._finish_current()
        self._current = task.get_name().strip()

    def _progress(self):
        if self._total:
            self._display.display(PROGRESS.format(done=min(self._done, self._total), total=self._total))

    def v2_playbook_on_play_start(self, play):
        try:
            self._total += _count_compiled(play.compile())
        except Exception as error:  # Progress is a nicety: the run must not depend on it.
            self._display.warning(f"task_timer could not count the play's tasks: {error}")

    def v2_playbook_on_include(self, included_file):
        try:
            self._total += _count_file(DataLoader().load_from_file(included_file._filename))
        except Exception as error:
            self._display.warning(f"task_timer could not count the tasks of {included_file._filename}: {error}")

    def v2_playbook_on_task_start(self, task, is_conditional):
        self._start(task)
        self._done += 1
        self._progress()

    def v2_playbook_on_handler_task_start(self, task):
        self._start(task)

    def v2_playbook_on_stats(self, stats):
        self._finish_current()
        total = time.monotonic() - self._started
        slowest = sorted(
            ((name, seconds) for name, seconds in self._seconds.items() if seconds >= MIN_SECONDS),
            key=lambda entry: entry[1],
            reverse=True,
        )[:TOP_TASKS]
        lines = ["", f"Playbook took {total:.1f}s. Slowest tasks:"]
        lines.extend(f"  {seconds:7.1f}s  {name}" for name, seconds in slowest)
        if not slowest:
            lines.append(f"  none took {MIN_SECONDS}s or more")
        self._display.display("\n".join(lines))
