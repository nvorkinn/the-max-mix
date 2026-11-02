import { TriangleAlert } from 'lucide-react';
import type { PlaybackProblem } from '../hooks/useSpotifyPlayer';

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
  let title: string;
  let text: string;
  let action: { label: string; run: () => void } | undefined;
  if (notice.kind === 'restricted') {
    title = 'Controls unavailable on this device';
    text = 'Choose another speaker, or use Spotify to control this device.';
    action = { label: 'Choose speaker', run: onChooseSpeaker };
  } else if (notice.problem.recovery === 'wait') {
    title = 'Waiting for Spotify';
    text = 'Spotify asked this app to wait. Playback status will be checked again automatically.';
  } else {
    title = 'Playback problem';
    const recovery = {
      'sign-in': { text: 'Your Spotify sign-in needs attention.', label: 'Reconnect Spotify', run: onSettings },
      'choose-speaker': {
        text: 'Choose an available speaker, or control this device in Spotify.',
        label: 'Choose speaker',
        run: onChooseSpeaker
      },
      settings: { text: 'Check your account and browser playback settings.', label: 'Settings', run: onSettings },
      reconnect: {
        text: 'The browser player could not connect to Spotify.',
        label: 'Reconnect player',
        run: onReconnect
      },
      refresh: {
        text: 'Refresh playback status, then try the control again.',
        label: 'Refresh playback',
        run: onRefresh
      },
      'enable-audio': {
        text: 'Allow browser audio, then press Play to start.',
        label: 'Allow browser audio',
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
          {busy ? 'Checking...' : action.label}
        </button>
      )}
      {isProblem && (
        <button type="button" className="button button-secondary" onClick={onDetails}>
          Details
        </button>
      )}
    </div>
  );
}
