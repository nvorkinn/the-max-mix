import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, ChevronLeft, Pause, Play, Podcast, RotateCcw, RotateCw } from 'lucide-react';
import type { PodcastShow, StoredPodcasts } from 'countdown-api';
import { BACK_S, FORWARD_S } from '../hooks/usePodcastPlayer';
import type { PodcastPlayer } from '../hooks/usePodcastPlayer';
import { useLanguage } from '../i18n/language';
import { useT } from '../i18n/translate';
import { continueListening, formatClock, formatDay, formatLength, fractionOf, progressOf } from '../podcasts/episodes';
import type { LocalProgress, ShowEpisode } from '../podcasts/episodes';

/** A show's or an episode's square picture, or the podcast mark while it has none. */
function Cover({ src, className }: Readonly<{ src: string | null; className: string }>) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || src === failed) {
    return (
      <span className={`${className} podcast-cover-empty`} aria-hidden="true">
        <Podcast />
      </span>
    );
  }
  return <img src={src} alt="" className={className} onError={() => setFailed(src)} />;
}

const coverOf = ({ show, episode }: ShowEpisode) => episode.image_url ?? show.image_url;

/** How far through an episode is, as a thin bar. */
function ProgressBar({ fraction }: Readonly<{ fraction: number }>) {
  return (
    <span className="podcast-progress" aria-hidden="true">
      <span style={{ width: `${fraction * 100}%` }} />
    </span>
  );
}

