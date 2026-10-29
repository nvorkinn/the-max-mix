import { useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import AudioVisualizer from './AudioVisualizer.jsx';

/** @param {import('../types.js').PlayerControls} props */
export default function VinylPlayer({ playback, isPlaying, onPlayPause, onNext, onPrevious, onSeek, onVolumeChange }) {
  const [isScratching, setIsScratching] = useState(false);
  const [scratchAngle, setScratchAngle] = useState(0);
  const [volume, setVolume] = useState(80);

  const item =
    playback?.item ?? playback?.track_window?.current_track ?? /** @type {import('../types.js').Track} */ ({});
  const title = item.name || item.title || 'Ready to Jam';
  const artist = item.artists
    ? item.artists.map(a => a.name).join(', ')
    : item.artist || 'Select "Party Tablet" in Spotify';
  const albumArt =
    item.album?.images?.[0]?.url ||
    item.albumArt ||
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80';

  const progressMs = playback?.progress_ms || playback?.position || 0;
  const durationMs = item.duration_ms || playback?.duration || 180000;
  const progressPercent = Math.min(100, Math.max(0, (progressMs / durationMs) * 100));

  /** @param {number} ms */
  const formatTime = ms => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  /** @param {import('react').MouseEvent<HTMLElement>} e */
  const handleProgressBarClick = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    onSeek(ratio * durationMs);
  };

  /** @param {import('react').KeyboardEvent<HTMLElement>} e */
  const handleProgressBarKeyDown = e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    onSeek(Math.max(0, Math.min(durationMs, progressMs + (e.key === 'ArrowRight' ? 5000 : -5000))));
  };

  /** @param {import('react').ChangeEvent<HTMLInputElement>} e */
  const handleVolumeSlide = e => {
    const val = Number(e.target.value);
    setVolume(val);
    if (onVolumeChange) {
      onVolumeChange(val);
    }
  };

  return (
    <div className="flex flex-col justify-between h-full p-3 select-none">
      {/* Top Section: Interactive Touch Turntable */}
      <div className="relative flex items-center justify-center pt-1 pb-2">
        <div className="relative w-56 h-56 rounded-full flex items-center justify-center shadow-2xl bg-black/60 border border-white/10 backdrop-blur-md">
          {/* Animated / Scratchable Vinyl Record */}
          <div
            onPointerDown={() => setIsScratching(true)}
            onPointerUp={() => setIsScratching(false)}
            onPointerLeave={() => setIsScratching(false)}
            onPointerMove={e => {
              if (isScratching) {
                setScratchAngle(prev => prev + e.movementX * 1.5);
              }
            }}
            className={`relative w-48 h-48 rounded-full flex items-center justify-center shadow-2xl transition-transform cursor-grab active:cursor-grabbing ${
              isPlaying && !isScratching ? 'spinning-record' : 'paused-record'
            }`}
            style={{
              transform: isScratching ? `rotate(${scratchAngle}deg)` : undefined,
              background: 'radial-gradient(circle, #2a2a2a 0%, #141414 45%, #080808 70%, #1a1a1a 85%, #000 100%)',
              boxShadow: '0 0 35px rgba(0,0,0,0.9), inset 0 0 20px rgba(255,255,255,0.06)'
            }}
          >
            {/* Vinyl Concentric Grooves */}
            <div className="absolute inset-2.5 rounded-full border border-white/5 opacity-60" />
            <div className="absolute inset-5 rounded-full border border-white/5 opacity-40" />
            <div className="absolute inset-9 rounded-full border border-white/5 opacity-50" />
            <div className="absolute inset-13 rounded-full border border-white/5 opacity-40" />
            <div className="absolute inset-17 rounded-full border border-white/5 opacity-60" />

            {/* Vinyl Center Label (Album Artwork) */}
            <div className="relative w-20 h-20 rounded-full overflow-hidden border-2 border-emerald-500/50 shadow-inner flex items-center justify-center">
              <img src={albumArt} alt="Album Art" className="w-full h-full object-cover pointer-events-none" />
              {/* Spindle hole */}
              <div className="absolute w-3.5 h-3.5 rounded-full bg-neutral-900 border-2 border-white/80 shadow-sm" />
            </div>
          </div>

          {/* Turntable Tonearm Needle */}
          <div className="absolute top-1 right-1 pointer-events-none z-10">
            <svg
              width="50"
              height="95"
              viewBox="0 0 60 110"
              className={`tonearm ${isPlaying ? 'tonearm-playing' : 'tonearm-paused'}`}
            >
              <circle cx="15" cy="15" r="9" fill="#333" stroke="#888" strokeWidth="2" />
              <path d="M 15 15 L 25 70 L 40 95" fill="none" stroke="#d1d5db" strokeWidth="3.5" strokeLinecap="round" />
              <rect x="36" y="92" width="10" height="15" rx="2" fill="#10b981" />
            </svg>
          </div>
        </div>
      </div>

      {/* Middle Section: Integrated Beat Frequency Visualizer */}
      <div className="h-10 w-full px-4 overflow-hidden">
        <AudioVisualizer isPlaying={isPlaying} primaryColor="#10b981" secondaryColor="#06b6d4" />
      </div>

      {/* Track Info Marquee */}
      <div className="text-center px-3 py-1">
        <h2 className="text-xl font-black tracking-tight text-white glow-text truncate">{title}</h2>
        <p className="text-xs font-semibold text-neutral-300 mt-0.5 truncate">{artist}</p>
      </div>

      {/* Bottom Section: Scrubber & Transport Controls */}
      <div className="space-y-2.5">
        {/* Scrubber Bar */}
        <div className="space-y-1">
          <div
            role="slider"
            tabIndex={0}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(durationMs)}
            aria-valuenow={Math.round(progressMs)}
            aria-valuetext={`${formatTime(progressMs)} of ${formatTime(durationMs)}`}
            onClick={handleProgressBarClick}
            onKeyDown={handleProgressBarKeyDown}
            className="group relative h-2.5 bg-white/10 rounded-full cursor-pointer overflow-hidden backdrop-blur-xs"
          >
            <div
              className="h-full bg-linear-to-r from-emerald-400 via-teal-400 to-cyan-400 rounded-full transition-all duration-300 relative shadow-[0_0_12px_rgba(52,211,153,0.7)]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] font-mono font-medium text-neutral-400 px-0.5">
            <span>{formatTime(progressMs)}</span>
            <span>{formatTime(durationMs)}</span>
          </div>
        </div>

        {/* Tactile Touch Transport & Volume */}
        <div className="flex items-center justify-between px-1">
          {/* Volume Control */}
          <div className="flex items-center space-x-1.5 w-24">
            <Volume2 className="w-4 h-4 text-neutral-400" />
            <input
              type="range"
              aria-label="Volume"
              min="0"
              max="100"
              value={volume}
              onChange={handleVolumeSlide}
              className="w-16 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-emerald-400"
            />
          </div>

          {/* Transport Buttons */}
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={onPrevious}
              className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white flex items-center justify-center transition-all border border-white/10 shadow-md"
              title="Previous Track"
            >
              <SkipBack className="w-5 h-5 fill-white" />
            </button>

            <button
              type="button"
              onClick={onPlayPause}
              className="w-14 h-14 rounded-full bg-linear-to-tr from-emerald-500 to-teal-400 active:scale-90 text-black flex items-center justify-center transition-all shadow-[0_0_25px_rgba(16,185,129,0.5)] border-2 border-white/40"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-6 h-6 fill-neutral-900 text-neutral-900" />
              ) : (
                <Play className="w-6 h-6 fill-neutral-900 text-neutral-900 translate-x-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={onNext}
              className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white flex items-center justify-center transition-all border border-white/10 shadow-md"
              title="Next Track"
            >
              <SkipForward className="w-5 h-5 fill-white" />
            </button>
          </div>

          <div className="w-24 text-right">
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-neutral-400">
              {isPlaying ? 'PLAYING' : 'PAUSED'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
