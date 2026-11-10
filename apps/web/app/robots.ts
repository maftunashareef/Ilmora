import type { MetadataRoute } from 'next'
import { disallowedPaths } from '@/lib/robotsRules'
import { SITE_URL } from '@/lib/server-api'

// APP_SURFACE is read when the container starts, not when the image is built (one image serves both domains).
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  // The admin domain has nothing for a search engine.
  if (process.env.APP_SURFACE === 'admin') return { rules: [{ userAgent: '*', disallow: '/' }] }
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: disallowedPaths() }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
