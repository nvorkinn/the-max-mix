"""THE MAX MIX Wi-Fi setup panel: a Qt Quick app that lists networks and joins one through nmcli.

Exit codes: 0 connected, 2 cancelled (--can-cancel only), 1 could not start."""

import argparse
import logging
import os
import sys
import threading
from pathlib import Path

import nmcli

EXIT_CONNECTED = 0
EXIT_FAILED = 1
EXIT_CANCELLED = 2

QML_FILE = Path(__file__).resolve().parent / 'qml' / 'Main.qml'


def parse_args(argv):
    parser = argparse.ArgumentParser(description='THE MAX MIX Wi-Fi setup panel')
    parser.add_argument('--can-cancel', action='store_true', help='show a Cancel button (exit code 2, nothing changed)')
    parser.add_argument('--windowed', action='store_true', help='1024x600 window instead of full screen (development)')
    return parser.parse_args(argv)


def main(argv):
    args = parse_args(argv)
    logging.basicConfig(level=logging.INFO, format='%(name)s: %(message)s')
    # Set before Qt starts so a dev machine behaves like the kiosk; the kiosk session sets the same values.
    os.environ.setdefault('QT_IM_MODULE', 'qtvirtualkeyboard')
    os.environ.setdefault('QT_QUICK_CONTROLS_STYLE', 'Basic')

    from PySide6.QtCore import Property, QObject, Signal, Slot
    from PySide6.QtGui import QGuiApplication
    from PySide6.QtQml import QQmlApplicationEngine

    class Backend(QObject):
        networksChanged = Signal()
        scanningChanged = Signal()
        connectingChanged = Signal()
        errorChanged = Signal()
        # Results come from worker threads; these queue them onto the Qt thread.
        scanFinished = Signal(list, str)
        connectFinished = Signal(bool, str)

        def __init__(self, client, can_cancel):
            super().__init__()
            self._client = client
            self._can_cancel = can_cancel
            self._networks = []
            self._scanning = False
            self._connecting = False
            self._error = ''
            self.scanFinished.connect(self._on_scan)
            self.connectFinished.connect(self._on_connect)

        @Property(bool, constant=True)
        def canCancel(self):
            return self._can_cancel

        @Property(list, notify=networksChanged)
        def networks(self):
            return self._networks

        @Property(bool, notify=scanningChanged)
        def scanning(self):
            return self._scanning

        @Property(bool, notify=connectingChanged)
        def connecting(self):
            return self._connecting

        @Property(str, notify=errorChanged)
        def error(self):
            return self._error

        def _set_error(self, message):
            if message != self._error:
                self._error = message
                self.errorChanged.emit()

        @Slot()
        def refresh(self):
            if self._scanning or self._connecting:
                return
            self._scanning = True
            self.scanningChanged.emit()
            self._set_error('')

            def work():
                try:
                    self._client.radio_on()
                    found = self._client.scan()
                    self.scanFinished.emit(
                        [{'ssid': n.ssid, 'bars': n.bars, 'security': n.security} for n in found], ''
                    )
                except nmcli.ScanError as error:
                    self.scanFinished.emit([], str(error))

            threading.Thread(target=work, daemon=True).start()

        def _on_scan(self, networks, error):
            self._scanning = False
            self.scanningChanged.emit()
            if error:
                self._set_error(error)
            else:
                self._networks = networks
                self.networksChanged.emit()

        @Slot(str, str, bool, str)
        def connectTo(self, ssid, password, hidden, security):
            if self._connecting:
                return
            self._connecting = True
            self.connectingChanged.emit()
            self._set_error('')

            def work():
                ok, message = self._client.connect(ssid, password, hidden, security)
                self.connectFinished.emit(ok, message)

            threading.Thread(target=work, daemon=True).start()

        def _on_connect(self, ok, message):
            if ok:
                QGuiApplication.exit(EXIT_CONNECTED)
                return
            self._connecting = False
            self.connectingChanged.emit()
            self._set_error(message)

        @Slot()
        def clearError(self):
            self._set_error('')

        @Slot()
        def cancel(self):
            if self._can_cancel:
                QGuiApplication.exit(EXIT_CANCELLED)

    app = QGuiApplication(sys.argv[:1])
    backend = Backend(nmcli.Nmcli(), args.can_cancel)
    engine = QQmlApplicationEngine()
    context = engine.rootContext()
    context.setContextProperty('backend', backend)
    context.setContextProperty('windowed', args.windowed)
    engine.load(str(QML_FILE))
    if not engine.rootObjects():
        return EXIT_FAILED
    backend.refresh()
    return app.exec()


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
