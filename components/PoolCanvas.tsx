'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TABLE,
  POCKETS,
  POCKET_MOUTH,
  simulate,
  type Ball,
  type GameState,
  type ShotInput,
} from '@/lib/game/physics';
import { canPlaceCue } from '@/lib/game/state';

/**
 * Canvas renderer + input for a pool match.
 *
 * Layout: the play surface (0..100 × 0..50 table units) is inset by a wooden
 * RAIL so the drawn cushion face sits exactly on the physics boundary — balls
 * visibly bounce at the rail instead of sliding past it. Pocket mouths are cut
 * into the cushions (matching physics.POCKET_MOUTH) and all six pockets render
 * at an equal size.
 *
 * Aim: drag back from the cue ball; a ghost-ball line previews where the struck
 * object ball will travel. Ball-in-hand: tap/drag to place the cue ball.
 */
const RAIL = 4; // table units of wood rail around the play area
const VIEW_W = TABLE.width + RAIL * 2;
const VIEW_H = TABLE.height + RAIL * 2;

export function PoolCanvas({
  board,
  myTurn,
  onShoot,
  ballInHand = false,
  onPlaceCue,
  needCall = false,
  calledPocket = null,
}: {
  board: GameState;
  myTurn: boolean;
  onShoot: (input: ShotInput) => void;
  ballInHand?: boolean;
  onPlaceCue?: (x: number, y: number) => void;
  needCall?: boolean;
  calledPocket?: number | null;
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
  // Ball-in-hand placement candidate (table coords) + validity.
  const placeRef = useRef<{ active: boolean; x: number; y: number; ok: boolean } | null>(null);

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
      const scale = canvas.width / VIEW_W;
      const X = (tx: number) => (tx + RAIL) * scale;
      const Y = (ty: number) => (ty + RAIL) * scale;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawTable(ctx, canvas.width, canvas.height, scale, calledPocket);

      // Balls.
      for (const b of ballsRef.current) {
        if (b.potted) continue;
        if (ballInHand && b.id === 0) continue; // hidden until placed
        drawBall(ctx, X(b.x), Y(b.y), b, scale);
      }

      // Ball-in-hand placement ghost.
      if (ballInHand && myTurn) {
        const p = placeRef.current;
        const cue = board.balls.find((b) => b.id === 0);
        const gx = p?.active ? p.x : (cue?.x ?? TABLE.width * 0.25);
        const gy = p?.active ? p.y : (cue?.y ?? TABLE.height / 2);
        const ok = p?.active ? p.ok : true;
        ctx.save();
        ctx.globalAlpha = 0.85;
        drawBall(ctx, X(gx), Y(gy), { id: 0 } as Ball, scale);
        ctx.beginPath();
        ctx.arc(X(gx), Y(gy), TABLE.ballRadius * scale + 2, 0, Math.PI * 2);
        ctx.strokeStyle = ok ? 'rgba(120,220,160,0.9)' : 'rgba(230,90,80,0.95)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // Aim + ghost-ball prediction.
      if (myTurn && !ballInHand && dragRef.current.active && !animatingRef.current) {
        const cue = ballsRef.current.find((b) => b.id === 0 && !b.potted);
        if (cue) {
          const a = dragRef.current.angle;
          const dx = Math.cos(a);
          const dy = Math.sin(a);
          const pred = predictContact(cue, ballsRef.current, dx, dy);

          // Primary cue line to the ghost (or a fixed reach if nothing is hit).
          const endX = pred ? pred.ghostX : cue.x + dx * 60;
          const endY = pred ? pred.ghostY : cue.y + dy * 60;
          ctx.save();
          ctx.setLineDash([7, 6]);
          ctx.strokeStyle = 'rgba(245, 240, 225, 0.9)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(X(cue.x), Y(cue.y));
          ctx.lineTo(X(endX), Y(endY));
          ctx.stroke();
          ctx.setLineDash([]);

          if (pred) {
            // Ghost ball at the contact point.
            ctx.beginPath();
            ctx.arc(X(pred.ghostX), Y(pred.ghostY), TABLE.ballRadius * scale, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(245,240,225,0.7)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            // Predicted object-ball direction (the second line).
            ctx.beginPath();
            ctx.moveTo(X(pred.objX), Y(pred.objY));
            ctx.lineTo(X(pred.objX + pred.dirX * 26), Y(pred.objY + pred.dirY * 26));
            ctx.strokeStyle = 'rgba(111, 208, 137, 0.95)';
            ctx.lineWidth = 2.5;
            ctx.stroke();
          }
          ctx.restore();

          // Power meter.
          ctx.fillStyle = 'rgba(217,164,65,0.9)';
          ctx.fillRect(8, canvas.height - 14, (canvas.width - 16) * dragRef.current.power, 5);
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [myTurn, ballInHand, calledPocket, board]);

  // Pointer input → aim + shoot, or ball-in-hand placement.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const toTable = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scale = canvas.width / VIEW_W;
      const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const cy = (e.clientY - rect.top) * (canvas.height / rect.height);
      return { x: cx / scale - RAIL, y: cy / scale - RAIL };
    };

    // ── Ball-in-hand placement ──
    const placeMove = (e: PointerEvent) => {
      const p = toTable(e);
      const ok = canPlaceCue(board, p.x, p.y);
      placeRef.current = { active: true, x: p.x, y: p.y, ok };
    };
    const placeUp = (e: PointerEvent) => {
      if (!placeRef.current?.active) return;
      const p = toTable(e);
      placeRef.current = null;
      if (canPlaceCue(board, p.x, p.y)) onPlaceCue?.(p.x, p.y);
    };

    // ── Aim / shoot ──
    const down = (e: PointerEvent) => {
      if (!myTurn || animatingRef.current) return;
      if (ballInHand) {
        placeMove(e);
        return;
      }
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
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      dragRef.current.angle = Math.atan2(dy, dx);
      dragRef.current.power = Math.min(1, Math.hypot(dx, dy) / 45);
    };
    const move = (e: PointerEvent) => {
      if (ballInHand && placeRef.current?.active) return placeMove(e);
      update(e);
    };
    const up = (e: PointerEvent) => {
      if (ballInHand) return placeUp(e);
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      const { angle, power } = dragRef.current;
      if (power < 0.05) return; // tap, not a shot
      if (needCall && calledPocket == null) return; // must call a pocket first
      shoot({ angle, power, spin, calledPocket: calledPocket ?? undefined });
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
  }, [myTurn, spin, ballInHand, needCall, calledPocket, board]);

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
        i += 2;
        requestAnimationFrame(play);
      } else {
        animatingRef.current = false;
        onShoot(input);
      }
    };
    requestAnimationFrame(play);
  }

  const hint = ballInHand
    ? myTurn
      ? 'Ball in hand — tap to place the cue ball anywhere'
      : 'Opponent is placing the cue ball'
    : needCall && calledPocket == null
      ? 'Call a pocket for the 8-ball, then shoot'
      : myTurn
        ? 'Your shot — drag back from the cue ball to aim'
        : "Opponent's turn";

  return (
    <div className="w-full">
      <canvas
        ref={canvasRef}
        width={1080}
        height={580}
        className="w-full touch-none rounded-2xl border border-ink-line shadow-felt"
        style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
      />
      {/* Spin selector */}
      <div className="mt-3 flex items-center gap-3">
        <span className="text-xs text-zinc-500">English</span>
        <SpinPad value={spin} onChange={setSpin} disabled={!myTurn || ballInHand} />
        <span className="text-xs text-zinc-500">{hint}</span>
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

// ── Ghost-ball prediction ───────────────────────────────────────────────────
function predictContact(
  cue: Ball,
  balls: Ball[],
  dx: number,
  dy: number,
): { ghostX: number; ghostY: number; objX: number; objY: number; dirX: number; dirY: number } | null {
  const rr = (TABLE.ballRadius * 2) ** 2;
  let best: ReturnType<typeof predictContact> = null;
  let bestDist = Infinity;
  for (const b of balls) {
    if (b.id === 0 || b.potted) continue;
    const fx = b.x - cue.x;
    const fy = b.y - cue.y;
    const t = fx * dx + fy * dy;
    if (t <= 0) continue; // behind the aim
    const perp2 = fx * fx + fy * fy - t * t;
    if (perp2 >= rr) continue; // ray misses this ball
    const contact = t - Math.sqrt(rr - perp2);
    if (contact < 0 || contact >= bestDist) continue;
    const ghostX = cue.x + dx * contact;
    const ghostY = cue.y + dy * contact;
    const ndx = b.x - ghostX;
    const ndy = b.y - ghostY;
    const len = Math.hypot(ndx, ndy) || 1;
    bestDist = contact;
    best = { ghostX, ghostY, objX: b.x, objY: b.y, dirX: ndx / len, dirY: ndy / len };
  }
  return best;
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

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
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

function drawBall(ctx: CanvasRenderingContext2D, cx: number, cy: number, b: Ball, scale: number) {
  const r = TABLE.ballRadius * scale;
  const stripe = b.id >= 9 && b.id <= 15;
  const color = ballColor(b.id);

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx + r * 0.18, cy + r * 0.42, r * 1.02, r * 0.78, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fill();

  const base = stripe ? '#f3efe4' : color;
  const grad = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.1, cx, cy, r * 1.08);
  grad.addColorStop(0, shade(base, 0.55));
  grad.addColorStop(0.45, base);
  grad.addColorStop(1, shade(base, -0.45));
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  if (stripe) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const bg = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.1, cx, cy, r * 1.08);
    bg.addColorStop(0, shade(color, 0.5));
    bg.addColorStop(0.45, color);
    bg.addColorStop(1, shade(color, -0.4));
    ctx.fillStyle = bg;
    ctx.fillRect(cx - r, cy - r * 0.5, r * 2, r);
    ctx.restore();
  }

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

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.98, 0, Math.PI * 2);
  ctx.lineWidth = r * 0.08;
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.stroke();

  const spec = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.4, 0, cx - r * 0.34, cy - r * 0.4, r * 0.7);
  spec.addColorStop(0, 'rgba(255,255,255,0.85)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(cx - r * 0.32, cy - r * 0.36, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = spec;
  ctx.fill();

  ctx.restore();
}

