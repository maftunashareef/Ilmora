import { useEffect, useState } from 'react'
import { Link } from '@/lib/router'
import {
  Avatar,
  Badge,
  Button,
  Card,
  Eyebrow,
  Field,
  Icon,
  Input,
  LField,
  Notice,
  PageTitle,
  Select,
  Toggle,
} from '../../components/ui'
import { UploadField } from '../../components/UploadField'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { useCurrentTeacher } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import type { Teacher } from '../../types'

export function StudioChannel() {
  const { t, tr, lang } = useT()
  const teacher = useCurrentTeacher()
  const perms = useStore((s) => s.site.permissions.teacher)
  const courses = useStore((s) => s.courses.filter((c) => c.teacherId === teacher?.id))
  const playlists = useStore((s) => s.playlists.filter((p) => p.teacherId === teacher?.id))
  const center = useStore((s) => s.centers.find((c) => c.id === teacher?.centerId))
  const teacherSubjects = useStore((s) => s.subjects.filter((sub) => sub.teacherId === teacher?.id))
  const { upsertTeacher, notify } = useStore()

  const [draft, setDraft] = useState<Teacher | null>(teacher ?? null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    setDraft(teacher ?? null)
  }, [teacher?.id])

  if (!teacher || !draft) return null

  const locked = !perms.customizeChannel
  const dirty = JSON.stringify(draft) !== JSON.stringify(teacher)
  const featuredValue = draft.featured ? `${draft.featured.type}:${draft.featured.id}` : ''
  const currentAvatarUrl = draft.avatarUrl || draft.avatarUpload?.previewUrl
  const currentBannerUrl = draft.bannerUrl || draft.bannerUpload?.previewUrl

  const handleSave = async () => {
    if (locked || !dirty) return
    if (!draft.name.trim()) {
      setSaveError(t('auth.err.name'))
      return
    }
    if (draft.avatarUrl && !/^https?:\/\//i.test(draft.avatarUrl)) {
      setSaveError('URL https:// bilan boshlanishi kerak')
      return
    }
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      await upsertTeacher(draft)
      notify(t('common.saved'))
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 4000)
    } catch (err: unknown) {
      setSaveError(apiErrorText(err, lang))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageTitle
        eyebrow={t('dash.teacherStudio')}
        title={t('studio.channel')}
        action={
          <div className="flex items-center gap-2">
            <Link
              to={`/teachers/${teacher.id}`}
              className="inline-flex items-center gap-1.5 rounded-control border border-charcoal/15 bg-paper px-4 py-2.5 text-sm font-medium text-charcoal hover:border-forest/50 hover:text-forest"
            >
              <Icon name="external" className="h-3.5 w-3.5" />
              {t('studio.channel.previewProfile')}
            </Link>
            <Button
              disabled={!dirty || locked || saving}
              onClick={handleSave}
            >
              {saving ? (
                <>
                  <Icon name="upload" className="h-4 w-4 animate-spin" />
                  {t('common.saveChanges')}...
                </>
              ) : (
                t('common.saveChanges')
              )}
            </Button>
          </div>
        }
      />

      {locked && (
        <Notice tone="warn" className="mb-6">
          <Icon name="lock" className="mr-1 inline h-3.5 w-3.5" />
          {t('studio.lockedByAdmin')}: {t('perm.teacher.customizeChannel')}
        </Notice>
      )}

      {saveSuccess && (
        <Notice tone="info" className="mb-6">
          <Icon name="check" className="mr-1 inline h-4 w-4 text-forest" />
          {t('common.saved')}
        </Notice>
      )}

      {saveError && (
        <Notice tone="warn" className="mb-6">
          <Icon name="x" className="mr-1 inline h-4 w-4 text-amber-700" />
          {saveError}
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <fieldset disabled={locked} className="space-y-6 disabled:opacity-70">
          {/* Profile Photo and Banner Card */}
          <Card className="space-y-5">
            <Eyebrow>
              {t('studio.channel.avatar')} · {t('studio.channel.banner')}
            </Eyebrow>

            {/* Profile Photo */}
            <div className="space-y-3">
              <div className="text-xs font-medium text-charcoal/80">
                {t('studio.channel.avatar')}
              </div>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <Avatar
                  name={draft.name || '?'}
                  seed={draft.avatarSeed}
                  size={72}
                  url={currentAvatarUrl}
                  alt={draft.name}
                  className="ring-2 ring-forest/20"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <UploadField
                    kind="image"
                    accept="image/jpeg,image/png,image/webp"
                    value={draft.avatarUpload}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        avatarUpload: v,
                        avatarUrl: v?.previewUrl ? undefined : draft.avatarUrl,
                      })
                    }
                  />
                </div>
              </div>

              {/* Direct image URL input */}
              <Field
                label={t('studio.channel.avatarUrl')}
                hint="HTTPS havola (masalan, CDN yoki shaxsiy rasm manzili)"
              >
                <div className="flex gap-2">
                  <Input
                    placeholder="https://..."
                    value={draft.avatarUrl ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        avatarUrl: e.target.value.trim() || null,
                      })
                    }
                  />
                  {draft.avatarUrl && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDraft({ ...draft, avatarUrl: null })}
                    >
                      {t('common.remove')}
                    </Button>
                  )}
                </div>
              </Field>

              <Notice tone="info" className="text-[12px] leading-relaxed">
                {t('studio.channel.storageUnavailable')}
              </Notice>
            </div>

            {/* Banner Section */}
            <div className="border-t border-charcoal/10 pt-5 space-y-4">
              <div className="text-xs font-medium text-charcoal/80">
                {t('studio.channel.banner')}
              </div>
              <UploadField
                kind="image"
                accept="image/jpeg,image/png,image/webp"
                value={draft.bannerUpload}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    bannerUpload: v,
                    bannerUrl: v?.previewUrl ? undefined : draft.bannerUrl,
                  })
                }
              />
              <Field label={t('studio.channel.tone')}>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    className="h-10 w-16 cursor-pointer rounded-control border border-charcoal/15 bg-paper"
                    value={draft.bannerTone}
                    onChange={(e) =>
                      setDraft({ ...draft, bannerTone: e.target.value })
                    }
                  />
                  <span className="font-mono text-xs uppercase text-charcoal/55">
                    {draft.bannerTone}
                  </span>
                </div>
              </Field>
            </div>
          </Card>

          {/* About / Bio / Credentials Card */}
          <Card className="space-y-5">
            <Eyebrow>{t('channel.tab.about')}</Eyebrow>

            {/* Name */}
            <Field label={t('common.name')}>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>

            {/* Title / Role */}
            <LField
              label={t('studio.channel.titleField')}
              value={draft.title}
              onChange={(v) => setDraft({ ...draft, title: v })}
            />

            {/* Tagline */}
            <LField
              label={t('studio.channel.tagline')}
              value={draft.tagline}
              onChange={(v) => setDraft({ ...draft, tagline: v })}
            />

            {/* Biography */}
            <LField
              label={t('studio.channel.bio')}
              multiline
              value={draft.bio}
              onChange={(v) => setDraft({ ...draft, bio: v })}
            />

            {/* Expertise / Specializations */}
            <Field
              label={t('studio.channel.expertise')}
              hint="Masalan: Matematika, Fizika, IELTS, SAT, Web dasturlash"
            >
              <Input
                value={draft.expertise.join(', ')}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    expertise: e.target.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>

            {/* Quick Suggestions for Spoken Languages and Experience */}
            <div className="rounded-control bg-paper/60 p-3.5 space-y-2 border border-charcoal/10">
              <div className="text-xs font-medium text-charcoal/70">
                {t('studio.channel.languages')} & {t('studio.channel.experience')}
              </div>
              <p className="text-[11px] text-charcoal/50">
                {t('studio.channel.experienceHint')} · {t('studio.channel.languagesHint')}
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[
                  'Özbek tili',
                  'Rus tili',
                  'Ingliz tili',
                  '5+ yil tajriba',
                  'IELTS 8.0+',
                  'Oliy toifa',
                ].map((tag) => {
                  const hasTag = draft.expertise.includes(tag)
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        const next = hasTag
                          ? draft.expertise.filter((x) => x !== tag)
                          : [...draft.expertise, tag]
                        setDraft({ ...draft, expertise: next })
                      }}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                        hasTag
                          ? 'bg-forest text-ivory ring-1 ring-forest'
                          : 'bg-sage/70 text-forest hover:bg-sage'
                      }`}
                    >
                      {hasTag ? <Icon name="check" className="h-3 w-3" /> : <Icon name="plus" className="h-3 w-3" />}
                      {tag}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Configured Subjects */}
            <div className="border-t border-charcoal/10 pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-charcoal/80">
                  {t('studio.subjects')}
                </span>
                <Link
                  to="/teacher/subjects"
                  className="text-xs font-medium text-forest hover:underline inline-flex items-center gap-1"
                >
                  {t('common.edit')} <Icon name="arrowRight" className="h-3 w-3" />
                </Link>
              </div>
              {teacherSubjects.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {teacherSubjects.map((sub) => (
                    <Badge key={sub.id} tone="forest">
                      {tr(sub.name)}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-charcoal/50">
                  {t('common.empty')}
                </p>
              )}
            </div>
          </Card>

          {/* Featured content & Channel visibility */}
          <Card className="space-y-5">
            <Eyebrow>{t('studio.channel.featuredPick')}</Eyebrow>
            <Field label={t('channel.featured')}>
              <Select
                value={featuredValue}
                onChange={(e) => {
                  const [type, id] = e.target.value.split(':')
                  setDraft({
                    ...draft,
                    featured: e.target.value
                      ? { type: type as 'course' | 'playlist', id }
                      : undefined,
                  })
                }}
              >
                <option value="">{t('common.none')}</option>
                <optgroup label={t('common.courses')}>
                  {courses.map((c) => (
                    <option key={c.id} value={`course:${c.id}`}>
                      {tr(c.title)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t('common.playlists')}>
                  {playlists.map((p) => (
                    <option key={p.id} value={`playlist:${p.id}`}>
                      {tr(p.title)}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </Field>
            <Toggle
              checked={draft.channelActive}
              onChange={(v) => setDraft({ ...draft, channelActive: v })}
              label={t('studio.channel.active')}
              description={t('vis.publicHint')}
            />
          </Card>
        </fieldset>

        {/* Live Public Profile Preview Column */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Eyebrow className="mb-3">
            {t('common.preview')} · {t('studio.asVisitor')}
          </Eyebrow>
          <div className="card overflow-hidden p-0 shadow-soft transition-all duration-300">
            <div
              className="h-28 transition duration-500"
              style={{
                background: currentBannerUrl
                  ? `url(${currentBannerUrl}) center/cover`
                  : `linear-gradient(110deg, ${draft.bannerTone} 0%, ${draft.bannerTone}dd 55%, #C8AD7F66 100%)`,
              }}
            />
            <div className="-mt-9 px-5 pb-5">
              <Avatar
                name={draft.name || '?'}
                seed={draft.avatarSeed}
                size={76}
                url={currentAvatarUrl}
                alt={draft.name}
                className="ring-4 ring-paper transition-transform duration-300 hover:scale-105"
              />
              <div className="mt-3 font-display text-2xl text-charcoal">
                {draft.name || 'Ism kiritilmagan'}
              </div>
              <div className="text-xs font-medium text-charcoal/60">
                {tr(draft.title) || 'Lavozim'} · {center?.name ?? 'ILMORA'}
              </div>
              {draft.tagline && (
                <p className="mt-3 font-display text-lg italic text-charcoal/70">
                  “{tr(draft.tagline)}”
                </p>
              )}
              {draft.expertise.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {draft.expertise.map((e) => (
                    <Badge key={e} tone="muted">
                      {e}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="mt-4 flex gap-3 border-t border-charcoal/10 pt-3 text-[11px] text-charcoal/55">
                {['home', 'courses', 'videos', 'playlists', 'resources', 'about'].map(
                  (tab) => (
                    <span key={tab}>
                      {t(`channel.tab.${tab}` as 'channel.tab.home')}
                    </span>
                  )
                )}
              </div>
            </div>
          </div>
          {dirty && (
            <Notice tone="warn" className="mt-3 text-xs">
              {t('common.unsaved')}
            </Notice>
          )}
        </aside>
      </div>
    </div>
  )
}
