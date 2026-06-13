'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { WalletBar } from '@/components/WalletBar';
import { ConnectWallet } from '@/components/ConnectWallet';
import { Avatar } from '@/components/Avatar';
import { ChatPanel } from '@/components/ChatPanel';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { useIdentity } from '@/lib/wallet/useIdentity';
import { useLobby } from '@/lib/net/useLobby';
import { useXmtp } from '@/lib/xmtp/useXmtp';
import { fetchStats } from '@/lib/net/socket';
import {
  resolveIdentity,
  resolveEnsRecords,
  truncate,
  type Identity,
  type EnsRecords,
} from '@/lib/ens/resolve';
import type { PlayerInfo } from '@/lib/net/protocol';

type PlayerStats = {
  address: string;
  wins: number;
  losses: number;
  disputed: number;
  lastPlayed: number;
};

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const { identity: me } = useIdentity();
  const { players, connected } = useLobby(me);
  const { enable, ready, connecting, error: xmtpError, openConversation } = useXmtp();

  // Optionally view another player's profile via ?address=
  const [viewed, setViewed] = useState<Identity | null>(null);
  const [records, setRecords] = useState<EnsRecords | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [peer, setPeer] = useState<PlayerInfo | null>(null);

  const targetAddress = (viewed?.address ?? address) as Address | undefined;

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('address');
    if (q && /^0x[a-fA-F0-9]{40}$/.test(q)) {
      resolveIdentity(q as Address).then(setViewed);
    }
  }, []);

  // Default the viewed identity to the connected user.
  const profile = viewed ?? me;

  // Pull ENS text records (bio + links) once a primary name is known.
  useEffect(() => {
    setRecords(null);
    const name = profile?.ensName;
    if (!name) return;
    let cancelled = false;
    resolveEnsRecords(name)
      .then((r) => {
        if (!cancelled) setRecords(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [profile?.ensName]);

  useEffect(() => {
    if (!targetAddress) return;
    setStatsLoading(true);
    fetchStats(targetAddress)
      .then((d: { player: PlayerStats | null }) => setStats(d.player))
      .catch(() => setStats(null))
      .finally(() => setStatsLoading(false));
  }, [targetAddress]);

  const total = (stats?.wins ?? 0) + (stats?.losses ?? 0);
  const winPct = total ? Math.round(((stats?.wins ?? 0) / total) * 100) : 0;

  const onlineOthers = useMemo(
    () => players.filter((p) => p.address.toLowerCase() !== address?.toLowerCase()),
    [players, address],
  );

  if (!isConnected) {
    return (
      <main className="min-h-screen">
        <WalletBar />
        <div className="mx-auto grid max-w-3xl place-items-center px-5 py-24 text-center">
          <h1 className="font-serif text-3xl text-cream">Your profile</h1>
          <p className="mt-2 text-sm text-zinc-400">Connect a wallet to see your stats and chat with players.</p>
          <div className="mt-6">
            <ConnectWallet />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <WalletBar />
      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[1fr_380px]">
        {/* Left: identity + stats + chat */}
        <div className="space-y-6">
          {/* Identity card */}
          <div className="flex items-center gap-4 rounded-2xl border border-ink-line bg-ink-card/60 p-6">
            {profile ? (
              <>
                <Avatar address={profile.address} avatar={profile.avatar} size={64} />
                <div className="min-w-0">
                  <h1 className="truncate font-serif text-2xl text-cream">
                    {profile.ensName ?? truncate(profile.address)}
                  </h1>
                  <p className="font-mono text-xs text-zinc-500">{profile.address}</p>
                  {records?.description && (
                    <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-300">
                      {records.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {profile.ensName ? (
                      <a
                        href={`https://app.ens.domains/${profile.ensName}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-sage-bright hover:underline"
                      >
                        View ENS ↗
                      </a>
                    ) : (
                      <a href="/register" className="text-xs text-sage-bright hover:underline">
                        Get an ENS name
                      </a>
                    )}
                    {records?.url && (
                      <a
                        href={records.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-zinc-400 hover:text-sage-bright hover:underline"
                      >
                        Website ↗
                      </a>
                    )}
                    {records?.twitter && (
                      <a
                        href={`https://x.com/${records.twitter.replace(/^@/, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-zinc-400 hover:text-sage-bright hover:underline"
                      >
                        @{records.twitter.replace(/^@/, '')}
                      </a>
                    )}
                    {viewed && (
                      <a href="/profile" className="text-xs text-zinc-500 hover:underline">
                        ← back to my profile
                      </a>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <Spinner />
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Wins" value={statsLoading ? '—' : String(stats?.wins ?? 0)} tone="win" />
            <Stat label="Losses" value={statsLoading ? '—' : String(stats?.losses ?? 0)} />
            <Stat label="Win %" value={statsLoading ? '—' : `${winPct}%`} tone="accent" />
            <Stat label="Games" value={statsLoading ? '—' : String(total)} />
          </div>
          {stats && stats.disputed > 0 && (
            <p className="text-xs text-zinc-500">
              {stats.disputed} disputed {stats.disputed === 1 ? 'match' : 'matches'} (server-adjudicated).
            </p>
          )}

          {/* Chat */}
          <div>
            <h2 className="mb-3 font-display text-lg font-700 text-zinc-100">Messages</h2>
            {!ready ? (
              <div className="rounded-2xl border border-ink-line bg-ink-card/60 p-6">
                <p className="text-sm text-zinc-400">
                  Chat with other players over <span className="text-sage-bright">XMTP</span> — fully
                  end-to-end encrypted, tied to your wallet. Enable it once with a signature.
                </p>
                <div className="mt-4">
                  <Button onClick={enable} disabled={connecting}>
                    {connecting ? (
                      <>
                        <Spinner size={14} /> Enabling…
                      </>
                    ) : (
                      'Enable messaging'
                    )}
                  </Button>
                </div>
                {xmtpError && <p className="mt-2 text-xs text-red-400">{xmtpError}</p>}
              </div>
            ) : peer ? (
              <ChatPanel
                peer={{
                  address: peer.address,
                  display: peer.ensName ?? truncate(peer.address),
                  avatar: peer.avatar,
                }}
                openConversation={openConversation}
              />
            ) : (
              <div className="grid place-items-center rounded-2xl border border-dashed border-ink-line/80 py-12 text-sm text-zinc-500">
                Pick a player from “Online now” to start chatting.
              </div>
            )}
          </div>
        </div>

        {/* Right: online players */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-ink-line bg-ink-card/60 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-base font-700 text-zinc-100">Online now</h3>
              <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                <span className={'h-2 w-2 rounded-full ' + (connected ? 'bg-sage-bright' : 'bg-zinc-600')} />
                {onlineOthers.length}
              </span>
            </div>
            <ul className="space-y-1">
              {onlineOthers.length === 0 && (
                <li className="py-6 text-center text-sm text-zinc-600">No one else online right now.</li>
              )}
              {onlineOthers.map((p) => (
                <li
                  key={p.address}
                  className="flex items-center justify-between rounded-xl px-2 py-2 hover:bg-white/5"
                >
                  <a
                    href={`/profile?address=${p.address}`}
                    className="flex min-w-0 items-center gap-2.5"
                  >
                    <Avatar address={p.address} avatar={p.avatar} size={32} />
                    <span className="truncate text-sm text-zinc-100">
                      {p.ensName ?? truncate(p.address)}
                    </span>
                  </a>
                  <button
                    onClick={() => setPeer(p)}
                    disabled={!ready}
                    className="rounded-lg border border-sage/40 px-2.5 py-1 text-xs text-sage-bright transition hover:bg-sage/10 disabled:opacity-40"
                    title={ready ? 'Message' : 'Enable messaging first'}
                  >
                    Message
                  </button>
                </li>
              ))}
            </ul>
            {!ready && onlineOthers.length > 0 && (
              <p className="mt-2 text-[11px] text-zinc-600">Enable messaging to chat.</p>
            )}
          </div>

          <div className="rounded-2xl border border-ink-line bg-ink-card/40 p-5 text-sm text-zinc-400">
            <Badge tone="neutral">Tip</Badge>
            <p className="mt-2">
              Your ENS name is your identity across billiard.eth — leaderboard, challenges, and
              chat. Players without a name still rank by address.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'win' | 'accent';
}) {
  return (
    <div className="rounded-2xl border border-ink-line bg-ink-card/60 p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p
        className={
          'mt-1 font-display text-2xl font-700 ' +
          (tone === 'win' ? 'text-emerald-400' : tone === 'accent' ? 'text-sage-bright' : 'text-zinc-100')
        }
      >
        {value}
      </p>
    </div>
  );
}
