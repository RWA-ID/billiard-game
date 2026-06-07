import { createPublicClient, http, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import { RPC_URL } from '@/lib/wallet/config';

/**
 * A standalone mainnet client for ENS reads (resolution does not depend on the
 * connected wallet's chain). Used for getEnsName / getEnsAvatar lookups.
 */
export const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
});

export type Identity = {
  address: Address;
  ensName: string | null;
  avatar: string | null;
  /** Display label: ENS name if present, else truncated address. */
  display: string;
};

export function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** ENS profile text records (bio + social links), fetched on demand. */
export type EnsRecords = {
  description: string | null;
  url: string | null;
  twitter: string | null;
};

/**
 * Read ENS text records for a name (description/bio, url, twitter). Each lookup
 * fails soft to null so a missing record never breaks the profile. Only call
 * this when a primary ENS name is known — guests have no records.
 */
export async function resolveEnsRecords(name: string): Promise<EnsRecords> {
  const norm = normalize(name);
  const [description, url, twitter] = await Promise.all([
    ensClient.getEnsText({ name: norm, key: 'description' }).catch(() => null),
    ensClient.getEnsText({ name: norm, key: 'url' }).catch(() => null),
    ensClient.getEnsText({ name: norm, key: 'com.twitter' }).catch(() => null),
  ]);
  return { description, url, twitter };
}

/**
 * Resolve a wallet address to its ENS identity. Returns a guest identity
 * (ensName: null) if no primary name is set — guests are full participants.
 */
export async function resolveIdentity(address: Address): Promise<Identity> {
  let ensName: string | null = null;
  let avatar: string | null = null;

  try {
    ensName = await ensClient.getEnsName({ address });
  } catch {
    ensName = null;
  }

  if (ensName) {
    try {
      avatar = await ensClient.getEnsAvatar({ name: normalize(ensName) });
    } catch {
      avatar = null;
    }
  }

  return {
    address,
    ensName,
    avatar,
    display: ensName ?? truncate(address),
  };
}
