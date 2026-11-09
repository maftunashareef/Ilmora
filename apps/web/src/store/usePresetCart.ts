'use client'
import { MAX_CART_COURSES } from '@ilmora/shared'
import { useT } from '../i18n/useT'
import type { Preset } from '../types'
import { useCurrentStudent } from './selectors'
import { useStore } from './useStore'

/**
 * Adds a ready-made package to the cart in one click and says what happened: added (with a link to the cart), or why
 * nothing was added. Returns whether the package's courses are in the cart now.
 */
export function usePresetCart() {
  const { t, tr } = useT()
  const student = useCurrentStudent()
  const courses = useStore((s) => s.courses)
  const addPresetToCart = useStore((s) => s.addPresetToCart)
  const notify = useStore((s) => s.notify)
  const packages = useStore((s) => s.site.packages)
  return (preset: Preset, opts?: { chosenOptional?: string[]; directionId?: string }): boolean => {
    if (!student) return false
    const r = addPresetToCart(student.id, preset, opts)
    const cart = { to: '/builder#cart', label: t('uni.goToCart') }
    if (r.ok) {
      notify(t('uni.addedToCart', { name: tr(preset.name) }), 'ok', cart)
      if (r.switchedFrom) notify(t('uni.switchedToCustom', { pkg: tr(packages.find((p) => p.id === r.switchedFrom)?.name) }))
      return true
    }
    const course = tr(courses.find((c) => c.id === r.courseId)?.title)
    const text = { full: t('uni.cannotAddFull', { course }), conflict: t('uni.cannotAddConflict', { course }), limit: t('builder.customLimit', { n: MAX_CART_COURSES }), unavailable: t('preset.unavailableHint') }[r.reason]
    notify(text, 'warn', r.reason === 'conflict' || r.reason === 'limit' ? cart : undefined)
    return false
  }
}
