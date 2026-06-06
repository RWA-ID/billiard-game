/**
 * Match state machine — ties together physics + rules for a two-player match.
 * Used by the GameRoom DO (authoritative) and by the local hot-seat mode.
 */
import {
  rackBalls,
  simulate,
  type GameState,
  type ShotInput,
  type SimResult,
} from '@/lib/game/physics';
import {
  evaluateShot,
  initialTurn,
  type Group,
  type TurnState,
} from '@/lib/game/rules';

export type MatchPhase = 'lobby' | 'breaking' | 'playing' | 'over';

export type Match = {
  phase: MatchPhase;
  board: GameState;
  turn: TurnState;
  rackSeed: number;
  shots: number;
};

export function newMatch(rackSeed: number, breaker: 0 | 1): Match {
  return {
    phase: 'breaking',
    board: { balls: rackBalls(rackSeed), rackSeed },
    turn: initialTurn(breaker),
    rackSeed,
    shots: 0,
  };
}

function remainingCounter(board: GameState) {
  return (g: Exclude<Group, null>): number => {
    const lo = g === 'solids' ? 1 : 9;
    const hi = g === 'solids' ? 7 : 15;
    return board.balls.filter((b) => b.id >= lo && b.id <= hi && !b.potted).length;
  };
}

export type AppliedShot = {
  match: Match;
  result: SimResult;
  foul: boolean;
  foulReason: string | null;
  pottedBalls: number[];
};

/**
 * Apply a shot to the match: run the (authoritative) simulation, then update
 * board + turn + win state. Returns the new match plus the SimResult so the
 * caller can broadcast `{finalState, events}` for animation.
 */
export function applyShot(match: Match, input: ShotInput): AppliedShot {
  const result = simulate(match.board, input);
  const board = result.finalState;

  const outcome = evaluateShot(match.turn, result, remainingCounter(board));

  // Re-spot the cue ball if it was scratched (ball-in-hand handles placement).
  const cue = board.balls.find((b) => b.id === 0);
  if (cue && cue.potted) {
    cue.potted = false;
    cue.pocket = -1;
    cue.x = match.board.balls.find((b) => b.id === 0)!.x; // headspot fallback
    cue.y = match.board.balls.find((b) => b.id === 0)!.y;
    cue.vx = 0;
    cue.vy = 0;
  }

  const over = outcome.next.winner !== null;
  const next: Match = {
    phase: over ? 'over' : 'playing',
    board,
    turn: outcome.next,
    rackSeed: match.rackSeed,
    shots: match.shots + 1,
  };

  return {
    match: next,
    result,
    foul: outcome.foul,
    foulReason: outcome.foulReason,
    pottedBalls: outcome.pottedBalls,
  };
}

/** Place the cue ball anywhere (ball-in-hand) before the next shot. */
export function placeCueBall(match: Match, x: number, y: number): Match {
  const board: GameState = {
    rackSeed: match.board.rackSeed,
    balls: match.board.balls.map((b) =>
      b.id === 0 ? { ...b, x, y, vx: 0, vy: 0, potted: false, pocket: -1 } : { ...b },
    ),
  };
  return { ...match, board, turn: { ...match.turn, ballInHand: false } };
}
