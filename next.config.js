/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fully static export for IPFS hosting (billiard.eth). No Node runtime, no API routes.
  output: 'export',
  // IPFS gateways serve from /path/ — emit index.html in each route dir.
  trailingSlash: true,
  images: {
    // No server-side image optimization on IPFS.
    unoptimized: true,
  },
  reactStrictMode: true,
  webpack: (config) => {
    // XMTP browser-sdk (@xmtp/wasm-bindings) ships WebAssembly + top-level await.
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    // WalletConnect's pino logger optionally requires pino-pretty (dev only);
    // it's not installed and not needed in the browser bundle — stub it out.
    config.resolve.alias = { ...config.resolve.alias, 'pino-pretty': false };
    return config;
  },
};

module.exports = nextConfig;
