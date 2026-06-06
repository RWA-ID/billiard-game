'use client';

import { WalletBar } from '@/components/WalletBar';
import { Leaderboard } from '@/components/Leaderboard';

export default function StatsPage() {
  return (
    <main className="min-h-screen">
      <WalletBar />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="font-display text-3xl font-700 tracking-tight text-zinc-50">Leaderboard</h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-400">
          Win/loss records from mutually-signed matches. Every result is signed by both players —
          you can't inflate wins without a real opponent. Guests rank by their address; ENS names
          just make you easier to recognize.
        </p>
        <div className="mt-6">
          <Leaderboard />
        </div>
      </div>
    </main>
  );
}
