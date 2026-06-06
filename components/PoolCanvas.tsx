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

      // Felt.
      ctx.fillStyle = '#0d3b2e';
      roundRect(ctx, 0, 0, width, height, 14 * scale * 0.4);
      ctx.fill();
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
      // Inner felt highlight.
      ctx.fillStyle = '#0f4534';
      ctx.fillRect(4 * scale, 4 * scale, width - 8 * scale, height - 8 * scale);

      // Rails.
      ctx.strokeStyle = '#3a2c12';
      ctx.lineWidth = 3 * scale;
      ctx.strokeRect(2 * scale, 2 * scale, width - 4 * scale, height - 4 * scale);

      // Pockets.
      for (const [px, py] of POCKETS) {
        ctx.beginPath();
        ctx.arc(px * scale, py * scale, TABLE.pocketRadius * scale * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = '#05140f';
        ctx.fill();
      }

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

function drawBall(ctx: CanvasRenderingContext2D, b: Ball, scale: number) {
  const r = TABLE.ballRadius * scale;
  const cx = b.x * scale;
  const cy = b.y * scale;
  const stripe = b.id >= 9 && b.id <= 15;

  ctx.save();
  // shadow
  ctx.beginPath();
  ctx.arc(cx + 1.5, cy + 2, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  // body
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = stripe ? '#f4f1ea' : ballColor(b.id);
  ctx.fill();

  if (stripe) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = ballColor(b.id);
    ctx.fillRect(cx - r, cy - r * 0.45, r * 2, r * 0.9);
    ctx.restore();
  }

  // number circle (skip cue)
  if (b.id !== 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fdfdf8';
    ctx.fill();
    ctx.fillStyle = '#14181a';
    ctx.font = `${r * 0.7}px ui-sans-serif, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(b.id), cx, cy + 0.5);
  }

  // highlight
  ctx.beginPath();
  ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.25, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();
  ctx.restore();
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
