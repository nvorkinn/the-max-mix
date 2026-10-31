import type { PlaybackProblem } from '../hooks/useSpotifyPlayer';

export type PlaybackNoticeState =
  | { kind: 'signed-out' | 'connecting' | 'no-device' | 'restricted' | 'offline' | 'idle' }
  | { kind: 'problem'; problem: PlaybackProblem };

interface PlaybackNoticeProps {
  notice: PlaybackNoticeState;
  busy: boolean;
  onSettings: () => void;
  onChooseSpeaker: () => void;
  onRefresh: () => void;
  onReconnect: () => void;
  onAllowAudio: () => void;
  onDetails: () => void;
}

export default function PlaybackNotice({
  notice,
  busy,
  onSettings,
  onChooseSpeaker,
  onRefresh,
  onReconnect,
  onAllowAudio,
  onDetails
}: Readonly<PlaybackNoticeProps>) {
  let title: string;
  let text: string;
  let action: { label: string; run: () => void } | undefined;
  if (notice.kind === 'problem') {
    title = 'Playback problem';
    if (notice.problem.recovery === 'wait') {
      title = 'Waiting for Spotify';
      text = 'Spotify asked this app to wait. Playback status will be checked again automatically.';
    } else {
      const recovery = {
        'sign-in': {
          text: 'Your Spotify sign-in needs attention.',
          label: 'Reconnect Spotify',
          run: onSettings
        },
        'choose-speaker': {
          text: 'Choose an available speaker, or control this device in Spotify.',
          label: 'Choose speaker',
          run: onChooseSpeaker
        },
        settings: {
          text: 'Check your account and browser playback settings.',
          label: 'Settings',
          run: onSettings
        },
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
  } else {
    const state = {
      'signed-out': {
        title: 'Connect Spotify',
        text: 'Sign in with your Spotify Premium account.',
        action: { label: 'Connect Spotify', run: onSettings }
      },
      connecting: {
        title: 'Connecting to Spotify...',
        text: 'Waiting for playback status.',
        action: undefined
      },
      'no-device': {
        title: 'No active Spotify device',
        text: 'Choose a speaker or start playback in Spotify.',
        action: { label: 'Choose speaker', run: onChooseSpeaker }
      },
      restricted: {
        title: 'Controls unavailable on this device',
        text: 'Choose another speaker, or use Spotify to control this device.',
        action: { label: 'Choose speaker', run: onChooseSpeaker }
      },
      offline: {
        title: 'Playback controls are offline',
        text: 'Reconnect to the network to check the current playback state.',
        action: undefined
      },
      idle: {
        title: 'No track playing',
        text: 'Choose music in Spotify, then press Play.',
        action: undefined
      }
    }[notice.kind];
    ({ title, text, action } = state);
  }
  return (
    <div
      className="playback-notice"
      role={notice.kind === 'problem' && notice.problem.recovery !== 'wait' ? 'alert' : 'status'}
      aria-busy={busy}
    >
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
      {(action !== undefined || notice.kind === 'problem') && (
        <div className="playback-notice-actions">
          {action && (
            <button type="button" className="button button-secondary" disabled={busy} onClick={action.run}>
              {busy ? 'Checking...' : action.label}
            </button>
          )}
          {notice.kind === 'problem' && (
            <button type="button" className="button button-secondary" onClick={onDetails}>
              Details
            </button>
          )}
        </div>
      )}
    </div>
  );
}
