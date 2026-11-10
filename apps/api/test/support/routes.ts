import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { IS_PUBLIC_KEY, ROLES_KEY } from '../../src/common/decorators'
import { APPROVED_KEY } from '../../src/common/registry-access'

export interface Route {
  controller: string
  method: string
  path: string
  public: boolean
  roles: string[]
  approved: string | null
  /** For running the real guards against the route. */
  handler: (...a: unknown[]) => unknown
  cls: new (...a: never[]) => unknown
}

/** Every HTTP route of a Nest module tree with the access metadata the guards read (handler first, then the class). */
export function routesOf(root: unknown): Route[] {
  const seen = new Set<unknown>()
  const controllers: (new (...a: never[]) => unknown)[] = []
  const walk = (m: unknown) => {
    const mod = (m as { module?: unknown })?.module ?? m
    if (!mod || seen.has(mod)) return
    seen.add(mod)
    for (const c of Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, mod as object) ?? []) controllers.push(c)
    for (const i of Reflect.getMetadata(MODULE_METADATA.IMPORTS, mod as object) ?? []) walk(i)
  }
  walk(root)
  const out: Route[] = []
  for (const c of controllers) {
    const base = String(Reflect.getMetadata(PATH_METADATA, c) ?? '')
    for (const key of Object.getOwnPropertyNames(c.prototype)) {
      const h = (c.prototype as Record<string, unknown>)[key]
      if (key === 'constructor' || typeof h !== 'function') continue
      const sub = Reflect.getMetadata(PATH_METADATA, h)
      if (sub === undefined) continue
      const meta = <T>(k: string): T | undefined => Reflect.getMetadata(k, h) ?? Reflect.getMetadata(k, c)
      out.push({
        controller: c.name,
        method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, h) as number],
        path: '/' + [base, String(sub)].map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/'),
        public: !!meta<boolean>(IS_PUBLIC_KEY),
        roles: meta<string[]>(ROLES_KEY) ?? [],
        approved: meta<string>(APPROVED_KEY) ?? null,
        handler: h as (...a: unknown[]) => unknown,
        cls: c,
      })
    }
  }
  return out
}
