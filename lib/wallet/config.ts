import { http } from 'wagmi';
import { mainnet } from '@reown/appkit/networks';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import type { AppKitNetwork } from '@reown/appkit/networks';

/**
 * Reown AppKit + wagmi config.
 *
 * Uses the Reown WalletConnect projectId so the AppKit modal offers a QR code
 * for ALL mobile wallets (Rainbow, MetaMask Mobile, Trust, etc.) in addition to
 * injected/EIP-6963 extensions and Coinbase Smart Wallet. The WagmiAdapter
 * wires injected + WalletConnect + Coinbase connectors automatically.
 */
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';

export const projectId =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? '43bdd1b8c477ac4d4a4264a14a8472f8';

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [mainnet];

export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks,
  transports: {
    [mainnet.id]: http(RPC_URL),
  },
  ssr: false,
});

export const config = wagmiAdapter.wagmiConfig;

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
