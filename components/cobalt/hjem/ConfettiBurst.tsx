"use client";

import { useEffect, useRef } from "react";

// One-shot canvas confetti for the PR celebration (#122). Hand-rolled on a
// single <canvas> + requestAnimationFrame — no dependency, and the whole
// overlay unmounts when the burst ends. Never rendered under
// prefers-reduced-motion (PrCelebration doesn't mount it).

// Brand particles: cobalt, red, silver.
const COLORS = ["#1B29C0", "#E51C23", "#C8CDD6"];
const PARTICLE_COUNT = 120;
const DURATION_MS = 2_600;
const GRAVITY = 900; // px/s²

/**
 * mulberry32 — a tiny seeded PRNG. Confetti needs variety, not entropy, and a
 * fixed seed keeps the burst reproducible (the repo avoids Math.random by
 * convention; see lib/demo/data.ts).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ConfettiBurst({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Latest onDone without retriggering the effect — the animation runs once.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const rand = mulberry32(122);
    const particles = Array.from({ length: PARTICLE_COUNT }, () => {
      // Fan upward from the upper-middle of the viewport, then rain down.
      const angle = -Math.PI / 2 + (rand() - 0.5) * Math.PI * 0.9;
      const speed = 340 + rand() * 420;
      return {
        x: width / 2 + (rand() - 0.5) * width * 0.3,
        y: height * 0.35,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + rand() * 5,
        color: COLORS[Math.floor(rand() * COLORS.length)],
        rotation: rand() * Math.PI * 2,
        spin: (rand() - 0.5) * 10,
      };
    });

    let raf = 0;
    let start: number | null = null;
    let last = 0;

    const tick = (now: number) => {
      if (start === null) {
        start = now;
        last = now;
      }
      // Clamp dt so a background-tab pause doesn't teleport the particles.
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const elapsed = now - start;

      ctx.clearRect(0, 0, width, height);
      // Fade everything out over the last 40% of the burst.
      ctx.globalAlpha = Math.min(
        1,
        Math.max(0, 1 - (elapsed - DURATION_MS * 0.6) / (DURATION_MS * 0.4))
      );

      for (const p of particles) {
        p.vy += GRAVITY * dt;
        p.vx *= 0.99;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotation += p.spin * dt;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        ctx.restore();
      }

      if (elapsed < DURATION_MS) {
        raf = requestAnimationFrame(tick);
      } else {
        onDoneRef.current();
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    // No ARIA marking needed: an empty canvas exposes nothing to assistive
    // tech, and Biome rejects both aria-hidden and role="presentation" here.
    <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-[70] h-full w-full" />
  );
}
