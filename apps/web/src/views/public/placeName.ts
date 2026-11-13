import { dict, type TKey } from '../../i18n/translations'

/** A city or country in the reader's language (the stored values are English; unknown ones are shown as stored). */
export const placeName = (t: (key: TKey) => string, value?: string): string => {
  const key = `uni.place.${value}`
  return value ? (key in dict ? t(key as TKey) : value) : ''
}
