import { http } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';

/**
 * wagmi + RainbowKit config.
 *
 * Now uses a WalletConnect projectId so the connect modal offers a QR code for
 * ALL mobile wallets (Rainbow, MetaMask Mobile, Trust, etc.) in addition to
 * injected/EIP-6963 extensions and Coinbase Smart Wallet. `getDefaultConfig`
 * wires injected + WalletConnect + Coinbase connectors automatically.
 */
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';

const WC_PROJECT_ID =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? 'af4ba7e87a82fdb5ec859c03b770b4fc';

export const config = getDefaultConfig({
  appName: 'billiard.eth',
  projectId: WC_PROJECT_ID,
  chains: [mainnet],
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
