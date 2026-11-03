/**
 * Pure rules for check-ins with a center's standing QR code, shared by the API (the decision) and the web app
 * (showing a student what is possible right now). Times are absolute instants; the window is the center's setting.
 */

export interface CheckInWindowInput {
  startsAt: string | Date
  /** Minutes before the start when check-in opens. */
  beforeMin: number
  /** Minutes after the start when check-in closes (absences are recorded then). */
  afterMin: number
}

export type CheckInWindowState = 'early' | 'open' | 'late'

export interface CheckInWindow {
  state: CheckInWindowState
  opensAt: Date
  closesAt: Date
}

const toDate = (v: string | Date) => (v instanceof Date ? v : new Date(v))

/** Where `now` falls relative to the check-in window of one lesson. */
export function checkInWindow(input: CheckInWindowInput, now = new Date()): CheckInWindow {
  const start = toDate(input.startsAt).getTime()
  const opensAt = new Date(start - Math.max(0, input.beforeMin) * 60_000)
  const closesAt = new Date(start + Math.max(0, input.afterMin) * 60_000)
  const t = now.getTime()
  return { state: t < opensAt.getTime() ? 'early' : t > closesAt.getTime() ? 'late' : 'open', opensAt, closesAt }
}

export interface GeoPoint {
  lat: number
  lng: number
}

/** Great-circle distance in metres (haversine on a 6 371 km sphere; accurate to well under 1 % over a city). */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export interface CenterLocation {
  lat: number | null
  lng: number | null
  geoRadiusM: number | null
}

/** True when the center asks for a location check (all three settings present). */
export const requiresLocation = (c: CenterLocation): c is { lat: number; lng: number; geoRadiusM: number } =>
  typeof c.lat === 'number' && typeof c.lng === 'number' && typeof c.geoRadiusM === 'number' && c.geoRadiusM > 0

export type LocationCheck = 'not-required' | 'ok' | 'location-required' | 'too-far'

/**
 * Location rule: nothing to check unless the center has a location and radius; then coordinates are required and the
 * reported accuracy (metres, optional) is allowed as slack so an imprecise phone fix on site is not refused.
 */
export function checkLocation(center: CenterLocation, point: (GeoPoint & { accuracyM?: number }) | null | undefined): { result: LocationCheck; distanceM: number | null } {
  if (!requiresLocation(center)) return { result: 'not-required', distanceM: null }
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return { result: 'location-required', distanceM: null }
  const distanceM = haversineMeters(center, point)
  const slack = Math.min(Math.max(0, point.accuracyM ?? 0), center.geoRadiusM)
  return { result: distanceM <= center.geoRadiusM + slack ? 'ok' : 'too-far', distanceM }
}

/** Why a center QR check-in is refused; the web app shows a matching message for each. */
export type CenterCheckInFailure =
  | 'invalid-code'
  | 'center-blocked'
  | 'wrong-center'
  | 'not-enrolled'
  | 'blocked'
  | 'cancelled'
  | 'early'
  | 'late'
  | 'location-required'
  | 'too-far'
