import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOTS = [join(__dirname, '..'), join(__dirname, '..', '..', 'app')]
const SAFE_REL = 'rel="noopener noreferrer"'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** Lines of `source` whose JSX tag opens a new tab without the safe rel (the tag runs from the `<` before it to the next `>`). */
function unsafeNewTabLinks(source: string): number[] {
  const lines: number[] = []
  for (const m of source.matchAll(/target=["{]["']?_blank/g)) {
    const at = m.index ?? 0
    const tag = source.slice(source.lastIndexOf('<', at), source.indexOf('>', at) + 1)
    if (!tag.includes(SAFE_REL)) lines.push(source.slice(0, at).split('\n').length)
  }
  return lines
}

describe('links that open a new tab', () => {
  it('the check finds a new-tab link without the safe rel', () => {
    expect(unsafeNewTabLinks('<a href={u} target="_blank" rel="noreferrer">x</a>\n<a href={u} target="_blank" rel="noopener noreferrer">y</a>')).toEqual([1])
  })

  it('every link in the web app that opens a new tab carries rel="noopener noreferrer"', () => {
    const files = ROOTS.flatMap(sources)
    const all = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/target=["{]["']?_blank/g)])
    const offenders = files.flatMap((f) => unsafeNewTabLinks(readFileSync(f, 'utf8')).map((line) => `${f}:${line}`))
    expect(all.length).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
