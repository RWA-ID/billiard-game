'use client';

import { useMemo } from 'react';

/** Deterministic blocky identicon generated from an address (no deps). */
function identicon(address: string, size = 8): string {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (Math.imul(31, h) + address.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  const cells: string[] = [];
  const px = 100 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < Math.ceil(size / 2); x++) {
      h = (Math.imul(1103515245, h) + 12345) | 0;
      if ((h >>> 16) % 2 === 0) {
        const rect = (cx: number) =>
          `<rect x="${cx * px}" y="${y * px}" width="${px}" height="${px}"/>`;
        cells.push(rect(x));
        cells.push(rect(size - 1 - x));
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="hsl(${hue} 30% 12%)"/><g fill="hsl(${hue} 60% 55%)">${cells.join('')}</g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function Avatar({
  address,
  avatar,
  size = 32,
  alt = '',
}: {
  address: string;
  avatar?: string | null;
  size?: number;
  alt?: string;
}) {
  const fallback = useMemo(() => identicon(address), [address]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatar || fallback}
      alt={alt}
      width={size}
      height={size}
      className="rounded-full ring-1 ring-white/10 object-cover bg-charcoal-card"
      style={{ width: size, height: size }}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).src = fallback;
      }}
    />
  );
}
