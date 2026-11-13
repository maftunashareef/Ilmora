import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Rules for database migrations (security review 11.11, №87 and №122; how to write one: docs/migrations.md).
 *
 * - The migrations already applied in production are frozen: Prisma keeps their checksum, and an edited file no longer
 *   matches what the database ran. Their hashes are pinned below; a new migration is added, an old one is never edited.
 * - Every new migration runs in one transaction (`BEGIN;` … `COMMIT;`): a migration that fails halfway used to leave the
 *   schema half changed (P3018, then P3009 on every release). In a transaction it is undone entirely.
 * - It starts with `SET LOCAL lock_timeout`: an ALTER TABLE queued behind the nightly backup or a long query held every
 *   request to that table (6.6 s measured). With the timeout the migration fails after a few seconds instead, undone, and
 *   the release is repeated.
 * - A statement that cannot run in a transaction (CREATE INDEX CONCURRENTLY) goes into a migration of its own, marked
 *   `-- no-transaction: <why>`, with a session `SET lock_timeout` first.
 */
const DIR = join(__dirname, '../prisma/migrations')

/** Applied in production: up to 20261117 by release 51, 20261118–19 by release 53, 20261120 by release 54 (11.11.2026), 20261121–23 by release 55 (12.11). Never edit these files. */
const APPLIED: Record<string, string> = {
  '20261018000000_init': '9cc486172d513929dcf3e4cf645df43f06fef8fb52dc89eb9b2d821aca0b8319',
  '20261019000000_login_password_owner': '797826e75456ef423da4ed319465913c4a860c81cb1b1eb584fb713ae8d2a0e5',
  '20261022000000_offer_consent': 'b01e8188060d26b7d71984d2218ba4146d3e982af8efc3a68168ab3a9c00a216',
  '20261023000000_multiple_owners': '3da635d62155137044dc0cd9cac31ed4f04e6787c804baae431a88f1491fd01e',
  '20261030000000_course_discount': 'c7e8a0c82b4ded6c23a3ede80b61118328e612e5ce187c6b29678575d5905885',
  '20261031000000_course_learning_format': 'fe132cc61dedfb1fb978c22cc8148e43bdd5cf2aba9e381b371b13b34589550a',
  '20261031000100_certificate_available': 'c86e8849f3da9b83878ddafa24fd4345dccf07eef549e8456afa7a15b5d535de',
  '20261101000000_approved_content_sync': '48ae65ae9dcc72e4ec31f7a5c030b5114d87e3cffbf99670ced5fcd9c4a3efc5',
  '20261103000000_centers_attendance_subscriptions_notifications': '2b0c5ac892057533d4607c65842f0a11beb55b05fb03c638e6c16c011ce08174',
  '20261104000000_center_rejected_status': '1a53c5d2c33b1da3ba61b3d94b94bb1d4de56c7fd6283c2b3eebe08a8619c509',
  '20261105000000_university_preparation_universities': '81b813aadc70108d725eddf80d2cb76b8bcc0ec713aad319f0df21ddd639b3cd',
  '20261106000000_university_preparation_navigation': '4e55243c179e7033b2fc187c70b1747039ec2f8b6b9c74119f7f6a67e53f258b',
  '20261107000000_university_preparation_packages': 'ae3fabd705b02b2b92c753223f7625286ad552f3af9494e2deef52d397f79feb',
  '20261108000000_user_google_id': '6fe3f2779136cc367f759ec715680ff00793f5e2503221632370f7a471a7ef47',
  '20261109000000_university_nav_after_how_it_works': '7026e6c23f7ee74b683a9fb5fb4a4a6c595f27bba70c8fe5a7b15b338c86d348',
  '20261110000000_university_preparation_catalog_update': 'dfe372c83482d8bcdda953e8e844c03e189ba2f354446dc2f1cf068861b1fe88',
  '20261111000000_university_admission_directions': 'b8ed5116f4de650ddd233267c9118c3d7609e32babb3285a344de1a905cd81a7',
  '20261112000000_teacher_invites_center_rename': '08ab81f3830e0f5601fb515549fa73acbaacea317fbd1d20bd6bf7fd62cf545a',
  '20261113000000_registry_institutions_companies_students': '11094159f92769aa90b4f7400dc01f0c3c7680ca5212ed39d1162a55de6fd34c',
  '20261114000000_institution_names_region_slug': '2077788699bf547cdcccbf7ce2625f7fa310ea7ec48ce1242698c89d056cf1c5',
  '20261115000000_student_contact_phone': '9680c11788caa3c077f7ffc546df0271d7ade381543ccc1c518f66ae5e186ba1',
  '20261116000000_registry_pending_changes_block_contact_snapshot': '1516e0739ace506579216b0870218d645a6d8913dbad4ee656395df0c0ef563f',
  '20261117000000_refund_requests_payment_lines': '79944dbe9d823baea301b468a6517da269501136a7476e27d3c3f88bda043d07',
  '20261118000000_payment_one_pending_per_subscription': '9e6b19dc50530945676b9f63b4dd55adaff3faec4f337be26b19f0f83564450f',
  '20261119000000_contact_request_unique_per_channel': 'ad36adb309ba12ed416081263f830de61d0bb3a8eb2cef66ebe6bf1aae221213',
  '20261120000000_student_consent_journal': '47c9717c00ee40f85c751d90d77fe53694868ccda6186aa98df52d77cb508bcb',
  '20261121000000_students_vacancies_enum_values': 'e13013cc7b5610ff2eaeeda557098e94a7c23badd122d6586bd99d1aa5e6079e',
  '20261121000100_students_section_vacancy_broadcasts': 'ac3918eece20a8889bb3716006cdd232c3b618da4db031be3306c1bc5fd9e394',
  '20261122000000_vacancy_job_schedule_experience': 'd33c372d292cea34a5a3e01c0b82abffcf267db36d2c70ff7153f2f727165a32',
  '20261122000100_company_claimed_at': 'f6ac0f4dec2a749962d79185780582e20eea7f44214ce6bd1857c57cd8870d5f',
  '20261123000000_payment_lessons_bought': 'a9b551482b8f0bea09aa094caf194a9a43be9ef04d60397d9ec70f93ec4fb9bc',
}

