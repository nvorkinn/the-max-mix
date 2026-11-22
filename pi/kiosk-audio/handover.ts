// Carries the app's saved data over when the kiosk moves from the hosted app to the copy this service serves
// (app-files.ts). A browser keeps localStorage per origin, so without this the people, their Spotify logins and the
// countdown device secret would stay behind on the hosted origin. The hosted app on the kiosk sends its maxmix.* items
// here (POST /handover); the local app takes them once on its first start (GET /handover) and then has them deleted
// (POST /handover/done). The file is in the kiosk user's own state folder, readable by that user only, like the
// browser profile that held the same items.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The most a handover may hold: the people list with its pictures' addresses is a few KB, the config a few more. */
export const MAX_HANDOVER = 256 * 1024;
const MAX_ITEMS = 100;

/** The saved items, by key: only the app's own (maxmix.*), each a string as localStorage holds it. */
export type Handover = Record<string, string>;

/** The body of POST /handover as the items to keep, or null when it is not a handover. */
export function parseHandover(body: unknown): Handover | null {
  if (typeof body !== 'object' || body === null) return null;
  const items = (body as { items?: unknown }).items;
  if (typeof items !== 'object' || items === null || Array.isArray(items)) return null;
  const entries = Object.entries(items);
  if (entries.length > MAX_ITEMS) return null;
  const handover: Handover = {};
  for (const [key, value] of entries) {
    if (typeof value !== 'string' || !/^maxmix\.[\w.]+$/.test(key)) return null;
    handover[key] = value;
  }
  return handover;
}

/** Where the handover is kept until the local app has taken it. */
export interface HandoverStore {
  save: (handover: Handover) => Promise<void>;
  /** The items kept, or null when there are none. */
  read: () => Promise<Handover | null>;
  remove: () => Promise<void>;
}

/** The handover kept in `file`. */
export function handoverFile(file: string): HandoverStore {
  return {
    save: async (handover: Handover): Promise<void> => {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      // Written beside it and moved over it, so a reader never finds half a file.
      await writeFile(`${file}.tmp`, JSON.stringify(handover), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    },
    read: async (): Promise<Handover | null> => {
      try {
        return parseHandover({ items: JSON.parse(await readFile(file, 'utf8')) as unknown });
      } catch {
        return null;
      }
    },
    remove: async (): Promise<void> => {
      await rm(file, { force: true });
    }
  };
}
