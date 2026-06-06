'use client';

import { useEffect, useRef } from 'react';

/**
 * Static, glossy pool-table hero illustration drawn on a canvas: a felt bed
 * with wooden rails + a corner pocket, a full triangle rack of numbered/striped
 * balls, the cue ball, and a cue stick. Rendered once (crisp, hi-DPI), with a
 * gentle parallax tilt on pointer move. Purely decorative.
 */
export function HeroTable({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const el = canvas; // non-null capture for nested closures
    const ctx = el.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      const rect = el.getBoundingClientRect();
      el.width = Math.round(rect.width * dpr);
      el.height = Math.round(rect.height * dpr);
      draw();
    }

    function draw() {
      const W = el.width;
      const H = el.height;
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.scale(dpr, dpr);
      const w = W / dpr;
      const h = H / dpr;

      // Scene scale relative to a 760-wide reference.
      const s = w / 760;

      ctx.save();
      // Table group: sit in the upper-right, tilted, bleeding off the edges.
      ctx.translate(w * 0.6, h * 0.46);
      ctx.rotate(-0.2);

      drawTable(ctx, s);
      drawRack(ctx, s);
      drawCueBall(ctx, s);
      drawCue(ctx, s);

      ctx.restore();
      ctx.restore();
    }

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden
    />
  );
}

// ── Table bed + rails + pocket ──────────────────────────────────────────────
function drawTable(ctx: CanvasRenderingContext2D, s: number) {
  const bw = 560 * s; // half-width of bed
  const bh = 230 * s; // half-height of bed
  const railW = 26 * s;

  // Drop shadow under the whole table.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 60 * s;
  ctx.shadowOffsetY = 40 * s;

  // Wooden rail (outer rounded rect).
  const railGrad = ctx.createLinearGradient(0, -bh, 0, bh);
  railGrad.addColorStop(0, '#3a2a17');
  railGrad.addColorStop(0.5, '#23170c');
  railGrad.addColorStop(1, '#16100a');
  roundRect(ctx, -bw - railW, -bh - railW, (bw + railW) * 2, (bh + railW) * 2, 30 * s);
  ctx.fillStyle = railGrad;
  ctx.fill();
  ctx.restore();

  // Rail highlight edge.
  roundRect(ctx, -bw - railW, -bh - railW, (bw + railW) * 2, (bh + railW) * 2, 30 * s);
  ctx.lineWidth = 1.5 * s;
  ctx.strokeStyle = 'rgba(217,164,65,0.22)';
  ctx.stroke();

  // Felt bed with a soft overhead-lamp gradient.
  const felt = ctx.createRadialGradient(
    -bw * 0.15,
    -bh * 0.3,
    20 * s,
    -bw * 0.15,
    -bh * 0.3,
    bw * 1.5,
  );
  felt.addColorStop(0, '#1c6b4f');
  felt.addColorStop(0.5, '#11543c');
  felt.addColorStop(1, '#0a3528');
  roundRect(ctx, -bw, -bh, bw * 2, bh * 2, 16 * s);
  ctx.fillStyle = felt;
  ctx.fill();

  // Inner felt vignette.
  ctx.save();
  roundRect(ctx, -bw, -bh, bw * 2, bh * 2, 16 * s);
  ctx.clip();
  const vig = ctx.createRadialGradient(0, 0, bh * 0.3, 0, 0, bw * 1.2);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = vig;
  ctx.fillRect(-bw, -bh, bw * 2, bh * 2);
  ctx.restore();

  // A corner pocket (top-left of the bed).
  drawPocket(ctx, -bw + 6 * s, -bh + 6 * s, 26 * s);
  // A side pocket (top-middle).
  drawPocket(ctx, 0, -bh - railW * 0.3, 22 * s);
}

function drawPocket(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 1.25, 0, Math.PI * 2);
  ctx.fillStyle = '#0a0a08';
  ctx.fill();
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, '#000');
  g.addColorStop(1, '#1a130a');
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

