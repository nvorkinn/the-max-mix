"""Prints how far the playbook has got ("Ansible progress: 12/84") as each task starts.

Ansible loads callback plugins that sit next to the playbook, so this runs for ansible-pull and for a hand run alike. The
lines land in the journal (journalctl -u kiosk-pull) and drive the bar on the app's update screen.

Ansible does not know the total up front, as include_tasks files are read while the play runs, so the total starts as
the play's own tasks and grows by the tasks of each file when it is included. Handlers are not counted."""

from __future__ import annotations

from ansible.parsing.dataloader import DataLoader
from ansible.playbook.block import Block
from ansible.plugins.callback import CallbackBase

DOCUMENTATION = """
    name: task_progress
    type: notification
    short_description: Print how many of the playbook's tasks have started, out of how many.
    description:
      - Prints "Ansible progress: done/total" as each task starts.
"""

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
    CALLBACK_NAME = "task_progress"
    # Runs without being listed in callbacks_enabled, so no setting on the Pi has to change.
    CALLBACK_NEEDS_ENABLED = False

    def __init__(self):
        super().__init__()
        self._done = 0
        self._total = 0

    def v2_playbook_on_play_start(self, play):
        try:
            self._total += _count_compiled(play.compile())
        except Exception as error:  # Progress is a nicety: the run must not depend on it.
            self._display.warning(f"task_progress could not count the play's tasks: {error}")

    def v2_playbook_on_include(self, included_file):
        try:
            self._total += _count_file(DataLoader().load_from_file(included_file._filename))
        except Exception as error:
            self._display.warning(f"task_progress could not count the tasks of {included_file._filename}: {error}")

    def v2_playbook_on_task_start(self, task, is_conditional):
        self._done += 1
        if self._total:
            self._display.display(PROGRESS.format(done=min(self._done, self._total), total=self._total))
