import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { pick, type Lang } from '@ilmora/shared'
import { JsonLd } from '@/components/JsonLd'
import { TeacherChannelPage } from '@/views/next/clients'
import { pageMetadata, teacherJsonLd } from '@/lib/seo'
import { getCatalog, getTeacher } from '@/lib/server-api'

type Params = Promise<{ locale: Lang; id: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, id } = await params
  const data = await getTeacher(id)
  if (!data || !data.teacher.channelActive) notFound()
  const t = data.teacher
  return pageMetadata({ locale, path: `/teachers/${t.slug ?? t.id}`, title: `${t.name} — ${pick(locale, t.title)}`, description: pick(locale, t.bio), type: 'article' })
}

export default async function Page({ params }: { params: Params }) {
  const { locale, id } = await params
  const [data, catalog] = await Promise.all([getTeacher(id), getCatalog().catch(() => null)])
  // No such teacher, or the channel is turned off: a real 404 for everyone (М2, security review №21).
  if (!data || !data.teacher.channelActive) notFound()
  const center = catalog?.centers.find((c) => c.id === data.teacher.centerId)
  return (
    <>
      <JsonLd data={teacherJsonLd(data.teacher, center, locale)} />
      <TeacherChannelPage />
    </>
  )
}
