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

const RANK_COLORS = ['text-brass-light', 'text-zinc-300', 'text-[#cd7f32]'];

/**
 * Leaderboard from the Worker. `preview` = compact top-5 for the landing page;
 * `full` = the /stats table. Guests rank normally by address.
 */
export function Leaderboard({ variant = 'full' }: { variant?: 'full' | 'preview' }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = variant === 'preview';

  useEffect(() => {
    fetchStats()
      .then((data: { leaderboard?: Row[] }) => setRows(data.leaderboard ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load'));
  }, []);

  if (error) {
    return (
      <p className="rounded-xl border border-ink-line bg-ink-card/50 p-6 text-sm text-zinc-500">
        Leaderboard unavailable. The stats service may be warming up.
      </p>
    );
  }
  if (!rows) {
    return (
      <div className="grid place-items-center py-12">
        <Spinner size={20} />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-ink-line/80 py-10 text-center">
        <p className="text-sm text-zinc-400">No matches recorded yet.</p>
        <p className="mt-1 text-xs text-zinc-600">Be the first to break and claim #1.</p>
      </div>
    );
  }

  const data = preview ? rows.slice(0, 5) : rows;

  if (preview) {
    return (
      <ul>
        <li className="flex items-center justify-between px-1 pb-2 text-[11px] uppercase tracking-wide text-zinc-600">
          <span>Player</span>
          <span className="flex gap-8">
            <span className="w-16 text-right">Wins</span>
            <span className="w-10 text-right">Win %</span>
          </span>
        </li>
        {data.map((r, i) => {
          const total = r.wins + r.losses;
          const pct = total ? Math.round((r.wins / total) * 100) : 0;
          return (
            <li
              key={r.address}
              className="flex items-center justify-between border-t border-ink-line/40 py-2.5"
            >
              <div className="flex items-center gap-3">
                <span className={`w-4 text-sm font-700 ${RANK_COLORS[i] ?? 'text-zinc-600'}`}>
                  {i + 1}
                </span>
                <Avatar address={r.address} avatar={r.avatar} size={30} />
                <span className="text-sm text-zinc-100">{r.ensName ?? truncate(r.address)}</span>
              </div>
              <span className="flex items-center gap-8">
                <span className="w-16 text-right text-sm text-zinc-200">{r.wins.toLocaleString()}</span>
                <span className="w-10 text-right text-sm text-sage-bright">{pct}%</span>
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-line bg-ink-card/50">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink-line text-left text-xs uppercase tracking-wide text-zinc-500">
            <th className="px-4 py-3">#</th>
            <th className="px-4 py-3">Player</th>
            <th className="px-4 py-3 text-right">Wins</th>
            <th className="px-4 py-3 text-right">Losses</th>
            <th className="px-4 py-3 text-right">Win %</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => {
            const total = r.wins + r.losses;
            const pct = total ? Math.round((r.wins / total) * 100) : 0;
            return (
              <tr key={r.address} className="border-b border-ink-line/50 last:border-0">
                <td className={`px-4 py-3 font-700 ${RANK_COLORS[i] ?? 'text-zinc-600'}`}>{i + 1}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar address={r.address} avatar={r.avatar} size={30} />
                    <span className="text-zinc-100">{r.ensName ?? truncate(r.address)}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-emerald-400">{r.wins}</td>
                <td className="px-4 py-3 text-right text-zinc-400">{r.losses}</td>
                <td className="px-4 py-3 text-right text-sage-bright">{pct}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
