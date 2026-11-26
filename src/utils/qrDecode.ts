// Reads the QR code in a picture, for the kiosk's camera. Loaded only when a code is to be read: the decoder is a
// megabyte of WebAssembly. Its file is part of the app, since the kiosk reads a Wi-Fi code while it has no internet
// and the library would otherwise fetch it from a CDN.
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) }
});

/** The text of the QR code in `image`, or null when it shows none that can be read. */
export async function decodeQr(image: ImageData): Promise<string | null> {
  const [found] = await readBarcodes(image, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
  return found?.text ?? null;
}
