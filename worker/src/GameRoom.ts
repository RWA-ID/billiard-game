/**
 * GameRoom Durable Object (per match): AUTHORITATIVE for outcomes.
 *
 * A client sends only its shot input; the room imports the SAME physics + rules
 * and runs the one simulation that counts, then broadcasts {finalState, events}
 * for both clients to animate to. Clients also send a diagnostic state hash; the
 * room compares it to its own as a desync detector (logging only).
 *
 * At match end the room collects both players' signed result payloads. If both
 * sign the same payload it writes the win/loss to KV; otherwise it records its
 * OWN authoritative outcome and marks the match disputed.
 */
import { applyShot, newMatch, type Match } from '@/lib/game/state';
import { hashState, type ShotInput } from '@/lib/game/physics';
import { verifyResult } from '@/lib/crypto/sign';
import { recordResult } from './stats';
import type {
  PlayerInfo,
  ResultPayload,
  RoomClientMsg,
  RoomServerMsg,
  Signed,
} from '@/lib/net/protocol';
import type { Env } from './index';

type Seat = { ws: WebSocket; player: PlayerInfo; breaker: boolean };

export class GameRoom {
  private seats: Seat[] = []; // index 0 = breaker
  private match: Match | null = null;
  private roomId = '';
  private started = false;
  private signatures = new Map<string, Signed<ResultPayload>>(); // addr → signed
  private finalPayload: ResultPayload | null = null; // room's authoritative payload
  private written = false;

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    this.roomId = new URL(req.url).pathname.split('/').pop() ?? 'room';
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    this.wire(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private wire(ws: WebSocket) {
    ws.addEventListener('message', async (ev) => {
      let msg: RoomClientMsg;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      switch (msg.t) {
        case 'join':
          this.onJoin(ws, msg.player, msg.youBreak);
          break;
        case 'shot':
          this.onShot(ws, msg.input);
          break;
        case 'statehash':
          this.onStateHash(msg.turn, msg.hash);
          break;
        case 'sign-result':
          await this.onSignResult(msg.signed);
          break;
        case 'resign':
          this.onResign(ws);
          break;
      }
    });
    ws.addEventListener('close', () => this.onLeave(ws));
    ws.addEventListener('error', () => this.onLeave(ws));
  }

  private onJoin(ws: WebSocket, player: PlayerInfo, youBreak: boolean) {
    if (this.seats.length >= 2 && !this.seats.find((s) => s.ws === ws)) return;
    const existing = this.seats.find(
      (s) => s.player.address.toLowerCase() === player.address.toLowerCase(),
    );
    if (existing) {
      existing.ws = ws; // reconnect: refresh the socket
      existing.breaker = youBreak;
      // Catch a reconnecting client up to the in-progress match.
      if (this.started && this.match) {
        this.send(ws, {
          t: 'start',
          rackSeed: this.match.rackSeed,
          turnAddress: this.currentAddress() ?? this.seats[0].player.address,
        });
        this.send(ws, {
          t: 'resolved',
          turn: this.match.shots,
          finalState: this.match,
          events: [],
          nextTurn: this.currentAddress() ?? this.seats[0].player.address,
        });
      }
    } else {
      this.seats.push({ ws, player, breaker: youBreak });
    }

    if (this.seats.length === 2 && !this.started) {
      // Seat the lobby's designated breaker (challenger) as seat 0, regardless
      // of socket join order, so the DO's turn order matches both clients.
      this.seats.sort((a, b) => Number(b.breaker) - Number(a.breaker));
      this.started = true;
      const seed = seedFromRoom(this.roomId);
      this.match = newMatch(seed, 0); // seats[0] breaks
      this.broadcast({
        t: 'start',
        rackSeed: seed,
        turnAddress: this.seats[0].player.address,
      });
    }
  }

  private currentAddress(): `0x${string}` | null {
    if (!this.match) return null;
    return this.seats[this.match.turn.current]?.player.address ?? null;
  }

  private onShot(ws: WebSocket, input: ShotInput) {
    if (!this.match) return;
    const shooter = this.seats.find((s) => s.ws === ws);
    // Reject out-of-turn shots — the room is authoritative on turn order.
    if (
      !shooter ||
      shooter.player.address.toLowerCase() !== this.currentAddress()?.toLowerCase()
    ) {
      this.send(ws, { t: 'error', message: 'not your turn' });
      return;
    }

    const applied = applyShot(this.match, input);
    this.match = applied.match;
    const turn = this.match.shots;

    this.broadcast({
      t: 'resolved',
      turn,
      // Full authoritative match (board + turn + phase) so BOTH clients snap
      // their turn state — not just the shooter's locally-applied copy.
      finalState: this.match,
      events: applied.result.events.map((e) =>
        e.type === 'pot'
          ? { type: 'pot', ball: e.ball, pocket: e.pocket }
          : e.type === 'collision'
            ? { type: 'collision', a: e.a, b: e.b }
            : e.type === 'cushion'
              ? { type: 'cushion', ball: e.ball }
              : { type: 'turn-pass' },
      ),
      nextTurn: this.currentAddress() ?? this.seats[0].player.address,
    });

    if (this.match.turn.winner !== null) {
      this.endMatch();
    } else {
      this.broadcast({
        t: 'turn',
        turnAddress: this.currentAddress() ?? this.seats[0].player.address,
        ballInHand: this.match.turn.ballInHand,
      });
    }
  }

  private onStateHash(turn: number, hash: string) {
    if (!this.match) return;
    // Diagnostic only: compare client's board hash to ours.
    const ours = hashState(this.match.board);
    if (turn === this.match.shots && hash !== ours) {
      console.warn(`[desync] room=${this.roomId} turn=${turn} client=${hash} server=${ours}`);
      this.broadcast({ t: 'desync', turn });
    }
  }

  private endMatch() {
    if (!this.match || this.match.turn.winner === null) return;
    const winnerIdx = this.match.turn.winner;
    const winner = this.seats[winnerIdx].player.address;
    const loser = this.seats[winnerIdx === 0 ? 1 : 0].player.address;

    this.finalPayload = {
      kind: 'result',
      matchId: this.roomId,
      winner,
      loser,
      rackSeed: this.match.rackSeed,
      shots: this.match.shots,
      finishedAt: Date.now(),
    };

    this.broadcast({
      t: 'gameover',
      winner,
      loser,
      reason: this.match.turn.reason ?? 'win',
      resultPayload: this.finalPayload,
    });

    // Give clients a window to return both signatures; otherwise self-adjudicate.
    this.state.waitUntil(
      (async () => {
        await new Promise((r) => setTimeout(r, 15_000));
        await this.settle();
      })(),
    );
  }

  private async onSignResult(signed: Signed<ResultPayload>) {
    if (!this.finalPayload) return;
    // Determine which participant signed.
    for (const seat of this.seats) {
      const addr = seat.player.address;
      const ok = await verifyResult(signed.payload, signed.signature, addr).catch(() => false);
      if (ok && sameResult(signed.payload, this.finalPayload)) {
        this.signatures.set(addr.toLowerCase(), signed);
        break;
      }
    }
    if (this.signatures.size === 2) await this.settle();
  }

  private async settle() {
    if (this.written || !this.finalPayload) return;
    this.written = true;

    const bothSigned = this.signatures.size === 2;
    await recordResult(this.env.STATS, {
      payload: this.finalPayload,
      players: this.seats.map((s) => s.player),
      disputed: !bothSigned, // server-adjudicated from its own authoritative sim
    });
  }

  private onResign(ws: WebSocket) {
    if (!this.match || this.match.turn.winner !== null) return;
    const loserSeat = this.seats.find((s) => s.ws === ws);
    if (!loserSeat) return;
    const winnerSeat = this.seats.find((s) => s.ws !== ws) ?? this.seats[0];
    this.match.turn.winner = (this.seats.indexOf(winnerSeat) as 0 | 1) ?? 0;
    this.match.turn.reason = 'opponent resigned';
    this.endMatch();
  }

  private onLeave(ws: WebSocket) {
    const idx = this.seats.findIndex((s) => s.ws === ws);
    if (idx === -1) return;
    if (this.match && this.match.turn.winner === null && this.started) {
      // Treat mid-match disconnect as a resignation.
      this.onResign(ws);
    }
    this.broadcast({ t: 'opponent-left' });
  }

  private broadcast(msg: RoomServerMsg) {
    for (const s of this.seats) this.send(s.ws, msg);
  }
  private send(ws: WebSocket, msg: RoomServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closing */
    }
  }
}

function sameResult(a: ResultPayload, b: ResultPayload): boolean {
  return (
    a.matchId === b.matchId &&
    a.winner.toLowerCase() === b.winner.toLowerCase() &&
    a.loser.toLowerCase() === b.loser.toLowerCase() &&
    a.rackSeed === b.rackSeed &&
    a.shots === b.shots
  );
}

/** Must match the client's seedFromRoom so both rack the same balls. */
function seedFromRoom(roomId: string): number {
  let h = 0;
  for (let i = 0; i < roomId.length; i++) h = (Math.imul(31, h) + roomId.charCodeAt(i)) | 0;
  return h & 0xffff;
}
