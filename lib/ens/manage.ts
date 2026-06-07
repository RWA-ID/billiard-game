import { encodeFunctionData, namehash, type Address, type Hex } from 'viem';
import { ensClient } from '@/lib/ens/resolve';
import { ENS, ENS_REGISTRY_ABI, PUBLIC_RESOLVER_ABI } from '@/lib/ens/contracts';

/**
 * Post-registration ENS management: set the resolver, write avatar + text
 * records, and set the primary name. These are independent, optional txs — a
 * failure here never affects ownership of an already-registered name.
 */

/** Editable profile fields → ENS text-record keys. */
export const PROFILE_FIELDS = [
  { key: 'avatar', label: 'Avatar URL', placeholder: 'https://… or ipfs://…' },
  { key: 'description', label: 'Bio', placeholder: 'A short bio' },
  { key: 'url', label: 'Website', placeholder: 'https://…' },
  { key: 'com.twitter', label: 'Twitter / X', placeholder: 'handle (no @)' },
] as const;

export type ProfileRecords = Record<string, string>;

export function nodeOf(name: string): Hex {
  return namehash(name);
}

/**
 * Best-effort list of `.eth` names a wallet owns, via the ENS subgraph. The
 * `.eth` registrar isn't enumerable on-chain, so this is the only way to list
 * names — but it's an external (deprecated-but-live) endpoint, so it fails soft
 * to an empty array. Callers should merge in the known primary + any name just
 * registered this session.
 */
const ENS_SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/ensdomains/ens';

export async function listOwnedNames(address: Address): Promise<string[]> {
  const a = address.toLowerCase();
  const query = `query($a: String!) {
    domains(first: 200, where: { owner: $a }) { name }
    registrations(first: 200, where: { registrant: $a }) { domain { name } }
  }`;
  try {
    const res = await fetch(ENS_SUBGRAPH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { a } }),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const names = new Set<string>();
    for (const d of json?.data?.domains ?? []) if (d?.name) names.add(d.name);
    for (const r of json?.data?.registrations ?? []) if (r?.domain?.name) names.add(r.domain.name);
    return [...names]
      .filter((n) => n.endsWith('.eth') && !n.includes('[') && n.split('.').length === 2)
      .sort();
  } catch {
    return [];
  }
}

/** The resolver currently set for a name (zero address if none). */
export async function getResolver(name: string): Promise<Address> {
  return ensClient.readContract({
    address: ENS.registry,
    abi: ENS_REGISTRY_ABI,
    functionName: 'resolver',
    args: [namehash(name)],
  });
}

/** Read the current profile records so the editor pre-fills existing values. */
export async function readProfile(name: string): Promise<ProfileRecords> {
  const entries = await Promise.all(
    PROFILE_FIELDS.map(async (f) => {
      try {
        const v = await ensClient.getEnsText({ name, key: f.key });
        return [f.key, v ?? ''] as const;
      } catch {
        return [f.key, ''] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

const ZERO = '0x0000000000000000000000000000000000000000';

export function isZeroResolver(resolver: Address): boolean {
  return resolver.toLowerCase() === ZERO;
}

/**
 * Build the inner calls for a PublicResolver `multicall`: optionally set the ETH
 * address (so the name resolves forward) plus every non-empty text record. Pass
 * the result straight to `multicall(bytes[])`. Returns null when nothing to do.
 */
export function buildRecordCalls(
  name: string,
  owner: Address,
  records: ProfileRecords,
  opts: { setAddr: boolean } = { setAddr: true },
): Hex[] | null {
  const node = namehash(name);
  const calls: Hex[] = [];

  if (opts.setAddr) {
    calls.push(
      encodeFunctionData({
        abi: PUBLIC_RESOLVER_ABI,
        functionName: 'setAddr',
        args: [node, owner],
      }),
    );
  }

  for (const f of PROFILE_FIELDS) {
    const value = (records[f.key] ?? '').trim();
    if (!value) continue;
    calls.push(
      encodeFunctionData({
        abi: PUBLIC_RESOLVER_ABI,
        functionName: 'setText',
        args: [node, f.key, value],
      }),
    );
  }

  return calls.length ? calls : null;
}
