import type { AdmissionSource, L, University } from './types.js'

/**
 * Researched university preparation packages.
 *
 * Every package records the official page its required subjects come from, the academic year that page states and the
 * date it was checked (2026-10-30). Status is "verified" only when an official page states the requirement explicitly for
 * that program and year; anything unclear, stale or contradictory is "needs_review" and stays an unpublished draft.
 *
 * Each required subject is mapped to an existing ILMORA OFFLINE course by its sample-catalog id (resolved by id or slug at
 * import time). A subject with no matching course carries `course: null`: it is reported as missing, and no course is
 * invented for it. The mapping is ILMORA's own decision (which course prepares best for the subject), not the
 * university's. ILMORA packages are not affiliated with any university.
 */
export interface UniversityPackageSeed {
  id: string
  universityId: string
  program: L
  name: L
  description: L
  /** Required subjects in the university's own terms; `course` is the ILMORA course that prepares for it, or null when none exists. */
  subjects: { label: L; course: string | null }[]
  admission: AdmissionSource
}

const l = (uz: string, ru: string, en: string): L => ({ uz, ru, en })
const CHECKED = '2026-10-30'

/** ILMORA offline courses (sample catalog ids) used for the mapping. */
const COURSE = { math: 'c-algebra', english: 'c-general-english', ielts: 'c-ielts', physics: 'c-physics', chemistry: 'c-chemistry' } as const

const SUBJECT = {
  math: l('Matematika', 'Математика', 'Mathematics'),
  mathLogic: l('Matematika va mantiqiy fikrlash (kirish testi)', 'Математика и логическое мышление (вступительный тест)', 'Math & Logical Thinking (entrance exam)'),
  logic: l('Mantiqiy fikrlash', 'Логическое мышление', 'Logical thinking'),
  physics: l('Fizika', 'Физика', 'Physics'),
  chemistry: l('Kimyo', 'Химия', 'Chemistry'),
  biology: l('Biologiya', 'Биология', 'Biology'),
  aptitude: l('Qobiliyat (aptitude) testi', 'Тест на способности (aptitude)', 'Aptitude test'),
  english: l('Ingliz tili', 'Английский язык', 'English'),
  motherTongue: l('Ona tili (o‘zbek, rus yoki qoraqalpoq)', 'Родной язык (узбекский, русский или каракалпакский)', 'Native language (Uzbek, Russian or Karakalpak)'),
  historyUz: l('O‘zbekiston tarixi', 'История Узбекистана', 'History of Uzbekistan'),
  history: l('Tarix', 'История', 'History'),
  legal: l('Huquqshunoslik fanlari', 'Правовые дисциплины', 'Legal sciences'),
  foreign: l('Chet tili (tili sahifada ko‘rsatilmagan)', 'Иностранный язык (язык на странице не указан)', 'Foreign language (language not named on the page)'),
  ielts: (band: string) => l(`Ingliz tili (IELTS ${band} yoki unga teng)`, `Английский язык (IELTS ${band} или эквивалент)`, `English (IELTS ${band} or equivalent)`),
}

/** Package title: "<Uni> <program> Preparation" in three languages. */
const title = (short: string, program: L): L => l(`${short} ${program.uz} tayyorgarligi`, `${short}: подготовка — ${program.ru}`, `${short} ${program.en} Preparation`)

/** A short description that points to the official requirement source and never implies an affiliation (subjects are listed separately). */
const describe = (uni: L, program: L): L =>
  l(
    `${uni.uz} “${program.uz}” uchun rasmiy sahifada ko‘rsatilgan talablar bo‘yicha tayyorgarlik. Kurslar — shu fanlar bo‘yicha ILMORA oflayn kurslari; paket universitet bilan rasmiy bog‘liq emas.`,
    `Подготовка по требованиям, указанным на официальной странице ${uni.ru} для «${program.ru}». Курсы — офлайн-курсы ILMORA по этим предметам; пакет официально не связан с университетом.`,
    `Preparation for the requirements ${uni.en} states on its official page for ${program.en}. The courses are ILMORA offline courses for these subjects; the package is not officially affiliated with the university.`,
  )

const un = (short: string, full: string): L => l(short || full, short || full, short || full)

type Subject = { label: L; course: string | null }
const MATH_TWICE = l('Matematika (majburiy fan va yo‘nalish fani)', 'Математика (обязательный и профильный предмет)', 'Mathematics (mandatory and direction subject)')

/**
 * The national state test (Cabinet Res. 578 of 13.09.2025; 2026/27 structure on digital.gov.uz): three mandatory subjects
 * (native language, mathematics, history of Uzbekistan) plus two direction subjects fixed per direction.
 */
