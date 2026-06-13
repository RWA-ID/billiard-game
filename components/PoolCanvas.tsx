'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TABLE,
  simulate,
  type Ball,
  type GameState,
  type ShotInput,
  type SimEvent,
} from '@/lib/game/physics';
import { canPlaceCue } from '@/lib/game/state';
import {
  sfxClick,
  sfxCushion,
  sfxPocket,
  sfxStrike,
  sfxTick,
  unlockAudio,
} from '@/lib/sound/sfx';

/**
 * Canvas renderer + input for a pool match.
 *
 * The table is a photographed tournament table (/table.jpg). The physics play
 * area (0..100 × 0..50 table units) maps EXACTLY onto the photo's cushion-nose
 * rectangle (measured below), so balls visibly bounce at the cushion face and
 * roll into the photographed pocket jaws.
 *
 * Render-only flourishes (none affect the deterministic sim): a cue stick that
 * pulls back with power and strikes on release, rolling number decals, soft
 * contact shadows, pocket sink animations, and WebAudio sounds timed to the
 * sim's collision/cushion/pot events. Remote shots arrive as a `remoteShot`
 * prop and replay the same deterministic sim as an animation before snapping
 * to the authoritative board.
 */

// /table.jpg natural size + the cushion-nose play rect measured in its pixels.
const IMG_W = 1480;
const IMG_H = 835;
const PLAY = { x: 106, y: 99, w: 1273, h: 638 } as const;
const ASPECT = IMG_W / IMG_H;

const STRIDE = 2; // sim steps per recorded frame
const FRAME_SKIP = 2; // recorded frames advanced per rAF tick
const STRIKE_MS = 95; // cue stick strike animation
const SINK_MS = 340; // ball-into-pocket animation

// Where each pocket HOLE visually sits (table units, matching physics.POCKETS
// order) — the photo's side pockets are recessed into the rail.
const VISUAL_POCKETS: ReadonlyArray<readonly [number, number]> = [
  [-0.7, -0.7],
  [50, -2.6],
  [100.7, -0.7],
  [-0.7, 50.7],
  [50, 52.6],
  [100.7, 50.7],
];

type Mapping = { ox: number; oy: number; sx: number; sy: number };
const mapFor = (w: number, h: number): Mapping => ({
  ox: (w * PLAY.x) / IMG_W,
  oy: (h * PLAY.y) / IMG_H,
  sx: (w * PLAY.w) / IMG_W / TABLE.width,
  sy: (h * PLAY.h) / IMG_H / TABLE.height,
});

type Roll = { x: number; y: number; phase: number; dx: number; dy: number };
type Sink = { id: number; x: number; y: number; pocket: number; t0: number };
type Playback = {
  frames: Ball[][];
  events: SimEvent[];
  i: number;
  ev: number;
  mode: 'local' | 'remote';
  input: ShotInput;
};
type Strike = { t0: number; angle: number; power: number; playback: Playback };

export type RemoteShot = { input: ShotInput; seq: number };

