// The Podcasts tab's lists from countdown-server's StoredPodcasts: the part-listened episodes to carry on with, each
// episode's progress (NRK's, or what this kiosk has played since), and the times they show.

import type { PodcastEpisode, PodcastProgress, PodcastShow, StoredPodcasts } from 'countdown-api';
import type { Language } from '../i18n/language';
import { LOCALES } from '../i18n/language';

/** One episode with the show it is from. */
export interface ShowEpisode {
  show: PodcastShow;
  episode: PodcastEpisode;
}

/** Where this kiosk has got to in episodes since the shows were read, by episode id. */
export type LocalProgress = ReadonlyMap<string, PodcastProgress>;

/** An episode's progress: this kiosk's latest, or else NRK's as the server read it. */
export function progressOf(episode: PodcastEpisode, local: LocalProgress): PodcastProgress | null {
  return local.get(episode.id) ?? episode.progress;
}

/** Whether an episode was started and not finished. */
export function isPartListened(progress: PodcastProgress | null): progress is PodcastProgress {
  return progress !== null && !progress.finished && progress.position_s > 0;
}

/** How far through, from 0 to 1. */
export function fractionOf(progress: PodcastProgress | null, durationS: number): number {
  if (!progress || durationS <= 0) return 0;
  if (progress.finished) return 1;
  return Math.min(1, Math.max(0, progress.position_s / durationS));
}

/** The part-listened episodes of every show, newest first. */
export function continueListening(podcasts: StoredPodcasts | null, local: LocalProgress): ShowEpisode[] {
  if (!podcasts) return [];
  const started = podcasts.shows.flatMap(show =>
    show.episodes.filter(episode => isPartListened(progressOf(episode, local))).map(episode => ({ show, episode }))
  );
  return started.toSorted((a, b) => Date.parse(b.episode.published_at) - Date.parse(a.episode.published_at));
}

/** Where an episode starts: where it was left, unless it was finished or never started. */
export function startPosition(progress: PodcastProgress | null): number {
  return isPartListened(progress) ? progress.position_s : 0;
}

/** A time on the player's clock: 4:05, or 1:02:05 past an hour. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** An episode's length in hours and minutes, as Intl writes them in the language: 59 mins, 1 hr 5 mins. */
export function formatLength(seconds: number, language: Language): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const unit = (value: number, name: 'hour' | 'minute') =>
    new Intl.NumberFormat(LOCALES[language], { style: 'unit', unit: name, unitDisplay: 'short' }).format(value);
  if (hours === 0) return unit(minutes, 'minute');
  return minutes === 0 ? unit(hours, 'hour') : `${unit(hours, 'hour')} ${unit(minutes, 'minute')}`;
}

/** The day an episode came out: 27 Nov, with the year when it is not this one's. */
export function formatDay(iso: string, language: Language, now: Date = new Date()): string {
  const day = new Date(iso);
  const sameYear = day.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(LOCALES[language], {
    day: 'numeric',
    month: 'short',
    ...(!sameYear && { year: 'numeric' })
  }).format(day);
}
