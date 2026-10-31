import { Link } from '@/lib/router'
import { Card, Eyebrow, Icon, Notice, PageTitle, Stat } from '../../components/ui'
import { countLabel, NOUNS } from '@ilmora/shared'
import { useT } from '../../i18n/useT'
import { useStore } from '../../store/useStore'

export function AdminOverview() {
  const { t, tr, lang } = useT()
  const s = useStore()
  const all = [...s.courses, ...s.videos, ...s.playlists, ...s.resources]
  const drafts = all.filter((x) => x.status === 'draft').length
  const privateItems = all.filter((x) => x.visibility === 'private' && x.status === 'published').length
  const review = all.filter((x) => x.reviewRequested).length
  const quick = [
    { to: '/admin/pages', label: t('admin.pages'), icon: 'layers' },
    { to: '/admin/theme', label: t('admin.theme'), icon: 'palette' },
    { to: '/admin/courses', label: t('admin.courses'), icon: 'book' },
    { to: '/admin/content', label: t('admin.content'), icon: 'video' },
    { to: '/admin/packages', label: t('admin.packages'), icon: 'package' },
    { to: '/admin/permissions', label: t('admin.permissions'), icon: 'shield' },
  ]
  return (
    <div>
      <PageTitle eyebrow={t('dash.admin')} title={t('admin.overview.hello')} subtitle={t('admin.overview.body')} />
      <div className="reveal-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('admin.overview.published')} value={s.courses.filter((c) => c.status === 'published').length} hint={countLabel(lang, s.courses.length, NOUNS.course)} />
        <Stat label={t('admin.overview.drafts')} value={drafts} hint={review ? `${review} · ${t('admin.reviewQueue')}` : undefined} />
        <Stat label={t('admin.overview.privateItems')} value={privateItems} />
        <Stat label={t('admin.overview.activeSubs')} value={s.students.filter((x) => x.subscription.status === 'active').length} hint={countLabel(lang, s.students.length, NOUNS.student)} />
      </div>
      {review > 0 && (
        <Notice tone="warn" className="mt-6 flex items-center justify-between gap-3">
          <span><Icon name="warn" className="mr-1 inline h-4 w-4" />{t('admin.reviewQueue')}: {review}</span>
          <Link to="/admin/content" className="font-medium underline">{t('common.open')}</Link>
        </Notice>
      )}
      <div className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section>
          <Eyebrow className="mb-4">{t('admin.overview.quick')}</Eyebrow>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {quick.map((q) => (
              <Link key={q.to} to={q.to} className="card group flex items-center gap-3.5 p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-lift hover:border-forest/30">
                <span className="flex h-11 w-11 items-center justify-center rounded-control bg-sage/70 text-forest transition-colors duration-300 group-hover:bg-forest group-hover:text-ivory shadow-xs"><Icon name={q.icon} className="h-5 w-5" /></span>
                <span className="text-sm font-semibold text-charcoal group-hover:text-forest transition-colors">{q.label}</span>
              </Link>
            ))}
          </div>
        </section>
        <section>
          <Eyebrow className="mb-4">{t('common.demo')}</Eyebrow>
          <Card className="space-y-3 text-sm text-charcoal/70">
            <p>{t('admin.overview.templateNote')}</p>
            <p>{t('perm.superAdminNote')}</p>
            <div className="border-t border-charcoal/10 pt-3 text-xs">
              <div className="flex justify-between py-1"><span>{t('common.centers')}</span><span className="font-medium text-charcoal">{s.centers.length}</span></div>
              <div className="flex justify-between py-1"><span>{t('common.categories')}</span><span className="font-medium text-charcoal">{s.categories.length}</span></div>
              <div className="flex justify-between py-1"><span>{t('common.teachers')}</span><span className="font-medium text-charcoal">{s.teachers.length}</span></div>
              <div className="flex justify-between py-1"><span>{t('common.videos')}</span><span className="font-medium text-charcoal">{s.videos.length}</span></div>
              <div className="flex justify-between py-1"><span>{t('common.resources')}</span><span className="font-medium text-charcoal">{s.resources.length}</span></div>
            </div>
            <div className="border-t border-charcoal/10 pt-3 text-xs text-charcoal/55">{tr(s.site.brand.heroHeadline)} · {s.site.theme.fonts.display} / {s.site.theme.fonts.body}</div>
          </Card>
        </section>
      </div>
    </div>
  )
}
