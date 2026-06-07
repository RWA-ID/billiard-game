'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { ConnectWallet } from '@/components/ConnectWallet';
import { Lobby } from '@/components/Lobby';
import { EnsPrompt } from '@/components/EnsPrompt';
import { EnsRegister } from '@/components/EnsRegister';
import { ChallengeModal } from '@/components/ChallengeModal';
import { Avatar } from '@/components/Avatar';
import { Leaderboard } from '@/components/Leaderboard';
import { DonateCard } from '@/components/DonateButton';
import { useIdentity } from '@/lib/wallet/useIdentity';
import { useLobby } from '@/lib/net/useLobby';

export default function Home() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { identity, isGuest } = useIdentity();
  const { players, incoming, outgoing, matched, connected, challenge, accept, decline } =
    useLobby(identity);
  const [showRegister, setShowRegister] = useState(false);
  const lobbyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('register') === '1') {
      setShowRegister(true);
      lobbyRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    if (matched) {
      sessionStorage.setItem('billiard.match', JSON.stringify(matched));
      router.push('/play');
    }
  }, [matched, router]);

  const scrollToLobby = () => lobbyRef.current?.scrollIntoView({ behavior: 'smooth' });

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <SiteHeader onPlay={scrollToLobby} />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative mx-auto grid max-w-7xl items-center gap-6 px-5 pb-10 pt-6 lg:grid-cols-[1.05fr_1fr] lg:pt-10">
        <div className="rise relative z-10">
          <h1 className="font-serif text-5xl font-700 leading-[1.04] tracking-tight text-cream sm:text-6xl lg:text-7xl">
            Real Players.
            <br />
            Real Competition.
            <br />
            <span className="text-sage-bright">Built On Reputation.</span>
          </h1>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-zinc-400">
            billiard.eth is a multiplayer 8-ball game where your ENS name is your identity.
            Challenge players, climb the leaderboard, and become a legend.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              onClick={scrollToLobby}
              className="rounded-xl bg-sage px-7 py-3.5 text-sm font-600 text-ink shadow-sage transition hover:bg-sage-bright"
            >
              Play Now
            </button>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-xl border border-ink-line bg-ink-card/60 px-6 py-3.5 text-sm font-500 text-zinc-200 transition hover:border-sage/40"
            >
              <PlayIcon /> How it Works
            </a>
          </div>

          <p className="mt-6 flex items-center gap-2 text-sm text-zinc-500">
            <EnsMark />
            Built on <span className="text-sage-bright">ENS</span> for identity and discovery
          </p>
        </div>

        {/* Table photo */}
        <div className="relative h-[300px] sm:h-[380px] lg:h-[520px]">
          <OnlinePill connected={connected} count={players.length} players={players} />
          <div className="absolute inset-0 animate-floaty overflow-hidden rounded-3xl border border-ink-line/80 shadow-2xl ring-1 ring-sage/10">
            <img
              src="/hero-table.jpg"
              alt="A felt pool table racked and waiting in a dim bar"
              className="h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-transparent" />
          </div>
        </div>
      </section>

      {/* ── Feature row ──────────────────────────────────────────────────── */}
      <section id="how" className="border-t border-ink-line/60 bg-ink-soft/40">
        <div className="mx-auto grid max-w-6xl gap-px px-5 py-12 sm:grid-cols-2 lg:grid-cols-4">
          <Feature
            icon={<PersonIcon />}
            title="ENS Identity"
            body="Your ENS name is your handle. No signups, no usernames — just connect and play."
          />
          <Feature
            icon={<CuesIcon />}
            title="Challenge Players"
            body="See who's online, send a challenge, and settle it on the table."
          />
          <Feature
            icon={<BarsIcon />}
            title="Track Your Stats"
            body="Wins, losses, win streaks, and rankings. Prove you're the best."
          />
          <Feature
            icon={<TrophyIcon />}
            title="Climb the Leaderboard"
            body="Compete with the best players on billiard.eth and earn your place at the top."
          />
        </div>
      </section>

      {/* ── Leaderboard preview + Anywhere promo ─────────────────────────── */}
      <section className="mx-auto grid max-w-6xl gap-5 px-5 py-12 lg:grid-cols-2">
        <div className="rounded-2xl border border-ink-line bg-ink-card/70 p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-lg font-700 text-zinc-100">Top Players</h3>
            <Link
              href="/stats"
              className="text-sm font-500 text-sage-bright hover:underline"
            >
              View Leaderboard →
            </Link>
          </div>
          <Leaderboard variant="preview" />
        </div>

        <AnywherePromo />
      </section>

      {/* ── Live lobby ───────────────────────────────────────────────────── */}
      <section ref={lobbyRef} id="lobby" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-12">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="font-serif text-3xl font-700 text-cream">Game on.</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {isConnected
                ? 'Pick an opponent below and break.'
                : 'Connect a wallet to enter the lobby — injected wallets or Coinbase Smart Wallet (passkey, no extension).'}
            </p>
          </div>
        </div>

        {!isConnected ? (
          <div className="grid place-items-center rounded-2xl border border-ink-line bg-ink-card/60 py-16">
            <div className="text-center">
              <p className="mb-4 text-zinc-300">Connect to play, challenge, and rank.</p>
              <div className="inline-block">
                <ConnectWallet />
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <Lobby
              players={players}
              connected={connected}
              outgoing={outgoing}
              onChallenge={challenge}
            />
            <aside className="space-y-6">
              {isGuest && !showRegister && (
                <EnsPrompt visible onRegister={() => setShowRegister(true)} />
              )}
              {showRegister && <EnsRegister onDone={() => setShowRegister(false)} />}
            </aside>
          </div>
        )}
      </section>

      {/* ── Powered by ENS ───────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pb-12">
        <div className="flex flex-col items-start justify-between gap-6 rounded-2xl border border-ink-line bg-gradient-to-br from-ink-card to-ink-soft p-7 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <EnsLogo size={44} />
            <div>
              <h4 className="font-serif text-xl font-700 text-cream">Powered by ENS</h4>
              <p className="mt-1 text-sm text-zinc-400">
                Decentralized identity. Seamless discovery. The future of online gaming.
              </p>
            </div>
          </div>
          <a
            href="https://ens.domains"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-ink-line bg-ink/60 px-5 py-3 text-sm font-500 text-zinc-200 transition hover:border-sage/40"
          >
            Learn More About ENS ↗
          </a>
        </div>
      </section>

      {/* ── Donate ───────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pb-14">
        <DonateCard />
      </section>

      <SiteFooter />

      <ChallengeModal incoming={incoming} onAccept={accept} onDecline={decline} />
    </main>
  );
}

// ── Header ────────────────────────────────────────────────────────────────
function SiteHeader({ onPlay }: { onPlay: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-line/50 bg-ink/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <EightBallLogo />
          <span className="font-serif text-xl font-700 tracking-tight text-cream">
            billiard<span className="text-sage-bright">.eth</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-zinc-400 md:flex">
          <button onClick={onPlay} className="text-sage-bright transition hover:text-sage">
            Play Now
          </button>
          <a href="#how" className="transition hover:text-zinc-100">
            How it Works
          </a>
          <Link href="/stats" className="transition hover:text-zinc-100">
            Leaderboard
          </Link>
          <Link href="/profile" className="transition hover:text-zinc-100">
            Profile
          </Link>
        </nav>

        <ConnectEnsButton />
      </div>
    </header>
  );
}

function ConnectEnsButton() {
  const { open } = useAppKit();
  const { isConnected } = useAccount();
  const { identity } = useIdentity();
  return (
    <button
      onClick={() => open()}
      className="inline-flex items-center gap-2 rounded-xl border border-sage/40 bg-sage/5 px-4 py-2.5 text-sm font-600 text-sage-bright transition hover:bg-sage/10"
    >
      <EnsLogo size={16} />
      {isConnected && identity ? identity.display : 'Connect ENS'}
    </button>
  );
}

// ── Online pill ───────────────────────────────────────────────────────────
function OnlinePill({
  connected,
  count,
  players,
}: {
  connected: boolean;
  count: number;
  players: { address: string; avatar: string | null }[];
}) {
  return (
    <div className="absolute right-2 top-0 z-20 flex items-center gap-3 rounded-full border border-ink-line bg-ink-card/85 px-3.5 py-2 backdrop-blur sm:right-4">
      <span className="flex items-center gap-2 text-xs font-500 text-zinc-300">
        <span className="h-2 w-2 animate-glow rounded-full bg-sage-bright" />
        {connected ? `${count + 1} player${count === 0 ? '' : 's'} online` : 'Live now'}
      </span>
      {connected && players.length > 0 && (
        <div className="flex -space-x-2">
          {players.slice(0, 4).map((p) => (
            <span key={p.address} className="ring-2 ring-ink-card rounded-full">
              <Avatar address={p.address} avatar={p.avatar} size={22} />
            </span>
          ))}
          {count > 4 && (
            <span className="grid h-[22px] min-w-[22px] place-items-center rounded-full bg-ink px-1 text-[10px] text-zinc-400 ring-2 ring-ink-card">
              +{count - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Feature card ──────────────────────────────────────────────────────────
function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-4 text-center sm:border-r sm:border-ink-line/60 sm:last:border-r-0">
      <div className="grid h-12 w-12 place-items-center rounded-xl border border-ink-line bg-ink-card text-sage-bright">
        {icon}
      </div>
      <h3 className="mt-4 font-display text-base font-700 text-zinc-100">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-500">{body}</p>
    </div>
  );
}

// ── Anywhere promo ────────────────────────────────────────────────────────
function AnywherePromo() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-ink-line bg-gradient-to-br from-[#1a120c] via-ink-card to-ink p-7 shadow-card">
      {/* neon sign */}
      <div className="pointer-events-none absolute right-5 top-5 select-none rounded-md border-2 border-[#ff5a3c] px-4 py-2 text-right font-display text-sm font-700 leading-tight shadow-[0_0_24px_rgba(255,90,60,0.5)]">
        <span className="text-[#ff7a5c]">PLAY</span>
        <br />
        <span className="text-sage-bright">POOL</span>
      </div>

      <h3 className="font-serif text-3xl font-700 leading-tight text-cream">
        Game on.
        <br />
        Anywhere.
      </h3>
      <p className="mt-3 max-w-[16rem] text-sm leading-relaxed text-zinc-400">
        Jump in from any device. No downloads. No friction. Just pure pool.
      </p>

      {/* top-down table photo */}
      <div className="mt-6 overflow-hidden rounded-xl border border-ink-line/80 shadow-2xl ring-1 ring-sage/10">
        <img
          src="/anywhere-table.jpg"
          alt="A racked pool table seen from above"
          className="h-44 w-full object-cover"
        />
      </div>
    </div>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────
