import { HOMEWORK_COMMENT_MAX, HOMEWORK_DESCRIPTION_MAX, HOMEWORK_LINKS_MAX, HOMEWORK_TEXT_MAX, HOMEWORK_TITLE_MAX, JOURNAL_MARKS } from '@ilmora/shared'
import { z } from 'zod'

const id = z.string().min(1).max(80)
const instant = z.string().datetime()

/** A mark in the group journal: one of the center's own students, one lesson; null clears it. */
export const JournalMarkInput = z.object({ sessionId: id, centerStudentId: id, status: z.enum(JOURNAL_MARKS).nullable() }).strict()
export type JournalMarkInput = z.infer<typeof JournalMarkInput>
export const JournalQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).strict()

/** ZIP is listed so the form can show it is coming; the service refuses it until the second stage. */
const modes = z.array(z.enum(['TEXT', 'LINK', 'ZIP'])).min(1).max(3)
export const HomeworkInput = z.object({
  groupId: id,
  title: z.string().trim().min(1).max(HOMEWORK_TITLE_MAX),
  description: z.string().trim().min(1).max(HOMEWORK_DESCRIPTION_MAX),
  /** UTC instant; the form types it in Tashkent time. */
  dueAt: instant,
  links: z.array(z.string().max(500)).max(HOMEWORK_LINKS_MAX).optional(),
  submitModes: modes,
}).strict()
export type HomeworkInput = z.infer<typeof HomeworkInput>
export const HomeworkPatch = HomeworkInput.omit({ groupId: true }).partial().strict()
export type HomeworkPatch = z.infer<typeof HomeworkPatch>
export const HomeworkListQuery = z.object({ groupId: id }).strict()

export const ExtensionInput = z.object({ studentId: id, dueAt: instant }).strict()
export type ExtensionInput = z.infer<typeof ExtensionInput>
export const GradeInput = z.object({ studentId: id, grade: z.number().int().min(1).max(5), comment: z.string().trim().max(HOMEWORK_COMMENT_MAX).nullable().optional() }).strict()
export type GradeInput = z.infer<typeof GradeInput>
export const SubmissionInput = z.object({ text: z.string().max(HOMEWORK_TEXT_MAX).nullable().optional(), link: z.string().max(500).nullable().optional() }).strict()
export type SubmissionInput = z.infer<typeof SubmissionInput>
