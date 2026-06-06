import { verifyMessage, type Address, type Hex, toHex } from 'viem';
import type { ChallengePayload, ResultPayload } from '@/lib/net/protocol';

/**
 * Canonical message serialization for signed challenges/results.
 *
 * The EXACT string here is what gets signed and verified — it must be byte
 * identical on the signer (client) and verifier (peer client + Worker), so
 * this module is framework-free and copy-importable by the Worker.
 */

export function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export function challengeMessage(p: ChallengePayload): string {
  return [
    'billiard.eth challenge',
    `challenger: ${p.challenger.toLowerCase()}`,
    `opponent:   ${p.opponent.toLowerCase()}`,
    `nonce:      ${p.nonce}`,
    `issuedAt:   ${p.issuedAt}`,
  ].join('\n');
}

export function resultMessage(p: ResultPayload): string {
  return [
    'billiard.eth result',
    `matchId:  ${p.matchId}`,
    `winner:   ${p.winner.toLowerCase()}`,
    `loser:    ${p.loser.toLowerCase()}`,
    `rackSeed: ${p.rackSeed}`,
    `shots:    ${p.shots}`,
    `finishedAt: ${p.finishedAt}`,
  ].join('\n');
}

export async function verifyChallenge(
  payload: ChallengePayload,
  signature: Hex,
): Promise<boolean> {
  return verifyMessage({
    address: payload.challenger,
    message: challengeMessage(payload),
    signature,
  });
}

export async function verifyResult(
  payload: ResultPayload,
  signature: Hex,
  signer: Address,
): Promise<boolean> {
  return verifyMessage({
    address: signer,
    message: resultMessage(payload),
    signature,
  });
}
