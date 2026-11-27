// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkPackages, checkPersistList, checkUnits, type RootfsUnit } from './image-lists.ts';

describe('checkPackages', () => {
  it('accepts packages, purges and comments', () => {
    expect(checkPackages('# Display\ncage\nlibspa-0.2-bluetooth # A2DP\n\n-cloud-init\n')).toEqual([]);
  });

  it('flags a bad name, two on a line and a repeat', () => {
    expect(checkPackages('Cage\nbluez rfkill\nbluez\n-bluez\n')).toEqual([
      'line 1: "Cage" is not a package name',
      'line 2: one package a line, not "bluez rfkill"',
      'line 4: bluez is already on line 3'
    ]);
  });
});

describe('checkPersistList', () => {
  it('accepts directories and files kept on /data', () => {
    expect(
      checkPersistList('# Wi-Fi\ndir  /etc/netplan  network/netplan\nfile /etc/hostname identity/hostname\n')
    ).toEqual([]);
  });

  it('flags a bad kind, a missing column and paths that are not plain', () => {
    expect(
      checkPersistList('link /a a\ndir /b\ndir etc/c c\ndir /d/../e e\ndir /f ../f\ndir /g /data/g\ndir /run/x x\n')
    ).toEqual([
      'line 1: the kind is dir or file, not "link"',
      'line 2: expected KIND PATH SOURCE, got "dir /b"',
      'line 3: "etc/c" is not a plain absolute path',
      'line 4: "/d/../e" is not a plain absolute path',
      'line 5: "../f" is not a plain path under /data',
      'line 6: "/data/g" is not a plain path under /data',
      'line 7: /run/x cannot be kept on /data'
    ]);
  });

  it('flags two lines for one place, or one inside another', () => {
    expect(
      checkPersistList('dir /home/kiosk home/kiosk\ndir /home/kiosk/.ssh ssh\ndir /var/lib/bluetooth ssh\n')
    ).toEqual(['line 2: /home/kiosk/.ssh overlaps /home/kiosk on line 1', 'line 3: ssh overlaps ssh on line 2']);
  });
});

describe('checkUnits', () => {
  const rootfs: RootfsUnit[] = [
    { name: 'kiosk.service', scope: 'system', hasInstall: true },
    { name: 'kiosk-ssh-keys.service', scope: 'system', hasInstall: false },
    { name: 'kiosk-server.service', scope: 'user', hasInstall: true }
  ];

  it('accepts every installable unit listed, and units from packages', () => {
    expect(
      checkUnits(
        'enable kiosk.service\nenable-global kiosk-server.service\nenable bluetooth.service\nmask getty@tty1.service\n',
        rootfs
      )
    ).toEqual([]);
  });

  it('flags a bad action or name, a repeat and the wrong scope', () => {
    expect(
      checkUnits(
        'start kiosk.service\nenable kiosk.service\nenable kiosk-server.service\nenable kiosk-ssh-keys.service\nenable foo\n',
        rootfs
      )
    ).toEqual([
      'line 1: the action is enable, enable-global, mask, not "start"',
      'line 2: kiosk.service is already on line 1',
      'line 3: kiosk-server.service is a user unit, so its action is enable-global',
      'line 4: kiosk-ssh-keys.service has no [Install] section, so it cannot be enabled',
      'line 5: "foo" is not a unit name'
    ]);
  });

  it('flags an installable unit in the rootfs that is not listed', () => {
    expect(checkUnits('enable kiosk.service\n', rootfs)).toEqual([
      'kiosk-server.service has an [Install] section but is not listed, so nothing would start it'
    ]);
  });
});
