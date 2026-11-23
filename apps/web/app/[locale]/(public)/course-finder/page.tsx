import type { Metadata } from 'next'
import { translate, type Lang } from '@ilmora/shared'
import { pageMetadata, staticTitle } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: Lang }> }): Promise<Metadata> {
  const { locale } = await params
  return pageMetadata({ locale, path: '/course-finder', title: staticTitle(locale, '/course-finder'), description: translate(locale, 'finder.meta') })
}

import { CourseFinderPage } from '@/views/public/CourseFinder'

export default function Page() {
  return <CourseFinderPage />
}
