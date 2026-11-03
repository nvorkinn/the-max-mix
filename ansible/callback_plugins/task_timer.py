"""Prints how long the playbook took and which tasks were slowest, at the end of every run.

Ansible loads callback plugins that sit next to the playbook, so this runs for ansible-pull and for a hand run alike.
ansible-core does not include ansible.posix's profile_tasks, and the Pi installs only ansible-core, so this small one stands
in for it. The summary lands in the journal (journalctl -u kiosk-pull) and in the update output the app shows."""

from __future__ import annotations

import time

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

    def _finish_current(self):
        now = time.monotonic()
        if self._current is not None:
            self._seconds[self._current] = self._seconds.get(self._current, 0.0) + now - self._current_start
        self._current_start = now

    def _start(self, task):
        self._finish_current()
        self._current = task.get_name().strip()

    def v2_playbook_on_task_start(self, task, is_conditional):
        self._start(task)

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
