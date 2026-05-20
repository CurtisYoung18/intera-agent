const path = require('path')
const fs = require('fs')

// Load env from monorepo root
const rootEnv = path.resolve(__dirname, '../..', '.env.local')
if (fs.existsSync(rootEnv)) {
  for (const line of fs.readFileSync(rootEnv, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

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
      {
        source: '/api/admin/config-changed',
        destination: `${CHAT_API_BASE}/api/admin/config-changed`,
      },
      // Proxy composer-assist (DeepSeek prefix completion) to the chat app
      {
        source: '/api/composer-assist/:path*',
        destination: `${CHAT_API_BASE}/api/composer-assist/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
