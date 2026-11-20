import { CENTER_STUDENT_STATUSES, FULL_NAME_MAX, IMPORT_MAX_BYTES, INSTITUTION_TEXT_MAX, REGISTRY_INSTITUTION_TYPES, STUDY_YEAR_MAX } from '@ilmora/shared'
import { z } from 'zod'

const id = z.string().min(1).max(80)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
const phone = z.string().trim().max(30)

/** A student the center adds by hand (ТЗ 4.3). Phones are normalised and checked by the service (adult / minor rules). */
export const CenterStudentInput = z.object({
  fullName: z.string().trim().min(2).max(FULL_NAME_MAX),
  phone: phone.nullable().optional(),
  birthDate: isoDate,
  /** From the registry; or, when it is not there, the name typed by hand with its type. */
  institutionId: id.nullable().optional(),
  institutionText: z.string().trim().max(INSTITUTION_TEXT_MAX).nullable().optional(),
  institutionType: z.enum(REGISTRY_INSTITUTION_TYPES).nullable().optional(),
  studyYear: z.number().int().min(1).max(STUDY_YEAR_MAX).nullable().optional(),
  /** The center's own groups only (checked by the service). */
  groupIds: z.array(id).max(20).optional(),
  parentName: z.string().trim().max(FULL_NAME_MAX).nullable().optional(),
  parentPhone: phone.nullable().optional(),
  startedOn: isoDate.nullable().optional(),
}).strict()
export type CenterStudentInput = z.infer<typeof CenterStudentInput>

/** Edit: any field of the form, and the status (LEFT sends the record to the archive, another status brings it back). */
export const CenterStudentPatch = CenterStudentInput.partial().extend({ status: z.enum(CENTER_STUDENT_STATUSES).optional() }).strict()
export type CenterStudentPatch = z.infer<typeof CenterStudentPatch>

/** The table's search and filters (4.2); `archive=1` is the archive tab. */
export const RosterQuery = z.object({
  q: z.string().trim().max(60).optional(),
  status: z.enum(CENTER_STUDENT_STATUSES).optional(),
  groupId: id.optional(),
  institution: z.string().trim().max(INSTITUTION_TEXT_MAX).optional(),
  below: z.coerce.number().int().min(1).max(100).optional(),
  archive: z.enum(['0', '1']).optional(),
}).strict()
export type RosterQuery = z.infer<typeof RosterQuery>

/** Excel export: the same filters, the language of the header, or the empty template. */
export const RosterExportQuery = RosterQuery.extend({ lang: z.enum(['uz', 'ru', 'en']).default('ru'), template: z.enum(['0', '1']).optional() }).strict()
export type RosterExportQuery = z.infer<typeof RosterExportQuery>

/** Excel import: the .xlsx as base64 (a 1000-row file is far below the limit). */
export const RosterImportBody = z.object({ file: z.string().min(1).max(Math.ceil((IMPORT_MAX_BYTES * 4) / 3) + 8).regex(/^[A-Za-z0-9+/]+=*$/, 'base64') }).strict()
export type RosterImportBody = z.infer<typeof RosterImportBody>

/** The student's side of an invitation: the token from the link (body only, never the URL). */
export const InviteTokenBody = z.object({ token: z.string().min(20).max(120).regex(/^[A-Za-z0-9_-]+$/) }).strict()
export type InviteTokenBody = z.infer<typeof InviteTokenBody>
/** Accepting: the token, and the place of study the student confirms or corrects (4.3, step 4). */
export const InviteAcceptBody = InviteTokenBody.extend({
  institutionId: id.nullable().optional(),
  institutionText: z.string().trim().max(INSTITUTION_TEXT_MAX).nullable().optional(),
  institutionType: z.enum(REGISTRY_INSTITUTION_TYPES).nullable().optional(),
  studyYear: z.number().int().min(1).max(STUDY_YEAR_MAX).nullable().optional(),
}).strict()
export type InviteAcceptBody = z.infer<typeof InviteAcceptBody>
