'use client';

import { clsx } from './clsx';
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-600 transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0',
        variant === 'primary' &&
          'bg-sage text-ink shadow-sage hover:bg-sage-bright hover:shadow-lg',
        variant === 'secondary' &&
          'border border-sage/40 text-sage-bright hover:border-sage hover:bg-sage/5',
        variant === 'ghost' && 'text-zinc-300 hover:bg-white/5',
        className,
      )}
      {...props}
    />
  );
}
