'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { ConnectWallet } from '@/components/ConnectWallet';
import { EnsNameCard } from '@/components/EnsNameCard';
import { ChallengeModal } from '@/components/ChallengeModal';
import { Avatar } from '@/components/Avatar';
import { Leaderboard } from '@/components/Leaderboard';
import { DonateCard } from '@/components/DonateButton';
import { Spinner } from '@/components/ui/Spinner';
import { useIdentity } from '@/lib/wallet/useIdentity';
import { useLobby } from '@/lib/net/useLobby';
import { truncate } from '@/lib/ens/resolve';
import type { PlayerInfo } from '@/lib/net/protocol';

// Members' Break — a classic prestige-club home page: full-bleed felt hero,
// editorial Libre Caslon headlines, brass-gold accent, the leaderboard & live
// lobby pulled front-and-center. All data is real (useLobby / Leaderboard).
export default function Home() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { identity } = useIdentity();
  const { players, incoming, outgoing, matched, connected, challenge, accept, decline } =
    useLobby(identity);
  const lobbyRef = useRef<HTMLDivElement>(null);
  const ensRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('register') === '1') {
      ensRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    if (matched) {
      sessionStorage.setItem('billiard.match', JSON.stringify(matched));
      router.push('/play');
    }
  }, [matched, router]);

  const scrollToLobby = () => lobbyRef.current?.scrollIntoView({ behavior: 'smooth' });
  const onlineCount = connected ? players.length + 1 : 0;

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <SiteHeader onPlay={scrollToLobby} />

      {/* ── Hero: full-bleed felt panel with edge-to-edge photo ──────────────── */}
      <section
        className="relative overflow-hidden"
        style={{
          background:
            'radial-gradient(120% 130% at 18% 0%, #155c43, #0d3b2e 48%, #08251c 100%)',
        }}
      >
        {/* soft top-left light */}
        <div
          className="pointer-events-none absolute inset-0 z-[2]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 22% 0%, rgba(255,255,255,.08), transparent 42%)',
          }}
        />
        {/* photo — right half on desktop, soft top banner on mobile */}
        <div className="absolute inset-0 left-auto top-0 hidden h-full w-1/2 lg:block">
          <img
            src="/hero-hall.jpg"
            alt="A dim billiard hall, balls racked under a low lamp"
            className="h-full w-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to right, #0d3b2e 0%, rgba(13,59,46,.65) 16%, rgba(13,59,46,.12) 40%, transparent 62%)',
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(to top, rgba(8,18,14,.55), transparent 50%)',
            }}
          />
        </div>

        <div className="relative z-[3] mx-auto max-w-[1320px] px-5 pb-16 pt-16 sm:px-8 lg:px-14 lg:pb-[100px] lg:pt-24">
          <div className="rise max-w-[560px]">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-brass/40 px-3.5 py-1.5 font-display text-[11px] font-600 uppercase tracking-[0.22em] text-brass-light">
              <span className="h-[7px] w-[7px] animate-glow rounded-full bg-sage-bright" />
              The house is open
            </div>
            <h1 className="mt-6 font-serif text-[44px] leading-[1.0] tracking-[-0.01em] text-[#f7f3e9] sm:text-6xl lg:text-[78px]">
              Take your
              <br />
              shot at the
              <br />
              <span className="text-brass-light">head table.</span>
            </h1>
            <p className="mt-7 max-w-[440px] text-[15px] leading-relaxed text-[#cfe0d4] sm:text-[17px]">
              Online 8-ball where your <span className="text-[#f7f3e9]">.eth</span> name carries
              your record. Challenge anyone in the lobby, win, and climb a leaderboard that everyone
              can verify.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3.5">
              <button
                onClick={scrollToLobby}
                className="inline-flex items-center gap-2.5 rounded-xl bg-brass px-8 py-4 font-display text-[15px] font-700 text-ink shadow-brass transition hover:-translate-y-0.5 hover:bg-brass-light active:translate-y-0"
              >
                Play Now
                <ArrowIcon />
              </button>
              <a
                href="#how"
                className="inline-flex items-center gap-2 rounded-xl border border-[#f7f3e9]/30 px-7 py-4 font-display text-[15px] font-500 text-[#f7f3e9] transition hover:-translate-y-0.5 hover:border-[#f7f3e9]/60 active:translate-y-0"
              >
                How it Works
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── House rules ──────────────────────────────────────────────────────── */}
      <section id="how" className="mx-auto max-w-[1320px] px-5 pb-2 pt-16 sm:px-8 lg:px-14">
        <div className="flex flex-wrap items-baseline gap-4">
          <h2 className="font-serif text-3xl text-cream">House rules</h2>
          <span className="font-display text-[11px] font-600 uppercase tracking-[0.24em] text-[#7d887f]">
            Four steps to the table
          </span>
        </div>
      </section>
      <div className="mx-auto mb-2 grid max-w-[1320px] gap-px bg-ink-line/60 px-5 sm:grid-cols-2 sm:px-8 lg:grid-cols-4 lg:px-14">
        {HOUSE_RULES.map((r) => (
          <div key={r.numeral} className="bg-ink px-7 pb-9 pt-8">
            <div className="font-serif text-[42px] leading-none text-brass/50">{r.numeral}</div>
            <h3 className="mt-3.5 font-display text-[17px] font-600 text-[#f0f3ef]">{r.title}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-[#828d84]">{r.body}</p>
          </div>
        ))}
      </div>

      {/* ── The Head Table (leaderboard) ─────────────────────────────────────── */}
      <section className="mx-auto max-w-[1320px] px-5 py-14 sm:px-8 lg:px-14">
        <div className="overflow-hidden rounded-[20px] border border-brass/20 bg-ink-card">
          <div className="grid lg:grid-cols-2">
            <div className="border-b border-ink-line/70 px-7 py-9 sm:px-10 lg:border-b-0 lg:border-r">
              <div className="font-display text-[11px] font-600 uppercase tracking-[0.24em] text-brass">
                Standings
              </div>
              <h2 className="mt-3 font-serif text-[34px] text-cream">The head table</h2>
              <div className="mt-6">
                <Leaderboard variant="preview" />
              </div>
            </div>
            <div className="relative min-h-[280px] overflow-hidden">
              <img
                src="/anywhere-table.jpg"
                alt="Tournament table from above"
                className="h-full w-full object-cover"
              />
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(105deg, #0a1610 2%, rgba(10,22,16,.5) 30%, transparent 70%)',
                }}
              />
              <div className="absolute inset-x-8 bottom-8">
                <h3
                  className="font-serif text-[30px] text-[#f7f3e9]"
                  style={{ textShadow: '0 2px 14px rgba(0,0,0,.6)' }}
                >
                  Game on. Anywhere.
                </h3>
                <p
                  className="mt-2 max-w-[280px] text-sm text-[#dfe7e0]"
                  style={{ textShadow: '0 1px 8px rgba(0,0,0,.7)' }}
                >
                  Jump in from any device. No downloads, no friction — just pure pool.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── The Lobby (live players — real data) ─────────────────────────────── */}
      <section
        ref={lobbyRef}
        id="lobby"
        className="mx-auto max-w-[1320px] scroll-mt-20 px-5 pb-14 sm:px-8 lg:px-14"
      >
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3.5">
          <div>
            <div className="font-display text-[11px] font-600 uppercase tracking-[0.24em] text-brass">
              The lobby
            </div>
            <h2 className="mt-3 font-serif text-[34px] text-cream">Who&apos;s at the rail</h2>
            <p className="mt-2 text-[14.5px] text-[#9aa69d]">
              {isConnected
                ? 'Pick an opponent and break. Challenges go out in real time.'
                : 'Connect a wallet to enter the lobby and challenge players in real time.'}
            </p>
          </div>
          {isConnected && (
            <div className="inline-flex items-center gap-2.5 rounded-full border border-brass/30 bg-brass/[0.06] px-4 py-2.5">
              <span className="h-2 w-2 animate-glow rounded-full bg-sage-bright" />
              <span className="font-display text-[12.5px] font-500 text-[#cfe0d4]">
                {connected
                  ? `${onlineCount} player${onlineCount === 1 ? '' : 's'} online`
                  : 'connecting…'}
              </span>
            </div>
          )}
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
        ) : players.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-ink-line/80 py-14 text-center">
            <p className="text-sm text-zinc-300">
              {connected
                ? 'No one else at the rail yet — invite a friend to billiard.eth.'
                : 'Connecting to the lobby…'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {players.map((p) => (
              <LobbyCard
                key={p.address}
                player={p}
                pending={outgoing?.toLowerCase() === p.address.toLowerCase()}
                onChallenge={() => challenge(p.address)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── ENS identity band ────────────────────────────────────────────────── */}
      <section className="border-y border-brass/[0.16] bg-ink-card">
        <div className="mx-auto grid max-w-[1320px] items-start gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[1fr_minmax(0,360px)] lg:px-14">
          <div ref={ensRef} id="register" className="scroll-mt-20">
            <div className="flex items-center gap-3">
              <EnsLogo size={34} />
              <span className="font-display text-[11px] font-600 uppercase tracking-[0.24em] text-brass">
                Powered by ENS · optional
              </span>
            </div>
            <h2 className="mt-5 font-serif text-[32px] leading-tight text-cream sm:text-[38px]">
              Claim a name that
              <br />
              follows you everywhere.
            </h2>
            <p className="mt-4 max-w-[560px] text-[15.5px] leading-relaxed text-[#9aa69d]">
              Register a <span className="text-brass-light">.eth</span> name, set your avatar and
              bio, and make it your primary identity across Ethereum. Guests can still play and
              rank.
            </p>
            <div className="mt-6">
              <EnsNameCard />
            </div>
          </div>

          <DonateCard />
        </div>
      </section>

      <SiteFooter />

      <ChallengeModal incoming={incoming} onAccept={accept} onDecline={decline} />
    </main>
  );
}

// ── Lobby player card (real player from useLobby) ───────────────────────────
function LobbyCard({
  player,
  pending,
  onChallenge,
}: {
  player: PlayerInfo;
  pending: boolean;
  onChallenge: () => void;
}) {
  const name = player.ensName ?? truncate(player.address);
  return (
    <div className="flex flex-col items-center rounded-2xl border border-brass/[0.18] bg-ink-card p-5 text-center transition hover:-translate-y-0.5 hover:border-brass/40">
      <div className="relative">
        <span className="block rounded-full shadow-[0_0_0_3px_#0a1610,0_0_0_4px_rgba(217,164,65,.25)]">
          <Avatar address={player.address} avatar={player.avatar} size={56} />
        </span>
        <span className="absolute -bottom-px -right-px h-3.5 w-3.5 rounded-full border-[3px] border-ink-card bg-sage-bright" />
      </div>
      <div className="mt-3.5 max-w-full truncate font-display text-[15px] font-600 text-[#f0f3ef]">
        {name}
      </div>
      <div className="mt-2.5 font-display text-[11px] tracking-[0.04em] text-sage-bright">
        {pending ? 'Challenge sent…' : 'Ready to play'}
      </div>
      <button
        onClick={onChallenge}
        disabled={pending}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-brass py-3 font-display text-[13.5px] font-700 text-ink transition hover:bg-brass-light disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <>
            <Spinner size={13} /> Waiting…
          </>
        ) : (
          <>
            Challenge
            <CuesIcon />
          </>
        )}
      </button>
    </div>
  );
}

