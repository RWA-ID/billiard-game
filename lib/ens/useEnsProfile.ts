'use client';

import { useEffect, useState } from 'react';
import { normalize } from 'viem/ens';
import type { Address } from 'viem';
import { ensClient, truncate } from './resolve';

/**
 * Client-side ENS lookup for an arbitrary address, with a module-level cache so
 * a given address is resolved once per session (leaderboard rows, incoming
 * challenges, etc. that only carry a raw address). Returns the primary name +
 * avatar; falls back to a truncated address for display.
 */
const nameCache = new Map<string, string | null>();
const avatarCache = new Map<string, string | null>();

export function useEnsProfile(address?: string | null): {
  name: string | null;
  avatar: string | null;
  display: string;
} {
  const key = address ? address.toLowerCase() : '';
  const [name, setName] = useState<string | null>(() => nameCache.get(key) ?? null);
  const [avatar, setAvatar] = useState<string | null>(() => avatarCache.get(key) ?? null);

  useEffect(() => {
    if (!address) return;
    if (nameCache.has(key)) {
      setName(nameCache.get(key) ?? null);
      setAvatar(avatarCache.get(key) ?? null);
      return;
    }
    let cancelled = false;
    (async () => {
      let n: string | null = null;
      try {
        n = await ensClient.getEnsName({ address: address as Address });
      } catch {
        n = null;
      }
      nameCache.set(key, n);
      if (!cancelled) setName(n);

      let av: string | null = null;
      if (n) {
        try {
          av = await ensClient.getEnsAvatar({ name: normalize(n) });
        } catch {
          av = null;
        }
      }
      avatarCache.set(key, av);
      if (!cancelled) setAvatar(av);
    })();
    return () => {
      cancelled = true;
    };
  }, [address, key]);

  return {
    name,
    avatar,
    display: name ?? (address ? truncate(address) : ''),
  };
}