const MAX_LOCK_TIMEOUT_S = 5
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const migrations = readdirSync(DIR).filter((n) => statSync(join(DIR, n)).isDirectory()).sort()
const sql = (name: string) => readFileSync(join(DIR, name, 'migration.sql'), 'utf8')
/** The statements' lines: no comments, no blank lines. */
const codeLines = (text: string) => text.split('\n').map((l) => l.replace(/--.*$/, '').trim()).filter(Boolean)

describe('database migrations', () => {
  it('leaves the migrations applied in production exactly as they ran', () => {
    for (const [name, hash] of Object.entries(APPLIED)) expect(sha256(sql(name)), name).toBe(hash)
  })

  const fresh = migrations.filter((n) => !(n in APPLIED))
  const lastApplied = Object.keys(APPLIED).sort().at(-1)!

  it('names new migrations by time, after the last one applied in production', () => {
    for (const name of fresh) {
      expect(name).toMatch(/^\d{14}_[a-z0-9_]+$/)
      expect(name > lastApplied, `${name} must sort after ${lastApplied}`).toBe(true)
    }
  })

  it('runs every new migration in one transaction with a lock timeout', () => {
    for (const name of fresh) {
      const text = sql(name)
      const lines = codeLines(text)
      const timeout = (l: string | undefined, local: boolean) => {
        const m = l?.match(local ? /^SET LOCAL lock_timeout = '(\d+)s';$/ : /^SET lock_timeout = '(\d+)s';$/)
        return m ? Number(m[1]) : null
      }
      if (/^-- no-transaction: \S/m.test(text)) {
        // CREATE INDEX CONCURRENTLY and the like: no transaction, but the timeout still comes first.
        const t = timeout(lines[0], false)
        expect(t, `${name}: first statement SET lock_timeout = '…s';`).not.toBeNull()
        expect(t!, name).toBeLessThanOrEqual(MAX_LOCK_TIMEOUT_S)
        expect(lines.some((l) => /^(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i.test(l)), name).toBe(false)
        continue
      }
      expect(lines[0], `${name}: first statement BEGIN;`).toBe('BEGIN;')
      const t = timeout(lines[1], true)
      expect(t, `${name}: second statement SET LOCAL lock_timeout = '…s';`).not.toBeNull()
      expect(t!, name).toBeGreaterThan(0)
      expect(t!, name).toBeLessThanOrEqual(MAX_LOCK_TIMEOUT_S)
      expect(lines.at(-1), `${name}: last statement COMMIT;`).toBe('COMMIT;')
      const inner = lines.slice(2, -1)
      expect(inner.some((l) => /^(BEGIN|COMMIT|ROLLBACK|START TRANSACTION|END)\s*;?$/i.test(l)), `${name}: one transaction only`).toBe(false)
      expect(inner.some((l) => /\bCONCURRENTLY\b/i.test(l)), `${name}: CONCURRENTLY cannot run in a transaction`).toBe(false)
    }
  })
})
