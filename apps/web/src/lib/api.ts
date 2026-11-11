/**
 * HTTP client for the ILMORA API.
 *  - browser: NEXT_PUBLIC_API_URL, bearer access token kept in memory, refresh through the HTTP-only cookie
 *  - server (RSC / route handlers): API_INTERNAL_URL (docker network) or the public URL, no credentials
 */
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown, public readonly requestId?: string) {
    super(message)
  }
}

const RAW_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
/** Empty string = same origin: the web host proxies `/v1` to the API (next.config.ts rewrites), so the refresh cookie stays first-party. */
export const PUBLIC_API_URL = RAW_PUBLIC_API_URL === '/' || RAW_PUBLIC_API_URL === '' ? '' : RAW_PUBLIC_API_URL.replace(/\/$/, '')
const PREFIX = '/v1'

export const apiBase = (): string => (typeof window === 'undefined' ? (process.env.API_INTERNAL_URL ?? (PUBLIC_API_URL || 'http://localhost:4000')).replace(/\/$/, '') : PUBLIC_API_URL)

let accessToken: string | null = null
const tokenListeners = new Set<(t: string | null) => void>()
export const session = {
  get token() {
    return accessToken
  },
  set(token: string | null) {
    accessToken = token
    tokenListeners.forEach((l) => l(token))
  },
  subscribe(l: (t: string | null) => void) {
    tokenListeners.add(l)
    return () => tokenListeners.delete(l)
  },
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Attach the bearer token (default true in the browser). */
  auth?: boolean
  /** Send cookies (auth refresh/logout endpoints only). */
  credentials?: boolean
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Next.js fetch cache options for server-side calls. */
  next?: { revalidate?: number | false; tags?: string[] }
  cache?: RequestCache
  retryOn401?: boolean
  /** 'blob' — a file (the ministry's Excel): the body comes back as a Blob; errors are read as JSON as usual. */
  responseType?: 'json' | 'blob'
}

/**
 * How a refresh ended: 'ok'; 'denied' — the API rejected the cookie (the session is over); 'limited' — 429, too many
 * refreshes for now (security review 10.11 №19: the cookie is still valid, so the session is kept and the person is
 * asked to try again shortly, never sent to the sign-in page); 'failed' — no answer (network).
 */
export type RefreshOutcome = 'ok' | 'denied' | 'limited' | 'failed'
let refreshing: Promise<RefreshOutcome> | null = null
/** Seconds the API asked to wait after its last 429 on /auth/refresh (`Retry-After`; 30 when it did not say). */
let refreshRetryAfter = 30
export const refreshRetryAfterSeconds = () => refreshRetryAfter
/** The error a request gets while refreshes are limited: «повторите позже», the session stays. */
export const REFRESH_LIMITED = 'session_refresh_limited'

/** Cross-tab lock name and the timestamp the last successful refresh wrote (both tabs share the cookie jar). */
const REFRESH_LOCK = 'ilmora-refresh'
const REFRESHED_AT_KEY = 'ilmora:refreshed-at'
const readRefreshedAt = (): number => {
  try {
    return Number(localStorage.getItem(REFRESHED_AT_KEY)) || 0
  } catch {
    return 0
  }
}
const writeRefreshedAt = () => {
  try {
    localStorage.setItem(REFRESHED_AT_KEY, String(Date.now()))
  } catch {
    /* private mode */
  }
}

/** One POST /auth/refresh (see RefreshOutcome). */
async function postRefresh(): Promise<RefreshOutcome> {
  try {
    const res = await fetch(`${apiBase()}${PREFIX}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'ilmora' } })
    if (res.status === 429) {
      const wait = Number(res.headers.get('Retry-After'))
      refreshRetryAfter = Number.isFinite(wait) && wait > 0 ? Math.min(wait, 300) : 30
      return 'limited'
    }
    if (!res.ok) return 'denied'
    const data = (await res.json()) as { accessToken: string }
    session.set(data.accessToken)
    writeRefreshedAt()
    return 'ok'
  } catch {
    return 'failed'
  }
}

/**
 * The refresh cookie rotates on every call and the API revokes the whole session family when an old cookie is replayed,
 * so two tabs refreshing at once sign both out. Tabs therefore take turns through the Web Locks API; a tab that waited
 * sends the cookie the winner just received. Without Web Locks, a refresh rejected while another tab refreshed is
 * retried once with the new cookie.
 */
async function refreshExclusive(): Promise<RefreshOutcome> {
  const startedAt = Date.now()
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks) {
    const outcome = await locks.request(REFRESH_LOCK, postRefresh)
    if (outcome === 'denied') session.set(null)
    return outcome
  }
  let outcome = await postRefresh()
  if (outcome === 'denied' && readRefreshedAt() >= startedAt) outcome = await postRefresh()
  // Only a rejected cookie ends the session; «limited» and «failed» keep it for the next try.
  if (outcome === 'denied') session.set(null)
  return outcome
}

/** Exchange the refresh cookie for a new access token, and say how it went (see RefreshOutcome). */
export async function refreshSessionOutcome(): Promise<RefreshOutcome> {
  if (typeof window === 'undefined') return 'denied'
  if (!refreshing) {
    refreshing = refreshExclusive().finally(() => {
      setTimeout(() => (refreshing = null), 0)
    })
  }
  return refreshing
}

/** Exchange the refresh cookie for a new access token. Resolves false when there is no new token (any reason). */
export async function refreshSession(): Promise<boolean> {
  return (await refreshSessionOutcome()) === 'ok'
}

/**
 * Called when the API answers 403 `password_change_required`: the account still uses the temporary password from the
 * Super Admin (PR #48). The store marks the account, and the site shows the same change screen as for the flag.
 */
let onPasswordChangeRequired: (() => void) | null = null
export const setPasswordChangeRequiredHandler = (fn: (() => void) | null) => { onPasswordChangeRequired = fn }

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = `${apiBase()}${path.startsWith('/health') ? '' : PREFIX}${path}`
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'ilmora', ...(opts.headers ?? {}) }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const useAuth = opts.auth ?? typeof window !== 'undefined'
  if (useAuth && accessToken) headers.Authorization = `Bearer ${accessToken}`
  const init: RequestInit & { next?: RequestOptions['next'] } = {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: opts.credentials ? 'include' : 'same-origin',
    signal: opts.signal,
    cache: opts.cache,
    next: opts.next,
  }
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (cause) {
    throw new ApiError(0, 'network_error', 'Server bilan aloqa örnatib bölmadi', { cause })
  }
  if (res.status === 401 && useAuth && accessToken && opts.retryOn401 !== false) {
    const outcome = await refreshSessionOutcome()
    if (outcome === 'ok') return api<T>(path, { ...opts, retryOn401: false })
    // №19: refreshes are limited for now — «повторите позже», not «the session is over».
    if (outcome === 'limited') throw new ApiError(429, REFRESH_LIMITED, 'Too many sign-in refreshes; try again shortly', { retryAfter: refreshRetryAfter })
  }
  if (res.status === 204) return undefined as T
  if (opts.responseType === 'blob' && res.ok) return (await res.blob()) as T
  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : undefined
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | undefined)?.error
    if (res.status === 403 && err?.code === 'password_change_required') onPasswordChangeRequired?.()
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? res.statusText, err?.details, err?.requestId)
  }
  return data as T
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError
