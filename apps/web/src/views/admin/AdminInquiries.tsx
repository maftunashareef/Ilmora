'use client'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Card, EmptyState, Eyebrow, Icon, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api, isApiError } from '../../lib/api'
import { formatDate, formatTime } from '../../lib/format'
import { useStore } from '../../store/useStore'

interface Inquiry {
  id: string
  centerName: string
  contactName: string
  phoneE164: string
  message: string
  consentAt: string
  createdAt: string
  handledAt: string | null
}

interface InquiryPage {
  page: number
  pageSize: number
  total: number
  items: Inquiry[]
}

export function AdminInquiries() {
  const { t, lang } = useT()
  const roles = useStore((s) => s.auth.user?.roles ?? [])
  const [data, setData] = useState<InquiryPage | null>(null)
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [handlingId, setHandlingId] = useState<string | null>(null)

  const canSee = roles.includes('PLATFORM_ADMIN')

  const load = useCallback(async (p: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api<InquiryPage>(`/admin/inquiries?page=${p}&pageSize=30`)
      setData(res)
      setPage(p)
    } catch (err) {
      setError(isApiError(err) ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const toggleHandled = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setHandlingId(id)
    try {
      const res = await api<{ id: string; handledAt: string | null }>(`/admin/inquiries/${id}/handle`, { method: 'PATCH' })
      setData((prev) => (prev ? {
        ...prev,
        items: prev.items.map((it) => (it.id === id ? { ...it, handledAt: res.handledAt } : it)),
      } : prev))
    } catch (err) {
      setError(isApiError(err) ? err.message : String(err))
    } finally {
      setHandlingId(null)
    }
  }

  useEffect(() => { if (canSee) void load(1) }, [canSee, load])

  if (!canSee) return <Notice tone="warn">{t('auth.noAccessBody')}</Notice>

  const items = data?.items ?? []
  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1

  return (
    <div>
      <PageTitle
        eyebrow={t('dash.admin')}
        title={t('admin.inquiries')}
        subtitle={t('admin.inquiries.subtitle')}
        action={
          <Button size="sm" variant="secondary" onClick={() => void load(page)} disabled={loading}>
            <Icon name="refresh" className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        }
      />

      {error && <Notice tone="warn" className="mb-4">{error}</Notice>}

      {data && (
        <div className="mb-4">
          <Eyebrow>{t('admin.inquiries')} · {data.total}</Eyebrow>
        </div>
      )}

      {items.length === 0 && !loading ? (
        <EmptyState title={t('admin.inquiries.empty')} />
      ) : (
        <div className="space-y-3">
          {items.map((inq) => (
            <Card key={inq.id} className="p-0 overflow-hidden">
              <button
                type="button"
                className="w-full flex items-start gap-4 p-4 text-left hover:bg-ivory/50 transition"
                onClick={() => setExpanded(expanded === inq.id ? null : inq.id)}
                aria-expanded={expanded === inq.id}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sage text-forest">
                  <Icon name="building" className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-charcoal">{inq.centerName}</span>
                    {inq.handledAt ? (
                      <Badge tone="sage"><Icon name="check" className="h-3 w-3 mr-0.5" />{t('admin.inquiries.handled')}</Badge>
                    ) : (
                      <Badge tone="champagne">{t('admin.inquiries.pending')}</Badge>
                    )}
                  </div>
                  <div className="text-sm text-charcoal/60 mt-0.5">
                    {inq.contactName} · {inq.phoneE164}
                  </div>
                  <div className="text-xs text-charcoal/45 mt-1">
                    {t('admin.inquiries.receivedAt')}: {formatDate(inq.createdAt, lang)} {formatTime(inq.createdAt, lang)}
                  </div>
                </div>
                <Icon
                  name={expanded === inq.id ? 'up' : 'down'}
                  className="h-4 w-4 shrink-0 text-charcoal/40 mt-1"
                />
              </button>

              {expanded === inq.id && (
                <div className="border-t border-charcoal/8 bg-ivory/30 px-4 py-4">
                  <dl className="grid gap-3 sm:grid-cols-[140px_1fr]">
                    <dt className="text-xs font-medium uppercase tracking-wider text-charcoal/50 pt-0.5">
                      {t('admin.inquiries.centerName')}
                    </dt>
                    <dd className="text-sm text-charcoal">{inq.centerName}</dd>

                    <dt className="text-xs font-medium uppercase tracking-wider text-charcoal/50 pt-0.5">
                      {t('admin.inquiries.contact')}
                    </dt>
                    <dd className="text-sm text-charcoal">
                      <div>{inq.contactName}</div>
                      <a href={`tel:${inq.phoneE164}`} className="text-forest underline">{inq.phoneE164}</a>
                    </dd>

                    {inq.message && (
                      <>
                        <dt className="text-xs font-medium uppercase tracking-wider text-charcoal/50 pt-0.5">
                          {t('admin.inquiries.message')}
                        </dt>
                        <dd className="text-sm text-charcoal/80 whitespace-pre-wrap">{inq.message}</dd>
                      </>
                    )}

                    <dt className="text-xs font-medium uppercase tracking-wider text-charcoal/50 pt-0.5">
                      {t('admin.inquiries.receivedAt')}
                    </dt>
                    <dd className="text-sm text-charcoal/70">
                      {formatDate(inq.createdAt, lang)} {formatTime(inq.createdAt, lang)}
                    </dd>

                    <dt className="text-xs font-medium uppercase tracking-wider text-charcoal/50 pt-0.5">
                      {t('admin.inquiries.status')}
                    </dt>
                    <dd className="text-sm text-charcoal flex items-center justify-between gap-4">
                      <span>
                        {inq.handledAt ? (
                          <span className="text-forest font-medium">{t('admin.inquiries.handled')} ({formatDate(inq.handledAt, lang)})</span>
                        ) : (
                          <span className="text-champagne font-medium">{t('admin.inquiries.pending')}</span>
                        )}
                      </span>
                      <Button
                        size="sm"
                        variant={inq.handledAt ? 'ghost' : 'secondary'}
                        onClick={(e) => void toggleHandled(inq.id, e)}
                        disabled={handlingId === inq.id}
                      >
                        <Icon name="check" className={`h-3.5 w-3.5 mr-1 ${handlingId === inq.id ? 'animate-spin' : ''}`} />
                        {inq.handledAt ? t('admin.inquiries.markUnhandled') : t('admin.inquiries.markHandled')}
                      </Button>
                    </dd>
                  </dl>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => void load(page - 1)}>
            <Icon name="arrowLeft" className="h-3.5 w-3.5" />
            {t('common.back')}
          </Button>
          <span className="text-sm text-charcoal/60">{page} / {totalPages}</span>
          <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => void load(page + 1)}>
            {t('common.next')}
            <Icon name="arrowRight" className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}
