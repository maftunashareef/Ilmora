import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { pick, type Lang } from '@ilmora/shared'
import { JsonLd } from '@/components/JsonLd'
import { CourseDetailPage } from '@/views/next/clients'
import { courseJsonLd, pageMetadata } from '@/lib/seo'
import { getCatalog, getCourse } from '@/lib/server-api'

type Params = Promise<{ locale: Lang; id: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, id } = await params
  const course = await getCourse(id)
  if (!course) notFound()
  return pageMetadata({ locale, path: `/courses/${course.slug ?? course.id}`, title: pick(locale, course.title), description: pick(locale, course.summary), image: course.imageUrl, type: 'article' })
}

export default async function Page({ params }: { params: Params }) {
  const { locale, id } = await params
  const [course, catalog] = await Promise.all([getCourse(id), getCatalog().catch(() => null)])
  // A hidden, draft or deleted course is a real 404 for everyone (М2): the server cannot tell who is looking.
  if (!course) notFound()
  const teacher = catalog?.teachers.find((t) => t.id === course?.teacherId)
  const center = catalog?.centers.find((c) => c.id === course?.centerId)
  return (
    <>
      <JsonLd data={courseJsonLd(course, teacher, center, locale)} />
      <CourseDetailPage />
    </>
  )
}