/** The part-listened episodes, newest first, in a row to scroll sideways. */
function ContinueRow({
  items,
  local,
  onOpen
}: Readonly<{ items: ShowEpisode[]; local: LocalProgress; onOpen: (choice: ShowEpisode) => void }>) {
  const t = useT();
  return (
    <section className="podcasts-section" aria-labelledby="podcasts-continue">
      <h2 id="podcasts-continue" className="podcasts-heading">
        {t('podcasts.continue')}
      </h2>
      <ul className="podcasts-continue">
        {items.map(item => (
          <li key={item.episode.id}>
            <button type="button" className="podcast-card" onClick={() => onOpen(item)}>
              <Cover src={coverOf(item)} className="podcast-card-cover" />
              <span className="podcast-card-show">{item.show.title}</span>
              <span className="podcast-card-title">{item.episode.title}</span>
              <ProgressBar fraction={fractionOf(progressOf(item.episode, local), item.episode.duration_s)} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every show, favourites then pinned, as the server lists them. */
function ShowGrid({ shows, onOpen }: Readonly<{ shows: PodcastShow[]; onOpen: (show: PodcastShow) => void }>) {
  const t = useT();
  return (
    <section className="podcasts-section" aria-labelledby="podcasts-shows">
      <h2 id="podcasts-shows" className="podcasts-heading">
        {t('podcasts.shows')}
      </h2>
      <ul className="podcasts-shows">
        {shows.map(show => (
          <li key={show.id}>
            <button type="button" className="podcast-show" onClick={() => onOpen(show)}>
              <Cover src={show.image_url} className="podcast-show-cover" />
              <span className="podcast-show-title">{show.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One show: its picture and title beside its newest episodes. */
function ShowEpisodes({
  show,
  player,
  onBack
}: Readonly<{ show: PodcastShow; player: PodcastPlayer; onBack: () => void }>) {
  const t = useT();
  const language = useLanguage();
  return (
    <div className="podcast-show-page">
      <aside className="podcast-show-side">
        <button type="button" className="podcasts-back" onClick={onBack} aria-label={t('common.back')}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <Cover src={show.image_url} className="podcast-show-art" />
        <h2 className="podcast-show-name">{show.title}</h2>
      </aside>
      <ul className="podcast-episodes" aria-label={show.title}>
        {show.episodes.map(episode => {
          const progress = progressOf(episode, player.local);
          const isCurrent = player.current?.episode.id === episode.id;
          return (
            <li key={episode.id}>
              <button
                type="button"
                className="podcast-episode"
                aria-current={isCurrent || undefined}
                onClick={() => player.open({ show, episode })}
              >
                <span className="podcast-episode-title">{episode.title}</span>
                <span className="podcast-episode-meta">
                  <span>{formatDay(episode.published_at, language)}</span>
                  <span>{formatLength(episode.duration_s, language)}</span>
                  {progress?.finished && (
                    <span className="podcast-episode-finished" role="img" aria-label={t('podcasts.finished')}>
                      <Check aria-hidden="true" />
                    </span>
                  )}
                </span>
                {progress && !progress.finished && progress.position_s > 0 && (
                  <ProgressBar fraction={fractionOf(progress, episode.duration_s)} />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The episode playing: its picture, a scrubbable position and large controls. */
function Player({ player, onBack }: Readonly<{ player: PodcastPlayer; onBack: () => void }>) {
  const t = useT();
  // While a finger drags the position, it shows where it would go; the seek is made when it lets go.
  const [scrub, setScrub] = useState<number | null>(null);
  const { current } = player;
  if (!current) return null;
  const ready = player.phase === 'ready';
  const duration = Math.max(player.duration, 1);
  const shown = Math.min(scrub ?? player.position, duration);
  const elapsed = formatClock(shown);
  const remaining = `−${formatClock(duration - shown)}`;
  const commit = () => {
    if (scrub === null) return;
    player.seek(scrub);
    setScrub(null);
  };
  return (
    <div className="podcast-player">
      <button type="button" className="podcasts-back" onClick={onBack} aria-label={t('common.back')}>
        <ChevronLeft aria-hidden="true" />
      </button>
      <Cover src={coverOf(current)} className="podcast-player-art" />
      <div className="podcast-player-side">
        <div className="podcast-player-copy">
          <p className="podcast-player-show">{current.show.title}</p>
          <h2 className="podcast-player-title">{current.episode.title}</h2>
        </div>
        {player.phase === 'failed' && (
          <p className="podcast-player-failed" role="alert">
            {t('podcasts.failed')}
          </p>
        )}
        <div className="podcast-player-controls">
          <input
            type="range"
            className="range-control podcast-seek"
            min={0}
            max={duration}
            step={1}
            value={shown}
            disabled={!ready}
            aria-label={t('player.position')}
            aria-valuetext={t('player.position_of', { elapsed, total: formatClock(duration) })}
            style={{ '--range-progress': `${(shown / duration) * 100}%` } as CSSProperties}
            onChange={event => setScrub(Number(event.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
          />
          <div className="podcast-times">
            <span>{elapsed}</span>
            <span>{remaining}</span>
          </div>
          <div className="podcast-transport">
            <button
              type="button"
              className="podcast-jump"
              disabled={!ready}
              onClick={() => player.skip(-BACK_S)}
              aria-label={t('player.back_15')}
            >
              <RotateCcw aria-hidden="true" />
              <span aria-hidden="true">{BACK_S}</span>
            </button>
            <button
              type="button"
              className="podcast-play"
              disabled={!ready}
              onClick={player.togglePlay}
              aria-label={t(player.isPlaying ? 'dashboard.pause' : 'dashboard.play')}
            >
              {player.isPlaying ? (
                <Pause fill="currentColor" aria-hidden="true" />
              ) : (
                <Play fill="currentColor" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="podcast-jump"
              disabled={!ready}
              onClick={() => player.skip(FORWARD_S)}
              aria-label={t('podcasts.forward_30')}
            >
              <RotateCw aria-hidden="true" />
              <span aria-hidden="true">{FORWARD_S}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The episode open in the player, at the foot of the lists: a tap goes back to the player. */
function MiniPlayer({ player, onExpand }: Readonly<{ player: PodcastPlayer; onExpand: () => void }>) {
  const t = useT();
  const { current } = player;
  if (!current) return null;
  return (
    <div className="podcast-mini">
      <button
        type="button"
        className="podcast-mini-open"
        onClick={onExpand}
        aria-label={t('podcasts.open_player', { title: current.episode.title })}
      >
        <Cover src={coverOf(current)} className="podcast-mini-art" />
        <span className="podcast-mini-copy">
          <span className="podcast-mini-title">{current.episode.title}</span>
          <span className="podcast-mini-show">{current.show.title}</span>
        </span>
      </button>
      <ProgressBar fraction={player.duration > 0 ? Math.min(1, player.position / player.duration) : 0} />
      <button
        type="button"
        className="podcast-mini-play"
        disabled={player.phase !== 'ready'}
        onClick={player.togglePlay}
        aria-label={t(player.isPlaying ? 'dashboard.pause' : 'dashboard.play')}
      >
        {player.isPlaying ? (
          <Pause fill="currentColor" aria-hidden="true" />
        ) : (
          <Play fill="currentColor" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

/**
 * The Podcasts tab: the episodes to carry on with and the shows, a show's episodes, and the player. The player is the
 * app's (TabletView's), so an episode plays on with another tab showing.
 */
export default function PodcastsView({
  podcasts,
  player
}: Readonly<{ podcasts: StoredPodcasts | null; player: PodcastPlayer }>) {
  type Page = { kind: 'home' } | { kind: 'show'; showId: string } | { kind: 'player' };
  const [page, setPage] = useState<Page>({ kind: 'home' });
  const shows = podcasts?.shows ?? [];
  const show = page.kind === 'show' ? shows.find(candidate => candidate.id === page.showId) : undefined;
  const play = (choice: ShowEpisode) => {
    player.open(choice);
    setPage({ kind: 'player' });
  };
  const home = () => setPage({ kind: 'home' });
  const playerShown = page.kind === 'player' && player.current !== null;
  let content;
  if (playerShown) {
    const backTo = player.current?.show.id;
    content = (
      <Player
        player={player}
        onBack={() => (backTo && shows.some(s => s.id === backTo) ? setPage({ kind: 'show', showId: backTo }) : home())}
      />
    );
  } else if (show) {
    content = <ShowEpisodes show={show} player={{ ...player, open: play }} onBack={home} />;
  } else {
    const continuing = continueListening(podcasts, player.local);
    content = (
      <div className="podcasts-home">
        {continuing.length > 0 && <ContinueRow items={continuing} local={player.local} onOpen={play} />}
        <ShowGrid shows={shows} onOpen={chosen => setPage({ kind: 'show', showId: chosen.id })} />
      </div>
    );
  }
  return (
    <main className="podcasts-view">
      {content}
      {!playerShown && <MiniPlayer player={player} onExpand={() => setPage({ kind: 'player' })} />}
    </main>
  );
}
