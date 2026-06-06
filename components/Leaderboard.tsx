'use client';

import { useEffect, useState } from 'react';
import { fetchStats } from '@/lib/net/socket';
import { truncate } from '@/lib/ens/resolve';
import { Avatar } from './Avatar';
import { Spinner } from './ui/Spinner';

type Row = {
  address: string;
  ensName: string | null;
  avatar?: string | null;
  wins: number;
  losses: number;
};

/** Read-only leaderboard from the Worker. Guests rank normally by address. */
export function Leaderboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStats()
      .then((data: { leaderboard?: Row[] }) => setRows(data.leaderboard ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load'));
  }, []);

  if (error) {
    return (
      <p className="rounded-xl border border-charcoal-line bg-charcoal-card/50 p-6 text-sm text-zinc-400">
        Leaderboard unavailable ({error}). The stats Worker may not be deployed yet.
      </p>
    );
  }
  if (!rows) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner size={22} />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-charcoal-line bg-charcoal-card/50">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-charcoal-line text-left text-xs uppercase tracking-wide text-zinc-500">
            <th className="px-4 py-3">#</th>
            <th className="px-4 py-3">Player</th>
            <th className="px-4 py-3 text-right">Wins</th>
            <th className="px-4 py-3 text-right">Losses</th>
            <th className="px-4 py-3 text-right">Win %</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-zinc-500">
                No matches recorded yet. Be the first to break.
              </td>
            </tr>
          )}
          {rows.map((r, i) => {
            const total = r.wins + r.losses;
            const pct = total ? Math.round((r.wins / total) * 100) : 0;
            return (
              <tr key={r.address} className="border-b border-charcoal-line/50 last:border-0">
                <td className="px-4 py-3 font-mono text-zinc-500">{i + 1}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar address={r.address} avatar={r.avatar} size={30} />
                    <span className="text-zinc-100">{r.ensName ?? truncate(r.address)}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-emerald-400">{r.wins}</td>
                <td className="px-4 py-3 text-right text-zinc-400">{r.losses}</td>
                <td className="px-4 py-3 text-right text-brass-light">{pct}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
