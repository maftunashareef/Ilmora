/**
 * Offline demo sign-in opens a client-only mock session with no server account behind it. It is meant for local
 * development and explicit demo deployments, so production builds keep it off unless NEXT_PUBLIC_ENABLE_DEMO_LOGIN
 * is exactly "true". Next inlines both variables at build time.
 */
export const isDemoLoginEnabled = (env: { NODE_ENV?: string; NEXT_PUBLIC_ENABLE_DEMO_LOGIN?: string }): boolean =>
  env.NODE_ENV !== 'production' || env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === 'true'

export const DEMO_LOGIN_ENABLED = isDemoLoginEnabled({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_ENABLE_DEMO_LOGIN: process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN,
})
