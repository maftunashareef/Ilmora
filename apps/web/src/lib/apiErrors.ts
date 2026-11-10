import { translate, type Lang, type TKey } from '@ilmora/shared'
import { isApiError } from './api'

/**
 * API error codes → dictionary keys. The API answers in English, so Uzbek and Russian screens show these texts instead
 * of the raw message. Several codes are shared by related errors (e.g. `in_use`), so each text covers all of them.
 */
export const API_ERROR_KEYS: Record<string, TKey> = {
  network_error: 'auth.err.network',
  internal_error: 'centers.form.serverError',
  not_found: 'apiError.notFound',
  forbidden: 'apiError.forbidden',
  unauthorized: 'apiError.session',
  invalid_token: 'apiError.session',
  invalid_refresh: 'apiError.session',
  unavailable: 'apiError.unavailable',
  rate_limited: 'auth.err.tooMany',
  validation_failed: 'apiError.validation',
  version_conflict: 'apiError.versionConflict',
  // sign-in and registration
  invalid_credentials: 'auth.err.invalid',
  account_disabled: 'auth.err.disabled',
  invalid_phone: 'auth.err.phone',
  invalid_code: 'apiError.invalidCode',
  weak_password: 'auth.err.password',
  invalid_login: 'auth.err.login',
  login_taken: 'auth.err.loginTaken',
  phone_taken: 'auth.err.phoneTaken',
  invalid_role: 'auth.err.role',
  // The API's Google sign-in is still on the server until the API team removes it; the web signs in with a login and password only.
  google_unconfigured: 'auth.err.passwordOnly',
  invalid_google_token: 'auth.err.passwordOnly',
  invalid_google_response: 'auth.err.passwordOnly',
  invalid_google_code: 'auth.err.passwordOnly',
  google_client_mismatch: 'auth.err.passwordOnly',
  missing_google_credential: 'auth.err.passwordOnly',
  incomplete_google_profile: 'auth.err.passwordOnly',
  unverified_email: 'auth.err.passwordOnly',
  consent_required: 'auth.consent.required',
  // center inquiry form
  invalid_contact_name: 'auth.err.name',
  invalid_center_name: 'apiError.centerName',
  teacher_center_required: 'apiError.teacherCenterRequired',
  subscription_closed: 'apiError.subscriptionClosed',
  // registry
  not_approved: 'apiError.notApproved',
  invalid_industry: 'apiError.invalidIndustry',
  invalid_name: 'apiError.invalidName',
  invalid_region: 'apiError.invalidRegion',
  invalid_district: 'apiError.invalidDistrict',
  invalid_job_title: 'apiError.invalidJobTitle',
  already_has_institution: 'apiError.alreadyHasInstitution',
  already_claimed: 'apiError.alreadyClaimed',
  institution_details_required: 'apiError.institutionDetailsRequired',
  under_review: 'apiError.underReview',
  stir_taken: 'apiError.stirTaken',
  invalid_direction: 'apiError.invalidDirection',
  direction_listed_twice: 'apiError.directionListedTwice',
  already_submitted: 'apiError.alreadySubmitted',
  already_approved: 'apiError.alreadyApproved',
  incomplete_profile: 'apiError.incompleteProfile',
  not_pending: 'apiError.notPending',
  // cart and subscription
  full: 'capacity.full',
  duplicate: 'builder.duplicate',
  'no-package': 'builder.pickPackageFirst',
  incomplete: 'apiError.incomplete',
  limit: 'apiError.limit',
  disabled: 'apiError.disabled',
  subscription_exists: 'apiError.subscriptionExists',
  payment_not_pending: 'apiError.paymentNotPending',
  // course and catalog management
  online_fields_on_offline_course: 'apiError.onlineFields',
  online_course_no_discount: 'apiError.onlineNoDiscount',
  online_course_is_free: 'apiError.onlineFree',
  online_course_has_no_groups: 'apiError.onlineNoGroups',
  external_url_required: 'admin.course.linkInvalid',
  provider_required: 'admin.course.linkInvalid',
  has_groups: 'admin.course.formatLocked',
  has_enrollments: 'apiError.hasEnrollments',
  in_use: 'admin.centers.inUse',
  center_required: 'apiError.centerRequired',
  center_teacher_required: 'apiError.centerRequired',
  teacher_required: 'apiError.teacherRequired',
  invalid_schedule: 'apiError.schedule',
  invalid_featured: 'apiError.featured',
  storage_not_configured: 'studio.channel.storageUnavailable',
  storage_unavailable: 'studio.upload.unavailable',
  invalid_site_config: 'apiError.siteConfig',
  // university packages
  invalid_preset_course: 'apiError.presetData',
  unknown_university: 'apiError.presetData',
  duplicate_university: 'apiError.duplicateUniversity',
  unknown_direction: 'apiError.unknownDirection',
  duplicate_direction: 'apiError.duplicateDirection',
  preset_not_ready: 'admin.uni.publishBlocked',
  preset_not_verified: 'admin.uni.publishBlocked',
  published_preset_removed: 'admin.uni.deletePublished',
  // attendance
  session_cancelled: 'apiError.sessionCancelled',
  attendance_closed: 'apiError.attendanceClosed',
  attendance_expired: 'attend.expired',
  not_enrolled: 'apiError.notEnrolled',
  session_exists: 'session.exists',
  has_attendance: 'session.hasAttendance',
  invalid_date: 'apiError.schedule',
  // educational centers
  center_not_approved: 'center.err.notApproved',
  center_blocked: 'center.blockedNotice',
  wrong_center: 'center.err.wrongCenter',
  teacher_not_in_center: 'center.err.teacherNotInCenter',
  teacher_login_not_found: 'center.err.teacherNotFound',
  teacher_elsewhere: 'center.err.teacherElsewhere',
  no_pending_name: 'apiError.versionConflict',
  invalid_course: 'apiError.validation',
  wrong_course: 'apiError.forbidden',
  // Super Admin
  owner_protected: 'admin.accounts.ownerProtected',
  self_roles: 'admin.accounts.selfRoles',
  last_owner: 'admin.accounts.lastOwner',
  center_admin_needs_center: 'admin.accounts.centerRequired',
  center_not_found: 'admin.accounts.centerNotFound',
  self_delete: 'apiError.forbidden',
  lesson_count_required: 'admin.packages.lessonCount',
}

/**
 * The text to show for a failed request. English keeps the API's own (more specific) message; Uzbek and Russian get the
 * translated text for the error code, or a generic one, so no English sentence appears on those screens.
 */
export function apiErrorText(err: unknown, lang: Lang): string {
  if (!isApiError(err)) {
    if (lang === 'en' && err instanceof Error && err.message) return err.message
    return translate(lang, 'apiError.generic')
  }
  // `conflict` is both a duplicate record (409) and two overlapping groups in a selection (422).
  const key = err.code === 'conflict' ? (err.status === 409 ? 'apiError.duplicateRecord' : 'builder.conflictHint') : API_ERROR_KEYS[err.code]
  // The client's own network error message is Uzbek, so it is translated in every language.
  if (lang === 'en' && err.message && err.code !== 'network_error') return err.message
  return translate(lang, key ?? 'apiError.generic')
}
