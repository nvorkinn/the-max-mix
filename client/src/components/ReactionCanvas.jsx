import React, { useEffect, useRef } from 'react';

/**
 * High-performance 60 FPS HTML5 Canvas particle system for emoji bursts
 * Zero DOM strain on Raspberry Pi 4 GPU
 */
export default function ReactionCanvas({ socket }) {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const animFrameRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const resize = () => {
      canvas.width = canvas.parentElement.clientWidth || 1024;
      canvas.height = canvas.parentElement.clientHeight || 600;
    };
    resize();
    window.addEventListener('resize', resize);

    // Particle render loop
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const particles = particlesRef.current;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.y += p.vy;
        p.x += Math.sin(p.wobble) * 1.5 + p.vx;
        p.wobble += 0.08;
        p.rotation += p.vRot;
        p.opacity -= 0.012;
        p.scale += 0.005;

        if (p.opacity <= 0 || p.y < -50) {
          particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.font = `${Math.floor(p.size * p.scale)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.emoji, 0, 0);

        // Optional guest name tag above particle
        if (p.guestName && p.opacity > 0.4) {
          ctx.font = '11px sans-serif';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.fillText(p.guestName, 0, -p.size * 0.7);
        }

        ctx.restore();
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    // Socket listener for new reactions
    if (socket) {
      const handleReaction = (data) => {
        // Spawn 3 to 5 particles per reaction for a lively pop!
        const count = 3;
        const startX = Math.random() * (canvas.width * 0.7) + (canvas.width * 0.15);

        for (let j = 0; j < count; j++) {
          particlesRef.current.push({
            x: startX + (Math.random() - 0.5) * 60,
            y: canvas.height - 40,
            vy: -(Math.random() * 3.5 + 3.5),
            vx: (Math.random() - 0.5) * 1.2,
            vRot: (Math.random() - 0.5) * 0.08,
            rotation: 0,
            wobble: Math.random() * Math.PI * 2,
            size: Math.random() * 14 + 32,
            scale: 0.8,
            opacity: 1,
            emoji: data.emoji || '🔥',
            guestName: j === 0 ? data.guestName : null // Only tag one particle
          });
        }
      };

      socket.on('screen:reaction', handleReaction);

      return () => {
        socket.off('screen:reaction', handleReaction);
        window.removeEventListener('resize', resize);
        cancelAnimationFrame(animFrameRef.current);
      };
    }

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [socket]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-40"
      style={{ width: '100%', height: '100%' }}
    />
  );
}
