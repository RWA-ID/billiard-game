import { clsx } from './clsx';
import type { ReactNode } from 'react';

type Tone = 'available' | 'taken' | 'loading' | 'neutral';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        tone === 'available' && 'bg-emerald-500/15 text-emerald-400',
        tone === 'taken' && 'bg-red-500/15 text-red-400',
        tone === 'loading' && 'bg-zinc-500/15 text-zinc-400',
        tone === 'neutral' && 'bg-brass/10 text-brass-light',
      )}
    >
      {children}
    </span>
  );
}
