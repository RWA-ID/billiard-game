import { createConfig, http } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { injected, coinbaseWallet } from 'wagmi/connectors';

/**
 * wagmi config — INJECTED / EIP-6963 ONLY. No WalletConnect.
 *
 * We deliberately do NOT use RainbowKit `getDefaultConfig` (it requires a
 * WalletConnect projectId) and do NOT register the `walletConnect` connector.
 * EIP-6963 multi-injected discovery surfaces MetaMask / Rabby / Brave / etc.
 * automatically, and the Coinbase connector works via its injected/SDK path.
 */
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';

export const config = createConfig({
  chains: [mainnet],
  connectors: [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: 'billiard.eth' }),
  ],
  transports: {
    [mainnet.id]: http(RPC_URL),
  },
  ssr: false,
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
