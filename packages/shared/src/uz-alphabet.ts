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
const FINAL_G = new RegExp(`[gG][${MARK}]$`)
const STARTS_WITH_LETTER = /^[A-Za-zĞğÖöŞşÇç]/
const marked = (letter: string) => new RegExp(`${letter}[${MARK}](?=[a-zA-Z])`, 'g')
const MARKED = { O: marked('O'), o: marked('o'), G: marked('G'), g: marked('g'), Gend: new RegExp(`G[${MARK}]$`), gend: new RegExp(`g[${MARK}]$`) }
const ANY_APOS = new RegExp(`[${APOS}]`, 'g')
/** An apostrophe between two letters: the tutuq (ta'lim) or the sign before an ending (Roblox'da). */
const INNER_APOS = new RegExp(`(?<=[A-Za-zĞğÖöŞşÇç])[${APOS}](?=[A-Za-zĞğÖöŞşÇç])`, 'g')
const HAS_DIGRAPH = /sh|ch/i
const HAS_APOS = new RegExp(`[${APOS}]`)
/**
 * Links, e-mail addresses and {placeholders} are never touched. The text is cut at white space and each piece is judged
 * on its own, so the time grows with the length of the text and no more (a stored text is a center's input).
 */
const SPACES = /(\s+)/
const PLACEHOLDER = /(\{\w+\})/
const isAddress = (piece: string): boolean => piece.includes('://') || piece.includes('@') || piece.includes('www.')

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

const LETTER = /[A-Za-z]/
/** Does the English version contain this word as a whole word? (Plain search: no pattern is built from the text.) */
function inEnglish(en: string, word: string): boolean {
  if (en === '' || word === '' || word.length > en.length) return false
  for (let from = 0; ; ) {
    const i = en.indexOf(word, from)
    if (i < 0) return false
    const before = i === 0 ? '' : en[i - 1]
    const after = en[i + word.length] ?? ''
    if (!LETTER.test(before) && !LETTER.test(after)) return true
    from = i + 1
  }
}

/** One word (no hyphen inside): the old marks and digraphs become ILMORA letters, other apostrophes become ’. */
function convertWord(word: string, en: string): string {
  const bare = word.replace(ANY_APOS, '')
  const finalG = STARTS_WITH_LETTER.test(word) && FINAL_G.test(word)
  const oldMark = (OLD_MARK.test(word) || finalG) && bare.toLowerCase() !== 'oclock'
  // A foreign name followed by an Uzbek ending keeps its spelling: Roblox'da -> Roblox’da.
  let cut = word.length - 1
  while (cut >= 0 && !APOS.includes(word[cut])) cut--
  const name = cut >= 3 ? word.slice(0, cut) : ''
  const ending = cut >= 3 ? word.slice(cut + 1) : ''
  if (name && /^[a-z]{2,}$/.test(ending) && /^[A-Z]/.test(name) && (inEnglish(en, name) || name === name.toUpperCase())) return `${name}’${ending}`
  if (!oldMark && !HAS_DIGRAPH.test(word)) return word.replace(INNER_APOS, '’')
  const foreign = inEnglish(en, word) || ENGLISH.has(bare.toLowerCase()) || FOREIGN.test(bare) || INNER_CAPITAL.test(bare)
  if (foreign && !oldMark) return word
  let s = word
    .replace(MARKED.O, 'Ö').replace(MARKED.o, 'ö')
    .replace(MARKED.G, 'Ğ').replace(MARKED.g, 'ğ')
  if (finalG) s = s.replace(MARKED.Gend, 'Ğ').replace(MARKED.gend, 'ğ')
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
  for (const piece of uz.split(SPACES)) {
    if (piece === '' || isAddress(piece)) { out += piece; continue }
    const parts = piece.split(PLACEHOLDER)
    for (let i = 0; i < parts.length; i++) out += i % 2 === 1 ? parts[i] : parts[i].replace(WORD, (w) => convertWord(w, en))
  }
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, out)
  return out
}

/** `pick` for text a visitor reads: an Uzbek text comes out in the ILMORA alphabet. Use `pick` where the stored text itself is needed. */
export function pickDisplay(lang: Lang, l: L | undefined | null): string {
  if (!l) return ''
  return lang === 'uz' && l.uz ? ilmoraUz(l.uz, l.en ?? '') : pick(lang, l)
}