const stateTest = (direction: Subject[]): Subject[] => {
  const mathIsDirection = direction.some((d) => d.label === SUBJECT.math)
  return [
    { label: SUBJECT.motherTongue, course: null },
    { label: mathIsDirection ? MATH_TWICE : SUBJECT.math, course: COURSE.math },
    { label: SUBJECT.historyUz, course: null },
    ...direction.filter((d) => d.label !== SUBJECT.math),
  ]
}
const MATH: Subject = { label: SUBJECT.math, course: COURSE.math }
const PHYSICS: Subject = { label: SUBJECT.physics, course: COURSE.physics }
const CHEMISTRY: Subject = { label: SUBJECT.chemistry, course: COURSE.chemistry }
const BIOLOGY: Subject = { label: SUBJECT.biology, course: null }
const FOREIGN: Subject = { label: SUBJECT.foreign, course: COURSE.english }

const pack = (id: string, universityId: string, uniShort: string, program: L, subjects: { label: L; course: string | null }[], admission: Omit<AdmissionSource, 'checkedOn'>): UniversityPackageSeed => ({
  id, universityId, program, name: title(uniShort, program), description: describe(un(uniShort, uniShort), program), subjects,
  admission: { ...admission, checkedOn: CHECKED },
})

export const UNIVERSITIES: University[] = [
  { id: 'uni-inha', name: 'Inha University in Tashkent', shortName: 'INHA', city: 'Tashkent', website: 'https://inha.uz' },
  { id: 'uni-wiut', name: 'Westminster International University in Tashkent', shortName: 'WIUT', city: 'Tashkent', website: 'https://wiut.uz' },
  { id: 'uni-ttpu', name: 'Turin Polytechnic University in Tashkent', shortName: 'TTPU', city: 'Tashkent', website: 'https://turin.uz' },
  { id: 'uni-newuu', name: 'New Uzbekistan University', shortName: 'NewUU', city: 'Tashkent', website: 'https://newuu.uz' },
  { id: 'uni-amity', name: 'Amity University Tashkent', shortName: 'Amity', city: 'Tashkent', website: 'https://amity.uz' },
  { id: 'uni-mdis', name: 'MDIS Tashkent', shortName: 'MDIS', city: 'Tashkent', website: 'https://mdis.uz' },
  { id: 'uni-uwed', name: 'University of World Economy and Diplomacy', shortName: 'UWED', city: 'Tashkent', website: 'https://uwed.uz' },
  { id: 'uni-webster', name: 'Webster University in Tashkent', shortName: 'Webster', city: 'Tashkent', website: 'https://www.webstertashkent.uz' },
  { id: 'uni-kiut', name: 'Kimyo International University in Tashkent', shortName: 'KIUT', city: 'Tashkent', website: 'https://kiut.uz' },
  { id: 'uni-cau', name: 'Central Asian University (formerly AKFA University)', shortName: 'CAU', city: 'Tashkent', website: 'https://centralasian.uz' },
  { id: 'uni-nuuz', name: 'National University of Uzbekistan named after Mirzo Ulugbek', shortName: 'NUUz', city: 'Tashkent', website: 'https://nuu.uz' },
  { id: 'uni-tuit', name: 'Tashkent University of Information Technologies named after Muhammad al-Khwarizmi', shortName: 'TUIT', city: 'Tashkent', website: 'https://tuit.uz' },
  { id: 'uni-tsue', name: 'Tashkent State University of Economics', shortName: 'TSUE', city: 'Tashkent', website: 'https://tsue.uz' },
  { id: 'uni-tsul', name: 'Tashkent State University of Law', shortName: 'TSUL', city: 'Tashkent', website: 'https://tsul.uz' },
  { id: 'uni-tsmu', name: 'Tashkent State Medical University', shortName: 'TSMU', city: 'Tashkent', website: 'https://tashmeduni.uz' },
]

