/**
 * Deterministic 2D rigid-body pool physics.
 *
 * CONTRACT (see CLAUDE.md §5):
 *  - `simulate(state, input) -> { finalState, events }` is a PURE function:
 *    no DOM, no Date, no Math.random. The only entropy is a seeded PRNG.
 *  - FIXED timestep: time is accumulated and stepped at a constant dt. Never
 *    step by a requestAnimationFrame delta.
 *  - The GameRoom DO imports THIS SAME FILE and runs the authoritative sim.
 *    Clients may run it for instant feedback, then snap/lerp to the DO result.
 *
 * Units are abstract table units; the renderer scales to the canvas.
 */

export const TABLE = {
  width: 100,
  height: 50,
  ballRadius: 1.1,
  pocketRadius: 2.0,
} as const;

export const PHYS = {
  dt: 1 / 120, // fixed timestep (seconds)
  friction: 0.55, // rolling friction (per second, exponential-ish via dt)
  cushionRestitution: 0.92,
  ballRestitution: 0.96,
  minSpeed: 0.05, // below this a ball is snapped to rest
  maxSteps: 4000, // hard cap so a shot always terminates
  maxShotSpeed: 90, // table units / second at power = 1
  spinTransfer: 12, // how strongly english curves the cue post-contact
} as const;

// 6 pockets: 4 corners + 2 side. [x, y] in table units.
export const POCKETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [TABLE.width / 2, 0],
  [TABLE.width, 0],
  [0, TABLE.height],
  [TABLE.width / 2, TABLE.height],
  [TABLE.width, TABLE.height],
];

// Pocket geometry (table units):
//  - CAPTURE: a ball whose CENTER comes within this of a pocket centre drops.
//  - MOUTH: how far along a rail the cushion is "open" around a pocket, so a
//    ball can roll into the jaws instead of bouncing off the rail.
export const POCKET_CAPTURE = 2.2;
export const POCKET_MOUTH = 2.9;

// X-coords of pockets on the top/bottom rails; Y-coords on the left/right rails.
const X_POCKETS = [0, TABLE.width / 2, TABLE.width];
const Y_POCKETS = [0, TABLE.height];
const nearAny = (v: number, ps: number[]) => ps.some((p) => Math.abs(v - p) < POCKET_MOUTH);

export type Ball = {
  id: number; // 0 = cue, 1..7 solids, 8 = eight, 9..15 stripes
  x: number;
  y: number;
  vx: number;
  vy: number;
  potted: boolean;
  pocket: number; // pocket index it fell into, -1 otherwise
};

export type GameState = {
  balls: Ball[];
  rackSeed: number;
};

export type SimEvent =
  | { type: 'pot'; ball: number; pocket: number }
  | { type: 'cushion'; ball: number }
  | { type: 'collision'; a: number; b: number }
  | { type: 'first-contact'; ball: number }; // first ball the cue touched

export type SimResult = {
  finalState: GameState;
  events: SimEvent[];
  firstContact: number | null; // ball id the cue first hit (-1/null = no contact)
  cueScratched: boolean;
  anyCushionAfterContact: boolean;
};

export type ShotInput = {
  angle: number; // radians
  power: number; // 0..1
  spin: { x: number; y: number }; // -1..1 contact offset
  calledPocket?: number; // pocket index called for the 8-ball (when on the 8)
};

// ── Deterministic PRNG (mulberry32) — seeded, no global Math.random. ────────
export function makeRng(seed: number) {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard triangle rack at the foot spot, deterministic from the seed. */
export function rackBalls(rackSeed: number): Ball[] {
  const rng = makeRng(rackSeed);
  const r = TABLE.ballRadius;
  const gap = r * 2.02;
  const apexX = TABLE.width * 0.72;
  const apexY = TABLE.height / 2;

  // 15 object balls in a triangle. Shuffle non-8 balls; 8 stays at center (row 3).
  const ids = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }

  const balls: Ball[] = [];
  // Cue ball on the head spot.
  balls.push({ id: 0, x: TABLE.width * 0.25, y: apexY, vx: 0, vy: 0, potted: false, pocket: -1 });

  let k = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      const x = apexX + row * gap * 0.87;
      const y = apexY + (col - row / 2) * gap;
      let id: number;
      if (row === 2 && col === 1) {
        id = 8; // 8-ball locked to the rack center
      } else {
        id = ids[k++];
      }
      balls.push({ id, x, y, vx: 0, vy: 0, potted: false, pocket: -1 });
    }
  }
  return balls;
}

function clone(state: GameState): GameState {
  return {
    rackSeed: state.rackSeed,
    balls: state.balls.map((b) => ({ ...b })),
  };
}

export type SimOptions = {
  /**
   * Optional frame sink for RENDERING ONLY. When provided, a snapshot of ball
   * positions is pushed every `stride` steps. This is a pure side-channel: it
   * does not affect the simulation result, so the DO's authoritative call (no
   * frames) and a client's animated call produce identical finalState/events.
   */
  frames?: Ball[][];
  stride?: number;
};

