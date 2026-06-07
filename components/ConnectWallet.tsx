'use client';

import { useAppKit } from '@reown/appkit/react';
import { useAccount } from 'wagmi';
import { useIdentity } from '@/lib/wallet/useIdentity';
import { Avatar } from './Avatar';

/**
 * Reown AppKit connect button. Opens the AppKit modal — which offers a
 * WalletConnect QR code for mobile wallets, injected/EIP-6963 extensions, and
 * Coinbase Smart Wallet. When connected, clicking opens the account view.
 *
 * Drop-in replacement for RainbowKit's <ConnectButton>. Pass `className` to
 * restyle; the default matches the site's sage button.
 */
export function ConnectWallet({
  className,
  label = 'Connect Wallet',
}: {
  className?: string;
  label?: string;
}) {
  const { open } = useAppKit();
  const { isConnected } = useAccount();
  const { identity } = useIdentity();

  return (
    <button
      onClick={() => open()}
      className={
        className ??
        'inline-flex items-center gap-2 rounded-xl bg-sage px-5 py-2.5 text-sm font-600 text-ink shadow-sage transition hover:bg-sage-bright'
      }
    >
      {isConnected && identity ? (
        <>
          <Avatar address={identity.address} avatar={identity.avatar} size={20} />
          <span>{identity.display}</span>
        </>
      ) : (
        label
      )}
    </button>
  );
}
