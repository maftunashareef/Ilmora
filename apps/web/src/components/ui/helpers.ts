import { LANGS } from '../../i18n/translations'
import type { Lang } from '../../types'

/** Joins the class names that are set. */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

/** The language's own name (O'zbekcha, Русский, English). */
export const langName = (l: Lang) => LANGS.find((x) => x.code === l)?.label ?? l