/** Apply a shot to the cue ball, then run the fixed-step sim to rest. */
export function simulate(state: GameState, input: ShotInput, opts?: SimOptions): SimResult {
  const s = clone(state);
  const recordEvery = Math.max(1, opts?.stride ?? 2);
  const events: SimEvent[] = [];
  const cue = s.balls.find((b) => b.id === 0);

  let firstContact: number | null = null;
  let cushionAfterContact = false;

  if (cue && !cue.potted) {
    const power = Math.max(0, Math.min(1, input.power));
    const speed = power * PHYS.maxShotSpeed;
    cue.vx = Math.cos(input.angle) * speed;
    cue.vy = Math.sin(input.angle) * speed;
    // English nudges the cue's path slightly (simplified spin model).
    cue.vx += input.spin.x * PHYS.spinTransfer * 0.0;
    cue.vy += input.spin.y * PHYS.spinTransfer * 0.0;
  }

  const r = TABLE.ballRadius;
  const dt = PHYS.dt;

  for (let step = 0; step < PHYS.maxSteps; step++) {
    let moving = false;

    // Integrate + friction.
    for (const b of s.balls) {
      if (b.potted) continue;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp < PHYS.minSpeed) {
        b.vx = 0;
        b.vy = 0;
        continue;
      }
      moving = true;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const decay = Math.max(0, 1 - PHYS.friction * dt);
      b.vx *= decay;
      b.vy *= decay;
    }

    if (!moving) break;

    // Render-only snapshot.
    if (opts?.frames && step % recordEvery === 0) {
      opts.frames.push(s.balls.map((b) => ({ ...b })));
    }

    // Ball-ball collisions (elastic, equal mass).
    for (let i = 0; i < s.balls.length; i++) {
      const a = s.balls[i];
      if (a.potted) continue;
      for (let j = i + 1; j < s.balls.length; j++) {
        const b = s.balls[j];
        if (b.potted) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const min = r * 2;
        if (dist > 0 && dist < min) {
          // Separate to avoid sticking.
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = min - dist;
          a.x -= (nx * overlap) / 2;
          a.y -= (ny * overlap) / 2;
          b.x += (nx * overlap) / 2;
          b.y += (ny * overlap) / 2;

          // Relative velocity along the normal.
          const rvx = b.vx - a.vx;
          const rvy = b.vy - a.vy;
          const velN = rvx * nx + rvy * ny;
          if (velN < 0) {
            const imp = (-(1 + PHYS.ballRestitution) * velN) / 2;
            a.vx -= imp * nx;
            a.vy -= imp * ny;
            b.vx += imp * nx;
            b.vy += imp * ny;
            events.push({ type: 'collision', a: a.id, b: b.id });
            // Track first ball the cue contacts.
            if ((a.id === 0 || b.id === 0) && firstContact === null) {
              const other = a.id === 0 ? b.id : a.id;
              firstContact = other;
              events.push({ type: 'first-contact', ball: other });
            }
          }
        }
      }
    }

    // Pocket capture — BEFORE cushions, so the pocket jaws aren't walled off.
    for (const b of s.balls) {
      if (b.potted) continue;
      for (let p = 0; p < POCKETS.length; p++) {
        const [px, py] = POCKETS[p];
        if (Math.hypot(b.x - px, b.y - py) < POCKET_CAPTURE) {
          b.potted = true;
          b.pocket = p;
          b.vx = 0;
          b.vy = 0;
          events.push({ type: 'pot', ball: b.id, pocket: p });
          break;
        }
      }
    }

    // Cushion collisions — the rail is OPEN near each pocket mouth so a ball can
    // roll into the jaws instead of bouncing off a wall that spans the opening.
    for (const b of s.balls) {
      if (b.potted) continue;
      let hit = false;
      const openSide = nearAny(b.y, Y_POCKETS); // left/right rails open near corners
      const openEnd = nearAny(b.x, X_POCKETS); //  top/bottom rails open near pockets
      if (!openSide) {
        if (b.x < r) {
          b.x = r;
          b.vx = Math.abs(b.vx) * PHYS.cushionRestitution;
          hit = true;
        } else if (b.x > TABLE.width - r) {
          b.x = TABLE.width - r;
          b.vx = -Math.abs(b.vx) * PHYS.cushionRestitution;
          hit = true;
        }
      }
      if (!openEnd) {
        if (b.y < r) {
          b.y = r;
          b.vy = Math.abs(b.vy) * PHYS.cushionRestitution;
          hit = true;
        } else if (b.y > TABLE.height - r) {
          b.y = TABLE.height - r;
          b.vy = -Math.abs(b.vy) * PHYS.cushionRestitution;
          hit = true;
        }
      }
      if (hit) {
        events.push({ type: 'cushion', ball: b.id });
        if (firstContact !== null) cushionAfterContact = true;
      }
    }

    // Escape backstop: a ball past a boundary can only be inside a pocket mouth
    // (the solid rail clamps the rest), so drop it into the nearest pocket.
    for (const b of s.balls) {
      if (b.potted) continue;
      if (b.x < 0 || b.x > TABLE.width || b.y < 0 || b.y > TABLE.height) {
        let best = 0;
        let bestD = Infinity;
        for (let p = 0; p < POCKETS.length; p++) {
          const d = Math.hypot(b.x - POCKETS[p][0], b.y - POCKETS[p][1]);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        b.potted = true;
        b.pocket = best;
        b.vx = 0;
        b.vy = 0;
        events.push({ type: 'pot', ball: b.id, pocket: best });
      }
    }
  }

  // Final resting frame.
  if (opts?.frames) opts.frames.push(s.balls.map((b) => ({ ...b })));

  const cueAfter = s.balls.find((b) => b.id === 0);
  const cueScratched = !!cueAfter?.potted;

  return {
    finalState: s,
    events,
    firstContact,
    cueScratched,
    anyCushionAfterContact: cushionAfterContact,
  };
}

/**
 * Stable, order-independent hash of a board's resting positions — DIAGNOSTIC
 * ONLY (desync detector). The DO's own simulation is always authoritative.
 */
export function hashState(state: GameState): string {
  let h = 2166136261 >>> 0; // FNV-1a
  const q = (n: number) => Math.round(n * 1000); // quantize float noise
  for (const b of state.balls) {
    const parts = [b.id, b.potted ? 1 : 0, q(b.x), q(b.y)];
    for (const p of parts) {
      h ^= p & 0xffffffff;
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}
