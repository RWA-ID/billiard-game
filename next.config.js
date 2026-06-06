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
};

module.exports = nextConfig;