export function PoolCanvas({
  board,
  myTurn,
  onShoot,
  ballInHand = false,
  onPlaceCue,
  needCall = false,
  calledPocket = null,
  onCallPocket,
  remoteShot = null,
}: {
  board: GameState;
  myTurn: boolean;
  onShoot: (input: ShotInput) => void;
  ballInHand?: boolean;
  onPlaceCue?: (x: number, y: number) => void;
  needCall?: boolean;
  calledPocket?: number | null;
  onCallPocket?: (pocket: number) => void;
  remoteShot?: RemoteShot | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ballsRef = useRef<Ball[]>(board.balls.map((b) => ({ ...b })));
  const boardRef = useRef<GameState>(board);
  const animatingRef = useRef(false);
  const strikeRef = useRef<Strike | null>(null);
  const playbackRef = useRef<Playback | null>(null);
  const sinksRef = useRef<Sink[]>([]);
  const rollRef = useRef<Map<number, Roll>>(new Map());
  const imgRef = useRef<HTMLImageElement | null>(null);
  const onShootRef = useRef(onShoot);
  onShootRef.current = onShoot;

  const [spin, setSpin] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ active: boolean; angle: number; power: number }>({
    active: false,
    angle: 0,
    power: 0,
  });
  // Ball-in-hand placement candidate (table coords) + validity.
  const placeRef = useRef<{ active: boolean; x: number; y: number; ok: boolean } | null>(null);

  // Table photo (drawn as soon as it decodes; a flat fallback covers the gap).
  useEffect(() => {
    const img = new Image();
    img.src = '/table.jpg';
    img.onload = () => {
      imgRef.current = img;
    };
  }, []);

  // Crisp rendering on retina/mobile: back the canvas at devicePixelRatio.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(canvas.clientWidth * dpr);
      if (w > 0 && Math.abs(w - canvas.width) > 2) {
        canvas.width = w;
        canvas.height = Math.round(w / ASPECT);
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Start a shot animation: stick strike, then deterministic sim playback.
  function beginShot(input: ShotInput, mode: 'local' | 'remote') {
    if (animatingRef.current) return;
    animatingRef.current = true;
    const frames: Ball[][] = [];
    const res = simulate(
      { rackSeed: boardRef.current.rackSeed, balls: ballsRef.current.map((b) => ({ ...b })) },
      input,
      { frames, stride: STRIDE },
    );
    strikeRef.current = {
      t0: performance.now(),
      angle: input.angle,
      power: input.power,
      playback: { frames, events: res.events, i: 0, ev: 0, mode, input },
    };
  }

  // Animate the OPPONENT's shot (echoed by the GameRoom DO in `resolved`).
  // Declared BEFORE the board-snap effect so animatingRef is already set when
  // the new authoritative board lands in the same commit.
  const remoteSeq = remoteShot?.seq;
  useEffect(() => {
    if (remoteShot && remoteSeq !== undefined) beginShot(remoteShot.input, 'remote');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteSeq]);

  // Snap to a new authoritative board when not mid-animation.
  useEffect(() => {
    boardRef.current = board;
    if (!animatingRef.current) {
      ballsRef.current = board.balls.map((b) => ({ ...b }));
    }
  }, [board]);

  // ── Render loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    const playEvent = (e: SimEvent) => {
      if (e.type === 'collision') sfxClick(Math.min(1, (e.speed ?? 30) / 70));
      else if (e.type === 'cushion' && (e.speed ?? 0) > 2.5)
        sfxCushion(Math.min(1, (e.speed ?? 20) / 60));
      else if (e.type === 'pot') sfxPocket();
    };

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const m = mapFor(w, h);
      const X = (tx: number) => m.ox + tx * m.sx;
      const Y = (ty: number) => m.oy + ty * m.sy;
      const r = TABLE.ballRadius * m.sx;
      const now = performance.now();

      // Table.
      ctx.clearRect(0, 0, w, h);
      if (imgRef.current) {
        ctx.drawImage(imgRef.current, 0, 0, w, h);
      } else {
        drawFallbackTable(ctx, w, h, m);
      }

      // Called-pocket ring.
      if (calledPocket != null) {
        const [ux, uy] = VISUAL_POCKETS[calledPocket];
        const pulse = 0.75 + 0.25 * Math.sin(now / 220);
        ctx.beginPath();
        ctx.arc(X(ux), Y(uy), r * 2.0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(111,208,137,${0.9 * pulse})`;
        ctx.lineWidth = Math.max(2, r * 0.18);
        ctx.stroke();
      }

      // Strike phase: draw the stick snapping forward, then start playback.
      const st = strikeRef.current;
      if (st) {
        const t = (now - st.t0) / STRIKE_MS;
        if (t >= 1) {
          strikeRef.current = null;
          sfxStrike(st.power);
          playbackRef.current = st.playback;
        }
      }

      // Playback phase: step through recorded sim frames.
      const pb = playbackRef.current;
      if (pb) {
        const prev = ballsRef.current;
        const idx = Math.min(pb.i, pb.frames.length - 1);
        ballsRef.current = pb.frames[idx];

        // Sounds for every sim event up to the current step.
        const stepNow = idx * STRIDE;
        while (pb.ev < pb.events.length && (pb.events[pb.ev].step ?? 0) <= stepNow) {
          playEvent(pb.events[pb.ev]);
          pb.ev++;
        }

        // Newly potted balls get a sink animation toward the visual hole.
        for (const b of ballsRef.current) {
          if (!b.potted) continue;
          const was = prev.find((p) => p.id === b.id);
          if (was && !was.potted) {
            sinksRef.current.push({ id: b.id, x: was.x, y: was.y, pocket: b.pocket, t0: now });
          }
        }

        pb.i += FRAME_SKIP;
        if (pb.i >= pb.frames.length) {
          // Catch pots that land between the last played frame and the rest
          // frame, so they still get a sink animation.
          const last = pb.frames[pb.frames.length - 1];
          for (const b of last) {
            if (!b.potted) continue;
            const was = ballsRef.current.find((p) => p.id === b.id);
            if (was && !was.potted) {
              sinksRef.current.push({ id: b.id, x: was.x, y: was.y, pocket: b.pocket, t0: now });
            }
          }
          ballsRef.current = last.map((b) => ({ ...b }));
          playbackRef.current = null;
          animatingRef.current = false;
          while (pb.ev < pb.events.length) playEvent(pb.events[pb.ev++]);
          if (pb.mode === 'local') {
            onShootRef.current(pb.input);
          } else {
            // Snap to the DO's authoritative board (identical sim, this just
            // erases any float drift).
            ballsRef.current = boardRef.current.balls.map((b) => ({ ...b }));
          }
        }
      }

      // Advance render-only roll phases from actual motion.
      for (const b of ballsRef.current) {
        if (b.potted) continue;
        const roll = rollRef.current.get(b.id) ?? { x: b.x, y: b.y, phase: 0, dx: 1, dy: 0.2 };
        const ddx = b.x - roll.x;
        const ddy = b.y - roll.y;
        const d = Math.hypot(ddx, ddy);
        if (d > 0.001) {
          roll.dx = ddx / d;
          roll.dy = ddy / d;
          roll.phase += d / TABLE.ballRadius;
        }
        roll.x = b.x;
        roll.y = b.y;
        rollRef.current.set(b.id, roll);
      }

      // Pocket sink animations (under the live balls).
      sinksRef.current = sinksRef.current.filter((s) => now - s.t0 < SINK_MS);
      for (const s of sinksRef.current) {
        const t = (now - s.t0) / SINK_MS;
        const ease = t * (2 - t); // easeOutQuad
        const [vx, vy] = VISUAL_POCKETS[s.pocket];
        const bx = s.x + (vx - s.x) * ease;
        const by = s.y + (vy - s.y) * ease;
        drawBall(ctx, X(bx), Y(by), { id: s.id } as Ball, r * (1 - 0.65 * ease), null, 1 - t);
      }

      // Live balls.
      const cueGlow = myTurn && !animatingRef.current && !ballInHand && !dragRef.current.active;
      for (const b of ballsRef.current) {
        if (b.potted) continue;
        if (ballInHand && b.id === 0) continue; // hidden until placed
        if (b.id === 0 && cueGlow) {
          const pulse = 0.45 + 0.3 * Math.sin(now / 300);
          ctx.beginPath();
          ctx.arc(X(b.x), Y(b.y), r * 1.7, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(139,195,148,${pulse})`;
          ctx.lineWidth = Math.max(1.5, r * 0.14);
          ctx.stroke();
        }
        drawBall(ctx, X(b.x), Y(b.y), b, r, rollRef.current.get(b.id) ?? null, 1);
      }

      // Ball-in-hand placement ghost.
      if (ballInHand && myTurn) {
        const p = placeRef.current;
        const cue = boardRef.current.balls.find((b) => b.id === 0);
        const gx = p?.active ? p.x : (cue?.x ?? TABLE.width * 0.25);
        const gy = p?.active ? p.y : (cue?.y ?? TABLE.height / 2);
        const ok = p?.active ? p.ok : true;
        ctx.save();
        ctx.globalAlpha = 0.85;
        drawBall(ctx, X(gx), Y(gy), { id: 0 } as Ball, r, null, 0.85);
        ctx.beginPath();
        ctx.arc(X(gx), Y(gy), r + Math.max(2, r * 0.2), 0, Math.PI * 2);
        ctx.strokeStyle = ok ? 'rgba(120,220,160,0.95)' : 'rgba(230,90,80,0.95)';
        ctx.lineWidth = Math.max(2, r * 0.16);
        ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.restore();
      }

      // Aim: ghost-ball prediction + cue stick.
      const aiming =
        myTurn && !ballInHand && dragRef.current.active && !animatingRef.current;
      if (aiming) {
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
          ctx.shadowColor = 'rgba(245,240,225,0.5)';
          ctx.shadowBlur = 6;
          ctx.setLineDash([7, 6]);
          ctx.strokeStyle = 'rgba(245, 240, 225, 0.85)';
          ctx.lineWidth = Math.max(1.5, r * 0.13);
          ctx.beginPath();
          ctx.moveTo(X(cue.x), Y(cue.y));
          ctx.lineTo(X(endX), Y(endY));
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.shadowBlur = 0;

          if (pred) {
            // Ghost ball at the contact point.
            ctx.beginPath();
            ctx.arc(X(pred.ghostX), Y(pred.ghostY), r, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(245,240,225,0.7)';
            ctx.lineWidth = Math.max(1, r * 0.1);
            ctx.stroke();
            // Predicted object-ball direction.
            ctx.beginPath();
            ctx.moveTo(X(pred.objX), Y(pred.objY));
            ctx.lineTo(X(pred.objX + pred.dirX * 26), Y(pred.objY + pred.dirY * 26));
            ctx.strokeStyle = 'rgba(111, 208, 137, 0.95)';
            ctx.lineWidth = Math.max(2, r * 0.16);
            ctx.stroke();
          }
          ctx.restore();

          // Cue stick pulled back with power.
          drawStick(ctx, X(cue.x), Y(cue.y), a, dragRef.current.power, r, m);

          drawPowerMeter(ctx, w, h, dragRef.current.power);
        }
      }

      // Stick striking forward after release.
      if (st && !playbackRef.current) {
        const cue = ballsRef.current.find((b) => b.id === 0 && !b.potted);
        if (cue) {
          const t = Math.min(1, (now - st.t0) / STRIKE_MS);
          const pull = st.power * (1 - t * t); // ease-in to contact
          drawStick(ctx, X(cue.x), Y(cue.y), st.angle, pull, r, m);
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [myTurn, ballInHand, calledPocket]);

  // ── Pointer input → aim + shoot, or ball-in-hand placement ───────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const toTable = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const m = mapFor(canvas.width, canvas.height);
      const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const cy = (e.clientY - rect.top) * (canvas.height / rect.height);
      return { x: (cx - m.ox) / m.sx, y: (cy - m.oy) / m.sy };
    };

    // ── Ball-in-hand placement ──
    const placeMove = (e: PointerEvent) => {
      const p = toTable(e);
      const ok = canPlaceCue(boardRef.current, p.x, p.y);
      placeRef.current = { active: true, x: p.x, y: p.y, ok };
    };
    const placeUp = (e: PointerEvent) => {
      if (!placeRef.current?.active) return;
      const p = toTable(e);
      placeRef.current = null;
      if (canPlaceCue(boardRef.current, p.x, p.y)) onPlaceCue?.(p.x, p.y);
    };

    // ── Aim / shoot ──
    const down = (e: PointerEvent) => {
      unlockAudio();
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
      beginShot({ angle, power, spin, calledPocket: calledPocket ?? undefined }, 'local');
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
  }, [myTurn, spin, ballInHand, needCall, calledPocket]);

  const hint = ballInHand
    ? myTurn
      ? 'Ball in hand — tap to place the cue ball anywhere'
      : 'Opponent is placing the cue ball'
    : needCall && calledPocket == null
      ? 'You’re on the 8 — tap a pocket on the table to call it'
      : myTurn
        ? 'Your shot — drag back from the cue ball to aim'
        : "Opponent's turn";

  return (
    <div className="w-full">
      <div className="relative w-full overflow-hidden rounded-2xl border border-ink-line shadow-table">
        <canvas
          ref={canvasRef}
          className="block w-full touch-none"
          style={{ aspectRatio: `${IMG_W} / ${IMG_H}` }}
        />
        {/* Pocket-call hotspots: tap a pocket directly on the table. */}
        {needCall &&
          myTurn &&
          VISUAL_POCKETS.map(([ux, uy], i) => (
            <button
              key={i}
              type="button"
              aria-label={`Call pocket ${i + 1}`}
              onClick={() => {
                unlockAudio();
                sfxTick();
                onCallPocket?.(i);
              }}
              className={
                'pocket-hotspot absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition ' +
                (calledPocket === i
                  ? 'border-sage-bright bg-sage/25'
                  : 'border-sage/70 bg-ink/30 hover:bg-sage/15')
              }
              style={{
                left: `${((PLAY.x + (ux / TABLE.width) * PLAY.w) / IMG_W) * 100}%`,
                top: `${((PLAY.y + (uy / TABLE.height) * PLAY.h) / IMG_H) * 100}%`,
                width: '7.5%',
                aspectRatio: '1',
              }}
            />
          ))}
      </div>

      {/* Spin selector + hint */}
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
      className="relative h-11 w-11 rounded-full border border-ink-line bg-gradient-to-br from-[#fbf8ef] to-[#cfc9b8] shadow-inner disabled:opacity-40"
      aria-label="spin selector"
    >
      <span className="pointer-events-none absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-black/10" />
      <span className="pointer-events-none absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-black/10" />
      <span
        className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#c0392b] shadow"
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
  if (id === 0) return '#f6f3ea';
  if (id === 8) return '#14171a';
  const solids: Record<number, string> = {
    1: '#e8b00a',
    2: '#1d4fc4',
    3: '#cc2418',
    4: '#522a8c',
    5: '#e06a14',
    6: '#187a40',
    7: '#8c2030',
  };
  const base = ((id - 1) % 7) + 1;
  return solids[base] ?? '#cc2418';
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

/**
 * Glossy ball under the photo's overhead lamp. `roll` (render-only) rolls the
 * number decal across the ball with motion, like the real thing.
 */
function drawBall(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  b: Ball,
  r: number,
  roll: Roll | null,
  alpha: number,
) {
  if (r <= 0) return;
  const stripe = b.id >= 9 && b.id <= 15;
  const color = ballColor(b.id);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Soft contact shadow, biased away from the lamp (top-center).
  const sh = ctx.createRadialGradient(cx, cy + r * 0.45, r * 0.2, cx, cy + r * 0.45, r * 1.15);
  sh.addColorStop(0, 'rgba(0,0,0,0.4)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.45, r * 1.15, r * 0.85, 0, 0, Math.PI * 2);
  ctx.fillStyle = sh;
  ctx.fill();

  // Body.
  const base = stripe ? '#f4f0e5' : color;
  const grad = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.48, r * 0.08, cx, cy, r * 1.05);
  grad.addColorStop(0, shade(base, 0.5));
  grad.addColorStop(0.42, base);
  grad.addColorStop(1, shade(base, -0.52));
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Stripe band.
  if (stripe) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const bg = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.48, r * 0.08, cx, cy, r * 1.05);
    bg.addColorStop(0, shade(color, 0.45));
    bg.addColorStop(0.42, color);
    bg.addColorStop(1, shade(color, -0.45));
    ctx.fillStyle = bg;
    ctx.fillRect(cx - r, cy - r * 0.52, r * 2, r * 1.04);
    ctx.restore();
  }

  // Number decal, rolling over the ball with motion (cue ball gets a red dot).
  const phase = roll?.phase ?? 0;
  const cos = Math.cos(phase);
  const sin = Math.sin(phase);
  if (cos > 0.06) {
    const ox = (roll?.dx ?? 0) * sin * r * 0.52;
    const oy = (roll?.dy ?? 0) * sin * r * 0.52;
    const dx = roll?.dx ?? 1;
    const dy = roll?.dy ?? 0;
    const ang = Math.atan2(dy, dx);
    const discR = b.id === 0 ? r * 0.16 : r * 0.46;
    ctx.save();
    ctx.translate(cx + ox, cy + oy);
    ctx.rotate(ang);
    ctx.scale(Math.max(0.12, cos), 1); // foreshorten along motion axis
    ctx.rotate(-ang);
    ctx.beginPath();
    ctx.arc(0, 0, discR, 0, Math.PI * 2);
    ctx.fillStyle = b.id === 0 ? 'rgba(200,60,50,0.85)' : '#fbfaf3';
    ctx.fill();
    if (b.id !== 0) {
      ctx.fillStyle = '#14171a';
      ctx.font = `600 ${r * 0.6}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(b.id), 0, r * 0.03);
    }
    ctx.restore();
  }

  // Rim occlusion + specular highlight from the lamp.
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.985, 0, Math.PI * 2);
  ctx.lineWidth = r * 0.07;
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.stroke();

  const spec = ctx.createRadialGradient(
    cx - r * 0.32,
    cy - r * 0.42,
    0,
    cx - r * 0.32,
    cy - r * 0.42,
    r * 0.62,
  );
  spec.addColorStop(0, 'rgba(255,253,245,0.95)');
  spec.addColorStop(0.35, 'rgba(255,253,245,0.35)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(cx - r * 0.3, cy - r * 0.38, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = spec;
  ctx.fill();

  ctx.restore();
}

/** Wooden cue stick along the aim line; `power` 0..1 sets the pull-back. */
function drawStick(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angle: number,
  power: number,
  r: number,
  m: Mapping,
) {
  const playW = TABLE.width * m.sx;
  const len = playW * 0.52;
  const pull = r * 1.5 + power * r * 9;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  // Stick extends BEHIND the cue ball (negative x).
  const tipX = -pull;
  const buttX = tipX - len;

  const stickPath = (off: number) => {
    ctx.beginPath();
    ctx.moveTo(tipX, -r * 0.22 + off);
    ctx.lineTo(buttX, -r * 0.5 + off);
    ctx.lineTo(buttX, r * 0.5 + off);
    ctx.lineTo(tipX, r * 0.22 + off);
    ctx.closePath();
  };

  // Drop shadow on the felt.
  ctx.save();
  ctx.rotate(-angle);
  ctx.translate(r * 0.18, r * 0.5);
  ctx.rotate(angle);
  stickPath(0);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();
  ctx.restore();

  // Shaft: maple at the tip into dark walnut butt.
  const grad = ctx.createLinearGradient(tipX, 0, buttX, 0);
  grad.addColorStop(0, '#e7c98f');
  grad.addColorStop(0.45, '#c89a58');
  grad.addColorStop(0.72, '#6e4423');
  grad.addColorStop(1, '#2e1c10');
  stickPath(0);
  ctx.fillStyle = grad;
  ctx.fill();
  // Top highlight line for roundness.
  ctx.beginPath();
  ctx.moveTo(tipX, -r * 0.1);
  ctx.lineTo(buttX, -r * 0.26);
  ctx.strokeStyle = 'rgba(255,240,210,0.35)';
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.stroke();

  // Ferrule + leather tip.
  ctx.fillStyle = '#f3efe2';
  ctx.fillRect(tipX, -r * 0.22, -r * 0.5, r * 0.44);
  ctx.fillStyle = '#3a6ea8';
  ctx.fillRect(tipX + r * 0.18, -r * 0.21, -r * 0.18, r * 0.42);
  ctx.restore();
}

/** Sleek power meter pinned to the bottom rail while aiming. */
function drawPowerMeter(ctx: CanvasRenderingContext2D, w: number, h: number, power: number) {
  const bw = w * 0.42;
  const bh = Math.max(5, h * 0.012);
  const x = (w - bw) / 2;
  const y = h - bh * 3.4;
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x, y, bw, bh, bh / 2);
  ctx.fillStyle = 'rgba(8,12,10,0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,240,225,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (power > 0.01) {
    const grad = ctx.createLinearGradient(x, 0, x + bw, 0);
    grad.addColorStop(0, '#8bc394');
    grad.addColorStop(0.55, '#d9a441');
    grad.addColorStop(1, '#d6543c');
    ctx.beginPath();
    roundRect(ctx, x + 1, y + 1, Math.max(bh - 2, (bw - 2) * power), bh - 2, (bh - 2) / 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }
  ctx.restore();
}

/** Flat stand-in drawn for the frame or two before /table.jpg decodes. */
function drawFallbackTable(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  m: Mapping,
) {
  ctx.fillStyle = '#241308';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#175c40';
  ctx.fillRect(m.ox, m.oy, TABLE.width * m.sx, TABLE.height * m.sy);
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
