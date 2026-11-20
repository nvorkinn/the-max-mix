import { TriangleAlert } from 'lucide-react';
import type { PlaybackProblem } from '../hooks/useSpotifyPlayer';
import { useT } from '../i18n/translate';

export type PlaybackNoticeState =
  | { kind: 'signed-out' | 'connecting' | 'no-device' | 'restricted' | 'offline' | 'idle' }
  | { kind: 'problem'; problem: PlaybackProblem };

/** The states that need the user's attention, and so get a banner. */
export type BannerNotice = { kind: 'restricted' } | { kind: 'problem'; problem: PlaybackProblem };

interface PlaybackBannerProps {
  notice: BannerNotice;
  busy: boolean;
  onSettings: () => void;
  onChooseSpeaker: () => void;
  onRefresh: () => void;
  onReconnect: () => void;
  onAllowAudio: () => void;
  onDetails: () => void;
}

/** Small banner at the top of the screen for playback problems. It is derived from state, so it clears itself. */
export default function PlaybackBanner({
  notice,
  busy,
  onSettings,
  onChooseSpeaker,
  onRefresh,
  onReconnect,
  onAllowAudio,
  onDetails
}: Readonly<PlaybackBannerProps>) {
  const t = useT();
  let title: string;
  let text: string;
  let action: { label: string; run: () => void } | undefined;
  if (notice.kind === 'restricted') {
    title = t('notice.restricted_title');
    text = t('notice.restricted_text');
    action = { label: t('notice.choose_speaker'), run: onChooseSpeaker };
  } else if (notice.problem.recovery === 'quota') {
    title = t('notice.quota_title');
    text = t('notice.quota_text');
  } else if (notice.problem.recovery === 'wait') {
    title = t('notice.wait_title');
    text = t('notice.wait_text');
  } else {
    title = t('notice.problem_title');
    const recovery = {
      'sign-in': { text: t('notice.sign_in_text'), label: t('notice.reconnect_spotify'), run: onSettings },
      'choose-speaker': {
        text: t('notice.choose_speaker_text'),
        label: t('notice.choose_speaker'),
        run: onChooseSpeaker
      },
      settings: { text: t('notice.settings_text'), label: t('settings.title'), run: onSettings },
      reconnect: {
        text: t('notice.reconnect_text'),
        label: t('notice.reconnect_player'),
        run: onReconnect
      },
      refresh: {
        text: t('notice.refresh_text'),
        label: t('notice.refresh'),
        run: onRefresh
      },
      'enable-audio': {
        text: t('notice.audio_text'),
        label: t('notice.allow_audio'),
        run: onAllowAudio
      }
    }[notice.problem.recovery];
    text = recovery.text;
    action = { label: recovery.label, run: recovery.run };
  }
  const isProblem = notice.kind === 'problem';
  return (
    <div
      className="playback-banner"
      role={isProblem && notice.problem.recovery !== 'wait' ? 'alert' : 'status'}
      aria-busy={busy}
    >
      <TriangleAlert size={18} aria-hidden="true" />
      <span className="playback-banner-text">
        <strong>{title}</strong> {text}
      </span>
      {action && (
        <button type="button" className="button button-secondary" disabled={busy} onClick={action.run}>
          {busy ? t('notice.checking') : action.label}
        </button>
      )}
      {isProblem && (
        <button type="button" className="button button-secondary" onClick={onDetails}>
          {t('common.details')}
        </button>
      )}
    </div>
  );
}
