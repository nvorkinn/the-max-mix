// countdown-server's NRK podcasts, with the device secret (countdown-api's getPodcasts, getPodcastPlayback and
// putPodcastProgress): the shows the Podcasts tab lists, what to play for one episode, and where the owner has got to,
// which the server passes on to NRK so radio.nrk.no and the NRK app carry on from it.

import type { PodcastPlayback, StoredPodcasts } from 'countdown-api';
import {
  getPodcastPlayback,
  getPodcasts,
  putPodcastProgress
} from '../../../vendor/countdown-api/src/countdown_api/client';
import type { Client } from '../../../vendor/countdown-api/src/countdown_api/client';
import { serverClient } from '../countdown/config';

/** The shows, or null when the kiosk isn't registered or the server can't be reached or refuses. */
export async function fetchPodcasts(client: Client | null = serverClient()): Promise<StoredPodcasts | null> {
  if (!client) return null;
  try {
    const { data } = await getPodcasts(client);
    return data ?? null;
  } catch {
    return null;
  }
}

/** What to play for an episode, or null when it can't be had. */
export async function fetchPlayback(
  podcastId: string,
  episodeId: string,
  client: Client | null = serverClient()
): Promise<PodcastPlayback | null> {
  if (!client) return null;
  try {
    const { data } = await getPodcastPlayback(client, { podcast_id: podcastId, episode_id: episodeId });
    return data ?? null;
  } catch {
    return null;
  }
}

/** Saves the position, in whole seconds; true once the server took it. A report that fails is not tried again. */
export async function reportProgress(
  podcastId: string,
  episodeId: string,
  positionS: number,
  client: Client | null = serverClient()
): Promise<boolean> {
  if (!client) return false;
  try {
    const { error } = await putPodcastProgress(
      client,
      { podcast_id: podcastId, episode_id: episodeId },
      { position_s: Math.max(0, Math.floor(positionS)) }
    );
    return error === undefined;
  } catch {
    return false;
  }
}
