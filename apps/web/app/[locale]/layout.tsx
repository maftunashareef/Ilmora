import type { Metadata, Viewport } from 'next'
import { Cormorant_Garamond, Inter, Manrope, Playfair_Display } from 'next/font/google'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { isLang, pick } from '@ilmora/shared'
import { AppProviders } from '@/components/AppProviders'
import { getCatalog, getSite } from '@/lib/server-api'
import { organizationJsonLd, pageMetadata } from '@/lib/seo'
import '../globals.css'

const cormorant = Cormorant_Garamond({ subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600'], style: ['normal', 'italic'], variable: '--font-cormorant', display: 'swap' })
const playfair = Playfair_Display({ subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600'], variable: '--font-playfair', display: 'swap' })
const inter = Inter({ subsets: ['latin', 'cyrillic'], weight: ['300', '400', '500', '600'], variable: '--font-inter', display: 'swap' })
const manrope = Manrope({ subsets: ['latin', 'cyrillic'], weight: ['300', '400', '500', '600'], variable: '--font-manrope', display: 'swap' })

export const viewport: Viewport = { themeColor: '#163C35', width: 'device-width', initialScale: 1 }

/** Rendered per request (site + catalog come from the API with a 60 s data cache); nothing is prerendered at build time. */
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const lang = isLang(locale) ? locale : 'uz'
  const site = await getSite().catch(() => null)
  const name = site?.brand.name ?? 'ILMORA'
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
    title: { default: `${name} — ${pick(lang, site?.brand.heroHeadline) || 'Bitta abonement'}`, template: `%s · ${name}` },
    icons: { icon: [{ url: '/brand/icon-32.png', sizes: '32x32' }, { url: '/brand/icon-192.png', sizes: '192x192' }], apple: '/brand/icon-180.png', shortcut: '/brand/favicon.ico' },
    manifest: '/manifest.webmanifest',
    ...pageMetadata({ locale: lang, path: '/', title: `${name} — ${pick(lang, site?.brand.heroHeadline)}`, description: pick(lang, site?.brand.heroTagline) || 'ILMORA' }),
  }
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLang(locale)) notFound()
  const [site, catalog] = await Promise.all([getSite(), getCatalog()])
  const { version, ...siteData } = site
  const jsonLd = organizationJsonLd(site.brand.name, locale)
  return (
    <html lang={locale} className={`${cormorant.variable} ${playfair.variable} ${inter.variable} ${manrope.variable}`}>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <AppProviders initial={{ lang: locale, site: { ...siteData, version }, catalog }}>{children}</AppProviders>
      </body>
    </html>
  )
}
