import { Button, Card, Eyebrow, Field, Icon, LField, PageTitle, Select, Toggle } from '../../components/ui'
import { cx } from '../../components/ui/helpers'
import { emptyL, useT } from '../../i18n/useT'
import { uid, useStore } from '../../store/useStore'
import type { Announcement, FaqItem } from '../../types'

export function AdminAnnouncements() {
  const { t } = useT()
  const anns = useStore((s) => s.site.announcements)
  const faq = useStore((s) => s.site.faq)
  const patchSite = useStore((s) => s.patchSite)
  const setAnns = (list: Announcement[]) => patchSite((s) => ({ ...s, announcements: list }))
  const setFaq = (list: FaqItem[]) => patchSite((s) => ({ ...s, faq: list }))
  const moveFaq = (i: number, d: -1 | 1) => { const list = [...faq]; const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; setFaq(list) }
  return (
    <div>
      <PageTitle eyebrow={t('dash.admin')} title={t('admin.announcements')} />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between"><Eyebrow>{t('feature.announcements')}</Eyebrow><Button size="sm" onClick={() => setAnns([...anns, { id: uid('a'), title: emptyL(), body: emptyL(), audience: 'all', enabled: true }])}><Icon name="plus" className="h-3.5 w-3.5" />{t('admin.ann.add')}</Button></div>
          <div className="space-y-3">
            {anns.map((a) => (
              <Card key={a.id} className={cx('space-y-3', !a.enabled && 'opacity-60')}>
                <div className="flex items-center justify-between gap-3">
                  <Field label={t('admin.ann.audience')} className="w-44"><Select value={a.audience} onChange={(e) => setAnns(anns.map((x) => (x.id === a.id ? { ...x, audience: e.target.value as Announcement['audience'] } : x)))}><option value="all">{t('admin.ann.audience.all')}</option><option value="students">{t('admin.ann.audience.students')}</option><option value="teachers">{t('admin.ann.audience.teachers')}</option></Select></Field>
                  <div className="flex items-center gap-2"><Toggle checked={a.enabled} onChange={(v) => setAnns(anns.map((x) => (x.id === a.id ? { ...x, enabled: v } : x)))} /><Button size="sm" variant="danger" onClick={() => setAnns(anns.filter((x) => x.id !== a.id))} aria-label={t('common.delete')}><Icon name="trash" className="h-3.5 w-3.5" /></Button></div>
                </div>
                <LField label={t('common.title')} value={a.title} onChange={(v) => setAnns(anns.map((x) => (x.id === a.id ? { ...x, title: v } : x)))} />
                <LField label={t('common.body')} multiline value={a.body} onChange={(v) => setAnns(anns.map((x) => (x.id === a.id ? { ...x, body: v } : x)))} />
              </Card>
            ))}
          </div>
        </section>
        <section>
          <div className="mb-3 flex items-center justify-between"><Eyebrow>FAQ · {faq.length}</Eyebrow><Button size="sm" onClick={() => setFaq([...faq, { id: uid('f'), q: emptyL(), a: emptyL() }])}><Icon name="plus" className="h-3.5 w-3.5" />{t('admin.faq.add')}</Button></div>
          <div className="space-y-3">
            {faq.map((f, i) => (
              <Card key={f.id} className="space-y-3">
                <div className="flex items-center justify-between"><span className="font-display text-lg text-champagne">{String(i + 1).padStart(2, '0')}</span><div className="flex gap-0.5"><Button size="sm" variant="ghost" disabled={i === 0} onClick={() => moveFaq(i, -1)} aria-label={t('common.moveUp')}><Icon name="up" className="h-4 w-4" /></Button><Button size="sm" variant="ghost" disabled={i === faq.length - 1} onClick={() => moveFaq(i, 1)} aria-label={t('common.moveDown')}><Icon name="down" className="h-4 w-4" /></Button><Button size="sm" variant="danger" onClick={() => setFaq(faq.filter((x) => x.id !== f.id))} aria-label={t('common.delete')}><Icon name="trash" className="h-3.5 w-3.5" /></Button></div></div>
                <LField label={t('admin.faq.q')} value={f.q} onChange={(v) => setFaq(faq.map((x) => (x.id === f.id ? { ...x, q: v } : x)))} />
                <LField label={t('admin.faq.a')} multiline value={f.a} onChange={(v) => setFaq(faq.map((x) => (x.id === f.id ? { ...x, a: v } : x)))} />
              </Card>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
