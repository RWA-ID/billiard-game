/**
 * 8-ball rules / turn logic (v1). Pure functions over a shot's SimResult.
 * Drives the GameRoom DO's turn authority — the DO calls evaluateShot() with
 * the result of its authoritative simulation.
 */
import type { SimResult, SimEvent } from '@/lib/game/physics';

export type Group = 'solids' | 'stripes' | null;

export type TurnState = {
  current: 0 | 1; // player index 0 or 1
  groups: [Group, Group]; // assigned group per player (null = open table)
  ballInHand: boolean;
  open: boolean; // table still open (groups unassigned)
  winner: 0 | 1 | null;
  loser: 0 | 1 | null;
  reason: string | null;
};

export function initialTurn(breaker: 0 | 1): TurnState {
  return {
    current: breaker,
    groups: [null, null],
    ballInHand: false,
    open: true,
    winner: null,
    loser: null,
    reason: null,
  };
}

function ballGroup(id: number): Group {
  if (id >= 1 && id <= 7) return 'solids';
  if (id >= 9 && id <= 15) return 'stripes';
  return null; // cue (0) or eight (8)
}

function potted(events: SimEvent[]): number[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'pot' }> => e.type === 'pot').map((e) => e.ball);
}

export type ShotOutcome = {
  next: TurnState;
  foul: boolean;
  foulReason: string | null;
  pottedBalls: number[];
};

/**
 * Evaluate one completed shot and produce the next turn state.
 *
 * @param turn   current turn state
 * @param result authoritative SimResult from physics.simulate
 * @param remaining function: how many of a group remain on the table AFTER the shot
 */
export function evaluateShot(
  turn: TurnState,
  result: SimResult,
  remainingOf: (g: Exclude<Group, null>) => number,
  calledPocket?: number | null,
): ShotOutcome {
  const t: TurnState = { ...turn, groups: [...turn.groups] as [Group, Group] };
  const pot = potted(result.events);
  const eightPotted = pot.includes(8);
  const cueScratched = result.cueScratched;

  let foul = false;
  let foulReason: string | null = null;

  // Foul: no contact at all.
  if (result.firstContact === null) {
    foul = true;
    foulReason = 'no contact';
  } else {
    // Foul: hit the wrong group first (only enforced once groups assigned).
    const myGroup = t.groups[t.current];
    if (myGroup) {
      const fcGroup = ballGroup(result.firstContact);
      const clearedMyGroup = remainingOf(myGroup) === 0;
      // If my group is cleared, I'm on the 8 — must hit the 8 first.
      const legalFirst = clearedMyGroup ? result.firstContact === 8 : fcGroup === myGroup;
      if (!legalFirst) {
        foul = true;
        const hit = result.firstContact === 8 ? 'the 8-ball' : fcGroup ?? 'another ball';
        foulReason = clearedMyGroup
          ? `must hit the 8-ball first (hit ${hit})`
          : `must hit ${myGroup} first (hit ${hit})`;
      }
    }
    // Foul: no rail and no pot after contact.
    if (!foul && !result.anyCushionAfterContact && pot.length === 0) {
      foul = true;
      foulReason = 'no rail after contact';
    }
  }

  // Cue scratch is always a foul.
  if (cueScratched) {
    foul = true;
    foulReason = foulReason ?? 'scratch';
  }

  // ── 8-ball win/loss resolution ─────────────────────────────────────────
  if (eightPotted) {
    const myGroup = t.groups[t.current];
    const clearedBeforeEight = myGroup ? remainingOf(myGroup) === 0 : false;
    // Which pocket the 8 actually fell into.
    const eightPot = result.events.find(
      (e): e is Extract<SimEvent, { type: 'pot' }> => e.type === 'pot' && e.ball === 8,
    );
    const eightPocket = eightPot?.pocket;
    // Call-pocket: if a pocket was called, the 8 must drop there. No call (e.g.
    // a stray 8 on the break) stays lenient so a missing call can't brick a game.
    const calledOk = calledPocket == null || eightPocket === calledPocket;
    const legalEight = !t.open && clearedBeforeEight && !cueScratched && calledOk;
    if (legalEight) {
      t.winner = t.current;
      t.loser = (t.current === 0 ? 1 : 0) as 0 | 1;
      t.reason = 'potted the 8 on a clear table';
    } else {
      // Early 8, wrong pocket, or 8 + scratch → current player loses.
      t.loser = t.current;
      t.winner = (t.current === 0 ? 1 : 0) as 0 | 1;
      t.reason = cueScratched
        ? 'potted the 8 with a scratch'
        : !calledOk && clearedBeforeEight && !t.open
          ? 'potted the 8 in the wrong pocket'
          : 'potted the 8 early';
    }
    return { next: t, foul, foulReason, pottedBalls: pot };
  }

  // ── Group assignment on first legal pot (open table) ───────────────────
  if (t.open && !foul) {
    const solidsPotted = pot.some((b) => ballGroup(b) === 'solids');
    const stripesPotted = pot.some((b) => ballGroup(b) === 'stripes');
    // Only assign if exactly one group was potted (mixed = stays open).
    if (solidsPotted !== stripesPotted) {
      const g: Exclude<Group, null> = solidsPotted ? 'solids' : 'stripes';
      const other: Exclude<Group, null> = g === 'solids' ? 'stripes' : 'solids';
      t.groups[t.current] = g;
      t.groups[t.current === 0 ? 1 : 0] = other;
      t.open = false;
    }
  }

  // ── Turn continuation ──────────────────────────────────────────────────
  // Player continues if: no foul AND they legally potted at least one of
  // their own balls (or any ball while the table was open this shot).
  const myGroup = t.groups[t.current];
  const pottedOwn =
    !foul &&
    pot.length > 0 &&
    (turn.open || (myGroup ? pot.some((b) => ballGroup(b) === myGroup) : false));

  if (foul) {
    t.current = (t.current === 0 ? 1 : 0) as 0 | 1;
    t.ballInHand = true; // opponent gets ball-in-hand
  } else if (!pottedOwn) {
    t.current = (t.current === 0 ? 1 : 0) as 0 | 1;
    t.ballInHand = false;
  } else {
    t.ballInHand = false; // same player shoots again
  }

  return { next: t, foul, foulReason, pottedBalls: pot };
}
