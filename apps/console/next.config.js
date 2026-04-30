const CHAT_API_BASE = process.env.NEXT_PUBLIC_CHAT_API_URL || 'http://localhost:3000'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@intera/shared'],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  async rewrites() {
    return [
      {
        source: '/api/human-chat',
        destination: `${CHAT_API_BASE}/api/human-chat`,
      },
    ]
  },
}

module.exports = nextConfig
