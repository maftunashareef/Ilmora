'use client'
import type { CenterStudentStatus, HomeworkState, HomeworkSubmitMode, ImportRowError, InviteState, JournalMark, L, Lang, RegistryInstitutionType } from '@ilmora/shared'
import { api } from '../lib/api'

/**
 * The center's students table, the invitation, the group journal and homework (ТЗ 2026-11-18): shapes of the API and its
 * calls. `base` is the center's own `/center` or the Super Admin's `/admin/centers/:id`.
 */

export interface RosterGroup { id: string; name: string; courseTitle: L; via: 'center' | 'ilmora' }
export interface RosterRow {
  id: string
  source: 'CENTER' | 'ILMORA'
  fullName: string
  phone: string | null
  birthDate: string | null
  minor: boolean
  institution: { id: string | null; name: string; type: RegistryInstitutionType | null } | null
  studyYear: number | null
  groups: RosterGroup[]
  parentName: string | null
  parentPhone: string | null
  status: CenterStudentStatus
  startedOn: string | null
  archivedAt: string | null
  attendance: { attended: number; total: number; percent: number | null }
  invite: { state: InviteState; sends: number; sendsLeft: number; expiresAt: string | null }
  parentConsent: 'adult' | 'waiting'
  linked: boolean
}
export interface CenterGroupOption { id: string; name: string; courseId: string; courseTitle: L }
export interface Roster { center: { id: string; name: string; status: string }; total: number; rows: RosterRow[]; groups: CenterGroupOption[] }
export interface RosterFilter { q?: string; status?: CenterStudentStatus; groupId?: string; institution?: string; below?: number; archive?: '0' | '1' }
export interface StudentDraft {
  fullName: string
  phone: string | null
  birthDate: string
  institutionId: string | null
  institutionText: string | null
  institutionType: RegistryInstitutionType | null
  studyYear: number | null
  groupIds: string[]
  parentName: string | null
  parentPhone: string | null
  startedOn: string | null
}
export interface InviteLink { url: string; expiresAt: string; sends: number; sendsLeft: number; to: 'student' | 'parent'; phone: string; centerName: string }
export interface ImportCheck { total: number; ready: number; errors: { row: number; fullName: string; errors: ImportRowError[] }[] }

const qs = (q: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** The file as base64 for the JSON body (a 1000-row .xlsx is far below the API's limit). */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export const centerStudentsApi = (base: string) => ({
  roster: (f: RosterFilter) => api<Roster>(`${base}/students/roster${qs({ ...f })}`),
  detail: (id: string) => api<{ center: { id: string; name: string }; student: RosterRow }>(`${base}/students/${id}`),
  create: (d: StudentDraft) => api<{ student: RosterRow }>(`${base}/students`, { method: 'POST', body: d }),
  update: (id: string, d: Partial<StudentDraft> & { status?: CenterStudentStatus }) => api<{ student: RosterRow }>(`${base}/students/${id}`, { method: 'PATCH', body: d }),
  invite: (id: string) => api<InviteLink>(`${base}/students/${id}/invite`, { method: 'POST', body: {} }),
  exportFile: (f: RosterFilter & { lang: Lang; template?: '1' }) =>
    api<Blob>(`${base}/students/export${qs({ ...f })}`, { responseType: 'blob', headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } }),
  importCheck: (file: string) => api<ImportCheck>(`${base}/students/import/check`, { method: 'POST', body: { file } }),
  importCommit: (file: string) => api<{ created: number }>(`${base}/students/import`, { method: 'POST', body: { file } }),
})

// ───────── the student's side of an invitation ─────────

export interface InvitePreview {
  centerName: string
  fullName: string
  institution: { id: string | null; name: string; type: RegistryInstitutionType | null } | null
  studyYear: number | null
  groups: { name: string; courseTitle: L }[]
  expiresAt: string
}
export interface MyCenter {
  id: string
  source: 'CENTER' | 'ILMORA'
  status: CenterStudentStatus
  center: { id: string; name: string }
  institution: { name: string; type: RegistryInstitutionType | null } | null
  studyYear: number | null
  groups: { id: string; name: string; courseTitle: L }[]
}
export const studentCentersApi = {
  preview: (token: string) => api<InvitePreview>('/students/me/center-invites/preview', { method: 'POST', body: { token } }),
  accept: (body: { token: string; institutionId?: string | null; institutionText?: string | null; institutionType?: RegistryInstitutionType | null; studyYear?: number | null }) =>
    api<{ ok: true; centerName: string }>('/students/me/center-invites/accept', { method: 'POST', body }),
  mine: () => api<MyCenter[]>('/students/me/centers'),
  leave: (id: string) => api<{ ok: true }>(`/students/me/centers/${id}/leave`, { method: 'POST', body: {} }),
}

