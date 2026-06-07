'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TABLE,
  POCKETS,
  simulate,
  type Ball,
  type GameState,
  type ShotInput,
} from '@/lib/game/physics';

/**
 * Canvas renderer + input for a pool match.
 *
 * - Renders the felt table, pockets, balls and the aim line.
 * - Input: drag from the cue ball to aim (angle) + pull distance (power);
 *   a spin selector sets english. Locked to the active player.
 * - On shoot: animates the deterministic sim locally for instant feedback via
 *   `simulate(..., { frames })`. In multiplayer the parent reconciles to the
 *   DO's authoritative result by passing a new `board` to snap to.
 */
export function PoolCanvas({
  board,
  myTurn,
  onShoot,
}: {
  board: GameState;
  myTurn: boolean;
  onShoot: (input: ShotInput) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ballsRef = useRef<Ball[]>(board.balls.map((b) => ({ ...b })));
  const animatingRef = useRef(false);
  const [spin, setSpin] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ active: boolean; angle: number; power: number }>({
    active: false,
    angle: 0,
    power: 0,
  });

  // Snap to a new authoritative board when not mid-animation.
  useEffect(() => {
    if (!animatingRef.current) {
      ballsRef.current = board.balls.map((b) => ({ ...b }));
    }
  }, [board]);

  // Render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    const draw = () => {
      const { width, height } = canvas;
      const scale = width / TABLE.width;
      ctx.clearRect(0, 0, width, height);

      drawTable(ctx, width, height, scale);

      // Balls.
      for (const b of ballsRef.current) {
        if (b.potted) continue;
        drawBall(ctx, b, scale);
      }

      // Aim line.
      if (myTurn && dragRef.current.active && !animatingRef.current) {
        const cue = ballsRef.current.find((b) => b.id === 0 && !b.potted);
        if (cue) {
          const a = dragRef.current.angle;
          const len = (10 + dragRef.current.power * 60) * scale;
          ctx.save();
          ctx.setLineDash([6, 6]);
          ctx.strokeStyle = 'rgba(240, 196, 106, 0.85)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(cue.x * scale, cue.y * scale);
          ctx.lineTo(cue.x * scale + Math.cos(a) * len, cue.y * scale + Math.sin(a) * len);
          ctx.stroke();
          ctx.restore();

          // Power meter.
          ctx.fillStyle = 'rgba(217,164,65,0.9)';
          ctx.fillRect(8, height - 16, (width - 16) * dragRef.current.power, 6);
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [myTurn]);

  // Pointer input → aim + shoot.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const toTable = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scale = canvas.width / TABLE.width;
      return {
        x: ((e.clientX - rect.left) * (canvas.width / rect.width)) / scale,
        y: ((e.clientY - rect.top) * (canvas.height / rect.height)) / scale,
      };
    };

    const down = (e: PointerEvent) => {
      if (!myTurn || animatingRef.current) return;
      const cue = ballsRef.current.find((b) => b.id === 0 && !b.potted);
      if (!cue) return;
      dragRef.current.active = true;
      update(e, cue);
    };
    const update = (e: PointerEvent, cue?: Ball) => {
      if (!dragRef.current.active) return;
      const c = cue ?? ballsRef.current.find((b) => b.id === 0 && !b.potted);
      if (!c) return;
      const p = toTable(e);
      // Pull back: aim is from pointer toward the cue ball (slingshot).
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      dragRef.current.angle = Math.atan2(dy, dx);
      dragRef.current.power = Math.min(1, Math.hypot(dx, dy) / 45);
    };
    const move = (e: PointerEvent) => update(e);
    const up = () => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      const { angle, power } = dragRef.current;
      if (power < 0.05) return; // tap, not a shot
      shoot({ angle, power, spin });
    };

    canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn, spin]);

  // Animate the local deterministic sim, then hand the input to the parent.
  function shoot(input: ShotInput) {
    if (animatingRef.current) return;
    animatingRef.current = true;
    const frames: Ball[][] = [];
    simulate({ rackSeed: board.rackSeed, balls: ballsRef.current.map((b) => ({ ...b })) }, input, {
      frames,
      stride: 2,
    });

    let i = 0;
    const play = () => {
      if (i < frames.length) {
        ballsRef.current = frames[i];
        i += 2; // ~30fps playback of recorded frames
        requestAnimationFrame(play);
      } else {
        animatingRef.current = false;
        onShoot(input); // parent runs authority / relays to DO
      }
    };
    requestAnimationFrame(play);
  }

  return (
    <div className="w-full">
      <canvas
        ref={canvasRef}
        width={900}
        height={450}
        className="w-full touch-none rounded-2xl border border-ink-line bg-felt shadow-felt"
        style={{ aspectRatio: `${TABLE.width} / ${TABLE.height}` }}
      />
      {/* Spin selector */}
      <div className="mt-3 flex items-center gap-3">
        <span className="text-xs text-zinc-500">English</span>
        <SpinPad value={spin} onChange={setSpin} disabled={!myTurn} />
        <span className="text-xs text-zinc-500">
          {myTurn ? 'Your shot — drag back from the cue ball to aim' : "Opponent's turn"}
        </span>
      </div>
    </div>
  );
}