// ── Balls ───────────────────────────────────────────────────────────────────
function ballColor(id: number): string {
  if (id === 8) return '#15161a';
  const hues: Record<number, string> = {
    1: '#e8b21e',
    2: '#1f50c8',
    3: '#cf2027',
    4: '#5e2a8c',
    5: '#df6a1e',
    6: '#117a44',
    7: '#7a1f2b',
  };
  return hues[((id - 1) % 7) + 1] ?? '#cf2027';
}

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, id: number) {
  const stripe = id >= 9 && id <= 15;

  // Contact shadow.
  ctx.beginPath();
  ctx.ellipse(x + r * 0.15, y + r * 0.55, r * 1.05, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fill();

  // Base sphere.
  const base = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.05);
  const col = ballColor(id);
  if (stripe) {
    base.addColorStop(0, '#fff');
    base.addColorStop(0.7, '#efeadb');
    base.addColorStop(1, '#cfc7b3');
  } else {
    base.addColorStop(0, lighten(col, 0.5));
    base.addColorStop(0.6, col);
    base.addColorStop(1, darken(col, 0.35));
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = base;
  ctx.fill();

  // Stripe band.
  if (stripe) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    const band = ctx.createLinearGradient(x, y - r * 0.5, x, y + r * 0.5);
    band.addColorStop(0, lighten(col, 0.35));
    band.addColorStop(0.5, col);
    band.addColorStop(1, darken(col, 0.3));
    ctx.fillStyle = band;
    ctx.fillRect(x - r, y - r * 0.46, r * 2, r * 0.92);
    ctx.restore();
  }

  // Number disc.
  ctx.beginPath();
  ctx.arc(x, y - r * 0.02, r * 0.46, 0, Math.PI * 2);
  ctx.fillStyle = '#fbfaf4';
  ctx.fill();
  ctx.fillStyle = '#15161a';
  ctx.font = `${r * 0.6}px 'Space Grotesk', ui-sans-serif, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(id), x, y);

  // Specular highlight.
  ctx.beginPath();
  ctx.ellipse(x - r * 0.32, y - r * 0.38, r * 0.28, r * 0.18, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fill();
}

function drawRack(ctx: CanvasRenderingContext2D, s: number) {
  const r = 22 * s;
  const gap = r * 2.04;
  // Apex points left (toward the cue). Centered to the right of the bed center.
  const apexX = 70 * s;
  const apexY = -10 * s;
  // 8-ball locked in the middle (row 2, col 1). Others arranged for a pleasing mix.
  const layout: number[][] = [
    [1],
    [9, 2],
    [10, 8, 3],
    [11, 4, 12, 5],
    [6, 13, 7, 14, 15],
  ];
  for (let row = 0; row < layout.length; row++) {
    for (let col = 0; col < layout[row].length; col++) {
      const x = apexX + row * gap * 0.88;
      const y = apexY + (col - row / 2) * gap;
      drawBall(ctx, x, y, r, layout[row][col]);
    }
  }
}

function drawCueBall(ctx: CanvasRenderingContext2D, s: number) {
  const r = 22 * s;
  const x = -210 * s;
  const y = 70 * s;
  ctx.beginPath();
  ctx.ellipse(x + r * 0.15, y + r * 0.55, r * 1.05, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.05);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.7, '#efeadb');
  g.addColorStop(1, '#c9c2af');
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x - r * 0.32, y - r * 0.38, r * 0.28, r * 0.18, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fill();
  // a tiny red dot, classic measle cue ball
  ctx.beginPath();
  ctx.arc(x + r * 0.2, y + r * 0.1, r * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = '#c0392b';
  ctx.fill();
}

function drawCue(ctx: CanvasRenderingContext2D, s: number) {
  const cueX = -210 * s;
  const cueY = 70 * s;
  // Cue comes from lower-left toward the cue ball.
  const ang = Math.atan2(cueY - 360 * s, cueX - -560 * s);
  const tipX = cueX - Math.cos(ang) * 34 * s;
  const tipY = cueY - Math.sin(ang) * 34 * s;
  const buttX = tipX - Math.cos(ang) * 620 * s;
  const buttY = tipY - Math.sin(ang) * 620 * s;

  ctx.save();
  ctx.lineCap = 'round';
  // Shadow.
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 12 * s;
  ctx.beginPath();
  ctx.moveTo(tipX + 6 * s, tipY + 10 * s);
  ctx.lineTo(buttX + 6 * s, buttY + 10 * s);
  ctx.stroke();

  // Shaft (wood gradient).
  const grad = ctx.createLinearGradient(tipX, tipY, buttX, buttY);
  grad.addColorStop(0, '#f0d9a8');
  grad.addColorStop(0.5, '#b9802f');
  grad.addColorStop(1, '#2a1a0c');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 9 * s;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(buttX, buttY);
  ctx.stroke();

  // Ferrule + blue tip.
  ctx.strokeStyle = '#f6f1e6';
  ctx.lineWidth = 9 * s;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - Math.cos(ang) * 12 * s, tipY - Math.sin(ang) * 12 * s);
  ctx.stroke();
  ctx.strokeStyle = '#2f6fb0';
  ctx.lineWidth = 9 * s;
  ctx.beginPath();
  ctx.moveTo(tipX + Math.cos(ang) * 2 * s, tipY + Math.sin(ang) * 2 * s);
  ctx.lineTo(tipX - Math.cos(ang) * 3 * s, tipY - Math.sin(ang) * 3 * s);
  ctx.stroke();
  ctx.restore();
}

// ── helpers ─────────────────────────────────────────────────────────────────
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lighten(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => Math.round(c + (255 - c) * amt);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function darken(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => Math.round(c * (1 - amt));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
