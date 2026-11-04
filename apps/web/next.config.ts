import bundleAnalyzer from '@next/bundle-analyzer'
import type { NextConfig } from 'next'
import path from 'node:path'

const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === 'true' })

/** '' or '/' means the browser reaches the API through this host (rewrites below); the CSP then needs no extra origin. */
const SAME_ORIGIN_API = process.env.NEXT_PUBLIC_API_URL === '' || process.env.NEXT_PUBLIC_API_URL === '/'
const apiOrigin = (() => {
  if (SAME_ORIGIN_API) return ''
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').origin
  } catch {
    return 'http://localhost:4000'
  }
})()

/** Remote images only from the configured S3-compatible public bucket (narrow pattern, no wildcards hosts). */
const remotePatterns = (() => {
  const base = process.env.NEXT_PUBLIC_MEDIA_BASE_URL
  if (!base) return []
  try {
    const u = new URL(base)
    return [{ protocol: u.protocol.replace(':', '') as 'http' | 'https', hostname: u.hostname, port: u.port || undefined, pathname: `${u.pathname.replace(/\/$/, '')}/**` }]
  } catch {
    return []
  }
})()

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // React dev tooling needs eval; production bundles never do.
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: ${remotePatterns.map((p) => `${p.protocol}://${p.hostname}${p.port ? `:${p.port}` : ''}`).join(' ')}`.trim(),
      "font-src 'self' data:",
      "media-src 'self' blob:",
      // Lesson videos are embedded from YouTube (privacy-enhanced no-cookie host) and Vimeo; without frame-src these
      // iframes fall back to default-src 'self' and never load. Kept to the exact player origins used in embedFor().
      "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com",
      `connect-src 'self' ${apiOrigin}`.trim(),
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://checkout.paycom.uz https://test.paycom.uz https://my.click.uz",
    ].join('; '),
  },
]

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