// ───────── group journal ─────────

export interface JournalSession { id: string; date: string; startsAt: string; endsAt: string; status: string; markable: boolean }
export interface JournalRow {
  kind: 'ilmora' | 'center'
  id: string
  name: string
  editable: boolean
  status?: CenterStudentStatus
  institution: { name: string; type: RegistryInstitutionType | null } | null
  studyYear: number | null
  marks: Record<string, { status: string; method: string }>
  attendance: { attended: number; total: number; percent: number | null }
}
export interface Journal { group: { id: string; name: string; courseId: string; courseTitle: L; centerName: string; timezone: string }; month: string; today: string; sessions: JournalSession[]; rows: JournalRow[] }
export const journalApi = {
  get: (groupId: string, month?: string) => api<Journal>(`/teacher/groups/${groupId}/attendance${qs({ month })}`),
  mark: (groupId: string, body: { sessionId: string; centerStudentId: string; status: JournalMark | null }) => api(`/teacher/groups/${groupId}/attendance/marks`, { method: 'PUT', body }),
}

// ───────── homework ─────────

export interface Homework { id: string; groupId: string; title: string; description: string; links: string[]; submitModes: HomeworkSubmitMode[]; dueAt: string; createdAt: string; updatedAt: string }
export interface Submission { id: string; text: string | null; link: string | null; submittedAt: string; grade: number | null; comment: string | null; gradedAt: string | null }
export interface HomeworkDraft { title: string; description: string; dueAt: string; links: string[]; submitModes: HomeworkSubmitMode[] }
export interface TeacherHomeworkList { group: { id: string; name: string; courseTitle: L; centerName: string }; students: number; items: (Homework & { submitted: number })[] }
export interface TeacherHomeworkDetail {
  homework: Homework
  group: { id: string; name: string; courseTitle: L }
  students: { id: string; name: string; via: 'ilmora' | 'center'; state: HomeworkState; last: Submission | null; history: Submission[]; extendedTo: string | null }[]
}
export interface StudentHomework extends Homework {
  group: { id: string; name: string; courseTitle: L; centerName: string }
  state: HomeworkState
  last: Submission | null
  extendedTo: string | null
  open: boolean
  deadline: string
}
export interface StudentHomeworkDetail { homework: Homework; group: { id: string; name: string; courseTitle: L; centerName: string }; state: HomeworkState; submissions: Submission[]; extendedTo: string | null; open: boolean; deadline: string }

export const teacherHomeworkApi = {
  list: (groupId: string) => api<TeacherHomeworkList>(`/teacher/homework${qs({ groupId })}`),
  create: (groupId: string, d: HomeworkDraft) => api<Homework>('/teacher/homework', { method: 'POST', body: { groupId, ...d } }),
  update: (id: string, d: Partial<HomeworkDraft>) => api<Homework>(`/teacher/homework/${id}`, { method: 'PATCH', body: d }),
  remove: (id: string) => api(`/teacher/homework/${id}`, { method: 'DELETE' }),
  detail: (id: string) => api<TeacherHomeworkDetail>(`/teacher/homework/${id}`),
  extend: (id: string, studentId: string, dueAt: string) => api(`/teacher/homework/${id}/extensions`, { method: 'POST', body: { studentId, dueAt } }),
  grade: (id: string, studentId: string, grade: number, comment: string | null) => api<Submission>(`/teacher/homework/${id}/grades`, { method: 'POST', body: { studentId, grade, comment } }),
}
export const studentHomeworkApi = {
  list: () => api<StudentHomework[]>('/students/me/homework'),
  detail: (id: string) => api<StudentHomeworkDetail>(`/students/me/homework/${id}`),
  submit: (id: string, body: { text?: string | null; link?: string | null }) => api<Submission>(`/students/me/homework/${id}/submissions`, { method: 'POST', body }),
}