function SpinPad({
  value,
  onChange,
  disabled,
}: {
  value: { x: number; y: number };
  onChange: (v: { x: number; y: number }) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
        onChange({ x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) });
      }}
      className="relative h-9 w-9 rounded-full border border-ink-line bg-[#0e1213] disabled:opacity-40"
      aria-label="spin selector"
    >
      <span
        className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brass"
        style={{ left: `${(value.x + 1) * 50}%`, top: `${(value.y + 1) * 50}%` }}
      />
    </button>
  );
}

// ── draw helpers ────────────────────────────────────────────────────────────
function ballColor(id: number): string {
  if (id === 0) return '#f4f1ea';
  if (id === 8) return '#15181a';
  const solids: Record<number, string> = {
    1: '#e0a800',
    2: '#1e50c8',
    3: '#c81e1e',
    4: '#5a2a8a',
    5: '#d96a1e',
    6: '#1e7a3c',
    7: '#7a1e2a',
  };
  const base = ((id - 1) % 7) + 1;
  return solids[base] ?? '#c81e1e';
}

// Lighten/darken a #rrggbb hex by amt (-1..1) for ball shading.
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  let r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  } else {
    r *= 1 + amt;
    g *= 1 + amt;
    b *= 1 + amt;
  }
  return `rgb(${cl(r)},${cl(g)},${cl(b)})`;
}

