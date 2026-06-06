import { type Address, type Hex, toHex } from 'viem';
import { ensClient } from '@/lib/ens/resolve';
import {
  ENS,
  ETH_REGISTRAR_CONTROLLER_ABI,
  ETH_REGISTRY_DURATION,
} from '@/lib/ens/contracts';

/**
 * ENS commit/reveal registration helpers (OPTIONAL flow, opt-in only).
 *
 * The current ETHRegistrarController uses a struct-based register(). The
 * `Registration` tuple field order is PINNED in contracts.ts and must match:
 *   (label, owner, duration, secret, resolver, data, reverseRecord, referrer)
 */

export const ZERO_REFERRER: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

export type Registration = {
  label: string;
  owner: Address;
  duration: bigint;
  secret: Hex;
  resolver: Address;
  data: readonly Hex[];
  reverseRecord: number; // uint8: 0 = off, 1 = set reverse record
  referrer: Hex;
};

/** Cryptographically-random 32-byte secret. Persist it across commit→reveal. */
export function randomSecret(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** Build the `Registration` struct used by both makeCommitment and register. */
export function buildRegistration(params: {
  label: string;
  owner: Address;
  secret: Hex;
  duration?: bigint;
  reverseRecord?: boolean;
}): Registration {
  return {
    label: params.label,
    owner: params.owner,
    duration: params.duration ?? ETH_REGISTRY_DURATION,
    secret: params.secret,
    resolver: ENS.publicResolver,
    data: [],
    // Ask the controller to set the reverse record automatically.
    reverseRecord: (params.reverseRecord ?? true) ? 1 : 0,
    referrer: ZERO_REFERRER,
  };
}

export async function isAvailable(label: string): Promise<boolean> {
  return ensClient.readContract({
    address: ENS.ethRegistrarController,
    abi: ETH_REGISTRAR_CONTROLLER_ABI,
    functionName: 'available',
    args: [label],
  });
}

/** Returns { base, premium } in wei. Total cost = base + premium. */
export async function rentPrice(
  label: string,
  duration: bigint = ETH_REGISTRY_DURATION,
): Promise<{ base: bigint; premium: bigint; total: bigint }> {
  const price = await ensClient.readContract({
    address: ENS.ethRegistrarController,
    abi: ETH_REGISTRAR_CONTROLLER_ABI,
    functionName: 'rentPrice',
    args: [label, duration],
  });
  return { base: price.base, premium: price.premium, total: price.base + price.premium };
}

export async function makeCommitment(reg: Registration): Promise<Hex> {
  return ensClient.readContract({
    address: ENS.ethRegistrarController,
    abi: ETH_REGISTRAR_CONTROLLER_ABI,
    functionName: 'makeCommitment',
    args: [reg],
  });
}

/** minCommitmentAge in seconds (sane default 60s if the read fails). */
export async function minCommitmentAge(): Promise<number> {
  try {
    const age = await ensClient.readContract({
      address: ENS.ethRegistrarController,
      abi: ETH_REGISTRAR_CONTROLLER_ABI,
      functionName: 'minCommitmentAge',
    });
    return Number(age);
  } catch {
    return 60;
  }
}

/** Add a buffer to the rent price to absorb premium/price drift between txs. */
export function withBuffer(total: bigint, pct = 5n): bigint {
  return total + (total * pct) / 100n;
}
