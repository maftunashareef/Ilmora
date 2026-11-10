/** Every key of a response at any depth — to prove a field is not in the API answer at all, not just hidden by the screen. */
export function deepKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) deepKeys(v, out)
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.add(k); deepKeys(v, out) }
  return out
}

/** ТЗ 8 «Тесты доступа»: what an anonymised or graduate card never carries before the student opens contacts. */
export const PRIVATE_KEYS = ['phone', 'phoneE164', 'contactPhone', 'email', 'birthDate', 'parentName', 'parentPhone', 'fileKey', 'userId', 'address']
