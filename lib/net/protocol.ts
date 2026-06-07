import type { Address, Hex } from 'viem';

/**
 * Wire protocol shared (by shape) between the browser client and the Worker /
 * Durable Objects. Keep this file framework-free so it can be copied/imported
 * by the Worker too.
 */

export type PlayerInfo = {
  address: Address;
  ensName: string | null;
  avatar: string | null;
};

/** Match context handed to both clients when a challenge is accepted. */
export type Matched = {
  roomId: string;
  opponent: PlayerInfo;
  youBreak: boolean;
};

// ── Shot input: the ONLY gameplay payload a client sends. ──────────────────
// The GameRoom DO runs the authoritative simulation from this.
export type ShotInput = {
  angle: number; // radians
  power: number; // 0..1 normalized pull distance
  spin: { x: number; y: number }; // cue-ball contact offset, -1..1
  calledPocket?: number; // pocket index called for the 8-ball (when on the 8)
};

// ── Signed challenge / acceptance / result payloads (no gas, no contract). ──
export type ChallengePayload = {
  kind: 'challenge';
  challenger: Address;
  opponent: Address;
  nonce: Hex; // random 32 bytes
  issuedAt: number; // unix ms
};

export type ResultPayload = {
  kind: 'result';
  matchId: string;
  winner: Address;
  loser: Address;
  rackSeed: number;
  shots: number;
  finishedAt: number; // unix ms
};

export type Signed<T> = { payload: T; signature: Hex };

// ── Lobby messages (client ⇄ Lobby DO) ─────────────────────────────────────
export type LobbyClientMsg =
  | { t: 'hello'; player: PlayerInfo }
  | { t: 'challenge'; signed: Signed<ChallengePayload> }
  | { t: 'accept'; nonce: Hex; signed: Signed<ChallengePayload> }
  | { t: 'decline'; nonce: Hex }
  | { t: 'ping' };

export type LobbyServerMsg =
  | { t: 'presence'; players: PlayerInfo[] }
  | { t: 'incoming'; signed: Signed<ChallengePayload> }
  | { t: 'declined'; nonce: Hex }
  | { t: 'matched'; roomId: string; opponent: PlayerInfo; youBreak: boolean }
  | { t: 'error'; message: string }
  | { t: 'pong' };

// ── GameRoom messages (client ⇄ GameRoom DO) ───────────────────────────────
export type RoomClientMsg =
  // `youBreak` lets the DO seat the lobby's designated breaker as seat 0,
  // regardless of which client's socket happens to join the room first.
  | { t: 'join'; player: PlayerInfo; youBreak: boolean }
  | { t: 'shot'; input: ShotInput }
  // Ball-in-hand: place the cue ball after the opponent fouled.
  | { t: 'place-cue'; x: number; y: number }
  // Diagnostic-only desync detector: client's locally-computed board hash.
  | { t: 'statehash'; turn: number; hash: string }
  | { t: 'sign-result'; signed: Signed<ResultPayload> }
  | { t: 'resign' };

export type RoomServerMsg =
  | { t: 'start'; rackSeed: number; turnAddress: Address }
  // Authoritative simulation result the clients animate to.
  | { t: 'resolved'; turn: number; finalState: unknown; events: ShotEvent[]; nextTurn: Address }
  | { t: 'turn'; turnAddress: Address; ballInHand: boolean }
  | { t: 'gameover'; winner: Address; loser: Address; reason: string; resultPayload: ResultPayload }
  | { t: 'desync'; turn: number }
  | { t: 'opponent-left' }
  | { t: 'error'; message: string };

export type ShotEvent =
  | { type: 'pot'; ball: number; pocket: number }
  | { type: 'cushion'; ball: number }
  | { type: 'collision'; a: number; b: number }
  | { type: 'foul'; reason: string }
  | { type: 'turn-pass' }
  | { type: 'win' }
  | { type: 'loss' };
