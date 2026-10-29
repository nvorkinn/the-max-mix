import { useEffect, useRef } from 'react';

/**
 * @typedef {{ x: number, y: number, radius: number, maxRadius: number, opacity: number, color: string,
 *   isSparkle?: undefined }} Ring
 * @typedef {{ x: number, y: number, vx: number, vy: number, size: number, opacity: number, color: string,
 *   isSparkle: true }} Sparkle
 */

/**
 * 60 FPS Touch & Tap ripple canvas
 * Spawns glowing sonic rings and stardust sparkles wherever the user touches the Waveshare screen.
 * Adapts to ink drops in minimal mode or neon rings in party mode.
 */
export default function TouchRipples({ theme = 'neon' }) {
  const canvasRef = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const animFrameRef = useRef(/** @type {number | null} */ (null));
  const ripplesRef = useRef(/** @type {(Ring | Sparkle)[]} */ ([]));
  const isMinimal = theme === 'minimal';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    /**
     * @param {number} x
     * @param {number} y
     */
    const spawnRipple = (x, y) => {
      // Add soundwave / ink ring
      const ringColors = isMinimal
        ? ['#000000', '#222222', '#444444']
        : ['#10b981', '#06b6d4', '#ec4899', '#f59e0b', '#8b5cf6'];

      ripplesRef.current.push({
        x,
        y,
        radius: 10,
        maxRadius: isMinimal ? 80 : 100,
        opacity: isMinimal ? 0.9 : 0.8,
        color: ringColors[Math.floor(Math.random() * ringColors.length)] ?? '#ffffff'
      });

      // Add a few sparkles or ink spritzes
      for (let i = 0; i < 4; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3 + 1;
        ripplesRef.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: Math.random() * 3 + 2,
          opacity: 1,
          isSparkle: true,
          color: isMinimal ? '#111111' : '#ffffff'
        });
      }
    };

    /** @param {PointerEvent} e */
    const handlePointerDown = e => {
      if (document.hidden) return;
      spawnRipple(e.clientX, e.clientY);
      if (!animFrameRef.current) animFrameRef.current = requestAnimationFrame(render);
    };

    window.addEventListener('pointerdown', handlePointerDown);

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const ripples = ripplesRef.current;

      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        if (!r) continue;

        if (r.isSparkle) {
          r.x += r.vx;
          r.y += r.vy;
          r.opacity -= 0.03;
          if (r.opacity <= 0) {
            ripples.splice(i, 1);
            continue;
          }
          ctx.save();
          ctx.globalAlpha = Math.max(0, r.opacity);
          ctx.fillStyle = r.color;
          ctx.beginPath();
          ctx.arc(r.x, r.y, r.size, 0, Math.PI * 2);
          ctx.fill();
        } else {
          r.radius += 2.5;
          r.opacity -= isMinimal ? 0.03 : 0.02;

          if (r.opacity <= 0 || r.radius >= r.maxRadius) {
            ripples.splice(i, 1);
            continue;
          }

          ctx.save();
          ctx.globalAlpha = Math.max(0, r.opacity);
          ctx.strokeStyle = r.color;
          ctx.lineWidth = isMinimal ? 2 : 2.5;
          ctx.beginPath();
          ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      animFrameRef.current = ripples.length > 0 ? requestAnimationFrame(render) : null;
    };

    const handleVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(/** @type {number} */ (animFrameRef.current));
        animFrameRef.current = null;
        ripplesRef.current = [];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('visibilitychange', handleVisibility);
      cancelAnimationFrame(/** @type {number} */ (animFrameRef.current));
      animFrameRef.current = null;
    };
  }, [theme, isMinimal]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-50"
      style={{ width: '100%', height: '100%' }}
    />
  );
}
