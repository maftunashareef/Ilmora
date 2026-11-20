import { formatDate, isoToTashkentLocal, tashkentLocalToIso, type Lang } from '@ilmora/shared'

/** A deadline as people in Tashkent read it: the date and the Tashkent time, whatever the browser's time zone. */
export const tashkentDateTime = (iso: string, lang: Lang) => `${formatDate(isoToTashkentLocal(iso).slice(0, 10), lang)}, ${isoToTashkentLocal(iso).slice(11, 16)}`
/** `datetime-local` text typed in Tashkent time ↔ an instant. */
export const toTashkentInput = (iso: string) => isoToTashkentLocal(iso)
export const fromTashkentInput = (local: string) => tashkentLocalToIso(local)
/** Links of a description, one per line, kept only when they are plain https. */
export const linesToLinks = (text: string) => text.split(/\s+/).map((x) => x.trim()).filter(Boolean)
