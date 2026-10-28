import React, { useEffect, useRef } from 'react';

/**
 * Decorative waveform driven by playback state, not an audio analysis.
 * @param {{ isPlaying: boolean, primaryColor?: string, secondaryColor?: string }} props
 */
export default function AudioVisualizer({ isPlaying, primaryColor = '#10b981', secondaryColor = '#6366f1' }) {
  const canvasRef = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const animFrameRef = useRef(/** @type {number | null} */ (null));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const resize = () => {
      canvas.width = /** @type {HTMLElement} */ (canvas.parentElement).clientWidth || 400;
      canvas.height = /** @type {HTMLElement} */ (canvas.parentElement).clientHeight || 120;
    };
    resize();

    const BAR_COUNT = 36;
    const bars = Array.from({ length: BAR_COUNT }, (_, i) => ({
      height: 10,
      targetHeight: 10,
      speed: 0.15 + Math.random() * 0.1,
      phase: (i / BAR_COUNT) * Math.PI * 2
    }));

    let time = 0;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const width = canvas.width;
      const height = canvas.height;
      const barWidth = (width / BAR_COUNT) * 0.65;
      const gap = (width - barWidth * BAR_COUNT) / (BAR_COUNT + 1);

      time += isPlaying ? 0.08 : 0.01;

      // Create gradient
      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, primaryColor);
      gradient.addColorStop(1, secondaryColor);
      ctx.fillStyle = gradient;

      for (let i = 0; i < BAR_COUNT; i++) {
        const bar = bars[i];

        if (isPlaying) {
          // Dynamic beat simulation with multiple harmonics
          const wave1 = Math.sin(time + bar.phase * 3);
          const wave2 = Math.cos(time * 0.6 + bar.phase * 2);
          const wave3 = Math.sin(time * 1.4 + i * 0.4);
          const energy = Math.abs(wave1 * 0.5 + wave2 * 0.3 + wave3 * 0.2);

          bar.targetHeight = Math.max(8, energy * (height * 0.85));
        } else {
          bar.targetHeight = 4;
        }

        // Smooth interpolation
        bar.height += (bar.targetHeight - bar.height) * bar.speed;

        const x = gap + i * (barWidth + gap);
        const y = height - bar.height;

        // Rounded pill bars
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, bar.height, [barWidth / 2, barWidth / 2, 2, 2]);
        ctx.fill();

        // Subtle glow top cap
        if (isPlaying && bar.height > 20) {
          ctx.save();
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 0.6;
          ctx.beginPath();
          ctx.arc(x + barWidth / 2, y + 2, barWidth / 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      if (isPlaying && !document.hidden && !reducedMotion.matches) {
        animFrameRef.current = requestAnimationFrame(render);
      }
    };

    const restart = () => {
      cancelAnimationFrame(/** @type {number} */ (animFrameRef.current));
      resize();
      render();
    };
    restart();
    window.addEventListener('resize', restart);
    document.addEventListener('visibilitychange', restart);
    reducedMotion.addEventListener('change', restart);

    return () => {
      window.removeEventListener('resize', restart);
      document.removeEventListener('visibilitychange', restart);
      reducedMotion.removeEventListener('change', restart);
      cancelAnimationFrame(/** @type {number} */ (animFrameRef.current));
    };
  }, [isPlaying, primaryColor, secondaryColor]);

  return <canvas ref={canvasRef} className="w-full h-full pointer-events-none" />;
}
