import { TriangleAlert } from 'lucide-react';
import type { PlaybackProblem } from '../hooks/useSpotifyPlayer';
import type { Problem } from '../problems/problems';
import type { Translate } from '../i18n/translate';
import { useT } from '../i18n/translate';

export type PlaybackNoticeState =
  | { kind: 'signed-out' | 'connecting' | 'no-device' | 'restricted' | 'offline' | 'idle' }
  | { kind: 'problem'; problem: PlaybackProblem };

/** The states that need the user's attention, and so are said in the player and in the warning list. */
export type PlayerNotice = { kind: 'restricted' } | { kind: 'problem'; problem: PlaybackProblem };

export interface PlaybackFixes {
  onSettings: () => void;
  onChooseSpeaker: () => void;
  onRefresh: () => void;
  onReconnect: () => void;
}

const fix = (label: string, run: () => void) => ({ label, run });

/** A playback problem in a few words, with the one button that fixes it. */
export function describePlayback(notice: PlayerNotice, t: Translate, fixes: PlaybackFixes): Omit<Problem, 'id'> {
  if (notice.kind === 'restricted') {
    return {
      title: t('notice.restricted_title'),
      action: { label: t('notice.choose_speaker'), run: fixes.onChooseSpeaker }
    };
  }
  const described: Record<PlaybackProblem['recovery'], Omit<Problem, 'id'>> = {
    quota: { title: t('notice.quota_title') },
    wait: { title: t('notice.wait_title') },
    'sign-in': { title: t('notice.sign_in_title'), action: fix(t('notice.reconnect_spotify'), fixes.onSettings) },
    'choose-speaker': { title: t('notice.no_speaker'), action: fix(t('notice.choose_speaker'), fixes.onChooseSpeaker) },
    settings: { title: t('notice.settings_title'), action: fix(t('settings.title'), fixes.onSettings) },
    'soloist-key': { title: t('notice.soloist_key_title'), action: fix(t('settings.title'), fixes.onSettings) },
    'pick-on-phone': { title: t('notice.pick_on_phone_title') },
    reconnect: { title: t('notice.player_title'), action: fix(t('notice.reconnect_player'), fixes.onReconnect) },
    refresh: { title: t('notice.problem_title'), action: fix(t('notice.refresh'), fixes.onRefresh) }
  };
  return described[notice.problem.recovery];
}

/**
 * A playback problem said in the player, where the speaker it plays on is named otherwise. It goes by itself once the
 * problem does.
 */
export function PlayerProblem({ problem, busy }: Readonly<{ problem: Omit<Problem, 'id'>; busy: boolean }>) {
  const t = useT();
  return (
    <div className="player-problem" role="alert" aria-busy={busy}>
      <TriangleAlert size={16} aria-hidden="true" />
      <strong>{problem.title}</strong>
      {problem.action && (
        <button type="button" className="button button-secondary" disabled={busy} onClick={problem.action.run}>
          {busy ? t('notice.checking') : problem.action.label}
        </button>
      )}
    </div>
  );
}