export const UNIVERSITY_PACKAGES: UniversityPackageSeed[] = [
  // ── INHA Tashkent: own on-site exam (not DTM), run by Inha University in Korea; 2026-2027 guideline pages ──────────
  pack('uni-inha-socie', 'uni-inha', 'INHA', l('Kompyuter va axborot injiniringi (SOCIE: CSE, ICE)', 'Компьютерная и информационная инженерия (SOCIE: CSE, ICE)', 'Computer and Information Engineering (SOCIE: CSE, ICE)'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: SUBJECT.physics, course: COURSE.physics }, { label: l('Ingliz tili (IELTS 5.0 yoki TOEFL iBT 50)', 'Английский язык (IELTS 5.0 или TOEFL iBT 50)', 'English (IELTS 5.0 or TOEFL iBT 50)'), course: COURSE.ielts }],
    { url: 'https://inha.uz/prospective-students/admissions/application-guideline/', academicYear: '2026-2027', status: 'verified', note: 'Own exam: 30 multiple-choice questions (21 Mathematics, 9 Physics), 60 minutes. English is not an exam subject: the certificate is submitted after passing. The Russian page gives a different points split; the subjects are the same on every page.' }),
  pack('uni-inha-business', 'uni-inha', 'INHA', l('Biznes va logistika (Business Administration, Logistics Management)', 'Бизнес и логистика (Business Administration, Logistics Management)', 'Business and Logistics (Business Administration, Logistics Management)'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: l('Ingliz tili (IELTS 5.5 yoki TOEFL iBT 71)', 'Английский язык (IELTS 5.5 или TOEFL iBT 71)', 'English (IELTS 5.5 or TOEFL iBT 71)'), course: COURSE.ielts }],
    { url: 'https://inha.uz/prospective-students/admissions/application-guideline/', academicYear: '2026-2027', status: 'verified', note: 'School of Business and Logistics: own exam of 30 multiple-choice Mathematics questions, 60 minutes; English certificate submitted after passing.' }),
  pack('uni-inha-uk-it', 'uni-inha', 'INHA', l('Axborot texnologiyalari (Buyuk Britaniya yo‘nalishi)', 'Информационные технологии (британский трек)', 'Information Technology (UK track)'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: l('Ingliz tili (IELTS 5.0 yoki TOEFL iBT 50)', 'Английский язык (IELTS 5.0 или TOEFL iBT 50)', 'English (IELTS 5.0 or TOEFL iBT 50)'), course: COURSE.ielts }],
    { url: 'https://inha.uz/admissions-2026-guideline-for-uk-and-italy-programs/', academicYear: '2026-2027', status: 'verified', note: 'Own exam: 30 multiple-choice Mathematics questions, 60 minutes. An official SAT (1300+ total, 680+ Math) with an interview can replace the exam. The page states no degree title or language of instruction.' }),
  pack('uni-inha-uk-bm', 'uni-inha', 'INHA', l('Biznes va menejment (Buyuk Britaniya yo‘nalishi)', 'Бизнес и менеджмент (британский трек)', 'Business and Management (UK track)'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: l('Ingliz tili (IELTS 5.5 yoki TOEFL iBT 71)', 'Английский язык (IELTS 5.5 или TOEFL iBT 71)', 'English (IELTS 5.5 or TOEFL iBT 71)'), course: COURSE.ielts }],
    { url: 'https://inha.uz/admissions-2026-guideline-for-uk-and-italy-programs/', academicYear: '2026-2027', status: 'verified', note: 'Same Mathematics exam as the UK-track IT programme with a higher English threshold. SAT option as above.' }),
  pack('uni-inha-italy', 'uni-inha', 'INHA', l('Kompyuter injiniringi va ma’lumotlar fani (Italiya yo‘nalishi)', 'Компьютерная инженерия и наука о данных (итальянский трек)', 'Computer Engineering and Data Science (Italy track)'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: l('Ingliz tili (IELTS 5.0 yoki TOEFL iBT 50)', 'Английский язык (IELTS 5.0 или TOEFL iBT 50)', 'English (IELTS 5.0 or TOEFL iBT 50)'), course: COURSE.ielts }],
    { url: 'https://inha.uz/application-guideline-2026-italy/', academicYear: '2026-2027', status: 'verified', note: 'Own exam: 30 multiple-choice Mathematics questions, 60 minutes; SAT option as on the UK track.' }),

  // ── WIUT: document-based entry (maths proof + English); per-programme 2026-2027 pages ──────────────────────────────
  pack('uni-wiut-cs', 'uni-wiut', 'WIUT', l('Kompyuter fanlari', 'Компьютерные науки', 'Computer Science'),
    [{ label: l('Matematika (WIUT kirish matematika testi yoki unga teng)', 'Математика (вступительный тест WIUT по математике или эквивалент)', 'Mathematics (WIUT entrance maths test or equivalent)'), course: COURSE.math }, { label: SUBJECT.ielts('6.5'), course: COURSE.ielts }],
    { url: 'https://wiut.uz/bsc-hons-in-computer-science', academicYear: '2026-2027', status: 'verified', note: 'Programme page: maths competence proof and IELTS 6.5 (Writing 6.0). No subject exam; no DTM mentioned.' }),
  pack('uni-wiut-business', 'uni-wiut', 'WIUT', l('Biznes, moliya va iqtisodiyot', 'Бизнес, финансы и экономика', 'Business, Finance and Economics'),
    [{ label: l('Matematika (WIUT kirish matematika testi yoki unga teng)', 'Математика (вступительный тест WIUT по математике или эквивалент)', 'Mathematics (WIUT entrance maths test or equivalent)'), course: COURSE.math }, { label: SUBJECT.ielts('6.5'), course: COURSE.ielts }],
    { url: 'https://wiut.uz/finance', academicYear: '2026-2027', status: 'verified', note: 'Finance page; the Economics and Business Management pages state the same 2026-2027 maths and English requirements.' }),
  pack('uni-wiut-law', 'uni-wiut', 'WIUT', l('Huquq va xalqaro munosabatlar', 'Право и международные отношения', 'Law and International Relations'),
    [{ label: SUBJECT.ielts('6.5'), course: COURSE.ielts }],
    { url: 'https://wiut.uz/commercial-law', academicYear: '2026-2027', status: 'verified', note: 'Commercial Law and International Relations and Law pages: English requirement only (IELTS 6.5, Writing 6.0); no maths requirement listed.' }),
  pack('uni-wiut-foundation', 'uni-wiut', 'WIUT', l('Xalqaro Foundation sertifikati', 'Международный Foundation-сертификат', 'International Foundation Studies'),
    [{ label: l('Matematika (WIUT kirish matematika imtihoni)', 'Математика (вступительный экзамен WIUT по математике)', 'Mathematics (WIUT entrance maths exam)'), course: COURSE.math }, { label: SUBJECT.ielts('6.0'), course: COURSE.ielts }],
    { url: 'https://wiut.uz/certificate-international-foundation-studies', academicYear: '2026-2027', status: 'verified', note: 'Foundation page: Entrance Maths exam (or equivalent proof) and IELTS 6.0 with Writing 5.0.' }),

  // ── Turin Polytechnic (TTPU): own computer-based exam; 2026/2027 regulation lists subjects for some programmes only ──
  pack('uni-ttpu-engineering', 'uni-ttpu', 'Turin', l('Muhandislik (mexanika, qurilish, kompyuter) — 2-kursga kirish', 'Инженерия (механика, строительство, компьютерная) — поступление на 2 курс', 'Engineering (Mechanical, Civil, Computer) — Year 2 entry'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: SUBJECT.physics, course: COURSE.physics }, { label: SUBJECT.english, course: COURSE.english }, { label: SUBJECT.logic, course: null }],
    { url: 'https://qabul.turin.uz/regulations/bachelor', academicYear: '2026/2027', status: 'verified', note: 'Regulation section 2.5: 42-question exam in English (Mathematics 18, Physics 12, English 6, Logic 6) for the Year-2 route of the three partnership programmes.' }),
  pack('uni-ttpu-economics', 'uni-ttpu', 'Turin', l('Iqtisodiyot', 'Экономика', 'Economics'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: SUBJECT.logic, course: null }],
    { url: 'https://qabul.turin.uz/regulations/bachelor', academicYear: '2026/2027', status: 'verified', note: 'Regulation sections 2.4 and 4.1: Mathematics 30 plus Logic 10; an IELTS certificate does not exempt Economics applicants.' }),
  pack('uni-ttpu-aviation', 'uni-ttpu', 'Turin', l('Aviatsiya muhandisligi', 'Авиационная инженерия', 'Aviation Engineering'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: SUBJECT.logic, course: null }],
    { url: 'https://qabul.turin.uz/regulations/bachelor', academicYear: '2026/2027', status: 'verified', note: 'Regulation sections 2.4 and 4.1: Mathematics 30 plus Logic 10, exam in English only.' }),
  pack('uni-ttpu-standard', 'uni-ttpu', 'Turin', l('Boshqa bakalavr yo‘nalishlari (standart imtihon)', 'Остальные бакалаврские направления (стандартный экзамен)', 'Other bachelor programmes (standard exam)'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: SUBJECT.logic, course: null }],
    { url: 'https://qabul.turin.uz/regulations/bachelor', academicYear: '2026/2027', status: 'needs_review', note: 'The regulation names no exam for these programmes (Business, Software Engineering, AI, Cybersecurity, Architecture, ...); the standard exam is inferred by elimination, and one aggregator lists a different split.' }),

  // ── New Uzbekistan University: own "Math & Logical Thinking" exam + English proof; per-programme pages (Fall 2026) ───
  pack('uni-newuu-tech', 'uni-newuu', 'NewUU', l('Dasturiy injiniring, AI, kiberxavfsizlik, iqtisod va ma’lumotlar fani', 'Программная инженерия, ИИ, кибербезопасность, экономика и наука о данных', 'Software Engineering, AI & Robotics, Cyber Security, Economics & Data Science, Industrial Management'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: SUBJECT.logic, course: null }, { label: SUBJECT.ielts('6.0'), course: COURSE.ielts }],
    { url: 'https://newuu.uz/en/undergraduate-program/bsc-software-engineering', academicYear: '2026/2027', status: 'verified', note: 'Programme pages: "Math & Logical Thinking" entrance exam and IELTS 6.0 (CEFR B2 56-60, TOEFL iBT 60). Exam format is in a PDF that was not read.' }),
  pack('uni-newuu-engineering', 'uni-newuu', 'NewUU', l('Muhandislik va amaliy matematika', 'Инженерия и прикладная математика', 'Engineering and Applied Mathematics'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: SUBJECT.logic, course: null }, { label: SUBJECT.ielts('5.5'), course: COURSE.ielts }],
    { url: 'https://newuu.uz/en/undergraduate-program/bsc-mechanical-engineering', academicYear: '2026/2027', status: 'verified', note: 'Programme pages (Mechanical, Chemical & Materials, Aerospace, Applied Mathematics, STEM Education): "Math & Logical Thinking" exam and IELTS 5.5.' }),
  pack('uni-newuu-medicine', 'uni-newuu', 'NewUU', l('Tibbiyot (M.D.)', 'Медицина (M.D.)', 'Doctor of Medicine (M.D.)'),
    [{ label: SUBJECT.biology, course: null }, { label: SUBJECT.chemistry, course: COURSE.chemistry }, { label: SUBJECT.ielts('5.5'), course: COURSE.ielts }],
    { url: 'https://newuu.uz/en/undergraduate-program/md-doctor-of-medicine', academicYear: '2026', status: 'verified', note: 'M.D. page: separate Biology and Chemistry test (40 multiple-choice questions, in English) and IELTS 5.5.' }),

  // ── Amity Tashkent: no academic year on any requirement page, so every package needs verification ─────────────────
  pack('uni-amity-it', 'uni-amity', 'Amity', l('Axborot texnologiyalari (B.Sc. IT)', 'Информационные технологии (B.Sc. IT)', 'Information Technology (B.Sc. IT)'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: SUBJECT.aptitude, course: null }, { label: SUBJECT.ielts('5.5'), course: COURSE.ielts }],
    { url: 'https://amity.uz/en/pages/programme/91', academicYear: '', status: 'needs_review', note: 'Programme and entry-requirements pages agree (Mathematics 60%, Aptitude 40%, interview, IELTS 5.5) but state no academic year. The B.Tech CSE pages contradict each other.' }),
  pack('uni-amity-business', 'uni-amity', 'Amity', l('Biznes va iqtisodiyot (BBA, BA Economics)', 'Бизнес и экономика (BBA, BA Economics)', 'Business and Economics (BBA, BA Economics)'),
    [{ label: SUBJECT.aptitude, course: null }, { label: SUBJECT.ielts('6.0'), course: COURSE.ielts }],
    { url: 'https://amity.uz/en/pages/programme/107', academicYear: '', status: 'needs_review', note: 'Aptitude exam, interview and IELTS 6 (BBA, BA Economics, BA Tourism); no academic year stated.' }),

  // ── MDIS Tashkent: English-score selection only; the newest admission pages found are for 2025 ─────────────────────
  pack('uni-mdis-foundation', 'uni-mdis', 'MDIS', l('Foundation yili (biznes bakalavr dasturlariga yo‘l)', 'Foundation-год (путь к бакалаврским программам по бизнесу)', 'Foundation Year (route to business bachelor programmes)'),
    [{ label: SUBJECT.ielts('5.5'), course: COURSE.ielts }],
    { url: 'https://mdis.uz/en/menu/foundation-year', academicYear: '2025', status: 'needs_review', note: 'No subject exam: selection by English score (IELTS/EET 5.5, 6.0 first). Pages are for 2025, and the English and Russian pages differ on component minimums.' }),

  // ── UWED: state exam (DTM) with three mandatory subjects plus two direction subjects; 2026/2027 bachelor page ─────────
  // Mother tongue, History of Uzbekistan, History and Legal sciences have no ILMORA course, so these stay drafts.
  pack('uni-uwed-politics', 'uni-uwed', 'UWED', l('Siyosatshunoslik va xalqaro munosabatlar', 'Политология и международные отношения', 'Political Science and International Relations'),
    [{ label: SUBJECT.motherTongue, course: null }, { label: SUBJECT.math, course: COURSE.math }, { label: SUBJECT.historyUz, course: null }, { label: SUBJECT.history, course: null }, { label: SUBJECT.foreign, course: COURSE.english }],
    { url: 'https://uwed.uz/admission/bachelor', academicYear: '2026/2027', status: 'verified', note: 'State exam, 90 tests: three mandatory subjects (10 tests each) plus History (30) and a foreign language (30). The page does not name which foreign language; ILMORA maps it to English as its own choice.' }),
  pack('uni-uwed-economy', 'uni-uwed', 'UWED', l('Jahon iqtisodiyoti va xalqaro iqtisodiy munosabatlar', 'Мировая экономика и международные экономические отношения', 'World Economy and International Economic Relations'),
    [{ label: SUBJECT.motherTongue, course: null }, { label: l('Matematika (majburiy fan va yo‘nalish fani)', 'Математика (обязательный и профильный предмет)', 'Mathematics (mandatory and direction subject)'), course: COURSE.math }, { label: SUBJECT.historyUz, course: null }, { label: SUBJECT.foreign, course: COURSE.english }],
    { url: 'https://uwed.uz/admission/bachelor', academicYear: '2026/2027', status: 'verified', note: 'State exam, 90 tests: Mathematics is tested as a mandatory subject (10 tests) and again as the direction subject (30 tests), plus a foreign language (30). The page does not name which foreign language.' }),
  pack('uni-uwed-law', 'uni-uwed', 'UWED', l('Yurisprudensiya', 'Юриспруденция', 'Jurisprudence'),
    [{ label: SUBJECT.motherTongue, course: null }, { label: SUBJECT.math, course: COURSE.math }, { label: SUBJECT.historyUz, course: null }, { label: SUBJECT.legal, course: null }, { label: SUBJECT.foreign, course: COURSE.english }],
    { url: 'https://uwed.uz/admission/bachelor', academicYear: '2026/2027', status: 'verified', note: 'State exam, 90 tests: three mandatory subjects (10 tests each) plus Legal sciences (30) and a foreign language (30). Graduates of academic lyceums or law technikums have a separate interview-only track.' }),

  // ── Webster Tashkent: no subject exam; English proof + GPA. The only intake the page states is Fall 2025 ───────────
  pack('uni-webster-english', 'uni-webster', 'Webster', l('Bakalavr dasturlari (ingliz tili talabi)', 'Бакалаврские программы (требование по английскому)', 'Bachelor programmes (English requirement)'),
    [{ label: l('Ingliz tili (IELTS 6.0, yoki SAT EBRW 450+, yoki unga teng)', 'Английский язык (IELTS 6.0, SAT EBRW 450+ или эквивалент)', 'English (IELTS 6.0, SAT EBRW 450+ or equivalent)'), course: COURSE.ielts }],
    { url: 'https://www.webstertashkent.uz/admissions/index.php', academicYear: 'Fall 2025', status: 'needs_review', note: 'No entrance exam: GPA 2.5/4.0 plus English proof (IELTS 6.0; 5.5 with the ESL Bridge). The page states only the Fall 2025 intake, so the current cycle must be confirmed with the university. SAT is accepted only as English proof.' }),

  // ── KIUT: own entrance tests; subjects come from programme pages that state no academic year ──────────────────────
  pack('uni-kiut-business', 'uni-kiut', 'KIUT', l('Biznes, moliya va iqtisodiyot', 'Бизнес, финансы и экономика', 'Business, Finance and Economics'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: l('Ingliz tili (IELTS 5.5 bo‘lsa, ingliz tili testidan ozod)', 'Английский язык (при IELTS 5.5 тест по английскому не требуется)', 'English (IELTS 5.5 exempts from the English test)'), course: COURSE.english }],
    { url: 'https://kiut.uz/en/programs/bachelors-programs/faculty-directions/Business-Management/', academicYear: '', status: 'needs_review', note: 'Business Management, Finance, International Economic Relations, Accounting, Banking and International Marketing pages list Mathematics and English; none states an academic year. The 2026/2027 admission page gives only generic exam labels.' }),
  pack('uni-kiut-engineering', 'uni-kiut', 'KIUT', l('Muhandislik va axborot tizimlari', 'Инженерия и информационные системы', 'Engineering and Information Systems'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: SUBJECT.physics, course: COURSE.physics }],
    { url: 'https://kiut.uz/en/programs/bachelors-programs/faculty-directions/information-system-engineering/', academicYear: '', status: 'needs_review', note: 'Information System, Mechatronics, Mechanical, Electrical, Renewable Energy, Lift, Traffic and Civil Engineering pages list Mathematics and Physics; none states an academic year (the Lift Engineering file is named 2023-2024).' }),
  pack('uni-kiut-medicine', 'uni-kiut', 'KIUT', l('Davolash ishi va stomatologiya', 'Лечебное дело и стоматология', 'General Medicine and Dentistry'),
    [{ label: SUBJECT.biology, course: null }, { label: SUBJECT.chemistry, course: COURSE.chemistry }, { label: SUBJECT.motherTongue, course: null }],
    { url: 'https://kiut.uz/en/programs/bachelors-programs/faculty-directions/General-Medicine/', academicYear: '', status: 'needs_review', note: 'General Medicine and Dentistry pages list Biology, Chemistry and Mother Tongue and Literature; the Pediatrics page lists only Chemistry and Biology. No academic year is stated.' }),

  // ── Central Asian University (formerly AKFA): own online/offline exams, English-taught; regulations page states 2027-2028 ──
  pack('uni-cau-business-engineering', 'uni-cau', 'CAU', l('Kompyuter fanlari, muhandislik, biznes va iqtisodiyot', 'Компьютерные науки, инженерия, бизнес и экономика', 'Computer Science, Engineering, Business and Economics'),
    [{ label: l('Matematika (CAU kirish imtihoni, o‘tish bali 50%)', 'Математика (вступительный экзамен CAU, проходной балл 50%)', 'Mathematics (CAU entrance exam, pass mark 50%)'), course: COURSE.math }, { label: l('Ingliz tili (IELTS 5.5 yoki unga teng bo‘lsa, imtihondan ozod)', 'Английский язык (при IELTS 5.5 или эквиваленте экзамен не нужен)', 'English (IELTS 5.5 or equivalent exempts from the exam)'), course: COURSE.ielts }],
    { url: 'https://centralasian.uz/admissionregulations', academicYear: '2027-2028', status: 'verified', note: 'Admission regulations: own exams (Mathematics 20 questions / 45 min, English 60 questions / 30 min, pass mark 50%) plus an interview; the Business and Engineering faculties accept IELTS 5.5 for the English exemption. The Computer Science page repeats Mathematics (min 50%) and IELTS 5.5; program pages also show 2026-2027 tuition.' }),
  pack('uni-cau-medicine', 'uni-cau', 'CAU', l('Tibbiyot va stomatologiya (M.D., D.D.S.)', 'Медицина и стоматология (M.D., D.D.S.)', 'Medicine and Dentistry (M.D., D.D.S.)'),
    [BIOLOGY, CHEMISTRY, { label: SUBJECT.ielts('6.0'), course: COURSE.ielts }],
    { url: 'https://centralasian.uz/admissionregulations', academicYear: '2027-2028', status: 'verified', note: 'Admission regulations: own Biology and Chemistry exams (20 questions / 45 min each, pass mark 50%) and English (IELTS 6.0 or TOEFL iBT 60 exempts). The Medicine and Dentistry pages cite both 2026-2027 and 2027-2028 intakes with the same subjects.' }),

  // ── State-test universities (NUUz, TUIT, TSUE, TSUL, TSMU): three mandatory subjects + two direction subjects ──────────
  // The per-direction subjects come from the state testing agency directory (my.uzbmb.uz), which shows scores for 2023-2025 and
  // no admission year, so those are needs_review. TSUL states them for 2026/2027 on its own page. Mother tongue and History of
  // Uzbekistan have no ILMORA course, so none of these can be published until such courses exist.
  pack('uni-nuuz-it', 'uni-nuuz', 'NUUz', l('Sun’iy intellekt, kiberxavfsizlik, axborot tizimlari', 'Искусственный интеллект, кибербезопасность, информационные системы', 'Artificial Intelligence, Cybersecurity, Information Systems'),
    stateTest([MATH, PHYSICS]),
    { url: 'https://my.uzbmb.uz/university-about-direction/314', academicYear: '', status: 'needs_review', note: 'State testing agency directory lists Mathematics and Physics as the direction subjects; the page shows 2023-2025 scores and no admission year. The 2026/27 test structure (90 questions, 189 points) is confirmed on qabul.nuu.uz.' }),
  pack('uni-nuuz-economics', 'uni-nuuz', 'NUUz', l('Iqtisodiyot, menejment, moliya, bank ishi', 'Экономика, менеджмент, финансы, банковское дело', 'Economics, Management, Finance, Banking'),
    stateTest([MATH, FOREIGN]),
    { url: 'https://my.uzbmb.uz/university-about-direction/314', academicYear: '', status: 'needs_review', note: 'Directory lists Mathematics and a foreign language; no admission year. A B1 certificate earns 75% and B2 or higher 100% of the foreign-language score (Cabinet Res. 578).' }),
  pack('uni-nuuz-chemistry', 'uni-nuuz', 'NUUz', l('Kimyo', 'Химия', 'Chemistry'),
    stateTest([CHEMISTRY, MATH]),
    { url: 'https://my.uzbmb.uz/university-about-direction/314', academicYear: '', status: 'needs_review', note: 'Directory lists Chemistry and Mathematics; no admission year.' }),
  pack('uni-tuit-it', 'uni-tuit', 'TUIT', l('Dasturiy injiniring, sun’iy intellekt, kiberxavfsizlik, kompyuter injiniringi', 'Программная инженерия, ИИ, кибербезопасность, компьютерная инженерия', 'Software Engineering, AI, Cybersecurity, Computer Engineering'),
    stateTest([MATH, PHYSICS]),
    { url: 'https://my.uzbmb.uz/university-about-direction/380', academicYear: '', status: 'needs_review', note: 'State testing agency directory lists Mathematics and Physics for these directions; TUIT’s own pages name no subjects and the directory states no admission year.' }),
  pack('uni-tuit-business', 'uni-tuit', 'TUIT', l('Iqtisodiyot, biznesni boshqarish, marketing, logistika', 'Экономика, управление бизнесом, маркетинг, логистика', 'Economics, Business Management, Marketing, Logistics'),
    stateTest([MATH, FOREIGN]),
    { url: 'https://my.uzbmb.uz/university-about-direction/380', academicYear: '', status: 'needs_review', note: 'Directory lists Mathematics and a foreign language; no admission year.' }),
  pack('uni-tsue-economics', 'uni-tsue', 'TSUE', l('Iqtisodiyot, moliya, buxgalteriya, menejment, marketing', 'Экономика, финансы, бухгалтерия, менеджмент, маркетинг', 'Economics, Finance, Accounting, Management, Marketing'),
    stateTest([MATH, FOREIGN]),
    { url: 'https://my.uzbmb.uz/university-about-direction/324', academicYear: '', status: 'needs_review', note: 'Directory lists Mathematics and a foreign language; no admission year. TSUE’s 2026 subject-set PDF was not read.' }),
  pack('uni-tsue-it', 'uni-tsue', 'TSUE', l('Sun’iy intellekt, axborot tizimlari va xavfsizligi', 'Искусственный интеллект, информационные системы и безопасность', 'Artificial Intelligence, Information Systems and Security'),
    stateTest([MATH, PHYSICS]),
    { url: 'https://my.uzbmb.uz/university-about-direction/324', academicYear: '', status: 'needs_review', note: 'Directory lists Mathematics and Physics for these directions; no admission year.' }),
  pack('uni-tsul-law', 'uni-tsul', 'TSUL', l('Yurisprudensiya', 'Юриспруденция', 'Jurisprudence'),
    stateTest([{ label: l('Huquqshunoslik (davlat va huquq asoslari)', 'Правоведение (основы государства и права)', 'Law (fundamentals of state and law)'), course: null }, FOREIGN]),
    { url: 'https://tsul.uz/uz/general-page/bakalavriat', academicYear: '2026/2027', status: 'verified', note: 'TSUL’s own 2026/2027 page names Law as the first and a foreign language as the second direction subject (state test, 90 questions). Raqamli huquq and Xalqaro huquq are admitted by an IQ test and a B2 certificate instead.' }),
  pack('uni-tsul-governance', 'uni-tsul', 'TSUL', l('Davlat va jamiyat boshqaruvi', 'Государственное и общественное управление', 'State and Public Administration'),
    stateTest([{ label: SUBJECT.history, course: null }, FOREIGN]),
    { url: 'https://tsul.uz/uz/general-page/bakalavriat', academicYear: '2026/2027', status: 'verified', note: 'TSUL’s own 2026/2027 page names History and a foreign language as the direction subjects (state test, 90 questions).' }),
  pack('uni-tsmu-medicine', 'uni-tsmu', 'TSMU', l('Davolash ishi, pediatriya, stomatologiya', 'Лечебное дело, педиатрия, стоматология', 'General Medicine, Pediatrics, Dentistry'),
    stateTest([BIOLOGY, CHEMISTRY]),
    { url: 'https://my.uzbmb.uz/university-about-direction/444', academicYear: '', status: 'needs_review', note: 'Directory lists Biology and Chemistry; no admission year. Tashkent Medical Academy was merged into Tashkent State Medical University in 2025, and the university’s own pages name no subjects.' }),
]
