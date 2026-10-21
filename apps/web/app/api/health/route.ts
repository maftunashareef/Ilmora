export const dynamic = 'force-dynamic'

/** Liveness for the container healthcheck and nginx. */
export function GET() {
  return Response.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) })
}
