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
}

let refreshing: Promise<boolean> | null = null

/** Exchange the refresh cookie for a new access token. Resolves false when there is no valid session. */
export async function refreshSession(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${apiBase()}${PREFIX}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'ilmora' } })
        if (!res.ok) {
          session.set(null)
          return false
        }
        const data = (await res.json()) as { accessToken: string }
        session.set(data.accessToken)
        return true
      } catch {
        return false
      } finally {
        setTimeout(() => (refreshing = null), 0)
      }
    })()
  }
  return refreshing
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = `${apiBase()}${path.startsWith('/payments/') || path.startsWith('/health') ? '' : PREFIX}${path}`
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
  const res = await fetch(url, init)
  if (res.status === 401 && useAuth && accessToken && opts.retryOn401 !== false) {
    const ok = await refreshSession()
    if (ok) return api<T>(path, { ...opts, retryOn401: false })
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : undefined
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | undefined)?.error
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? res.statusText, err?.details, err?.requestId)
  }
  return data as T
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError
