'use client';

import Link from 'next/link';
import { useIdentity } from '@/lib/wallet/useIdentity';
import { Avatar } from './Avatar';
import { ConnectWallet } from './ConnectWallet';

/**
 * Top bar: brand + Reown AppKit connect button + ENS identity display.
 * Guests (no ENS) get a subtle "Get an ENS name" link instead of a nag.
 */
export function WalletBar() {
  const { identity, isGuest } = useIdentity();

  return (
    <header className="sticky top-0 z-30 border-b border-ink-line/60 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-felt-light to-felt-dark ring-1 ring-sage/20">
            <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-ink text-[9px] font-700 text-cream">
              8
            </span>
          </span>
          <span className="font-serif text-lg font-700 tracking-tight text-cream">
            billiard<span className="text-sage-bright">.eth</span>
          </span>
        </Link>

        <div className="flex items-center gap-3">
          {identity && (
            <div className="hidden items-center gap-2 sm:flex">
              <Avatar address={identity.address} avatar={identity.avatar} size={26} />
              <span className="text-sm text-zinc-200">{identity.display}</span>
              {isGuest && (
                <Link
                  href="/?register=1"
                  className="text-xs text-sage-bright/70 underline-offset-2 hover:underline"
                >
                  Get an ENS name
                </Link>
              )}
            </div>
          )}
          <Link href="/profile" className="hidden text-sm text-zinc-400 hover:text-zinc-100 sm:block">
            Profile
          </Link>
          <Link href="/stats" className="text-sm text-zinc-400 hover:text-zinc-100">
            Leaderboard
          </Link>
          <ConnectWallet />
        </div>
      </div>
    </header>
  );
}
