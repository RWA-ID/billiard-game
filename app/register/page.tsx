'use client';

import Link from 'next/link';
import { WalletBar } from '@/components/WalletBar';
import { EnsNameCard } from '@/components/EnsNameCard';

/**
 * Standalone ENS registration + profile page. Always reachable (nav + the
 * "Get an ENS name" links across the app), independent of lobby state.
 */
export default function RegisterPage() {
  return (
    <main className="min-h-screen">
      <WalletBar />
      <div className="mx-auto max-w-3xl px-5 py-10">
        <div className="mb-6 text-center">
          <h1 className="font-serif text-4xl font-700 text-cream">Get your ENS identity</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
            Register a real <span className="text-sage-bright">.eth</span> name, set your avatar and
            records, and make it your primary name across billiard.eth. Totally optional — guests
            can still play and rank.
          </p>
        </div>

        <EnsNameCard />

        <p className="mt-6 text-center text-sm text-zinc-500">
          <Link href="/" className="text-sage-bright hover:underline">
            ← Back to the table
          </Link>
        </p>
      </div>
    </main>
  );
}
