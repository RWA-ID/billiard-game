'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { resolveIdentity, truncate, type Identity } from '@/lib/ens/resolve';

/**
 * Resolve the connected wallet to its ENS identity (name + avatar). ENS is
 * OPTIONAL — a null ensName means a guest, who still gets full access and a
 * truncated-address display. Never gate features on `ensName` being set.
 */
export function useIdentity(): {
  identity: Identity | null;
  isGuest: boolean;
  loading: boolean;
} {
  const { address, isConnected } = useAccount();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!isConnected || !address) {
      setIdentity(null);
      return;
    }
    // Optimistic guest identity first, then resolve ENS in the background.
    setIdentity({ address, ensName: null, avatar: null, display: truncate(address) });
    setLoading(true);
    resolveIdentity(address)
      .then((id) => {
        if (!cancelled) setIdentity(id);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, isConnected]);

  return {
    identity,
    isGuest: !!identity && identity.ensName === null,
    loading,
  };
}
