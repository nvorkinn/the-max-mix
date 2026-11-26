// The camera built into the kiosk's screen, through its service (pi/kiosk-audio/camera.ts): whether there is one, and
// where its picture comes from. The service reads it because Chromium on the kiosk cannot open a ribbon-cable camera.
import { KIOSK_SERVICE } from './kioskService';

/** The camera's picture, as JPEG frames one after another for as long as the request is open. */
export const CAMERA_STREAM = `${KIOSK_SERVICE}/camera/stream`;

/** Whether the kiosk has a camera. False when its service does not answer, or is too old to know. */
export async function hasCamera(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${KIOSK_SERVICE}/camera`, { signal: signal ?? null });
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && (body as Record<string, unknown>)['available'] === true;
  } catch {
    return false;
  }
}
