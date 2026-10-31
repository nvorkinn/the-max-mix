// AirPlay mode on the kiosk. Chromium lists the speakers: PipeWire makes an audio output for each AirPlay speaker it
// finds, and Chromium shows those outputs to the page. The Pi routes the sound: the page opens a kiosk-audio:// link,
// which the kiosk image hands to its audio handler (pi/kiosk-audio), the same way kiosk-wifi:// opens the Wi-Fi panel.
// The link only goes one way, so the page remembers the chosen speakers itself.
import { errorMessage } from '../utils/errorMessage';

const SPEAKERS_KEY = 'maxmix.airplaySpeakers';
// Chromium's stand-ins for "whatever the system uses"; they are not speakers.
const VIRTUAL_OUTPUTS = new Set(['default', 'communications']);

const isSpeaker = (device: MediaDeviceInfo) => device.kind === 'audiooutput' && !VIRTUAL_OUTPUTS.has(device.deviceId);

let labelAccess: Promise<void> | null = null;

/**
 * Chromium names the outputs only once the page has used the microphone, even with the policy that allows it
 * (AudioCaptureAllowedUrls). Opening it once, and closing it at once, is enough; the policy means nobody is asked.
 */
async function unlockLabels(): Promise<void> {
  labelAccess ??= navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then(stream => {
      for (const track of stream.getTracks()) track.stop();
    })
    .catch((error: unknown) => {
      labelAccess = null;
      throw new Error(
        `Chromium hides the speakers’ names, and the microphone permission that shows them failed: ${errorMessage(error)}`
      );
    });
  return labelAccess;
}

/** The names of the audio outputs Chromium can see, sorted. */
export async function listAudioOutputs(): Promise<string[]> {
  let devices = await navigator.mediaDevices.enumerateDevices();
  if (devices.some(device => isSpeaker(device) && !device.label)) {
    await unlockLabels();
    devices = await navigator.mediaDevices.enumerateDevices();
  }
  const names = devices.filter(device => isSpeaker(device) && device.label).map(device => device.label);
  return [...new Set(names)].toSorted((a, b) => a.localeCompare(b));
}

/** Calls `onChange` whenever an output appears or goes away; returns the unsubscribe function. */
export function watchAudioOutputs(onChange: () => void): () => void {
  navigator.mediaDevices.addEventListener('devicechange', onChange);
  return () => navigator.mediaDevices.removeEventListener('devicechange', onChange);
}

/** The link that asks the Pi to play to exactly these outputs; with none, the Pi's own output. */
export function routeLink(speakers: readonly string[]): string {
  const query = new URLSearchParams(speakers.map(name => ['speaker', name])).toString();
  return query ? `kiosk-audio://route?${query}` : 'kiosk-audio://route';
}

/** Asks the Pi to route the sound. A top-level navigation, like the Wi-Fi link; the page stays where it is. */
export function routeAudio(speakers: readonly string[]): void {
  location.assign(routeLink(speakers));
}

export function getChosenSpeakers(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SPEAKERS_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((name): name is string => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

export function setChosenSpeakers(speakers: readonly string[]): void {
  try {
    localStorage.setItem(SPEAKERS_KEY, JSON.stringify(speakers));
  } catch {
    // Storage is unavailable; the choice then lasts only until the page reloads.
  }
}
