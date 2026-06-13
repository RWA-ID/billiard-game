'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSignMessage } from 'wagmi';
import type { Address } from 'viem';
import { WalletBar } from '@/components/WalletBar';
import { PoolCanvas, type RemoteShot } from '@/components/PoolCanvas';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/Avatar';
import { Spinner } from '@/components/ui/Spinner';
import { ChatPanel } from '@/components/ChatPanel';
import { clsx } from '@/components/ui/clsx';
import { useXmtp } from '@/lib/xmtp/useXmtp';
import { useIdentity } from '@/lib/wallet/useIdentity';
import { useRoom } from '@/lib/net/useRoom';
import { applyShot, newMatch, placeCueBall, type Match } from '@/lib/game/state';
import { hashState, type ShotInput } from '@/lib/game/physics';
import { resultMessage } from '@/lib/crypto/sign';
import { useEnsProfile } from '@/lib/ens/useEnsProfile';
import { isMuted, setMuted, sfxLose, sfxWin, unlockAudio } from '@/lib/sound/sfx';
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
  const [remoteShot, setRemoteShot] = useState<RemoteShot | null>(null);
  const [muted, setMutedState] = useState(true);
  // Result overlay is delayed so the winning shot finishes animating first.
  const [overlayReady, setOverlayReady] = useState(false);
  const lastShotAtRef = useRef(0);

  // Latest message handler, read from a ref so useRoom never re-subscribes.
  const handlerRef = useRef<(msg: RoomServerMsg) => void>(() => {});
  const { connected, sendShot, sendPlaceCue, sendStateHash, sendSignedResult, resign } = useRoom(
    identity,
    ctx,
    (msg) => handlerRef.current(msg),
  );
  const [calledPocket, setCalledPocket] = useState<number | null>(null);

  // In-match XMTP chat with the opponent (multiplayer only).
  const { enable, ready: chatReady, connecting: chatConnecting, error: chatError, openConversation } =
    useXmtp();

  // Sound preference + unlock on the first gesture anywhere on the page, so
  // the waiting (non-shooting) player hears the opponent's break too.
  useEffect(() => {
    setMutedState(isMuted());
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

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
  // Show the docked chat sidebar only in a real (multiplayer) match.
  const showSidebar = !hotSeat && !!ctx;
  // In multiplayer, don't allow a shot until the DO has confirmed both players
  // joined (the `start` message) — otherwise the breaker could fire into a room
  // the opponent hasn't entered yet, and the shot would be dropped server-side.
  const myTurn =
    !!match &&
    match.phase !== 'over' &&
    (hotSeat || (started && match.turn.current === myIndex));

  // On the 8-ball? (my group assigned and fully cleared) — then I must call a
  // pocket. Ball-in-hand: I fouled-against, so I place the cue ball first.
  const myGroup = match && !match.turn.open ? match.turn.groups[myIndex] : null;
  const onEight =
    !!myGroup &&
    !!match &&
    match.board.balls.filter((b) => inGroup(b.id, myGroup) && !b.potted).length === 0;
  const ballInHand = myTurn && !!match?.turn.ballInHand;
  const needCall = myTurn && !ballInHand && onEight;

  // Clear a stale called pocket whenever it no longer applies.
  useEffect(() => {
    if (!needCall) setCalledPocket(null);
  }, [needCall]);

  function placeCue(x: number, y: number) {
    if (!match) return;
    setMatch(placeCueBall(match, x, y));
    if (!hotSeat) sendPlaceCue(x, y);
  }

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
      // If the OPPONENT shot, replay the deterministic sim as an animation
      // (PoolCanvas snaps to the authoritative board when it finishes).
      if (
        msg.input &&
        msg.by &&
        identity &&
        msg.by.toLowerCase() !== identity.address.toLowerCase()
      ) {
        lastShotAtRef.current = Date.now();
        setRemoteShot({ input: msg.input, seq: msg.turn });
      }
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
    setCalledPocket(null);
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
  const youWon = over && match && ctx && match.turn.winner === myIndex;

  // Let a just-animated winning shot play out before covering the table.
  useEffect(() => {
    if (!over) {
      setOverlayReady(false);
      return;
    }
    const sinceShot = Date.now() - lastShotAtRef.current;
    const delay = sinceShot < 1500 ? 2600 : 450;
    const t = setTimeout(() => {
      setOverlayReady(true);
      if (hotSeat || youWon) sfxWin();
      else sfxLose();
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over]);

  const turnLabel = useMemo(() => {
    if (!match) return '';
    if (match.phase === 'over') return 'Match over';
    if (hotSeat) return `Player ${match.turn.current + 1} to shoot`;
    if (!started) return 'Waiting for opponent…';
    return myTurn ? 'Your shot' : "Opponent's shot";
  }, [match, myTurn, hotSeat, started]);

  const oppActive = !!match && match.phase !== 'over' && !myTurn && (started || hotSeat);

  return (
    <main className="min-h-screen">
      <WalletBar />
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
        {/* ── Scoreboard ── */}
        <div className="mb-4 grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 sm:gap-4">
          <PlayerCard
            name={hotSeat ? 'Player 1' : (identity?.display ?? 'You')}
            address={hotSeat ? '0xP1' : (identity?.address ?? '0xP1')}
            avatar={hotSeat ? null : identity?.avatar}
            active={hotSeat ? match?.turn.current === 0 : myTurn}
            match={match}
            seat={hotSeat ? 0 : myIndex}
          />

          <div className="flex flex-col items-center justify-center gap-1.5 px-1">
            <span
              className={clsx(
                'whitespace-nowrap rounded-full border px-3 py-1 text-xs font-600 sm:px-4 sm:text-sm',
                myTurn
                  ? 'border-sage/50 bg-sage/10 text-sage-bright shadow-sage'
                  : !started && !hotSeat && !over
                    ? 'animate-glow border-brass/40 bg-brass/5 text-brass-light'
                    : 'border-ink-line bg-ink-card/70 text-zinc-300',
              )}
            >
              {turnLabel}
            </span>
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              {!hotSeat && (
                <span className="flex items-center gap-1">
                  <span
                    className={clsx(
                      'h-1.5 w-1.5 rounded-full',
                      connected ? 'bg-sage-bright' : 'bg-brass animate-glow',
                    )}
                  />
                  {connected ? 'live' : 'connecting…'}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  unlockAudio();
                  const next = !muted;
                  setMuted(next);
                  setMutedState(next);
                }}
                className="rounded p-0.5 text-zinc-400 transition hover:text-zinc-100"
                aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
                title={muted ? 'Unmute sounds' : 'Mute sounds'}
              >
                {muted ? <MutedIcon /> : <SoundIcon />}
              </button>
              <button
                type="button"
                onClick={leaveTable}
                className="text-zinc-400 underline-offset-2 transition hover:text-zinc-100 hover:underline"
              >
                Leave
              </button>
            </div>
          </div>

          <PlayerCard
            right
            name={hotSeat ? 'Player 2' : opponentName || 'Opponent'}
            address={hotSeat ? '0xP2' : (ctx?.opponent.address ?? '0xP2')}
            avatar={hotSeat ? null : ctx?.opponent.avatar}
            active={hotSeat ? match?.turn.current === 1 : oppActive}
            match={match}
            seat={hotSeat ? 1 : myIndex === 0 ? 1 : 0}
          />
        </div>

        {needCall && (
          <div className="mb-3 rounded-xl border border-sage/40 bg-sage/5 px-3 py-2 text-center text-sm font-600 text-sage-bright">
            {calledPocket == null
              ? 'You’re on the 8 — tap a pocket on the table to call it, then shoot.'
              : `Calling the ${POCKET_LABELS[calledPocket]} pocket — take your shot.`}
          </div>
        )}

        <div
          className={clsx(
            'grid items-start gap-4',
            showSidebar && 'lg:grid-cols-[minmax(0,1fr)_280px]',
          )}
        >
          {/* Table column */}
          <div className="min-w-0">
            {match && (
              <PoolCanvas
                board={match.board}
                myTurn={myTurn}
                onShoot={onShoot}
                ballInHand={ballInHand}
                onPlaceCue={placeCue}
                needCall={needCall}
                calledPocket={calledPocket}
                onCallPocket={setCalledPocket}
                remoteShot={remoteShot}
              />
            )}

            {status && (
              <p key={status} className="toast-in mt-3 text-center text-sm text-brass-light">
                {status}
              </p>
            )}
          </div>

          {/* Chat column — docked to the right of the table (multiplayer only). */}
          {showSidebar && (
            <aside className="lg:h-full lg:min-h-[420px]">
              {chatReady ? (
                <ChatPanel
                  compact
                  peer={{
                    address: ctx.opponent.address as Address,
                    display: opponentName || 'Opponent',
                    avatar: ctx.opponent.avatar ?? null,
                  }}
                  openConversation={openConversation}
                />
              ) : (
                <div className="flex h-full min-h-[320px] flex-col rounded-2xl border border-ink-line bg-ink-card/60 p-5 text-center">
                  <div className="flex items-center gap-2 text-left">
                    <ChatIcon />
                    <span className="text-sm font-600 text-zinc-200">Match chat</span>
                  </div>
                  <div className="flex flex-1 flex-col items-center justify-center">
                    <p className="text-sm text-zinc-400">
                      Chat with your opponent, end-to-end encrypted over{' '}
                      <span className="text-sage-bright">XMTP</span>. Enable once with a signature.
                    </p>
                    <div className="mt-4">
                      <Button onClick={() => void enable()} disabled={chatConnecting}>
                        {chatConnecting ? (
                          <>
                            <Spinner size={14} /> Enabling…
                          </>
                        ) : (
                          'Enable chat'
                        )}
                      </Button>
                    </div>
                    {chatError && <p className="mt-2 text-xs text-red-400">{chatError}</p>}
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>

        {opponentLeft && !over && (
          <div className="overlay-in mt-6 grid place-items-center rounded-2xl border border-brass/30 bg-ink-card/80 p-8 text-center shadow-brass backdrop-blur">
            <p className="font-display text-2xl font-700 text-zinc-50">Opponent left</p>
            <p className="mt-1 text-sm text-zinc-400">
              Your opponent disconnected from the table.
            </p>
            <div className="mt-5">
              <Button onClick={() => router.push('/')}>Back to lobby</Button>
            </div>
          </div>
        )}

        {over && overlayReady && (
          <div className="overlay-in mt-6 grid place-items-center rounded-2xl border border-ink-line bg-ink-card/80 p-8 text-center shadow-card backdrop-blur">
            <span
              className={clsx(
                'grid h-16 w-16 place-items-center rounded-full text-3xl',
                hotSeat || youWon
                  ? 'bg-sage/15 ring-2 ring-sage/50 shadow-sage'
                  : 'bg-ink ring-2 ring-ink-line',
              )}
            >
              {hotSeat || youWon ? '🏆' : '🎱'}
            </span>
            <p className="mt-4 font-serif text-3xl text-cream">
              {hotSeat
                ? `Player ${(match!.turn.winner ?? 0) + 1} wins`
                : youWon
                  ? 'You win'
                  : 'You lost'}
            </p>
            <p className="mt-1 text-sm text-zinc-400">{match!.turn.reason}</p>
            <div className="mt-6 flex gap-2">
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

// ── Scoreboard player card ──────────────────────────────────────────────────
function PlayerCard({
  name,
  address,
  avatar,
  active,
  match,
  seat,
  right = false,
}: {
  name: string;
  address: string;
  avatar?: string | null;
  active?: boolean;
  match: Match | null;
  seat: 0 | 1;
  right?: boolean;
}) {
  const group = match && !match.turn.open ? match.turn.groups[seat] : null;
  const remaining = group
    ? match!.board.balls.filter((b) => inGroup(b.id, group) && !b.potted).map((b) => b.id)
    : null;
  const onEight = remaining !== null && remaining.length === 0;

  return (
    <div
      className={clsx(
        'flex min-w-0 items-center gap-2.5 rounded-2xl border bg-ink-card/70 px-3 py-2 transition-all sm:px-4 sm:py-2.5',
        right && 'flex-row-reverse text-right',
        active ? 'border-sage/60 shadow-sage' : 'border-ink-line',
      )}
    >
      <span className={clsx('relative shrink-0', active && 'turn-ring rounded-full')}>
        <Avatar address={address} avatar={avatar} size={36} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-600 text-zinc-100">{name}</p>
        <div
          className={clsx(
            'mt-1 flex items-center gap-1',
            right && 'flex-row-reverse',
          )}
        >
          {remaining === null ? (
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">
              {match?.turn.open ? 'open table' : '—'}
            </span>
          ) : onEight ? (
            <>
              <BallDot id={8} />
              <span className="text-[10px] uppercase tracking-wide text-brass-light">on the 8</span>
            </>
          ) : (
            <>
              <span className="text-[10px] uppercase tracking-wide text-zinc-500">{group}</span>
              {remaining.map((id) => (
                <BallDot key={id} id={id} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const BALL_HEX: Record<number, string> = {
  1: '#e8b00a',
  2: '#1d4fc4',
  3: '#cc2418',
  4: '#522a8c',
  5: '#e06a14',
  6: '#187a40',
  7: '#8c2030',
  8: '#14171a',
};

function BallDot({ id }: { id: number }) {
  const stripe = id >= 9;
  const hue = BALL_HEX[stripe ? id - 8 : id] ?? '#cc2418';
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/40"
      style={{
        background: stripe
          ? `linear-gradient(to bottom, #f4f0e5 22%, ${hue} 22%, ${hue} 78%, #f4f0e5 78%)`
          : hue,
      }}
      title={`${id}`}
    />
  );
}

function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 5h16v10H8l-4 4V5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SoundIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path
        d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function MutedIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path d="m16 9 6 6m0-6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
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

// Pocket index → human label, matching physics.POCKETS order.
const POCKET_LABELS = [
  'top-left',
  'top-middle',
  'top-right',
  'bottom-left',
  'bottom-middle',
  'bottom-right',
];

function inGroup(id: number, group: 'solids' | 'stripes' | null): boolean {
  if (!group) return false;
  return group === 'solids' ? id >= 1 && id <= 7 : id >= 9 && id <= 15;
}

/** Deterministic 16-bit rack seed from a room id (both clients agree). */
function seedFromRoom(roomId: string): number {
  let h = 0;
  for (let i = 0; i < roomId.length; i++) h = (Math.imul(31, h) + roomId.charCodeAt(i)) | 0;
  return h & 0xffff;
}