function SiteFooter() {
  return (
    <footer className="border-t border-ink-line/60">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-5 py-7 text-sm text-zinc-600 sm:flex-row">
        <p>© {new Date().getFullYear()} billiard.eth — All rights reserved.</p>
        <div className="flex items-center gap-4">
          <a href="https://twitter.com" target="_blank" rel="noreferrer" className="hover:text-zinc-300">
            Twitter
          </a>
          <a href="https://github.com/RWA-ID/billiard-game" target="_blank" rel="noreferrer" className="hover:text-zinc-300">
            GitHub
          </a>
          <span className="text-zinc-700">·</span>
          <span>billiard.eth.link</span>
        </div>
      </div>
    </footer>
  );
}

// ── Icons (inline SVG, no deps) ────────────────────────────────────────────
function EightBallLogo() {
  return (
    <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-felt-light to-felt-dark ring-1 ring-sage/20">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-ink text-[10px] font-700 text-cream">
        8
      </span>
    </span>
  );
}
function EnsMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 13.5 11.5 3v7L5 13.5Z" fill="#6fd089" />
      <path d="M19 10.5 12.5 21v-7L19 10.5Z" fill="#4f88c7" />
    </svg>
  );
}
// Official-style ENS mark: blue rounded square with the white twist glyph.
function EnsLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" aria-hidden>
      <rect width="96" height="96" rx="22" fill="#3a8ec9" />
      <g fill="#fff">
        <path d="M48 10C40 22 28 34 18 48C30 42 40 38 44 33C45 25 46 17 48 10Z" />
        <path d="M48 10C52 24 60 34 80 52C66 50 56 46 50 38C47 30 47 19 48 10Z" />
      </g>
      <g fill="#fff" transform="rotate(180 48 48)">
        <path d="M48 10C40 22 28 34 18 48C30 42 40 38 44 33C45 25 46 17 48 10Z" />
        <path d="M48 10C52 24 60 34 80 52C66 50 56 46 50 38C47 30 47 19 48 10Z" />
      </g>
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 9l5 3-5 3V9Z" fill="currentColor" />
    </svg>
  );
}
function PersonIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 19c1.2-3.3 4-5 7-5s5.8 1.7 7 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function CuesIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 20 20 4M20 20 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function BarsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 19V11M12 19V5M19 19v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function TrophyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 4h10v4a5 5 0 0 1-10 0V4ZM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M9 20h6M12 13v4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
