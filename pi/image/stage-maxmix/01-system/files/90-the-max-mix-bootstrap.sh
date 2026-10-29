#!/bin/sh
# NetworkManager dispatcher script: when a connection comes up (ethernet, or Wi-Fi the Pi already knows), start the
# bootstrap right away instead of waiting for its next retry. It does nothing once THE MAX MIX is installed.
[ -e /var/lib/the-max-mix/bootstrapped ] && exit 0
case "$2" in
  up | connectivity-change)
    systemctl start --no-block the-max-mix-bootstrap.service || true
    ;;
esac
exit 0
