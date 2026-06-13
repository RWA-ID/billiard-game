'use client';

import { useEffect, useState } from 'react';
import { fetchStats } from '@/lib/net/socket';
import { PlayerIdentity } from './PlayerIdentity';
import { Spinner } from './ui/Spinner';

type Row = {
  address: string;
  ensName: string | null;
  avatar?: string | null;
  wins: number;
  losses: number;
};

const RANK_COLORS = ['text-brass-light', 'text-zinc-300', 'text-[#cd7f32]'];

// Medal colors for the head-table preview: gold / silver / bronze, then muted.
const MEDAL = ['#d9a441', '#c9cdd2', '#b87333'];
const medal = (i: number) => MEDAL[i] ?? '#7d887f';

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
      <div>
        {/* Column header */}
        <div className="grid grid-cols-[32px_1fr_auto_auto] gap-3.5 border-b border-ink-line/70 pb-3 font-display text-[11px] uppercase tracking-[0.16em] text-[#7d887f]">
          <span>#</span>
          <span>Player</span>
          <span className="text-right">W–L</span>
          <span className="text-right">Win%</span>
        </div>
        {data.map((r, i) => {
          const total = r.wins + r.losses;
          const pct = total ? Math.round((r.wins / total) * 100) : 0;
          return (
            <div
              key={r.address}
              className="grid grid-cols-[32px_1fr_auto_auto] items-center gap-3.5 border-b border-ink-line/50 py-3 last:border-0"
            >
              <span className="font-serif text-lg leading-none" style={{ color: medal(i) }}>
                {i + 1}
              </span>
              <PlayerIdentity
                address={r.address}
                ensName={r.ensName}
                avatar={r.avatar}
                size={30}
                nameClassName="font-display text-[14.5px] font-500 text-[#e3e8e3]"
              />
              <span className="text-right font-display text-[13.5px] text-[#9aa69d]">
                {r.wins}–{r.losses}
              </span>
              <span className="text-right font-display text-[13.5px] font-600 text-brass-light">
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
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
                  <PlayerIdentity
                    address={r.address}
                    ensName={r.ensName}
                    avatar={r.avatar}
                    size={30}
                    nameClassName="text-zinc-100"
                  />
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