const HOUSE_RULES = [
  {
    numeral: 'I',
    title: 'ENS Identity',
    body: 'Your ENS name is your handle. No signups, no usernames — connect and play.',
  },
  {
    numeral: 'II',
    title: 'Challenge Players',
    body: "See who's online, send a challenge, and settle it on the felt.",
  },
  {
    numeral: 'III',
    title: 'Track Your Stats',
    body: 'Wins, losses, streaks and rankings — all tied to your name.',
  },
  {
    numeral: 'IV',
    title: 'Climb the Board',
    body: 'Compete with the best and earn your place at the head table.',
  },
];

// ── Header ────────────────────────────────────────────────────────────────
function SiteHeader({ onPlay }: { onPlay: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-brass/[0.18] bg-ink-card/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1320px] items-center justify-between px-5 py-4 sm:px-8 lg:px-14">
        <Link href="/" className="flex items-center gap-3">
          <EightBallLogo />
          <span className="font-serif text-xl tracking-wide text-cream">
            billiard<span className="text-brass">.eth</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-8 font-display text-[13px] text-[#a4b0a6] md:flex">
          <button onClick={onPlay} className="text-brass transition hover:text-brass-light">
            Play
          </button>
          <a href="#how" className="transition hover:text-[#f0f3ef]">
            How it Works
          </a>
          <Link href="/register" className="transition hover:text-[#f0f3ef]">
            Get ENS
          </Link>
          <Link href="/stats" className="transition hover:text-[#f0f3ef]">
            Leaderboard
          </Link>
          <Link href="/profile" className="transition hover:text-[#f0f3ef]">
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
      className="inline-flex items-center gap-2 rounded-[9px] border border-brass/45 bg-brass/[0.08] px-4 py-2.5 font-display text-[13px] font-600 text-brass-light transition hover:bg-brass/15"
    >
      <EnsLogo size={15} />
      {isConnected && identity ? identity.display : 'Connect ENS'}
    </button>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────
function SiteFooter() {
  return (
    <footer className="mx-auto max-w-[1320px] border-t border-ink-line/60 px-5 sm:px-8 lg:px-14">
      <div className="flex flex-col items-center justify-between gap-3 py-7 text-center font-display text-[13px] text-[#5f6b62] sm:flex-row sm:text-left">
        <span>© {new Date().getFullYear()} billiard.eth — All rights reserved.</span>
        <span className="flex items-center gap-[18px]">
          <a
            href="https://twitter.com"
            target="_blank"
            rel="noreferrer"
            className="transition hover:text-zinc-300"
          >
            Twitter
          </a>
          <a
            href="https://github.com/RWA-ID/billiard-game"
            target="_blank"
            rel="noreferrer"
            className="transition hover:text-zinc-300"
          >
            GitHub
          </a>
          <span className="text-[#7d887f]">· billiard.eth.link</span>
        </span>
      </div>
    </footer>
  );
}

// ── Icons / marks ───────────────────────────────────────────────────────────
function EightBallLogo() {
  return (
    <span
      className="grid h-[38px] w-[38px] place-items-center rounded-full"
      style={{
        background: 'radial-gradient(circle at 32% 28%, #2a2a2a, #050505)',
        boxShadow: '0 0 0 1px rgba(217,164,65,.4), inset 0 2px 6px rgba(255,255,255,.18)',
      }}
    >
      <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-cream font-display text-[11px] font-700 text-[#0a0f0d]">
        8
      </span>
    </span>
  );
}

// Official ENS logo (the real mark, served from /public).
function EnsLogo({ size = 18 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/ens-logo.png"
      alt="ENS"
      width={size}
      height={size}
      className="rounded-[22%]"
      style={{ width: size, height: size }}
    />
  );
}
function ArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h13M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function CuesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 20 20 4M20 20 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
