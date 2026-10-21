import type { Metadata } from 'next'
import { pick, type L, type Lang } from '@ilmora/shared'
import { SITE_URL } from './server-api'

export const LOCALES: Lang[] = ['uz', 'ru', 'en']
const OG_LOCALE: Record<Lang, string> = { uz: 'uz_UZ', ru: 'ru_RU', en: 'en_US' }

/** Canonical + hreflang alternates for a path without the locale prefix ("/courses/bazis"). */
export function alternatesFor(path: string, locale: Lang): NonNullable<Metadata['alternates']> {
  const clean = path === '/' ? '' : path
  return {
    canonical: `${SITE_URL}/${locale}${clean}`,
    languages: { ...Object.fromEntries(LOCALES.map((l) => [l, `${SITE_URL}/${l}${clean}`])), 'x-default': `${SITE_URL}/uz${clean}` },
  }
}

export function pageMetadata(opts: { locale: Lang; path: string; title: string; description: string; image?: string; noindex?: boolean; type?: 'website' | 'article' }): Metadata {
  const image = opts.image ?? `${SITE_URL}/brand/og-default.png`
  return {
    title: opts.title,
    description: opts.description,
    alternates: alternatesFor(opts.path, opts.locale),
    robots: opts.noindex ? { index: false, follow: false } : undefined,
    openGraph: {
      title: opts.title,
      description: opts.description,
      url: `${SITE_URL}/${opts.locale}${opts.path === '/' ? '' : opts.path}`,
      siteName: 'ILMORA',
      locale: OG_LOCALE[opts.locale],
      alternateLocale: LOCALES.filter((l) => l !== opts.locale).map((l) => OG_LOCALE[l]),
      type: opts.type ?? 'website',
      images: [{ url: image, width: 1200, height: 630, alt: 'ILMORA' }],
    },
    twitter: { card: 'summary_large_image', title: opts.title, description: opts.description, images: [image] },
  }
}

export const l = (lang: Lang, v: L | undefined | null) => pick(lang, v)

/** Only factual structured data: no ratings, reviews or invented offers beyond the published monthly price. */
export function courseJsonLd(course: { title: L; summary: L; description: L; price: number; currency?: string; durationMonths: number; slug?: string; id: string; imageUrl?: string }, teacher: { name: string } | undefined, center: { name: string; district?: L } | undefined, lang: Lang) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: l(lang, course.title),
    description: l(lang, course.summary) || l(lang, course.description),
    url: `${SITE_URL}/${lang}/courses/${course.slug ?? course.id}`,
    image: course.imageUrl,
    provider: center ? { '@type': 'EducationalOrganization', name: center.name, address: center.district ? { '@type': 'PostalAddress', addressLocality: 'Tashkent', addressRegion: l(lang, center.district) } : undefined } : undefined,
    instructor: teacher ? { '@type': 'Person', name: teacher.name } : undefined,
    inLanguage: lang,
    offers: { '@type': 'Offer', price: course.price, priceCurrency: course.currency ?? 'UZS', category: 'Monthly subscription', availability: 'https://schema.org/InStock' },
    hasCourseInstance: { '@type': 'CourseInstance', courseMode: 'Onsite', courseWorkload: `P${course.durationMonths}M` },
  }
}

export function teacherJsonLd(teacher: { name: string; title: L; bio: L; slug?: string; id: string; expertise: string[] }, center: { name: string } | undefined, lang: Lang) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: teacher.name,
    jobTitle: l(lang, teacher.title),
    description: l(lang, teacher.bio),
    knowsAbout: teacher.expertise,
    worksFor: center ? { '@type': 'EducationalOrganization', name: center.name } : undefined,
    url: `${SITE_URL}/${lang}/teachers/${teacher.slug ?? teacher.id}`,
  }
}

export function organizationJsonLd(name: string, lang: Lang) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url: `${SITE_URL}/${lang}`,
    logo: `${SITE_URL}/brand/ilmora-logo.png`,
    areaServed: { '@type': 'City', name: 'Tashkent' },
  }
}

const STATIC_TITLES: Record<string, L> = {
  '/courses': { uz: 'Kurslar', ru: 'Курсы', en: 'Courses' },
  '/teachers': { uz: 'O‘qituvchilar', ru: 'Преподаватели', en: 'Teachers' },
  '/builder': { uz: 'Abonement', ru: 'Абонемент', en: 'Subscription' },
  '/how-it-works': { uz: 'Qanday ishlaydi', ru: 'Как это работает', en: 'How it works' },
  '/centers': { uz: 'Markazlar uchun', ru: 'Для центров', en: 'For centers' },
  '/faq': { uz: 'Savol-javob', ru: 'FAQ', en: 'FAQ' },
}
export const staticTitle = (lang: Lang, path: string) => pick(lang, STATIC_TITLES[path]) || 'ILMORA'
