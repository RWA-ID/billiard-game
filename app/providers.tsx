'use client';

import { useState, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RainbowKitProvider,
  darkTheme,
  connectorsForWallets,
} from '@rainbow-me/rainbowkit';
import { config } from '@/lib/wallet/config';

/**
 * Providers: wagmi (injected-only config) + react-query + RainbowKit.
 *
 * NOTE: we pass our OWN custom wagmi config (no getDefaultConfig, no
 * WalletConnect projectId). EIP-6963 discovery populates the wallet list, so
 * RainbowKit's ConnectButton works without WC. See lib/wallet/config.ts.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: '#d9a441',
            accentColorForeground: '#14181a',
            borderRadius: 'medium',
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

// connectorsForWallets is re-exported only to keep the injected-only intent
// discoverable; the active connector list lives in lib/wallet/config.ts.
export { connectorsForWallets };
