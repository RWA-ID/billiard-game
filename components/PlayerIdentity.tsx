'use client';

import { useEnsProfile } from '@/lib/ens/useEnsProfile';
import { truncate } from '@/lib/ens/resolve';
import { Avatar } from './Avatar';

/**
 * Avatar + name for a player address. Prefers any ENS name/avatar already
 * supplied (e.g. resolved upstream in the lobby); otherwise resolves the
 * address client-side (cached) so leaderboard rows and incoming challenges show
 * the ENS domain instead of a raw hex address.
 */
export function PlayerIdentity({
  address,
  ensName,
  avatar,
  size = 30,
  nameClassName = 'text-sm text-zinc-100',
}: {
  address: string;
  ensName?: string | null;
  avatar?: string | null;
  size?: number;
  nameClassName?: string;
}) {
  const resolved = useEnsProfile(ensName ? null : address);
  const name = ensName ?? resolved.name ?? truncate(address);
  const av = avatar ?? resolved.avatar;

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar address={address} avatar={av} size={size} />
      <span className={`truncate ${nameClassName}`}>{name}</span>
    </div>
  );
}
