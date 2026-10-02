import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, Button, Card, Eyebrow, Field, Icon, Input, LField, Notice, PageTitle, Select, Toggle } from '../../components/ui'
import { UploadField } from '../../components/UploadField'
import { useT } from '../../i18n/useT'
import { useCurrentTeacher } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import type { Teacher } from '../../types'

export function StudioChannel() {
  const { t, tr } = useT()
  const teacher = useCurrentTeacher()
  const perms = useStore((s) => s.site.permissions.teacher)
  const courses = useStore((s) => s.courses.filter((c) => c.teacherId === teacher?.id))
  const playlists = useStore((s) => s.playlists.filter((p) => p.teacherId === teacher?.id))
  const center = useStore((s) => s.centers.find((c) => c.id === teacher?.centerId))
  const { upsertTeacher, notify } = useStore()
  const [draft, setDraft] = useState<Teacher | null>(teacher ?? null)
  useEffect(() => { setDraft(teacher ?? null) }, [teacher?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!teacher || !draft) return null
  const locked = !perms.customizeChannel
  const dirty = JSON.stringify(draft) !== JSON.stringify(teacher)
  const featuredValue = draft.featured ? `${draft.featured.type}:${draft.featured.id}` : ''

  return (
    <div>
      <PageTitle eyebrow={t('dash.teacherStudio')} title={t('studio.channel')} action={<><Link to={`/teachers/${teacher.id}`} className="inline-flex items-center gap-1.5 rounded-control border border-charcoal/15 px-4 py-2.5 text-sm font-medium hover:border-forest/50"><Icon name="external" className="h-3.5 w-3.5" />{t('dash.viewChannel')}</Link><Button disabled={!dirty || locked} onClick={() => { upsertTeacher(draft); notify(t('common.saved')) }}>{t('common.saveChanges')}</Button></>} />
      {locked && <Notice tone="warn" className="mb-6"><Icon name="lock" className="mr-1 inline h-3.5 w-3.5" />{t('studio.lockedByAdmin')}: {t('perm.teacher.customizeChannel')}</Notice>}
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <fieldset disabled={locked} className="space-y-6 disabled:opacity-70">
          <Card className="space-y-5">
            <Eyebrow>{t('studio.channel.banner')} · {t('studio.channel.avatar')}</Eyebrow>
            <div className="grid gap-4 md:grid-cols-2">
              <div><div className="mb-1.5 text-xs font-medium text-charcoal/70">{t('studio.channel.banner')}</div><UploadField kind="image" accept="image/*" value={draft.bannerUpload} onChange={(v) => setDraft({ ...draft, bannerUpload: v })} /></div>
              <div><div className="mb-1.5 text-xs font-medium text-charcoal/70">{t('studio.channel.avatar')}</div><UploadField kind="image" accept="image/*" value={draft.avatarUpload} onChange={(v) => setDraft({ ...draft, avatarUpload: v })} /></div>
            </div>
            <Field label={t('studio.channel.tone')}><div className="flex items-center gap-3"><input type="color" className="h-10 w-16 cursor-pointer rounded-control border border-charcoal/15 bg-paper" value={draft.bannerTone} onChange={(e) => setDraft({ ...draft, bannerTone: e.target.value })} /><span className="font-mono text-xs uppercase text-charcoal/55">{draft.bannerTone}</span></div></Field>
          </Card>
          <Card className="space-y-5">
            <Eyebrow>{t('channel.tab.about')}</Eyebrow>
            <Field label={t('common.name')}><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <LField label={t('studio.channel.titleField')} value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
            <LField label={t('studio.channel.tagline')} value={draft.tagline} onChange={(v) => setDraft({ ...draft, tagline: v })} />
            <LField label={t('studio.channel.bio')} multiline value={draft.bio} onChange={(v) => setDraft({ ...draft, bio: v })} />
            <Field label={t('studio.channel.expertise')}><Input value={draft.expertise.join(', ')} onChange={(e) => setDraft({ ...draft, expertise: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
          </Card>
          <Card className="space-y-5">
            <Eyebrow>{t('studio.channel.featuredPick')}</Eyebrow>
            <Field label={t('channel.featured')}>
              <Select value={featuredValue} onChange={(e) => { const [type, id] = e.target.value.split(':'); setDraft({ ...draft, featured: e.target.value ? { type: type as 'course' | 'playlist', id } : undefined }) }}>
                <option value="">{t('common.none')}</option>
                <optgroup label={t('common.courses')}>{courses.map((c) => <option key={c.id} value={`course:${c.id}`}>{tr(c.title)}</option>)}</optgroup>
                <optgroup label={t('common.playlists')}>{playlists.map((p) => <option key={p.id} value={`playlist:${p.id}`}>{tr(p.title)}</option>)}</optgroup>
              </Select>
            </Field>
            <Toggle checked={draft.channelActive} onChange={(v) => setDraft({ ...draft, channelActive: v })} label={t('studio.channel.active')} description={t('vis.publicHint')} />
          </Card>
        </fieldset>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Eyebrow className="mb-3">{t('common.preview')} · {t('studio.asVisitor')}</Eyebrow>
          <div className="card overflow-hidden p-0">
            <div className="h-28" style={{ background: draft.bannerUpload?.previewUrl ? `url(${draft.bannerUpload.previewUrl}) center/cover` : `linear-gradient(110deg, ${draft.bannerTone} 0%, ${draft.bannerTone}dd 55%, #C8AD7F66 100%)` }} />
            <div className="-mt-9 px-5 pb-5">
              <Avatar name={draft.name || '?'} seed={draft.avatarSeed} size={72} url={draft.avatarUpload?.previewUrl} className="ring-4 ring-paper" />
              <div className="mt-3 font-display text-2xl text-charcoal">{draft.name}</div>
              <div className="text-xs text-charcoal/55">{tr(draft.title)} · {center?.name}</div>
              <p className="mt-3 font-display text-lg italic text-charcoal/70">“{tr(draft.tagline)}”</p>
              <div className="mt-3 flex flex-wrap gap-1">{draft.expertise.map((e) => <span key={e} className="rounded-full bg-sage px-2 py-0.5 text-[11px] text-forest">{e}</span>)}</div>
              <div className="mt-4 flex gap-3 border-t border-charcoal/10 pt-3 text-[11px] text-charcoal/55">{['home', 'courses', 'videos', 'playlists', 'resources', 'about'].map((tab) => <span key={tab}>{t(`channel.tab.${tab}` as 'channel.tab.home')}</span>)}</div>
            </div>
          </div>
          {dirty && <Notice tone="warn" className="mt-3 text-xs">{t('common.unsaved')}</Notice>}
        </aside>
      </div>
    </div>
  )
}