function drawBall(ctx: CanvasRenderingContext2D, b: Ball, scale: number) {
  const r = TABLE.ballRadius * scale;
  const cx = b.x * scale;
  const cy = b.y * scale;
  const stripe = b.id >= 9 && b.id <= 15;
  const color = ballColor(b.id);

  ctx.save();

  // Contact shadow on the felt.
  ctx.beginPath();
  ctx.ellipse(cx + r * 0.18, cy + r * 0.42, r * 1.02, r * 0.78, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fill();

  // Base body — radial gradient lit from the upper-left for a glossy sphere.
  const base = stripe ? '#f3efe4' : color;
  const grad = ctx.createRadialGradient(
    cx - r * 0.4,
    cy - r * 0.45,
    r * 0.1,
    cx,
    cy,
    r * 1.08,
  );
  grad.addColorStop(0, shade(base.startsWith('#') ? base : '#f3efe4', 0.55));
  grad.addColorStop(0.45, base);
  grad.addColorStop(1, shade(base.startsWith('#') ? base : '#cfc8b6', -0.45));

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Stripe band (clip to the ball) with its own shading.
  if (stripe) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const bandGrad = ctx.createRadialGradient(
      cx - r * 0.4,
      cy - r * 0.45,
      r * 0.1,
      cx,
      cy,
      r * 1.08,
    );
    bandGrad.addColorStop(0, shade(color, 0.5));
    bandGrad.addColorStop(0.45, color);
    bandGrad.addColorStop(1, shade(color, -0.4));
    ctx.fillStyle = bandGrad;
    ctx.fillRect(cx - r, cy - r * 0.5, r * 2, r);
    ctx.restore();
  }

  // Number on a white disc (skip cue ball).
  if (b.id !== 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.46, 0, Math.PI * 2);
    ctx.fillStyle = '#fbfaf4';
    ctx.fill();
    ctx.fillStyle = '#15181a';
    ctx.font = `600 ${r * 0.62}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(b.id), cx, cy + r * 0.04);
  }

  // Rim shading for roundness.
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.98, 0, Math.PI * 2);
  ctx.lineWidth = r * 0.08;
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.stroke();

  // Specular highlight.
  const spec = ctx.createRadialGradient(
    cx - r * 0.34,
    cy - r * 0.4,
    0,
    cx - r * 0.34,
    cy - r * 0.4,
    r * 0.7,
  );
  spec.addColorStop(0, 'rgba(255,255,255,0.85)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(cx - r * 0.32, cy - r * 0.36, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = spec;
  ctx.fill();

  ctx.restore();
}

// ── Realistic table: felt gradient, angled cushions w/ pocket jaws, pockets,
// and diamond sights. Canvas spans exactly the play surface (0..100 × 0..50),
// matching the physics bounds, so cushions are drawn as an inner lip. ───────
function drawTable(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
) {
  const W = width;
  const H = height;
  const pr = TABLE.pocketRadius * scale;
  const t = 2.4 * scale; // cushion thickness
  const gap = pr * 1.18; // mouth opening at each pocket
  const midX = W / 2;

  // Felt bed — radial gradient, lighter at center.
  const felt = ctx.createRadialGradient(midX, H / 2, H * 0.12, midX, H / 2, W * 0.62);
  felt.addColorStop(0, '#1c7d5e');
  felt.addColorStop(1, '#0c4734');
  ctx.fillStyle = '#0c4734';
  roundRect(ctx, 0, 0, W, H, 6 * scale);
  ctx.fill();
  ctx.fillStyle = felt;
  roundRect(ctx, 0, 0, W, H, 6 * scale);
  ctx.fill();

  // Subtle cloth nap streaks.
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (let i = 1; i < 10; i++) {
    ctx.beginPath();
    ctx.moveTo((W / 10) * i, 0);
    ctx.lineTo((W / 10) * i, H);
    ctx.stroke();
  }
  ctx.restore();

  // Cushions (felt rail noses) — trapezoids angled 45° into each pocket mouth.
  const cushion = (pts: [number, number][]) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = '#0e5740';
    ctx.fill();
    // playing-edge highlight
    ctx.strokeStyle = 'rgba(120,220,180,0.25)';
    ctx.lineWidth = Math.max(1, scale * 0.18);
    ctx.stroke();
  };

  // Top rail: two segments split by the side pocket.
  cushion([
    [gap, 0],
    [midX - gap, 0],
    [midX - gap - t, t],
    [gap + t, t],
  ]);
  cushion([
    [midX + gap, 0],
    [W - gap, 0],
    [W - gap - t, t],
    [midX + gap + t, t],
  ]);
  // Bottom rail.
  cushion([
    [gap, H],
    [midX - gap, H],
    [midX - gap - t, H - t],
    [gap + t, H - t],
  ]);
  cushion([
    [midX + gap, H],
    [W - gap, H],
    [W - gap - t, H - t],
    [midX + gap + t, H - t],
  ]);
  // Left rail (no side pocket).
  cushion([
    [0, gap],
    [0, H - gap],
    [t, H - gap - t],
    [t, gap + t],
  ]);
  // Right rail.
  cushion([
    [W, gap],
    [W, H - gap],
    [W - t, H - gap - t],
    [W - t, gap + t],
  ]);

  // Pockets — leather collar + dark hole.
  for (const [pxu, pyu] of POCKETS) {
    const px = pxu * scale;
    const py = pyu * scale;
    ctx.beginPath();
    ctx.arc(px, py, pr * 1.28, 0, Math.PI * 2);
    ctx.fillStyle = '#0a1712';
    ctx.fill();
    const hole = ctx.createRadialGradient(px, py, pr * 0.2, px, py, pr);
    hole.addColorStop(0, '#000000');
    hole.addColorStop(1, '#06120d');
    ctx.beginPath();
    ctx.arc(px, py, pr * 0.92, 0, Math.PI * 2);
    ctx.fillStyle = hole;
    ctx.fill();
  }

  // Diamond sights on the rails.
  ctx.fillStyle = 'rgba(245,240,225,0.5)';
  const diamond = (x: number, y: number) => {
    const d = Math.max(2, scale * 0.5);
    ctx.beginPath();
    ctx.moveTo(x, y - d);
    ctx.lineTo(x + d, y);
    ctx.lineTo(x, y + d);
    ctx.lineTo(x - d, y);
    ctx.closePath();
    ctx.fill();
  };
  for (const fx of [0.25, 0.75]) {
    diamond(W * fx, t * 0.5);
    diamond(W * fx, H - t * 0.5);
  }
  for (const fy of [0.25, 0.5, 0.75]) {
    diamond(t * 0.5, H * fy);
    diamond(W - t * 0.5, H * fy);
  }
}

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
