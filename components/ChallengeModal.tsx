'use client';

import type { Signed, ChallengePayload } from '@/lib/net/protocol';
import { truncate } from '@/lib/ens/resolve';
import { Button } from './ui/Button';
import { Avatar } from './Avatar';

/** Incoming challenge prompt. The signature was already verified upstream. */
export function ChallengeModal({
  incoming,
  onAccept,
  onDecline,
}: {
  incoming: Signed<ChallengePayload> | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  if (!incoming) return null;
  const from = incoming.payload.challenger;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-brass/30 bg-ink-card p-6 shadow-brass">
        <div className="flex items-center gap-3">
          <Avatar address={from} size={44} />
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Incoming challenge</p>
            <p className="font-display text-lg font-700 text-zinc-100">{truncate(from)}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-zinc-400">
          They signed a challenge with their wallet — it's verified as genuinely from this address.
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onDecline}>
            Decline
          </Button>
          <Button className="flex-1" onClick={onAccept}>
            Accept &amp; play
          </Button>
        </div>
      </div>
    </div>
  );
}
