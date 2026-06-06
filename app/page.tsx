'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { WalletBar } from '@/components/WalletBar';
import { Lobby } from '@/components/Lobby';
import { EnsPrompt } from '@/components/EnsPrompt';
import { EnsRegister } from '@/components/EnsRegister';
import { ChallengeModal } from '@/components/ChallengeModal';
import { useIdentity } from '@/lib/wallet/useIdentity';
import { useLobby } from '@/lib/net/useLobby';

export default function Home() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { identity, isGuest } = useIdentity();
  const { players, incoming, outgoing, matched, connected, challenge, accept, decline } =
    useLobby(identity);
  const [showRegister, setShowRegister] = useState(false);

  // Deep link ?register=1 opens the registration panel.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('register') === '1') {
      setShowRegister(true);
    }
  }, []);

  // On match, stash the match context and go to the table.
  useEffect(() => {
    if (matched) {
      sessionStorage.setItem('billiard.match', JSON.stringify(matched));
      router.push('/play');
    }
  }, [matched, router]);

  return (
    <main className="min-h-screen">
      <WalletBar />

      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Hero */}
        <section className="mb-8">
          <h1 className="font-display text-4xl font-700 tracking-tight text-zinc-50 sm:text-5xl">
            Online 8-ball, <span className="text-brass-light">on-chain identity</span>.
          </h1>
          <p className="mt-3 max-w-xl text-zinc-400">
            Connect a wallet, play with your ENS name, challenge anyone in the lobby in real time.
            Free to play — wins and losses are signed by both players and tracked on the leaderboard.
            Hosted on IPFS at <span className="text-brass-light">billiard.eth</span>.
          </p>
        </section>

        {!isConnected ? (
          <div className="grid place-items-center rounded-2xl border border-charcoal-line bg-charcoal-card/50 py-20">
            <div className="text-center">
              <p className="mb-4 text-zinc-300">Connect a wallet to enter the lobby.</p>
              <div className="inline-block">
                <ConnectButton chainStatus="none" showBalance={false} />
              </div>
              <p className="mt-3 text-xs text-zinc-500">No WalletConnect — injected wallets only.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="space-y-6">
              <Lobby
                players={players}
                connected={connected}
                outgoing={outgoing}
                onChallenge={challenge}
              />
            </div>

            <aside className="space-y-6">
              {isGuest && !showRegister && (
                <EnsPrompt visible onRegister={() => setShowRegister(true)} />
              )}
              {showRegister && (
                <EnsRegister
                  onDone={() => {
                    setShowRegister(false);
                  }}
                />
              )}
              <HowItWorks />
            </aside>
          </div>
        )}
      </div>

      <ChallengeModal incoming={incoming} onAccept={accept} onDecline={decline} />
    </main>
  );
}

function HowItWorks() {
  return (
    <div className="rounded-2xl border border-charcoal-line bg-charcoal-card/40 p-5 text-sm text-zinc-400">
      <h3 className="font-display font-700 text-zinc-100">How it works</h3>
      <ul className="mt-3 space-y-2">
        <li>• Challenges are signed messages — no gas, no contract.</li>
        <li>• Shots are simulated by an authoritative server room, so nobody can fake a result.</li>
        <li>• Both players sign the final score; the leaderboard only counts mutually-signed games.</li>
        <li>• ENS is optional — guests rank too, by their address.</li>
      </ul>
    </div>
  );
}
