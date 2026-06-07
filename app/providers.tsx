'use client';

import { useState, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createAppKit } from '@reown/appkit/react';
import { mainnet } from '@reown/appkit/networks';
import { wagmiAdapter, config, projectId, networks } from '@/lib/wallet/config';

/**
 * Providers: wagmi (via the Reown AppKit adapter) + react-query.
 *
 * createAppKit() is invoked once at module load — it mounts the AppKit modal
 * (with WalletConnect QR for mobile wallets, injected/EIP-6963 extensions, and
 * Coinbase Smart Wallet). No <RainbowKitProvider> wrapper needed; the connect
 * UI is opened imperatively via the useAppKit() hook. See lib/wallet/config.ts.
 */
createAppKit({
  adapters: [wagmiAdapter],
  networks,
  defaultNetwork: mainnet,
  projectId,
  metadata: {
    name: 'billiard.eth',
    description: 'Free online 8-ball pool with your ENS identity.',
    url: 'https://billiard.eth.link',
    icons: ['https://billiard.eth.link/og.png'],
  },
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#d9a441',
    '--w3m-font-family': "'Space Grotesk', system-ui, sans-serif",
    '--w3m-border-radius-master': '2px',
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
