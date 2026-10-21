import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/server-api'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/*/admin', '/*/teacher', '/*/student', '/*/attend/', '/*/login', '/*/payments/', '/*/preview', '/api/'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
