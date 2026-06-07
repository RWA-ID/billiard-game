'use client';

import type { PlayerInfo } from '@/lib/net/protocol';
import { PlayerIdentity } from './PlayerIdentity';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Spinner } from './ui/Spinner';

/** Online-players list with challenge buttons. */
export function Lobby({
  players,
  connected,
  outgoing,
  onChallenge,
}: {
  players: PlayerInfo[];
  connected: boolean;
  outgoing: string | null;
  onChallenge: (address: `0x${string}`) => void;
}) {
  return (
    <section className="rounded-2xl border border-ink-line bg-ink-card/50 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-700 text-zinc-100">Lobby</h2>
        <span className="flex items-center gap-2 text-xs text-zinc-500">
          <span
            className={
              'h-2 w-2 rounded-full ' + (connected ? 'bg-emerald-400' : 'bg-zinc-600')
            }
          />
          {connected ? `${players.length} online` : 'connecting…'}
        </span>
      </div>

      <ul className="mt-4 divide-y divide-ink-line/60">
        {players.length === 0 && (
          <li className="py-8 text-center text-sm text-zinc-500">
            {connected ? 'No one else here yet — invite a friend to billiard.eth.' : 'Connecting to lobby…'}
          </li>
        )}
        {players.map((p) => {
          const isPending = outgoing?.toLowerCase() === p.address.toLowerCase();
          return (
            <li key={p.address} className="flex items-center justify-between gap-3 py-3">
              <PlayerIdentity
                address={p.address}
                ensName={p.ensName}
                avatar={p.avatar}
                size={36}
                nameClassName="text-sm font-medium text-zinc-100"
              />
              {isPending ? (
                <Badge tone="loading">
                  <Spinner size={11} /> waiting…
                </Badge>
              ) : (
                <Button variant="secondary" onClick={() => onChallenge(p.address)}>
                  Challenge
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