function drawTable(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  calledPocket: number | null,
) {
  const X = (tx: number) => (tx + RAIL) * scale;
  const Y = (ty: number) => (ty + RAIL) * scale;
  const pr = TABLE.pocketRadius * scale;
  const cush = 1.1 * scale; // cushion thickness drawn into the rail
  const mouth = POCKET_MOUTH * scale;
  const fx = X(0);
  const fy = Y(0);
  const fw = TABLE.width * scale;
  const fh = TABLE.height * scale;

  // Wooden frame.
  const wood = ctx.createLinearGradient(0, 0, 0, height);
  wood.addColorStop(0, '#5a3a1c');
  wood.addColorStop(0.5, '#43290f');
  wood.addColorStop(1, '#33200c');
  ctx.fillStyle = wood;
  roundRect(ctx, 0, 0, width, height, 10 * scale * 0.4);
  ctx.fill();

  // Felt bed.
  const felt = ctx.createRadialGradient(fx + fw / 2, fy + fh / 2, fh * 0.12, fx + fw / 2, fy + fh / 2, fw * 0.62);
  felt.addColorStop(0, '#1c7d5e');
  felt.addColorStop(1, '#0c4734');
  ctx.fillStyle = '#0c4734';
  ctx.fillRect(fx, fy, fw, fh);
  ctx.fillStyle = felt;
  ctx.fillRect(fx, fy, fw, fh);

  // Cushions sit just OUTSIDE the play boundary (their face = the boundary), with
  // gaps cut for each pocket mouth. Drawn as felt-colored bevels on the rail.
  ctx.fillStyle = '#0e5740';
  const seg = (x: number, y: number, w: number, h: number) => ctx.fillRect(x, y, w, h);
  // Top & bottom rails: pockets at x = 0, W/2, W.
  seg(X(0) + mouth, fy - cush, X(TABLE.width / 2) - mouth - (X(0) + mouth), cush);
  seg(X(TABLE.width / 2) + mouth, fy - cush, X(TABLE.width) - mouth - (X(TABLE.width / 2) + mouth), cush);
  seg(X(0) + mouth, fy + fh, X(TABLE.width / 2) - mouth - (X(0) + mouth), cush);
  seg(X(TABLE.width / 2) + mouth, fy + fh, X(TABLE.width) - mouth - (X(TABLE.width / 2) + mouth), cush);
  // Left & right rails: pockets at y = 0, H.
  seg(fx - cush, Y(0) + mouth, cush, Y(TABLE.height) - mouth - (Y(0) + mouth));
  seg(fx + fw, Y(0) + mouth, cush, Y(TABLE.height) - mouth - (Y(0) + mouth));
  // Cushion top-light edge.
  ctx.strokeStyle = 'rgba(120,220,180,0.22)';
  ctx.lineWidth = Math.max(1, scale * 0.12);
  ctx.strokeRect(fx, fy, fw, fh);

  // Pockets — equal leather collar + hole at all six positions.
  for (let p = 0; p < POCKETS.length; p++) {
    const px = X(POCKETS[p][0]);
    const py = Y(POCKETS[p][1]);
    ctx.beginPath();
    ctx.arc(px, py, pr * 1.32, 0, Math.PI * 2);
    ctx.fillStyle = '#0a1712';
    ctx.fill();
    const hole = ctx.createRadialGradient(px, py, pr * 0.2, px, py, pr);
    hole.addColorStop(0, '#000');
    hole.addColorStop(1, '#06120d');
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fillStyle = hole;
    ctx.fill();
    if (calledPocket === p) {
      ctx.beginPath();
      ctx.arc(px, py, pr * 1.32, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(111,208,137,0.95)';
      ctx.lineWidth = Math.max(2, scale * 0.25);
      ctx.stroke();
    }
  }

  // Diamond sights on the wood rail.
  ctx.fillStyle = 'rgba(245,240,225,0.55)';
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
  const railMidTop = fy - cush - (RAIL * scale - cush) / 2;
  const railMidBottom = fy + fh + cush + (RAIL * scale - cush) / 2;
  for (const tx of [25, 50, 75]) {
    diamond(X(tx), railMidTop);
    diamond(X(tx), railMidBottom);
  }
  const railMidLeft = fx - cush - (RAIL * scale - cush) / 2;
  const railMidRight = fx + fw + cush + (RAIL * scale - cush) / 2;
  for (const ty of [12.5, 25, 37.5]) {
    diamond(railMidLeft, Y(ty));
    diamond(railMidRight, Y(ty));
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
