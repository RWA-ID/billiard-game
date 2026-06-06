'use client';

import type { PlayerInfo } from '@/lib/net/protocol';
import { truncate } from '@/lib/ens/resolve';
import { Avatar } from './Avatar';
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
    <section className="rounded-2xl border border-charcoal-line bg-charcoal-card/50 p-5">
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

      <ul className="mt-4 divide-y divide-charcoal-line/60">
        {players.length === 0 && (
          <li className="py-8 text-center text-sm text-zinc-500">
            {connected ? 'No one else here yet — invite a friend to billiard.eth.' : 'Connecting to lobby…'}
          </li>
        )}
        {players.map((p) => {
          const isPending = outgoing?.toLowerCase() === p.address.toLowerCase();
          return (
            <li key={p.address} className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3">
                <Avatar address={p.address} avatar={p.avatar} size={36} />
                <div>
                  <p className="text-sm font-medium text-zinc-100">
                    {p.ensName ?? truncate(p.address)}
                  </p>
                  {p.ensName && (
                    <p className="font-mono text-xs text-zinc-500">{truncate(p.address)}</p>
                  )}
                </div>
              </div>
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
