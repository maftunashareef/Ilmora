import { pick } from './i18n.js'
import type { L, Lang } from './types.js'

/**
 * ILMORA writes Uzbek with its own alphabet: Ğ ğ (for G‘ g‘), Ö ö (O‘ o‘), Ş ş (Sh sh) and Ç ç (Ch ch); see
 * docs/uz-glossary.md. The interface texts are written that way in the code. Centers and admins, however, type their
 * course and teacher texts in the standard alphabet (o‘, g‘, sh, ch), and those texts are stored as typed.
 *
 * `ilmoraUz` shows such a text in the ILMORA alphabet. It only changes what is displayed: nothing is written back, and a
 * text that is already in the ILMORA alphabet comes out unchanged. English words, names and links keep their spelling:
 * a word that also stands in the English version of the same text is left alone, and so is a word that looks English.
 */

/** Every apostrophe-like sign people type; the first six also stand for the old o‘ / g‘ mark (ʼ is only ever the tutuq). */
const MARK = '’\'‘ʻ`´'
const APOS = MARK + 'ʼ'
const WORD = new RegExp(`[A-Za-zĞğÖöŞşÇç${APOS}]+`, 'g')
const OLD_MARK = new RegExp(`[oOgG][${MARK}](?=[a-zA-Z])`)
/** g‘ also ends words (tog‘, bog‘); a word that opens with a quote sign is a quoted word, and its last sign closes the quote. */
const FINAL_G = new RegExp(`^[A-Za-zĞğÖöŞşÇç].*[gG][${MARK}]$`)
const ANY_APOS = new RegExp(`[${APOS}]`, 'g')
/** An apostrophe between two letters: the tutuq (ta'lim) or the sign before an ending (Roblox'da). */
const INNER_APOS = new RegExp(`(?<=[A-Za-zĞğÖöŞşÇç])[${APOS}](?=[A-Za-zĞğÖöŞşÇç])`, 'g')
const HAS_DIGRAPH = /sh|ch/i
const HAS_APOS = new RegExp(`[${APOS}]`)
/** Links, e-mail addresses and {placeholders} are never touched. */
const PROTECTED = /https?:\/\/\S+|\S+@\S+\.\S+|\{\w+\}/g

/** Letter patterns Uzbek words never have: a word with one of them is foreign and keeps its spelling. */
const FOREIGN = /w|c(?!h)|th|ph|ck|tch|sch|ee|oo|ou|igh/i
/** A capital inside a word (ChatGPT, GitHub, JavaScript) marks a product name. */
const INNER_CAPITAL = /[a-z][A-Z]/
/** Common English words with sh / ch that pass the pattern test above. */
const ENGLISH = new Set(
  ('bachelor bash cash challenge change channel chapter chart chat check chess chest child children chip choice church coach coaching dashboard each english fashion finish flash fresh ' +
    'french launch lunch machine march match much pitch polish publish punch push reach refresh research rich search share sharp she shell shift ship shop short shorts shot show spanish speech ' +
    'such teach teacher teaching tech touch turkish which wish').split(' '),
)

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Does the English version contain this word as a whole word? */
const inEnglish = (en: string, word: string): boolean => en !== '' && new RegExp(`(^|[^A-Za-z])${escapeRe(word)}([^A-Za-z]|$)`).test(en)

/** One word (no hyphen inside): the old marks and digraphs become ILMORA letters, other apostrophes become ’. */
function convertWord(word: string, en: string): string {
  const bare = word.replace(ANY_APOS, '')
  const oldMark = (OLD_MARK.test(word) || FINAL_G.test(word)) && bare.toLowerCase() !== 'oclock'
  // A foreign name followed by an Uzbek ending keeps its spelling: Roblox'da -> Roblox’da.
  const tail = new RegExp(`^(.{3,}?)[${APOS}]([a-z]{2,})$`).exec(word)
  if (tail && /^[A-Z]/.test(tail[1]) && (inEnglish(en, tail[1]) || tail[1] === tail[1].toUpperCase())) return `${tail[1]}’${tail[2]}`
  if (!oldMark && !HAS_DIGRAPH.test(word)) return word.replace(INNER_APOS, '’')
  const foreign = inEnglish(en, word) || ENGLISH.has(bare.toLowerCase()) || FOREIGN.test(bare) || INNER_CAPITAL.test(bare)
  if (foreign && !oldMark) return word
  let s = word
    .replace(new RegExp(`O[${MARK}](?=[a-zA-Z])`, 'g'), 'Ö').replace(new RegExp(`o[${MARK}](?=[a-zA-Z])`, 'g'), 'ö')
    .replace(new RegExp(`G[${MARK}](?=[a-zA-Z])`, 'g'), 'Ğ').replace(new RegExp(`g[${MARK}](?=[a-zA-Z])`, 'g'), 'ğ')
  if (FINAL_G.test(word)) s = s.replace(new RegExp(`G[${MARK}]$`), 'Ğ').replace(new RegExp(`g[${MARK}]$`), 'ğ')
  if (!foreign) s = s.replace(/S[Hh]/g, 'Ş').replace(/sh/g, 'ş').replace(/C[Hh]/g, 'Ç').replace(/ch/g, 'ç')
  return s.replace(INNER_APOS, '’')
}

const cache = new Map<string, string>()
const CACHE_LIMIT = 4000

/**
 * A stored Uzbek text as ILMORA shows it. `en` is the English version of the same text, when there is one: its words
 * tell which words of the Uzbek text are English or names.
 */
export function ilmoraUz(uz: string, en: string = ''): string {
  if (!uz || (!HAS_DIGRAPH.test(uz) && !HAS_APOS.test(uz))) return uz
  if (uz === en) return uz // an original title or name kept the same in every language
  const key = `${uz}\u0000${en}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  let out = ''
  let last = 0
  const convertPlain = (text: string) => text.replace(WORD, (w) => convertWord(w, en))
  for (const m of uz.matchAll(PROTECTED)) {
    out += convertPlain(uz.slice(last, m.index)) + m[0]
    last = (m.index ?? 0) + m[0].length
  }
  out += convertPlain(uz.slice(last))
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, out)
  return out
}

/** `pick` for text a visitor reads: an Uzbek text comes out in the ILMORA alphabet. Use `pick` where the stored text itself is needed. */
export function pickDisplay(lang: Lang, l: L | undefined | null): string {
  if (!l) return ''
  return lang === 'uz' && l.uz ? ilmoraUz(l.uz, l.en ?? '') : pick(lang, l)
}
