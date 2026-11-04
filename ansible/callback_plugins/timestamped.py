"""Ansible's usual console output (the default callback), with the time in front of every line.

Without it a pull's output says what ran but not when, which makes a slow or stuck run hard to read: in the update output
the app shows, and in a hand run's terminal (the journal times its own lines, but that is not where the app reads them).
ansible.cfg at the repository root selects it as `stdout_callback`, so it applies to ansible-pull, to the first-boot
pull and to a hand run from a clone alike. Ansible loads callback plugins that sit next to the playbook. It prints the
same as the default callback; only the prefix is added, and the other callbacks' lines (task_timer's summary, warnings)
get it too, because they all print through the same display."""

from __future__ import annotations

import time

from ansible.plugins.callback.default import CallbackModule as DefaultCallback

DOCUMENTATION = """
    name: timestamped
    type: stdout
    short_description: The default output with a timestamp in front of every line.
    description:
      - Prints what the default callback prints, each line starting with the local date and time.
    extends_documentation_fragment:
      - default_callback
"""

TIMESTAMP_FORMAT = "%Y-%m-%d %H:%M:%S"


class CallbackModule(DefaultCallback):
    CALLBACK_VERSION = 2.0
    CALLBACK_TYPE = "stdout"
    CALLBACK_NAME = "timestamped"

    def __init__(self):
        super().__init__()
        # Whether the next text starts a new line (a message printed without a newline continues the line before it).
        self._at_line_start = True
        display = self._display
        # Every plugin prints through this one display, so wrapping it stamps their lines as well. Wrapped once.
        if not getattr(display, "_timestamped", False):
            print_line = display.display

            def stamped(msg, color=None, stderr=False, screen_only=False, log_only=False, newline=True):
                # A message only for the log file is left alone: Ansible's log file stamps its own lines.
                if log_only:
                    return print_line(msg, color=color, stderr=stderr, screen_only=screen_only, log_only=True, newline=newline)
                text = str(msg)
                pieces = text.split("\n")
                now = time.strftime(TIMESTAMP_FORMAT)
                for index, piece in enumerate(pieces):
                    # Blank lines stay blank; a continued line is not stamped again.
                    if piece and (index > 0 or self._at_line_start):
                        pieces[index] = f"{now} {piece}"
                self._at_line_start = newline or text.endswith("\n")
                return print_line(
                    "\n".join(pieces), color=color, stderr=stderr, screen_only=screen_only, log_only=False, newline=newline
                )

            display.display = stamped
            display._timestamped = True
