'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSignMessage } from 'wagmi';
import { WalletBar } from '@/components/WalletBar';
import { PoolCanvas } from '@/components/PoolCanvas';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/Avatar';
import { useIdentity } from '@/lib/wallet/useIdentity';
import { useRoom } from '@/lib/net/useRoom';
import { applyShot, newMatch, type Match } from '@/lib/game/state';
import { hashState, type ShotInput } from '@/lib/game/physics';
import { resultMessage } from '@/lib/crypto/sign';
import { useEnsProfile } from '@/lib/ens/useEnsProfile';
import type { Matched, ResultPayload, RoomServerMsg } from '@/lib/net/protocol';

/**
 * Match screen. Reads the matched context stashed by the lobby. Maintains a
 * local Match (validates physics + rules, deliverable §10.3) and relays shot
 * inputs to the GameRoom DO, which is authoritative for outcomes; the client
 * reconciles to the DO's `resolved` board and signs the final result.
 */
export default function PlayPage() {
  const router = useRouter();
  const { identity } = useIdentity();
  const { signMessageAsync } = useSignMessage();

  const [ctx, setCtx] = useState<Matched | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [status, setStatus] = useState('');
  const [opponentLeft, setOpponentLeft] = useState(false);
  const [started, setStarted] = useState(false);

  // Latest message handler, read from a ref so useRoom never re-subscribes.
  const handlerRef = useRef<(msg: RoomServerMsg) => void>(() => {});
  const { connected, sendShot, sendStateHash, sendSignedResult, resign } = useRoom(
    identity,
    ctx,
    (msg) => handlerRef.current(msg),
  );

  // Load the match context the lobby stashed (or fall back to local hot-seat).
  useEffect(() => {
    const raw = sessionStorage.getItem('billiard.match');
    if (raw) {
      const parsed = JSON.parse(raw) as Matched;
      setCtx(parsed);
      // Deterministic rack seed shared by both clients via the room id.
      // Seat 0 ALWAYS breaks (the DO seats the lobby's breaker as seat 0); the
      // breaker vs. waiter distinction comes from myIndex, not the rack.
      const seed = seedFromRoom(parsed.roomId);
      setMatch(newMatch(seed, 0));
    } else {
      // No context: local hot-seat for physics/rules validation.
      setMatch(newMatch(Date.now() & 0xffff, 0));
    }
  }, []);

  // My player index: breaker = 0.
  const myIndex: 0 | 1 = ctx ? (ctx.youBreak ? 0 : 1) : 0;
  const hotSeat = !ctx;
  // In multiplayer, don't allow a shot until the DO has confirmed both players
  // joined (the `start` message) — otherwise the breaker could fire into a room
  // the opponent hasn't entered yet, and the shot would be dropped server-side.
  const myTurn =
    !!match &&
    match.phase !== 'over' &&
    (hotSeat || (started && match.turn.current === myIndex));

  // Resolve the opponent's ENS name (fallback if the lobby didn't carry one).
  const opp = useEnsProfile(ctx && !ctx.opponent.ensName ? ctx.opponent.address : null);
  const opponentName = ctx ? (ctx.opponent.ensName ?? opp.display) : '';

  // Leaving mid-match counts as a resignation — tell the DO before we close the
  // socket so the opponent gets notified immediately, then navigate.
  function leaveTable() {
    if (!hotSeat && match && match.phase !== 'over') resign();
    router.push('/');
  }

  // Reconcile to the DO's authoritative messages. Assigned every render so the
  // closure sees the latest identity/myIndex; useRoom calls it via handlerRef.
  handlerRef.current = (msg: RoomServerMsg) => {
    if (msg.t === 'start') {
      // Both players are in the room; the DO has racked. Enable input.
      setStarted(true);
    } else if (msg.t === 'resolved') {
      // The DO ran the canonical sim and sends the WHOLE match, so both clients
      // snap their turn state — this is what fixes the post-foul turn desync.
      const auth = msg.finalState as Match;
      setStarted(true); // a resolved snapshot also confirms the match is live
      setMatch(auth);
    } else if (msg.t === 'gameover') {
      // Drive the local match to "over" so the result overlay shows on the
      // client that didn't make the winning move (incl. opponent resignations).
      const iWon = msg.winner.toLowerCase() === identity?.address.toLowerCase();
      const winnerIdx: 0 | 1 = iWon ? myIndex : myIndex === 0 ? 1 : 0;
      setMatch((m) =>
        m ? { ...m, phase: 'over', turn: { ...m.turn, winner: winnerIdx, reason: msg.reason } } : m,
      );
      void offerSignResult(msg.resultPayload);
    } else if (msg.t === 'opponent-left') {
      setOpponentLeft(true);
      setStatus('Your opponent left the table.');
    }
  };

  function onShoot(input: ShotInput) {
    if (!match) return;
    // Local authority for hot-seat / optimistic update; relay to DO otherwise.
    const applied = applyShot(match, input);
    setMatch(applied.match);
    setStatus(applied.foul ? `Foul: ${applied.foulReason}` : '');

    if (!hotSeat) {
      sendShot(input);
      // Diagnostic desync detector — DO compares against its own sim.
      sendStateHash(applied.match.shots, hashState(applied.match.board));
    }

    // Hot-seat is its own authority; in multiplayer the DO drives `gameover`
    // (signing there) so we don't double-prompt for a signature.
    if (hotSeat && applied.match.turn.winner !== null) {
      const payload = buildResult(applied.match, ctx);
      void offerSignResult(payload);
    }
  }

  async function offerSignResult(payload: ResultPayload) {
    try {
      const signature = await signMessageAsync({ message: resultMessage(payload) });
      if (!hotSeat) sendSignedResult({ payload, signature });
      setStatus(
        payload.winner.toLowerCase() === identity?.address.toLowerCase()
          ? 'You win! Result signed.'
          : 'Match over. Result signed.',
      );
    } catch {
      setStatus('Result not signed (you can still leave).');
    }
  }

  const over = match?.phase === 'over';
  const youWon =
    over && match && ctx && match.turn.winner === myIndex;

  const turnLabel = useMemo(() => {
    if (!match) return '';
    if (match.phase === 'over') return 'Match over';
    if (hotSeat) return `Player ${match.turn.current + 1} to shoot`;
    if (!started) return 'Waiting for opponent…';
    return myTurn ? 'Your shot' : "Opponent's shot";
  }, [match, myTurn, hotSeat, started]);

  return (
    <main className="min-h-screen">
      <WalletBar />
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Match header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {identity && <Avatar address={identity.address} avatar={identity.avatar} size={34} />}
            <div>
              <p className="font-display font-700 text-zinc-100">{turnLabel}</p>
              <p className="text-xs text-zinc-500">
                {hotSeat
                  ? 'Local practice table'
                  : ctx
                    ? `vs ${opponentName} · ${connected ? 'connected' : 'connecting…'}`
                    : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {match && <GroupBadges match={match} myIndex={myIndex} hotSeat={hotSeat} />}
            <Button variant="ghost" onClick={leaveTable}>
              Leave
            </Button>
          </div>
        </div>

        {match && <PoolCanvas board={match.board} myTurn={myTurn} onShoot={onShoot} />}

        {status && (
          <p className="mt-3 text-center text-sm text-brass-light">{status}</p>
        )}

        {opponentLeft && !over && (
          <div className="mt-6 grid place-items-center rounded-2xl border border-brass/30 bg-ink-card/70 p-8 text-center shadow-brass">
            <p className="font-display text-2xl font-700 text-zinc-50">Opponent left</p>
            <p className="mt-1 text-sm text-zinc-400">
              Your opponent disconnected from the table.
            </p>
            <div className="mt-5">
              <Button onClick={() => router.push('/')}>Back to lobby</Button>
            </div>
          </div>
        )}

        {over && (
          <div className="mt-6 grid place-items-center rounded-2xl border border-brass/30 bg-ink-card/70 p-8 text-center shadow-brass">
            <p className="font-display text-2xl font-700 text-zinc-50">
              {hotSeat
                ? `Player ${(match!.turn.winner ?? 0) + 1} wins`
                : youWon
                  ? 'You win 🎉'
                  : 'You lost'}
            </p>
            <p className="mt-1 text-sm text-zinc-400">{match!.turn.reason}</p>
            <div className="mt-5 flex gap-2">
              <Button onClick={() => router.push('/')}>Back to lobby</Button>
              <Button variant="secondary" onClick={() => router.push('/stats')}>
                Leaderboard
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function GroupBadges({
  match,
  myIndex,
  hotSeat,
}: {
  match: Match;
  myIndex: 0 | 1;
  hotSeat: boolean;
}) {
  if (match.turn.open) return <Badge tone="neutral">open table</Badge>;
  const mine = match.turn.groups[myIndex];
  return <Badge tone="neutral">{hotSeat ? 'groups assigned' : `you: ${mine}`}</Badge>;
}

function buildResult(match: Match, ctx: Matched | null): ResultPayload {
  // Winner/loser addresses depend on match context; hot-seat uses placeholders.
  const winnerIdx = match.turn.winner ?? 0;
  const me = ctx?.opponent.address ?? '0x0000000000000000000000000000000000000000';
  return {
    kind: 'result',
    matchId: ctx?.roomId ?? 'local',
    winner: (winnerIdx === 0 ? me : ctx?.opponent.address ?? me) as `0x${string}`,
    loser: (winnerIdx === 0 ? ctx?.opponent.address ?? me : me) as `0x${string}`,
    rackSeed: match.rackSeed,
    shots: match.shots,
    finishedAt: Date.now(),
  };
}

/** Deterministic 16-bit rack seed from a room id (both clients agree). */
function seedFromRoom(roomId: string): number {
  let h = 0;
  for (let i = 0; i < roomId.length; i++) h = (Math.imul(31, h) + roomId.charCodeAt(i)) | 0;
  return h & 0xffff;
}
