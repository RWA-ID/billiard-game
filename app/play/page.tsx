'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { truncate } from '@/lib/ens/resolve';
import type { Matched, ResultPayload } from '@/lib/net/protocol';

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

  const { connected, last, sendShot, sendStateHash, sendSignedResult } = useRoom(identity, ctx);

  // Load the match context the lobby stashed (or fall back to local hot-seat).
  useEffect(() => {
    const raw = sessionStorage.getItem('billiard.match');
    if (raw) {
      const parsed = JSON.parse(raw) as Matched;
      setCtx(parsed);
      // Deterministic rack seed shared by both clients via the room id.
      const seed = seedFromRoom(parsed.roomId);
      setMatch(newMatch(seed, parsed.youBreak ? 0 : 1));
    } else {
      // No context: local hot-seat for physics/rules validation.
      setMatch(newMatch(Date.now() & 0xffff, 0));
    }
  }, []);

  // My player index: breaker = 0.
  const myIndex: 0 | 1 = ctx ? (ctx.youBreak ? 0 : 1) : 0;
  const hotSeat = !ctx;
  const myTurn = !!match && match.phase !== 'over' && (hotSeat || match.turn.current === myIndex);

  // Reconcile to the DO's authoritative board when it resolves a shot.
  useEffect(() => {
    if (!last || !match) return;
    if (last.t === 'resolved') {
      // The DO ran the canonical sim; snap our board to it.
      // (finalState shape matches GameState — typed as unknown over the wire.)
      const auth = last.finalState as Match['board'];
      setMatch((m) => (m ? { ...m, board: auth } : m));
    } else if (last.t === 'gameover') {
      void offerSignResult(last.resultPayload);
    } else if (last.t === 'opponent-left') {
      setStatus('Opponent left the table.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last]);

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

    if (applied.match.turn.winner !== null) {
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
    return myTurn ? 'Your shot' : "Opponent's shot";
  }, [match, myTurn, hotSeat]);

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
                    ? `vs ${ctx.opponent.ensName ?? truncate(ctx.opponent.address)} · ${
                        connected ? 'connected' : 'connecting…'
                      }`
                    : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {match && <GroupBadges match={match} myIndex={myIndex} hotSeat={hotSeat} />}
            <Button variant="ghost" onClick={() => router.push('/')}>
              Leave
            </Button>
          </div>
        </div>

        {match && <PoolCanvas board={match.board} myTurn={myTurn} onShoot={onShoot} />}

        {status && (
          <p className="mt-3 text-center text-sm text-brass-light">{status}</p>
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
