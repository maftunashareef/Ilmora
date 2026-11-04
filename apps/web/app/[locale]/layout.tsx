import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { isLang, pick } from '@ilmora/shared'
import { AppProviders } from '@/components/AppProviders'
import { getCatalog, getSite } from '@/lib/server-api'
import { organizationJsonLd, pageMetadata } from '@/lib/seo'
import '../globals.css'
// Fonts are self-hosted via @fontsource (woff2 shipped in node_modules), not fetched from Google at build time.
// next/font/google downloaded these during `next build`, which made the Docker image build flaky (network to Google
// Fonts). These imports register the same families; the --font-* CSS variables are set in globals.css.
import '@fontsource/cormorant-garamond/400.css'
import '@fontsource/cormorant-garamond/400-italic.css'
import '@fontsource/cormorant-garamond/500.css'
import '@fontsource/cormorant-garamond/500-italic.css'
import '@fontsource/cormorant-garamond/600.css'
import '@fontsource/cormorant-garamond/600-italic.css'
import '@fontsource-variable/playfair-display'
import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'

export const viewport: Viewport = { themeColor: '#163C35', width: 'device-width', initialScale: 1 }

/** Rendered per request (site + catalog come from the API with a 60 s data cache); nothing is prerendered at build time. */
export const dynamic = 'force-dynamic'
// A sleeping free-tier API can take up to a minute to answer its first request; do not cut the render short before that.
export const maxDuration = 60

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const lang = isLang(locale) ? locale : 'uz'
  const site = await getSite().catch(() => null)
  const name = site?.brand.name ?? 'ILMORA'
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
    icons: { icon: [{ url: '/brand/icon-32.png', sizes: '32x32' }, { url: '/brand/icon-192.png', sizes: '192x192' }], apple: '/brand/icon-180.png', shortcut: '/brand/favicon.ico' },
    manifest: '/manifest.webmanifest',
    ...pageMetadata({ locale: lang, path: '/', title: `${name} — ${pick(lang, site?.brand.heroHeadline)}`, description: pick(lang, site?.brand.heroTagline) || 'ILMORA' }),
    // Last so the spread above cannot replace it: child pages become "Kurslar — ILMORA".
    title: { default: `${name} — ${pick(lang, site?.brand.heroHeadline) || 'Bitta abonement'}`, template: `%s — ${name}` },
  }
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLang(locale)) notFound()
  const [site, catalog] = await Promise.all([getSite(), getCatalog()])
  const { version, ...siteData } = site
  const jsonLd = organizationJsonLd(site.brand.name, locale)
  return (
    <html lang={locale}>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <AppProviders initial={{ lang: locale, site: { ...siteData, version }, catalog }}>{children}</AppProviders>
      </body>
    </html>
  )
}
