export const TEACHER_PHOTOGRAPHS: Record<string, string> = {
  // English & IELTS
  't-dilnoza': '/images/teachers/dilnoza-karimova.jpg',
  // Mathematics & Olympiad
  't-jamshid': '/images/teachers/jamshid-toshpulatov.jpg',
  // Frontend & IT Mentor
  't-aziza': '/images/teachers/aziza-rahimova.jpg',
  // Furniture & Master Craftsman
  't-bekzod': '/images/teachers/bekzod-nazarov.jpg',
  // Interior Design & 3D Visualization
  't-malika': '/images/teachers/malika-yusupova.jpg',
}

/**
 * Resolves teacher profile photo URL with deterministic fallback priority:
 * 1. Active upload preview URL (local blob in Studio)
 * 2. Explicit avatarUrl (from API, CDN, or custom HTTPS URL)
 * 3. Seeded static photograph for demo teachers
 * 4. null (triggers the consistent warm neutral brand placeholder)
 */
export function getTeacherAvatarUrl(teacher?: {
  id?: string
  avatarUrl?: string | null
  avatarUpload?: { previewUrl?: string }
} | null): string | null {
  if (!teacher) return null
  if (teacher.avatarUpload?.previewUrl) return teacher.avatarUpload.previewUrl
  if (teacher.avatarUrl) return teacher.avatarUrl
  if (teacher.id && TEACHER_PHOTOGRAPHS[teacher.id]) return TEACHER_PHOTOGRAPHS[teacher.id]
  return null
}
