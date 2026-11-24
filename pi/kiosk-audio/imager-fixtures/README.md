# Raspberry Pi Imager's customisation files

What Raspberry Pi Imager writes to a card's first partition when its customisation is filled in, for the tests of
`kiosk-first-boot.ts`. Keys, password hashes and Wi-Fi passwords are made up.

- `imager-2`: Imager 2 (rpi-imager `src/customization_generator.cpp`, main in November 2026), with a host name, an
  `admin` account with two SSH keys, and a Wi-Fi network whose passphrase has spaces and quotes in it.
- `imager-2-open`: the same Imager with a mixed-case host name, a `pi` account with a password but no keys, and a hidden
  open network.
- `imager-1`: Imager 1.8's format, with its `users:` list, `renderer: networkd` among the Wi-Fi interfaces and a
  64-digit key in place of the passphrase.
