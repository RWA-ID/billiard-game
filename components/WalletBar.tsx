'use client';

import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useIdentity } from '@/lib/wallet/useIdentity';
import { Avatar } from './Avatar';

/**
 * Top bar: brand + RainbowKit connect button + ENS identity display.
 * Guests (no ENS) get a subtle "Get an ENS name" link instead of a nag.
 */
export function WalletBar() {
  const { identity, isGuest } = useIdentity();

  return (
    <header className="sticky top-0 z-30 border-b border-charcoal-line/60 bg-[#0b0e0f]/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-felt text-brass-light shadow-felt">
            ⑧
          </span>
          <span className="font-display text-lg font-700 tracking-tight">billiard.eth</span>
        </Link>

        <div className="flex items-center gap-3">
          {identity && (
            <div className="hidden items-center gap-2 sm:flex">
              <Avatar address={identity.address} avatar={identity.avatar} size={26} />
              <span className="text-sm text-zinc-200">{identity.display}</span>
              {isGuest && (
                <Link
                  href="/?register=1"
                  className="text-xs text-brass-light/70 underline-offset-2 hover:underline"
                >
                  Get an ENS name
                </Link>
              )}
            </div>
          )}
          <Link href="/stats" className="text-sm text-zinc-400 hover:text-zinc-100">
            Leaderboard
          </Link>
          <ConnectButton
            accountStatus="avatar"
            chainStatus="none"
            showBalance={false}
          />
        </div>
      </div>
    </header>
  );
}
