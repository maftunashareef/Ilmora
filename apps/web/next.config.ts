import bundleAnalyzer from '@next/bundle-analyzer'
import type { NextConfig } from 'next'
import path from 'node:path'
import { remotePatterns, SAME_ORIGIN_API, securityHeaders } from './security-headers'

const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === 'true' })

const nextConfig: NextConfig = {
  // Standalone bundle for the Docker image (apps/web/Dockerfile).
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  reactStrictMode: true,
  poweredByHeader: false,
  images: { remotePatterns, formats: ['image/avif', 'image/webp'] },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  /** Same-origin API mode (NEXT_PUBLIC_API_URL='/'): proxy the browser's API calls to API_INTERNAL_URL. */
  async rewrites() {
    const target = process.env.API_INTERNAL_URL?.replace(/\/$/, '')
    if (!SAME_ORIGIN_API || !target) return []
    return [{ source: '/v1/:path*', destination: `${target}/v1/:path*` }]
  },
}

export default withBundleAnalyzer(nextConfig)
