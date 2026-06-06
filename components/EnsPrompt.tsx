'use client';

import { useEffect, useState } from 'react';
import { Button } from './ui/Button';

const DISMISS_KEY = 'billiard.ensPrompt.dismissed';

/**
 * Soft, dismissible, NON-blocking prompt encouraging (never requiring) ENS
 * registration. Guests are full participants — this is an enhancement, not a
 * gate. Once dismissed we remember it and don't nag.
 */
export function EnsPrompt({
  visible,
  onRegister,
}: {
  visible: boolean;
  onRegister: () => void;
}) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  if (!visible || dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-brass/25 bg-ink-card/70 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-display text-sm font-600 text-zinc-100">
          Players with an ENS name are easier to find and recognize.
        </p>
        <p className="mt-0.5 text-sm text-zinc-400">
          Want one? You can register a real <span className="text-brass-light">.eth</span> name
          right here. Totally optional — you can keep playing as a guest.
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" onClick={dismiss}>
          Maybe later
        </Button>
        <Button onClick={onRegister}>Register</Button>
      </div>
    </div>
  );
}
