# flutter-proof

An experiment, not part of the kiosk: one Dashboard screen in Flutter (clock, weather, tube status, the departure board
with its line-by-line change, frosted panels and a blurred dialog) at 1280x800, run on the Pi with
[flutter-pi](https://github.com/ardera/flutter-pi), which draws straight to the screen with no Cage and no browser.
Fixture data only.

## Build

The Flutter proof workflow (`.github/workflows/flutter-proof.yml`) builds an arm64 bundle for the Pi 5, with the
flutter-pi binary in it, and uploads it as the `flutter-proof-pi5-arm64` artifact. By hand:

```sh
flutter pub global activate flutterpi_tool 0.13.0   # needs Flutter 3.47
flutterpi_tool build --arch=arm64 --cpu=pi5 --release
```

## Run and measure on the Pi

```sh
sudo systemctl stop kiosk
sudo ./measure.sh <bundle dir> idle 60     # clock only
sudo ./measure.sh <bundle dir> active 60   # board change every 6 s, dialog every 18 s
sudo systemctl start kiosk
```
