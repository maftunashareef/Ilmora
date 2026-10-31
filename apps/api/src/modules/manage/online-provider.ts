import { ONLINE_PROVIDER_SLUG } from '@ilmora/shared'

/**
 * ONLINE courses are taken on the provider's own site, so they have no ILMORA center or teacher. The course table still
 * needs both, so they hang on one platform center and one login-less profile with these details. The real provider
 * and instructor are stored on the course as text (providerName / instructorName), never as invented profiles.
 */
export const ONLINE_PROVIDER = {
  slug: ONLINE_PROVIDER_SLUG,
  name: 'ILMORA Online',
  tone: '#163C35',
  district: { uz: 'Onlayn', ru: 'Онлайн', en: 'Online' },
  description: {
    uz: 'Ishonchli ta’lim platformalarining bepul onlayn kurslari. Darslar provayderning o‘z saytida o‘tiladi.',
    ru: 'Бесплатные онлайн-курсы известных образовательных платформ. Обучение проходит на сайте самого провайдера.',
    en: 'Free online courses from established education providers, taken on the provider’s own site.',
  },
  teacherTitle: { uz: 'Onlayn kurslar katalogi', ru: 'Каталог онлайн-курсов', en: 'Online course catalog' },
  teacherTagline: { uz: 'Bepul onlayn ta’lim', ru: 'Бесплатное онлайн-обучение', en: 'Free online learning' },
} as const
