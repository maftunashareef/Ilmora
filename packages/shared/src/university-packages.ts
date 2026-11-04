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
  /** The directions of the university (see UNIVERSITIES[].faculties) this package prepares for. */
  directionIds?: string[]
  name: L
  description: L
  /**
   * Subjects in the university's own terms; `course` is the ILMORA course that prepares for it, or null when none exists.
   * `optional` marks an extra the student may leave out (for example IELTS when the certificate is submitted after the exam).
   */
  subjects: { label: L; course: string | null; optional?: boolean }[]
  admission: AdmissionSource
}

const l = (uz: string, ru: string, en: string): L => ({ uz, ru, en })
const CHECKED = '2026-10-30'
/** INHA's 2026-2027 Korean-programme guideline was read again on this date (subjects, majors and English minimums). */
const INHA_CHECKED = '2026-11-03'

/** ILMORA offline courses (sample catalog ids) used for the mapping. */
const COURSE = { math: 'c-algebra', english: 'c-general-english', ielts: 'c-ielts', physics: 'c-physics', chemistry: 'c-chemistry', dtm: 'c-dtm', python: 'c-python' } as const

const SUBJECT = {
  math: l('Matematika', 'Математика', 'Mathematics'),
  mathLogic: l('Matematika va mantiqiy fikrlaş (kiriş testi)', 'Математика и логическое мышление (вступительный тест)', 'Math & Logical Thinking (entrance exam)'),
  logic: l('Mantiqiy fikrlaş', 'Логическое мышление', 'Logical thinking'),
  physics: l('Fizika', 'Физика', 'Physics'),
  chemistry: l('Kimyo', 'Химия', 'Chemistry'),
  biology: l('Biologiya', 'Биология', 'Biology'),
  aptitude: l('Qobiliyat (aptitude) testi', 'Тест на способности (aptitude)', 'Aptitude test'),
  english: l('Ingliz tili', 'Английский язык', 'English'),
  motherTongue: l('Ona tili (özbek, rus yoki qoraqalpoq)', 'Родной язык (узбекский, русский или каракалпакский)', 'Native language (Uzbek, Russian or Karakalpak)'),
  historyUz: l('Özbekiston tarixi', 'История Узбекистана', 'History of Uzbekistan'),
  history: l('Tarix', 'История', 'History'),
  legal: l('Huquqşunoslik fanlari', 'Правовые дисциплины', 'Legal sciences'),
  foreign: l('Çet tili (tili sahifada körsatilmagan)', 'Иностранный язык (язык на странице не указан)', 'Foreign language (language not named on the page)'),
  ielts: (band: string) => l(`Ingliz tili (IELTS ${band} yoki unga teng)`, `Английский язык (IELTS ${band} или эквивалент)`, `English (IELTS ${band} or equivalent)`),
}

/** Package title: "<Uni> <program> Preparation" in three languages. */
const title = (short: string, program: L): L => l(`${short} ${program.uz} tayyorgarligi`, `${short}: подготовка — ${program.ru}`, `${short} ${program.en} Preparation`)

/** A short description that points to the official requirement source and never implies an affiliation (subjects are listed separately). */
const describe = (uni: L, program: L): L =>
  l(
    `${uni.uz} “${program.uz}” uçun rasmiy sahifada körsatilgan talablar böyiça tayyorgarlik. Kurslar — şu fanlar böyiça ILMORA oflayn kurslari; paket universitet bilan rasmiy boğliq emas.`,
    `Подготовка по требованиям, указанным на официальной странице ${uni.ru} для «${program.ru}». Курсы — офлайн-курсы ILMORA по этим предметам; пакет официально не связан с университетом.`,
    `Preparation for the requirements ${uni.en} states on its official page for ${program.en}. The courses are ILMORA offline courses for these subjects; the package is not officially affiliated with the university.`,
  )

const un = (short: string, full: string): L => l(short || full, short || full, short || full)

type Subject = { label: L; course: string | null; optional?: boolean }
const MATH_DIRECTION = l('Matematika (yönaliş fani)', 'Математика (профильный предмет)', 'Mathematics (direction subject)')

/**
 * The national state test (Cabinet Res. 578 of 13.09.2025; 2026/27 structure on digital.gov.uz): three mandatory subjects
 * (native language, mathematics, history of Uzbekistan) plus two direction subjects fixed per direction. The mandatory
 * block is one subject here, prepared by ILMORA's DTM course, whose curriculum is exactly those three subjects; the
 * direction subjects follow (Mathematics as a direction subject is the regular mathematics course).
 */
const STATE_MANDATORY = l('Majburiy fanlar: ona tili, matematika, Özbekiston tarixi', 'Обязательные предметы: родной язык, математика, история Узбекистана', 'Mandatory subjects: native language, mathematics, history of Uzbekistan')
const stateTest = (direction: Subject[]): Subject[] => [
  { label: STATE_MANDATORY, course: COURSE.dtm },
  ...direction.map((d) => (d.label === SUBJECT.math ? { ...d, label: MATH_DIRECTION } : d)),
]
const MATH: Subject = { label: SUBJECT.math, course: COURSE.math }
const PHYSICS: Subject = { label: SUBJECT.physics, course: COURSE.physics }
const CHEMISTRY: Subject = { label: SUBJECT.chemistry, course: COURSE.chemistry }
const BIOLOGY: Subject = { label: SUBJECT.biology, course: null }
const FOREIGN: Subject = { label: SUBJECT.foreign, course: COURSE.english }

const pack = (id: string, universityId: string, uniShort: string, program: L, subjects: Subject[], admission: Omit<AdmissionSource, 'checkedOn'> & { checkedOn?: string }, directionIds?: string[]): UniversityPackageSeed => ({
  id, universityId, program, directionIds, name: title(uniShort, program), description: describe(un(uniShort, uniShort), program), subjects,
  admission: { ...admission, checkedOn: admission.checkedOn ?? CHECKED },
})

/** A package of a preparation track: titled by its route, described as general preparation (never as a university's own programme). */
const TRACK_DESCRIPTION = l('Umumiy tayyorgarlik: fanlar quyida körsatilgan rasmiy manbadan olingan. Paket biror universitet bilan rasmiy boğliq emas va uning dasturi emas.',
  'Общая подготовка: предметы взяты из указанного ниже официального источника. Пакет официально не связан ни с одним университетом и не является его программой.',
  'General preparation: the subjects come from the official source named below. The package is not officially affiliated with any university and is not its programme.')
const trackPack = (...args: Parameters<typeof pack>): UniversityPackageSeed => {
  const seed = pack(...args)
  return { ...seed, name: seed.program, description: TRACK_DESCRIPTION }
}

/** IELTS preparation offered as an optional extra: INHA asks for the certificate after the exam, it is not an exam subject. */
const ieltsExtra = (band: string, toefl: string): Subject => ({
  label: l(`Ingliz tili (IELTS ${band} yoki TOEFL iBT ${toefl}; sertifikat bölsa şart emas)`, `Английский язык (IELTS ${band} или TOEFL iBT ${toefl}; не нужен при наличии сертификата)`, `English (IELTS ${band} or TOEFL iBT ${toefl}; not needed with a certificate)`),
  course: COURSE.ielts,
  optional: true,
})

/** Narxoz University (Almaty): the bachelor page could not be reached on 2026-11-03, so its combinations stay unverified drafts. */
const NARXOZ_SOURCE = {
  url: 'https://narxoz.edu.kz', academicYear: '', checkedOn: '2026-11-03', status: 'needs_review' as const,
  note: 'To be verified: the official site (narxoz.edu.kz; the older narxozedu.kz address no longer answers) builds its pages with JavaScript, so on 2026-11-03 neither the programmes nor their UNT profile-subject pairs could be read. The pair was supplied for planning only; verify it on the site before publishing.',
}
const narxozSubject = {
  math: l('Matematika', 'Математика', 'Mathematics'),
  informatics: l('Informatika', 'Информатика', 'Informatics'),
  geography: l('Geografiya', 'География', 'Geography'),
  physics: l('Fizika', 'Физика', 'Physics'),
  english: l('Ingliz tili', 'Английский язык', 'English'),
  worldHistory: l('Jahon tarixi', 'Всемирная история', 'World History'),
  law: l('Huquq asoslari', 'Основы права', 'Fundamentals of Law'),
}
const narxozPair = (key: string, a: Subject, b: Subject): UniversityPackageSeed => {
  const program = l(`${a.label.uz} + ${b.label.uz}`, `${a.label.ru} + ${b.label.ru}`, `${a.label.en} + ${b.label.en}`)
  return pack(`uni-narxoz-${key}`, 'uni-narxoz', 'Narxoz', program, [a, b], NARXOZ_SOURCE, [`narxoz-${key}`])
}

/** A programme or faculty name as the university writes it (English-taught or English-named), the same in every language. */
const official = (name: string): L => l(name, name, name)
const WIUT_MATH = l('Matematika (Westminster tasdiqlagan matematika testi yoki unga teng)', 'Математика (тест, утверждённый University of Westminster, или эквивалент)', 'Mathematics (maths test approved by the University of Westminster, or equivalent)')
const MOTHER_TONGUE_LIT = l('Ona tili va adabiyot', 'Родной язык и литература', 'Mother tongue and literature')
const CREATIVE_EXAM = l('Ijodiy imtihon', 'Творческий экзамен', 'Creative exam')
const FOREIGN_CERTIFICATE = l('Çet tili sertifikati (yetarli ball) yoki suhbat', 'Сертификат по иностранному языку (достаточный балл) или собеседование', 'Foreign-language certificate (sufficient score) or interview')
const kiutId = (name: string) => `kiut-${name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`
const kiutDirection = (name: string, subjects: L[]) => ({ id: kiutId(name), name: official(name), subjects })
const tuitId = (en: string) => `tuit-${en.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`
/** A TUIT direction: its Uzbek official name, translated, with the state-test mandatory block before its two specialised subjects. */
const tuitDirection = (uz: string, ru: string, en: string, subjects: L[]) => ({ id: tuitId(en), name: l(uz, ru, en), subjects: [STATE_MANDATORY, ...subjects] })
const FOREIGN_LANGUAGE = l('Çet tili', 'Иностранный язык', 'Foreign language')
const TSUL_LAW = l('Huquqşunoslik (davlat va huquq asoslari)', 'Правоведение (основы государства и права)', 'Law (fundamentals of state and law)')
const tsueId = (en: string) => `tsue-${en.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`
/** A TSUE direction: its Uzbek name, translated, with the state-test mandatory block before its specialised subjects (none when the list names none). */
const tsueDirection = (uz: string, ru: string, en: string, subjects: L[]) => ({ id: tsueId(en), name: l(uz, ru, en), subjects: subjects.length ? [STATE_MANDATORY, ...subjects] : [] })
const cauId = (name: string) => `cau-${name.toLowerCase().replace(/^b\.(s|sc|a)\. in /, '').replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`
const cauDirection = (name: string, subjects: L[]) => ({ id: cauId(name), name: official(name), subjects })
const CAU_ENGLISH_ONLY = l('Ingliz tili (CAU imtihoni yoki IELTS 5.5)', 'Английский язык (экзамен CAU или IELTS 5.5)', 'English (CAU exam or IELTS 5.5)')
const MU_MATH_LOGIC = l('Matematika va mantiq (MU kiriş imtihoni)', 'Математика и логика (вступительный экзамен MU)', 'Maths & Logic (MU entrance exam)')
const MU_ENGLISH = l('Ingliz tili (IELTS 5.0+ yoki MU ingliz tili testi)', 'Английский язык (IELTS 5.0+ или тест MU по английскому)', 'English (IELTS 5.0+ or MU English test)')
const MU_ENGLISH_ELT = l('Ingliz tili (MU ingliz tili imtihoni, IELTS 5.5+)', 'Английский язык (экзамен MU по английскому, IELTS 5.5+)', 'English (MU English exam, IELTS 5.5+)')
const TRACK_ROUTES = l('Qabul yöllari', 'Пути поступления', 'Admission routes')
/** ILMORA's programming course as an extra of the IT track: useful preparation, not something a university examines. */
const PROGRAMMING_EXTRA: Subject = { label: l('Dasturlaş asoslari (qöşimça, kiriş fani emas)', 'Основы программирования (дополнительно, не вступительный предмет)', 'Programming basics (extra, not an entrance subject)'), course: COURSE.python, optional: true }
const ENGLISH_BY_UNIVERSITY = l('Ingliz tili (IELTS; talab universitetga boğliq)', 'Английский язык (IELTS; требование зависит от университета)', 'English (IELTS; the requirement depends on the university)')
/** National 2026/2027 subject list (approved by the Ministry with the State Testing Agency), posted by TSUE. */
const NATIONAL_SUBJECT_LIST = 'https://tsue.uz/media/uploads/2026/06/17/nptqbl.pdf'

// `published`: shown on the University Admission page (INHA, TSUE, TUIT, KIUT, MDIS, Millat Umidi, WIUT and CAU, plus the preparation
// tracks); the other researched universities, Narxoz included, stay hidden records and their packages drafts.
export const UNIVERSITIES: University[] = [
  {
    id: 'uni-inha', name: 'Inha University in Tashkent', shortName: 'INHA', city: 'Tashkent', country: 'Uzbekistan', website: 'https://inha.uz', logoUrl: '/universities/uni-inha.svg', published: true,
    description: l("Toşkentdagi Inha universiteti (IUT) 2014-yilda Koreya Respublikasidagi INHA universiteti bilan hamkorlikda taşkil etilgan. Bakalavriat dasturlari kompyuter va dasturiy injiniring hamda biznes va logistika yönalişlarini öz içiga oladi.", "Университет Инха в Ташкенте (IUT) основан в 2014 году в сотрудничестве с Университетом INHA (Республика Корея). Бакалавриат включает направления компьютерной и программной инженерии, а также бизнеса и логистики.", "Inha University in Tashkent (IUT) was founded in 2014 in cooperation with INHA University in the Republic of Korea. Its undergraduate departments cover computer and software engineering, and business and logistics."), // https://inha.uz/about/introduction/
    // Schools and majors as the 2026-2027 guidelines name them; SOCIE students are assigned to CSE or ICE after the first year.
    faculties: [
      { id: 'inha-socie', name: l('Kompyuter va axborot injiniringi maktabi (SOCIE)', 'Школа компьютерной и информационной инженерии (SOCIE)', 'School of Computer and Information Engineering (SOCIE)'), directions: [
        { id: 'inha-socie-cse-ice', name: l('Kompyuter fanlari / Axborot va kommunikatsiya injiniringi (CSE, ICE)', 'Компьютерные науки / Информационно-коммуникационная инженерия (CSE, ICE)', 'Computer Science / Information and Communication Engineering (CSE, ICE)'), subjects: [l('Matematika', 'Математика', 'Mathematics'), l('Fizika', 'Физика', 'Physics')] },
      ] },
      { id: 'inha-sbl', name: l('Biznes va logistika maktabi (SBL)', 'Школа бизнеса и логистики (SBL)', 'School of Business and Logistics (SBL)'), directions: [
        { id: 'inha-sbl-ba', name: l('Biznes boşqaruvi (Business Administration)', 'Управление бизнесом (Business Administration)', 'Business Administration'), subjects: [l('Matematika', 'Математика', 'Mathematics')] },
        { id: 'inha-sbl-lm', name: l('Logistika menejmenti (Logistics Management)', 'Логистический менеджмент (Logistics Management)', 'Logistics Management'), subjects: [l('Matematika', 'Математика', 'Mathematics')] },
      ] },
      { id: 'inha-uk', name: l('Buyuk Britaniya dasturlari', 'Британские программы', 'UK programmes'), directions: [
        { id: 'inha-uk-it', name: l('Axborot texnologiyalari', 'Информационные технологии', 'Information Technology'), subjects: [l('Matematika', 'Математика', 'Mathematics')] },
        { id: 'inha-uk-bm', name: l('Biznes va menejment', 'Бизнес и менеджмент', 'Business and Management'), subjects: [l('Matematika', 'Математика', 'Mathematics')] },
      ] },
      { id: 'inha-italy', name: l('Italiya dasturi', 'Итальянская программа', 'Italy programme'), directions: [
        { id: 'inha-italy-ceds', name: l('Kompyuter injiniringi va ma’lumotlar fani', 'Компьютерная инженерия и наука о данных', 'Computer Engineering and Data Science'), subjects: [l('Matematika', 'Математика', 'Mathematics')] },
      ] },
    ],
  },
  {
    id: 'uni-narxoz', name: 'Narxoz University', shortName: 'Narxoz', city: 'Almaty', country: 'Kazakhstan', website: 'https://narxoz.edu.kz', logoUrl: '/universities/uni-narxoz.png',
    description: l("Almatidagi Narxoz universiteti yetakçi Yevropa va Amerika universitetlari — Queen’s University Belfast, Mykolas Romeris University va Penn State University bilan qöş diplom dasturlarini amalga oşiradi. Ta’lim an’anaviy fakultetlar örniga fanlararo maktablar modeli asosida taşkil etilgan.", "Университет Нархоз (Алматы) реализует программы двойного диплома с ведущими европейскими и американскими вузами — Queen's University Belfast, Mykolas Romeris University и Penn State University. Обучение организовано по междисциплинарной модели школ вместо традиционных факультетов.", "Narxoz University in Almaty runs dual-degree programmes with leading European and American universities: Queen's University Belfast, Mykolas Romeris University and Penn State University. Teaching is organised in interdisciplinary schools instead of traditional faculties."), // https://narxoz.edu.kz/
    // Directions are the profile-subject pairs to verify; the programmes behind each pair are not confirmed yet.
    faculties: [
      { id: 'narxoz-bachelor', name: l('Bakalavriat: profil fanlar juftligi (tasdiqlanmagan)', 'Бакалавриат: пары профильных предметов (не подтверждено)', 'Bachelor: profile-subject pairs (unverified)'), directions: [
        { id: 'narxoz-math-informatics', name: l('Matematika + Informatika', 'Математика + Информатика', 'Mathematics + Informatics'), subjects: [narxozSubject.math, narxozSubject.informatics] },
        { id: 'narxoz-math-geography', name: l('Matematika + Geografiya', 'Математика + География', 'Mathematics + Geography'), subjects: [narxozSubject.math, narxozSubject.geography] },
        { id: 'narxoz-math-physics', name: l('Matematika + Fizika', 'Математика + Физика', 'Mathematics + Physics'), subjects: [narxozSubject.math, narxozSubject.physics] },
        { id: 'narxoz-english-geography', name: l('Ingliz tili + Geografiya', 'Английский язык + География', 'English + Geography'), subjects: [narxozSubject.english, narxozSubject.geography] },
        { id: 'narxoz-english-history', name: l('Ingliz tili + Jahon tarixi', 'Английский язык + Всемирная история', 'English + World History'), subjects: [narxozSubject.english, narxozSubject.worldHistory] },
        { id: 'narxoz-law-history', name: l('Huquq asoslari + Jahon tarixi', 'Основы права + Всемирная история', 'Fundamentals of Law + World History'), subjects: [narxozSubject.law, narxozSubject.worldHistory] },
      ] },
    ],
  },
  {
    id: 'uni-wiut', name: 'Westminster International University in Tashkent', shortName: 'WIUT', city: 'Tashkent', country: 'Uzbekistan', website: 'https://wiut.uz', logoUrl: '/universities/uni-wiut-logo.png', published: true,
    description: l("Toşkentdagi Westminster xalqaro universiteti (WIUT) 2002-yilda Londondagi Westminster universiteti, «Umid» Prezident jamğarmasi hamda Oliy va örta maxsus ta’lim vazirligi bilan birgalikda taşkil etilgan. Universitet Britaniyada akkreditatsiyadan ötgan darajalarni taklif etadi, barça dasturlar ingliz tilida öqitiladi.", "Международный университет Вестминстер в Ташкенте (WIUT) основан в 2002 году совместно с Вестминстерским университетом (Лондон), Президентским фондом «Умид» и Министерством высшего и среднего специального образования. Университет предлагает степени с британской аккредитацией, все программы преподаются на английском языке.", "Westminster International University in Tashkent (WIUT) was established in 2002 in conjunction with the University of Westminster in London, the UMID Presidential Foundation and the Ministry of Higher and Secondary Specialized Education. It offers British-accredited degrees, and all programmes are taught in English."), // https://www.wiut.uz/about-us
    // Faculty labels from each programme page (the undergraduate menu has no school headings); read 2026-11-03.
    faculties: [
      { id: 'wiut-fsas', name: official('Faculty of Social and Applied Sciences (FSAS)'), directions: [
        { id: 'wiut-cs', name: official('BSc (Hons) in Computer Science'), subjects: [WIUT_MATH, SUBJECT.ielts('6.5')] },
        { id: 'wiut-bis', name: official('BSc (Hons) in Business Information Systems'), subjects: [] },
        { id: 'wiut-commercial-law', name: official('BA (Hons) in Commercial Law'), subjects: [SUBJECT.ielts('6.5')] },
        { id: 'wiut-ir-law', name: official('BA (Hons) in International Relations and Law'), subjects: [SUBJECT.ielts('6.5')] },
      ] },
      { id: 'wiut-business-school', name: official('WIUT Business School'), directions: [
        { id: 'wiut-economics', name: official('BSc (Hons) in Economics (with Finance, with Data Science)'), subjects: [WIUT_MATH, SUBJECT.ielts('6.5')] },
        { id: 'wiut-finance', name: official('BSc (Hons) in Finance'), subjects: [WIUT_MATH, SUBJECT.ielts('6.5')] },
        { id: 'wiut-business-management', name: official('BA (Hons) in Business Management (with Finance, with Marketing)'), subjects: [WIUT_MATH, SUBJECT.ielts('6.5')] },
      ] },
      { id: 'wiut-foundation-programme', name: official('International Foundation'), directions: [
        { id: 'wiut-foundation', name: official('Certificate in International Foundation Studies'), subjects: [l('Matematika (WIUT kiriş matematika imtihoni)', 'Математика (вступительный экзамен WIUT по математике)', 'Mathematics (WIUT Mathematics Entrance Exam)'), SUBJECT.ielts('6.0')] },
      ] },
    ],
  },
  { id: 'uni-ttpu', name: 'Turin Polytechnic University in Tashkent', shortName: 'TTPU', city: 'Tashkent', website: 'https://turin.uz' },
  { id: 'uni-newuu', name: 'New Uzbekistan University', shortName: 'NewUU', city: 'Tashkent', website: 'https://newuu.uz' },
  { id: 'uni-amity', name: 'Amity University Tashkent', shortName: 'Amity', city: 'Tashkent', website: 'https://amity.uz' },
  {
    id: 'uni-mdis', name: 'Management Development Institute of Singapore in Tashkent', shortName: 'MDIS', city: 'Tashkent', country: 'Uzbekistan', website: 'https://mdis.uz', logoUrl: '/universities/uni-mdis.svg', published: true,
    description: l("MDIS Tashkent 2007-yilda Özbekiston banklari assotsiatsiyasi va Management Development Institute of Singapore (MDIS) tomonidan MDISning birinçi xorijiy kampusi sifatida taşkil etilgan. Dasturlar Buyuk Britaniyadagi hamkorlar — Bangor universiteti va Sunderland universiteti, 2020-yildan esa Teesside universiteti bilan birgalikda olib boriladi.", "MDIS Tashkent основан в 2007 году Ассоциацией банков Узбекистана и Management Development Institute of Singapore (MDIS) и стал первым зарубежным кампусом MDIS. Программы реализуются с британскими университетами-партнёрами — Бангорским университетом и Университетом Сандерленда, а с 2020 года также с Университетом Тиссайда.", "MDIS Tashkent was established in 2007 by the Uzbekistan Banking Association and the Management Development Institute of Singapore (MDIS), as MDIS's first overseas campus. Its programmes are delivered with UK partners Bangor University and the University of Sunderland, joined by Teesside University in 2020."), // https://www.mdis.uz/en/menu/overview
    // Bachelor degrees are entered through the Foundation Year (or transfer); the programme list is on /en/menu/under-graduate-programmes-of-mdis-tashkent.
    faculties: [
      { id: 'mdis-foundation-year', name: official('Foundation Year'), directions: [
        { id: 'mdis-foundation', name: official('Foundation Year (route to the bachelor degrees)'), subjects: [l('Ingliz tili (IELTS yoki MDIS English Test 5.5+)', 'Английский язык (IELTS или MDIS English Test 5.5+)', 'English (IELTS or MDIS English Test 5.5+)')] },
      ] },
      { id: 'mdis-sunderland', name: official('University of Sunderland (UK) bachelor programmes'), directions: [
        'BA (Hons) Accounting and Finance', 'BA (Hons) Business and Financial Management', 'BA (Hons) Business and Management', 'BA (Hons) Business and Marketing Management', 'BA (Hons) Fashion Product and Promotion', 'BSc (Hons) International Tourism and Hospitality Management',
      ].map((name, i) => ({ id: `mdis-sunderland-${i + 1}`, name: official(name), subjects: [] })) },
      { id: 'mdis-teesside', name: official('Teesside University (UK) bachelor programmes'), directions: [
        'BA (Hons) Graphic Design & International Marketing', 'BA (Hons) Airline and Airport Management (Top-up)', 'BSc (Hons) Finance, Investment and Banking', 'BSc (Hons) Business Economics',
      ].map((name, i) => ({ id: `mdis-teesside-${i + 1}`, name: official(name), subjects: [] })) },
    ],
  },
  { id: 'uni-uwed', name: 'University of World Economy and Diplomacy', shortName: 'UWED', city: 'Tashkent', website: 'https://uwed.uz' },
  { id: 'uni-webster', name: 'Webster University in Tashkent', shortName: 'Webster', city: 'Tashkent', website: 'https://www.webstertashkent.uz' },
  {
    id: 'uni-kiut', name: 'Kimyo International University in Tashkent', shortName: 'KIUT', city: 'Tashkent', country: 'Uzbekistan', website: 'https://kiut.uz', logoUrl: '/universities/uni-kiut.svg', published: true,
    description: l("Toşkentdagi Kimyo xalqaro universiteti (KIUT) Özbekistondagi birinçi xususiy oliy ta’lim muassasasi bölib, 2018-yilda Toşkentda Yeoju texnika instituti nomi bilan taşkil etilgan. Ta’lim özbek, rus va ingliz tillarida olib boriladi.", "Ташкентский международный университет Кимё (KIUT) — первое частное высшее учебное заведение Республики Узбекистан, созданное в 2018 году в Ташкенте под названием Технический институт Ёджу. Обучение ведётся на узбекском, русском и английском языках.", "Kimyo International University in Tashkent (KIUT) is Uzbekistan's first private higher education institution, founded in Tashkent in 2018 as Yeoju Technical Institute. Teaching is in Uzbek, Russian and English."), // https://kiut.uz/ru/institute/o-nas/
    // Schools and programmes from the 2026/2027 admission table (kiut.uz/en/admissions/tashkent-admission/, read 2026-11-03). The table
    // names only the exam type; subjects come from the programme pages, which state no year. Empty subjects: not stated on the pages read.
    faculties: [
      { id: 'kiut-business', name: official('School of Business and Finance'), directions: [
        ...['Business Management', 'International Economic Relations', 'International Marketing', 'Accounting', 'Banking', 'Finance'].map((name) => kiutDirection(name, [SUBJECT.math, SUBJECT.english])),
        kiutDirection('Tourism', []), kiutDirection('International Relations', []),
      ] },
      { id: 'kiut-engineering', name: official('School of Engineering'), directions: [
        ...['Civil Engineering', 'Renewable Energy', 'Lift Engineering', 'Information Systems Engineering', 'Electrical Engineering', 'Mechatronics', 'Mechanical Engineering', 'Traffic Management'].map((name) => kiutDirection(name, [SUBJECT.math, SUBJECT.physics])),
        ...['Space Technologies', 'Applied Mathematics', 'Engineering Communications Construction and Installation', 'Information Systems and Technologies', 'Sustainable Transport', 'Biotechnology', 'Software Engineering', 'Computer Engineering', 'Industrial Engineering and Management', 'Artificial Intelligence'].map((name) => kiutDirection(name, [])),
        kiutDirection('Architecture and Urban Design', [CREATIVE_EXAM]),
      ] },
      { id: 'kiut-medicine', name: official('School of Medicine'), directions: [
        kiutDirection('General Medicine', [SUBJECT.biology, SUBJECT.chemistry, MOTHER_TONGUE_LIT]),
        kiutDirection('Dentistry', [SUBJECT.biology, SUBJECT.chemistry, MOTHER_TONGUE_LIT]),
        kiutDirection('Pediatrics', [SUBJECT.chemistry, SUBJECT.biology]),
        kiutDirection('Nursing', []), kiutDirection('Cosmetology', []),
      ] },
      { id: 'kiut-education', name: official('School of Education'), directions: [
        ...['Korean Philology', 'English Education', 'Translation Studies (Chinese, English Languages)', 'Philology and Language Teaching (Russian Language)', 'Uzbek Language and Literature', 'Translation Theory and Practice (Turkish Language)', 'Philology and Language Teaching (Japanese Language)'].map((name) => kiutDirection(name, [FOREIGN_CERTIFICATE])),
        ...['Preschool Education', 'Primary Education', 'History', 'Special Pedagogy', 'Psychology', 'Physical Culture'].map((name) => kiutDirection(name, [])),
      ] },
      { id: 'kiut-arts', name: official('School of Arts'), directions: [
        kiutDirection('Fashion Design', [l('Ijodiy imtihon: rasm va kompozitsiya', 'Творческий экзамен: рисунок и композиция', 'Creative exam: drawing and composition')]),
        kiutDirection('Painting', [CREATIVE_EXAM]), kiutDirection('Interior Design', [CREATIVE_EXAM]),
      ] },
    ],
  },
  {
    id: 'uni-millat-umidi', name: 'Millat Umidi University', shortName: 'MU', city: 'Tashkent', country: 'Uzbekistan', website: 'https://millatumidi.uz', logoUrl: '/universities/uni-millat-umidi.png', published: true,
    description: l("Millat Umidi University 2021-yilda taşkil etilgan: bakalavriat va magistratura dasturlari uç maktabda — biznes, axborot texnologiyalari va xorijiy tillar — olib boriladi; 30 dan ortiq xalqaro hamkori bor.", "Millat Umidi University основан в 2021 году: программы бакалавриата и магистратуры ведутся в трёх школах — бизнеса, информационных технологий и иностранных языков; более 30 международных партнёров.", "Founded in 2021, Millat Umidi University offers bachelor's and master's programmes in three schools — Business, Information Technology and Foreign Languages — and has more than 30 international partners."), // https://millatumidi.uz/about-us
    // Schools and bachelor programmes from the programme pages and Admissions 2026/2027 (read 2026-11-03). The admissions page
    // requires a Maths & Logic exam of every applicant and IELTS (or the MU English test) for English-taught programmes.
    faculties: [
      { id: 'mu-business', name: official('School of Business & Finance'), directions: [
        { id: 'mu-accounting-finance', name: official('Applied Accounting and Finance (ACCA)'), subjects: [MU_MATH_LOGIC, MU_ENGLISH] },
        { id: 'mu-business-management', name: official('Business Management (PMI)'), subjects: [MU_MATH_LOGIC, MU_ENGLISH] },
        { id: 'mu-accounting-uz', name: official('Applied Accounting (Uzbek)'), subjects: [MU_MATH_LOGIC] },
        { id: 'mu-business-administration', name: official('Business Administration (Uzbek / Russian)'), subjects: [MU_MATH_LOGIC] },
        { id: 'mu-tourism', name: official('Tourism and Hospitality (Uzbek / Russian)'), subjects: [MU_MATH_LOGIC] },
      ] },
      { id: 'mu-it', name: official('School of Information Technology'), directions: [
        { id: 'mu-software-engineering', name: official('Software Engineering (English)'), subjects: [MU_MATH_LOGIC, MU_ENGLISH] },
        { id: 'mu-software-engineering-uz', name: official('Software Engineering (Uzbek)'), subjects: [MU_MATH_LOGIC] },
      ] },
      { id: 'mu-languages', name: official('School of Foreign Languages'), directions: [
        { id: 'mu-english-language-teaching', name: official('English Language Teaching'), subjects: [MU_ENGLISH_ELT] },
      ] },
    ],
  },
  {
    id: 'uni-cau', name: 'Central Asian University (formerly AKFA University)', shortName: 'CAU', city: 'Tashkent', country: 'Uzbekistan', website: 'https://centralasian.uz', logoUrl: '/universities/uni-cau.svg', published: true,
    description: l("2019-yilda Toşkentda AKFA University nomi bilan taşkil etilgan, 2023-yilda Central Asian University (CAU) deb qayta nomlangan. Barça dasturlar ingliz tilida öqitiladi.", "Основан в Ташкенте в 2019 году как AKFA University, в 2023 году переименован в Central Asian University (CAU). Все программы преподаются на английском языке.", "Founded in Tashkent in 2019 as AKFA University and renamed Central Asian University (CAU) in 2023. All programmes are taught in English."), // https://centralasian.uz/akfa-university
    // Schools and programmes from the programme pages; subjects as each page and the admission regulations state them (read 2026-11-03).
    faculties: [
      { id: 'cau-medical', name: official('Medical School'), directions: [{ id: 'cau-medicine', name: official('Doctor of Medicine (M.D.)'), subjects: [SUBJECT.biology, SUBJECT.chemistry, SUBJECT.ielts('6.0')] }] },
      { id: 'cau-dental', name: official('Dental School'), directions: [{ id: 'cau-dentistry', name: official('Doctor of Dental Surgery (DDS)'), subjects: [SUBJECT.biology, SUBJECT.chemistry, SUBJECT.ielts('6.0')] }] },
      { id: 'cau-engineering', name: official('School of Engineering'), directions: [
        ...['B.S. in Computer Science', 'B.S. in Biomedical Engineering', 'B.S. in Industrial Engineering'].map((name) => cauDirection(name, [SUBJECT.math, SUBJECT.ielts('5.5')])),
      ] },
      { id: 'cau-architecture', name: official('Architecture & Design School'), directions: [cauDirection('B.S. in Architecture & Design', [SUBJECT.math, SUBJECT.ielts('5.5')])] },
      { id: 'cau-business', name: official('Business School'), directions: [
        ...['B.Sc. in Accounting & Finance', 'B.A. in Management', 'B.Sc. in Economics', 'B.A. in International Business (Dual Degree)', 'B.A. in Marketing'].map((name) => cauDirection(name, [SUBJECT.math, SUBJECT.ielts('5.5')])),
      ] },
      { id: 'cau-hospitality', name: official('Hospitality Management & Tourism School'), directions: [cauDirection('B.A. in International Hospitality Management & Tourism', [CAU_ENGLISH_ONLY])] },
    ],
  },
  { id: 'uni-nuuz', name: 'National University of Uzbekistan named after Mirzo Ulugbek', shortName: 'NUUz', city: 'Tashkent', website: 'https://nuu.uz' },
  // TUIT: its own sites state 2026/2027 admission but no faculties and no subjects per direction (only a 2023/2024 direction list).
  {
    id: 'uni-tuit', name: 'Tashkent University of Information Technologies named after Muhammad al-Khwarizmi', shortName: 'TUIT', city: 'Tashkent', country: 'Uzbekistan', website: 'https://tuit.uz', logoUrl: '/universities/uni-tuit-emblem.png', published: true,
    description: l("1955-yilda Toşkent elektrotexnika aloqa instituti sifatida taşkil etilgan; 2002-yil 30-mayda Prezidentning 3080-son Farmoni bilan Toşkent axborot texnologiyalari universiteti deb qayta nomlangan.", "Основан в 1955 году как Ташкентский электротехнический институт связи; 30 мая 2002 года указом Президента № 3080 переименован в Ташкентский университет информационных технологий.", "Founded in 1955 as the Tashkent Electrotechnical Institute of Communications; renamed Tashkent University of Information Technologies by Presidential Decree No. 3080 of 30 May 2002."), // https://tuit.uz/en/about-tuit-
    // Faculties as tuit.uz's faculty pages group them; direction names and their two specialised subjects (1st, 2nd) from the
    // State Testing Agency directory for TUIT (my.uzbmb.uz, edu_id 380), which match the 2026/2027 fee list. Directions the
    // faculty pages do not assign to a faculty are listed separately rather than guessed.
    faculties: [
      { id: 'tuit-computer-engineering', name: l('Kompyuter injiniringi fakulteti', 'Факультет компьютерной инженерии', 'Faculty of Computer Engineering'), directions: [
        tuitDirection('Kompyuter injiniringi', 'Компьютерная инженерия', 'Computer Engineering', [SUBJECT.math, SUBJECT.physics]),
        tuitDirection('Sun’iy intellekt', 'Искусственный интеллект', 'Artificial Intelligence', [SUBJECT.math, SUBJECT.physics]),
        tuitDirection('Mexatronika va robototexnika', 'Мехатроника и робототехника', 'Mechatronics and Robotics', [SUBJECT.physics, SUBJECT.math]),
        tuitDirection('Poçta aloqasi texnologiyasi', 'Технология почтовой связи', 'Postal Communication Technology', [SUBJECT.math, SUBJECT.physics]),
      ] },
      { id: 'tuit-software-engineering', name: l('Dasturiy injiniring fakulteti', 'Факультет программной инженерии', 'Faculty of Software Engineering'), directions: [
        tuitDirection('Dasturiy injiniring', 'Программная инженерия', 'Software Engineering', [SUBJECT.math, SUBJECT.physics]),
        tuitDirection('Amaliy matematika', 'Прикладная математика', 'Applied Mathematics', [SUBJECT.math, SUBJECT.physics]),
      ] },
      { id: 'tuit-cybersecurity', name: l('Kiberxavfsizlik fakulteti', 'Факультет кибербезопасности', 'Faculty of Cybersecurity'), directions: [
        tuitDirection('Axborot xavfsizligi', 'Информационная безопасность', 'Information Security', [SUBJECT.math, SUBJECT.physics]),
        tuitDirection('Kiberxavfsizlik injiniringi', 'Инженерия кибербезопасности', 'Cybersecurity Engineering', [SUBJECT.math, SUBJECT.physics]),
      ] },
      { id: 'tuit-telecommunications', name: l('Telekommunikatsiya texnologiyalari fakulteti', 'Факультет телекоммуникационных технологий', 'Faculty of Telecommunication Technologies'), directions: [
        tuitDirection('Telekommunikatsiya texnologiyalari', 'Телекоммуникационные технологии', 'Telecommunication Technologies', [SUBJECT.math, SUBJECT.physics]),
        tuitDirection('Infokommunikatsiya injiniringi', 'Инфокоммуникационная инженерия', 'Infocommunication Engineering', [SUBJECT.math, SUBJECT.physics]),
      ] },
      { id: 'tuit-television', name: l('Televizion texnologiyalar fakulteti', 'Факультет телевизионных технологий', 'Faculty of Television Technologies'), directions: [
        tuitDirection('Televizion texnologiyalar', 'Телевизионные технологии', 'Television Technologies', [SUBJECT.math, SUBJECT.physics]),
      ] },
      { id: 'tuit-digital-education', name: l('Raqamli ta’lim va texnologiyalar fakulteti', 'Факультет цифрового образования и технологий', 'Faculty of Digital Education and Technologies'), directions: [
        tuitDirection('Kutubxona-axborot faoliyati', 'Библиотечно-информационная деятельность', 'Library and Information Activity', [SUBJECT.math, MOTHER_TONGUE_LIT]),
      ] },
      { id: 'tuit-other', name: l('Boşqa yönalişlar (fakultet saytda körsatilmagan)', 'Другие направления (факультет на сайте не указан)', 'Other directions (faculty not stated on the site)'), directions: [
        tuitDirection('Axborot tizimlari va texnologiyalari', 'Информационные системы и технологии', 'Information Systems and Technologies', [SUBJECT.math, SUBJECT.physics]),
        tuitDirection('Radioelektron qurilmalar va tizimlar', 'Радиоэлектронные устройства и системы', 'Radio-electronic Devices and Systems', [SUBJECT.math, SUBJECT.physics]),
        tuitDirection('Simsiz aloqa va teleradioeşittiriş injiniringi', 'Инженерия беспроводной связи и телерадиовещания', 'Wireless Communication and Broadcasting Engineering', [SUBJECT.math, SUBJECT.physics]),
        tuitDirection('Elektr muhandisligi', 'Электротехника', 'Electrical Engineering', [SUBJECT.physics, SUBJECT.math]),
        tuitDirection('Iqtisodiyot', 'Экономика', 'Economics', [SUBJECT.math, FOREIGN_LANGUAGE]),
        tuitDirection('Menejment', 'Менеджмент', 'Management', [SUBJECT.math, FOREIGN_LANGUAGE]),
        tuitDirection('Logistika', 'Логистика', 'Logistics', [SUBJECT.math, FOREIGN_LANGUAGE]),
      ] },
    ],
  },
  {
    id: 'uni-tsue', name: 'Tashkent State University of Economics', shortName: 'TSUE', city: 'Tashkent', country: 'Uzbekistan', website: 'https://tsue.uz/ru', logoUrl: '/universities/uni-tsue.svg', published: true,
    localName: l('Toşkent davlat iqtisodiyot universiteti', 'Ташкентский государственный экономический университет', 'Tashkent State University of Economics'),
    description: l('Universitet tarixi 1931-yildan boşlanadi: Turkiston davlat universitetining iqtisodiyot fakultetlari asosida Toşkentda Örta Osiyo moliya-iqtisodiyot instituti taşkil etilgan va 1931-yil 1-sentabrda darslar boşlangan.',
      'История университета начинается в 1931 году: в Ташкенте на базе экономических факультетов Туркестанского государственного университета был создан Среднеазиатский финансово-экономический институт, занятия начались 1 сентября 1931 года.',
      'Its history goes back to 1931, when the Central Asian Finance-Economics Institute was set up in Tashkent from the economics faculties of Turkestan State University; classes began on 1 September 1931.'), // https://tsue.uz/api/v1/about/
    // TSUE lists its 2026/2027 bachelor directions for the whole university (contract-price document, Council decision No. 1 of
    // 26.08.2026) and publishes no faculty for each, so they are grouped by field here, not presented as faculties. The two
    // specialised subjects per direction come from the national 2026/2027 subject list TSUE posts (nptqbl.pdf). Not offered
    // as bachelor directions: Entrepreneurship, Business Analytics and Digital Economy (master's only), International Trade, Law.
    faculties: [
      { id: 'tsue-economics-finance', name: l('Iqtisodiyot va moliya yönalişlari', 'Направления: экономика и финансы', 'Economics and finance directions'), directions: [
        tsueDirection('Iqtisodiyot', 'Экономика', 'Economics', [SUBJECT.math, FOREIGN_LANGUAGE]),
        tsueDirection('Moliya va moliyaviy texnologiyalar', 'Финансы и финансовые технологии', 'Finance and Financial Technologies', [SUBJECT.math, FOREIGN_LANGUAGE]),
        tsueDirection('Bank işi', 'Банковское дело', 'Banking', [SUBJECT.math, FOREIGN_LANGUAGE]),
        tsueDirection('Buxgalteriya hisobi', 'Бухгалтерский учёт', 'Accounting', [SUBJECT.math, FOREIGN_LANGUAGE]),
        tsueDirection('Soliqlar va soliqqa tortiş', 'Налоги и налогообложение', 'Taxes and Taxation', [SUBJECT.math, FOREIGN_LANGUAGE]),
        tsueDirection('Statistika', 'Статистика', 'Statistics', [SUBJECT.math, FOREIGN_LANGUAGE]),
        tsueDirection('Davlat auditi', 'Государственный аудит', 'State Audit', []),
        tsueDirection('Islomiy moliya', 'Исламские финансы', 'Islamic Finance', []),
      ] },
      { id: 'tsue-business-management', name: l('Biznes va menejment yönalişlari', 'Направления: бизнес и менеджмент', 'Business and management directions'), directions: [
        tsueDirection('Menejment', 'Менеджмент', 'Management', [SUBJECT.math, FOREIGN_LANGUAGE]),
        tsueDirection('Biznesni boşqariş', 'Управление бизнесом', 'Business Management', [SUBJECT.math, FOREIGN_LANGUAGE]),
        tsueDirection('Marketing', 'Маркетинг', 'Marketing', [SUBJECT.math, FOREIGN_LANGUAGE]),
        tsueDirection('Inson resurslarini boşqariş', 'Управление человеческими ресурсами', 'Human Resource Management', [SUBJECT.math, FOREIGN_LANGUAGE]),
      ] },
      { id: 'tsue-international', name: l('Xalqaro iqtisodiyot, savdo va logistika yönalişlari', 'Направления: мировая экономика, торговля и логистика', 'International economy, trade and logistics directions'), directions: [
        tsueDirection('Jahon iqtisodiyoti va xalqaro iqtisodiy munosabatlar', 'Мировая экономика и международные экономические отношения', 'World Economy and International Economic Relations', [SUBJECT.math, FOREIGN_LANGUAGE]),
        tsueDirection('Savdo işi', 'Торговое дело', 'Trade Business', [SUBJECT.math, FOREIGN_LANGUAGE]),
        tsueDirection('Logistika', 'Логистика', 'Logistics', [SUBJECT.math, FOREIGN_LANGUAGE]),
      ] },
      { id: 'tsue-digital', name: l('Axborot texnologiyalari yönalişlari', 'Направления: информационные технологии', 'Information technology directions'), directions: [
        tsueDirection('Axborot tizimlari va texnologiyalari', 'Информационные системы и технологии', 'Information Systems and Technologies', [SUBJECT.math, SUBJECT.physics]),
        tsueDirection('Axborot xavfsizligi', 'Информационная безопасность', 'Information Security', [SUBJECT.math, SUBJECT.physics]),
        tsueDirection('Sun’iy intellekt', 'Искусственный интеллект', 'Artificial Intelligence', [SUBJECT.math, SUBJECT.physics]),
      ] },
      { id: 'tsue-tourism', name: l('Turizm yönalişi', 'Направление: туризм', 'Tourism direction'), directions: [
        tsueDirection('Turizm va mehmondöstlik', 'Туризм и гостеприимство', 'Tourism and Hospitality', [SUBJECT.history, FOREIGN_LANGUAGE]),
      ] },
    ],
  },
  { id: 'uni-tsul', name: 'Tashkent State University of Law', shortName: 'TSUL', city: 'Tashkent', website: 'https://tsul.uz' },
  { id: 'uni-tsmu', name: 'Tashkent State Medical University', shortName: 'TSMU', city: 'Tashkent', website: 'https://tashmeduni.uz' },

  // ── Preparation tracks: general preparation for a kind of university, not one university and not a programme of any ──
  {
    id: 'prep-general', kind: 'track', name: 'General university admission', shortName: 'ADM', country: 'Uzbekistan', published: true,
    localName: l('Oliy ta’limga kiriş: umumiy tayyorgarlik', 'Поступление в вузы: общая подготовка', 'University Admission: General Preparation'),
    description: l('Oliy ta’limga kiriş uçun umumiy tayyorgarlik: davlat testining majburiy fanlari yoki xalqaro va xususiy universitetlar uçun matematika va ingliz tili. Bu biror universitetning dasturi emas — maqsadli oliygohingiz talablarini uning rasmiy sahifasida tekşiring.',
      'Общая подготовка к поступлению: обязательные предметы государственного теста либо математика и английский для международных и частных университетов. Это не программа какого-либо университета — требования выбранного вуза проверьте на его официальной странице.',
      'General admission preparation: the mandatory state-test subjects, or Mathematics and English for international and private universities. It is not a programme of any university — check the requirements of your target university on its official page.'),
    faculties: [{ id: 'prep-general-routes', name: TRACK_ROUTES, directions: [
      { id: 'prep-general-state', name: l('Davlat testi: majburiy fanlar', 'Государственный тест: обязательные предметы', 'State test: mandatory subjects'), subjects: [STATE_MANDATORY] },
      { id: 'prep-general-international', name: l('Xalqaro va xususiy universitetlar', 'Международные и частные университеты', 'International and private universities'), subjects: [SUBJECT.math, ENGLISH_BY_UNIVERSITY] },
    ] }],
  },
  {
    id: 'prep-medical', kind: 'track', name: 'Medical university preparation', shortName: 'MED', country: 'Uzbekistan', published: true,
    localName: l('Tibbiyot yönalişi', 'Медицинское направление', 'Medicine'),
    description: l('Tibbiyot oliygohlariga kiriş uçun umumiy tayyorgarlik: biologiya, kimyo va kerak bölsa ingliz tili. Bu TDIU yoki boşqa universitetning dasturi emas — maqsadli oliygohingiz talablarini uning rasmiy sahifasida tekşiring.',
      'Общая подготовка к поступлению в медицинские вузы: биология, химия и, где нужно, английский язык. Это не программа ТГЭУ или другого университета — требования выбранного вуза проверьте на его официальной странице.',
      'General preparation for admission to medical universities: biology, chemistry and, where required, English. It is not a programme of TSUE or any other university — check the requirements of your target university on its official page.'),
    faculties: [{ id: 'prep-medical-routes', name: TRACK_ROUTES, directions: [
      { id: 'prep-medical-state', name: l('Davlat tibbiyot oliygohlari (davlat testi)', 'Государственные медицинские вузы (государственный тест)', 'State medical universities (state test)'), subjects: [STATE_MANDATORY, SUBJECT.biology, SUBJECT.chemistry] },
      { id: 'prep-medical-english', name: l('Ingliz tilidagi tibbiyot dasturlari (masalan, CAU, NewUU)', 'Медицинские программы на английском (например, CAU, NewUU)', 'English-taught medical programmes (e.g. CAU, NewUU)'), subjects: [SUBJECT.biology, SUBJECT.chemistry, l('Ingliz tili (IELTS 5.5–6.0)', 'Английский язык (IELTS 5.5–6.0)', 'English (IELTS 5.5–6.0)')] },
    ] }],
  },
  {
    id: 'prep-law', kind: 'track', name: 'Law preparation', shortName: 'LAW', country: 'Uzbekistan', published: true,
    localName: l('Huquqşunoslik', 'Юриспруденция', 'Law'),
    description: l('Huquq oliygohlari va yönalişlariga kiriş uçun umumiy tayyorgarlik. Fanlar universitet va yönalişga qarab farq qiladi: har bir yöl öz rasmiy manbasini körsatadi.',
      'Общая подготовка к поступлению на юридические специальности. Предметы зависят от университета и направления: у каждого пути указан свой официальный источник.',
      'General preparation for law universities and law programmes. The subjects differ by university and direction: each route names its own official source.'),
    faculties: [{ id: 'prep-law-routes', name: TRACK_ROUTES, directions: [
      { id: 'prep-law-tsul-jurisprudence', name: l('Yurisprudensiya — Toşkent davlat yuridik universiteti', 'Юриспруденция — Ташкентский государственный юридический университет', 'Jurisprudence — Tashkent State University of Law'), subjects: [STATE_MANDATORY, TSUL_LAW, FOREIGN_LANGUAGE] },
      { id: 'prep-law-tsul-administration', name: l('Davlat va jamiyat boşqaruvi — Toşkent davlat yuridik universiteti', 'Государственное и общественное управление — Ташкентский государственный юридический университет', 'State and Public Administration — Tashkent State University of Law'), subjects: [STATE_MANDATORY, SUBJECT.history, FOREIGN_LANGUAGE] },
      { id: 'prep-law-uwed', name: l('Yurisprudensiya — Jahon iqtisodiyoti va diplomatiya universiteti', 'Юриспруденция — Университет мировой экономики и дипломатии', 'Jurisprudence — University of World Economy and Diplomacy'), subjects: [STATE_MANDATORY, SUBJECT.legal, FOREIGN_LANGUAGE] },
    ] }],
  },
  {
    id: 'prep-it', kind: 'track', name: 'IT and engineering preparation', shortName: 'IT', country: 'Uzbekistan', published: true,
    localName: l('IT va muhandislik', 'IT и инженерия', 'IT & Engineering'),
    description: l('IT va muhandislik yönalişlariga kiriş uçun umumiy tayyorgarlik: matematika, fizika va qöşimça dasturlaş asoslari. Fanlar universitet va yönalişga qarab farq qiladi: har bir yöl öz rasmiy manbasini körsatadi.',
      'Общая подготовка к поступлению на ИТ и инженерные направления: математика, физика и, дополнительно, основы программирования. Предметы зависят от университета и направления: у каждого пути указан свой официальный источник.',
      'General preparation for IT and engineering directions: Mathematics, Physics and, as an extra, programming basics. The subjects differ by university and direction: each route names its own official source.'),
    faculties: [{ id: 'prep-it-routes', name: TRACK_ROUTES, directions: [
      { id: 'prep-it-state', name: l('IT yönalişlari (davlat testi)', 'Направления ИТ (государственный тест)', 'IT directions (state test)'), subjects: [STATE_MANDATORY, SUBJECT.math, SUBJECT.physics] },
      { id: 'prep-it-engineering', name: l('Muhandislik va telekommunikatsiya (davlat testi)', 'Инженерия и телекоммуникации (государственный тест)', 'Engineering and telecommunications (state test)'), subjects: [STATE_MANDATORY, SUBJECT.math, SUBJECT.physics] },
      { id: 'prep-it-international', name: l('Ingliz tilidagi IT dasturlari (masalan, INHA)', 'ИТ-программы на английском (например, INHA)', 'English-taught IT programmes (e.g. INHA)'), subjects: [SUBJECT.math, SUBJECT.physics, ENGLISH_BY_UNIVERSITY] },
    ] }],
  },
  {
    id: 'prep-economics', kind: 'track', name: 'Economics and business preparation', shortName: 'ECO', country: 'Uzbekistan', published: true,
    localName: l('Iqtisodiyot va biznes', 'Экономика и бизнес', 'Economics & Business'),
    description: l('Iqtisodiyot, moliya va biznes yönalişlariga kiriş uçun umumiy tayyorgarlik: matematika va çet tili. Fanlar universitet va yönalişga qarab farq qiladi: har bir yöl öz rasmiy manbasini körsatadi.',
      'Общая подготовка к поступлению на экономические, финансовые и бизнес-направления: математика и иностранный язык. Предметы зависят от университета и направления: у каждого пути указан свой официальный источник.',
      'General preparation for economics, finance and business directions: Mathematics and a foreign language. The subjects differ by university and direction: each route names its own official source.'),
    faculties: [{ id: 'prep-economics-routes', name: TRACK_ROUTES, directions: [
      { id: 'prep-economics-state', name: l('Iqtisodiyot yönalişlari (davlat testi)', 'Экономические направления (государственный тест)', 'Economics directions (state test)'), subjects: [STATE_MANDATORY, SUBJECT.math, FOREIGN_LANGUAGE] },
      { id: 'prep-economics-english', name: l('Ingliz tilidagi biznes dasturlari (masalan, WIUT)', 'Бизнес-программы на английском (например, WIUT)', 'English-taught business programmes (e.g. WIUT)'), subjects: [SUBJECT.math, ENGLISH_BY_UNIVERSITY] },
    ] }],
  },
]

export const UNIVERSITY_PACKAGES: UniversityPackageSeed[] = [
  // ── INHA Tashkent: own on-site exam (not DTM), run by Inha University in Korea; 2026-2027 guideline pages ──────────
  pack('uni-inha-socie', 'uni-inha', 'INHA', l('Kompyuter va axborot injiniringi (SOCIE: CSE, ICE)', 'Компьютерная и информационная инженерия (SOCIE: CSE, ICE)', 'Computer and Information Engineering (SOCIE: CSE, ICE)'),
    [MATH, PHYSICS, ieltsExtra('5.0', '50')],
    { url: 'https://inha.uz/prospective-students/admissions/application-guideline/', academicYear: '2026-2027', checkedOn: INHA_CHECKED, status: 'verified', note: 'Application Guideline 2026-2027 (Korean programme): entrance exam of 30 multiple-choice questions, 21 Mathematics and 9 Physics, 60 minutes (Math 70 / Physics 30 points). English is not an exam subject: IELTS 5.0 or TOEFL iBT 50 is required after passing. Students are assigned to CSE or ICE after the first year. The 2026 exam dates have passed; the next intake is not published yet.' },
    ['inha-socie-cse-ice']),
  pack('uni-inha-business', 'uni-inha', 'INHA', l('Biznes va logistika (Business Administration, Logistics Management)', 'Бизнес и логистика (Business Administration, Logistics Management)', 'Business and Logistics (Business Administration, Logistics Management)'),
    [MATH, ieltsExtra('5.5', '71')],
    { url: 'https://inha.uz/prospective-students/admissions/application-guideline/', academicYear: '2026-2027', checkedOn: INHA_CHECKED, status: 'verified', note: 'Application Guideline 2026-2027: School of Business and Logistics exam of 30 multiple-choice Mathematics questions, 60 minutes. Applicants choose Business Administration or Logistics Management at application (125 places each, not both). IELTS 5.5 or TOEFL iBT 71 is required after passing.' },
    ['inha-sbl-ba', 'inha-sbl-lm']),
  pack('uni-inha-uk-it', 'uni-inha', 'INHA', l('Axborot texnologiyalari (Buyuk Britaniya yönalişi)', 'Информационные технологии (британский трек)', 'Information Technology (UK track)'),
    [MATH, ieltsExtra('5.0', '50')],
    { url: 'https://inha.uz/admissions-2026-guideline-for-uk-and-italy-programs/', academicYear: '2026-2027', status: 'verified', note: 'Own exam: 30 multiple-choice Mathematics questions, 60 minutes. An official SAT (1300+ total, 680+ Math) with an interview can replace the exam. The page states no degree title or language of instruction.' },
    ['inha-uk-it']),
  pack('uni-inha-uk-bm', 'uni-inha', 'INHA', l('Biznes va menejment (Buyuk Britaniya yönalişi)', 'Бизнес и менеджмент (британский трек)', 'Business and Management (UK track)'),
    [MATH, ieltsExtra('5.5', '71')],
    { url: 'https://inha.uz/admissions-2026-guideline-for-uk-and-italy-programs/', academicYear: '2026-2027', status: 'verified', note: 'Same Mathematics exam as the UK-track IT programme with a higher English threshold. SAT option as above.' },
    ['inha-uk-bm']),
  pack('uni-inha-italy', 'uni-inha', 'INHA', l('Kompyuter injiniringi va ma’lumotlar fani (Italiya yönalişi)', 'Компьютерная инженерия и наука о данных (итальянский трек)', 'Computer Engineering and Data Science (Italy track)'),
    [MATH, ieltsExtra('5.0', '50')],
    { url: 'https://inha.uz/application-guideline-2026-italy/', academicYear: '2026-2027', status: 'verified', note: 'Own exam: 30 multiple-choice Mathematics questions, 60 minutes; SAT option as on the UK track.' },
    ['inha-italy-ceds']),

  // ── Narxoz University (Almaty): one package per profile-subject pair, all unverified drafts (see NARXOZ_SOURCE) ─────
  // Informatics, Geography, World History and Fundamentals of Law have no ILMORA course yet, so those pairs cannot be published.
  narxozPair('math-informatics', { label: narxozSubject.math, course: COURSE.math }, { label: narxozSubject.informatics, course: null }),
  narxozPair('math-geography', { label: narxozSubject.math, course: COURSE.math }, { label: narxozSubject.geography, course: null }),
  narxozPair('math-physics', { label: narxozSubject.math, course: COURSE.math }, { label: narxozSubject.physics, course: COURSE.physics }),
  narxozPair('english-geography', { label: narxozSubject.english, course: COURSE.english }, { label: narxozSubject.geography, course: null }),
  narxozPair('english-history', { label: narxozSubject.english, course: COURSE.english }, { label: narxozSubject.worldHistory, course: null }),
  narxozPair('law-history', { label: narxozSubject.law, course: null }, { label: narxozSubject.worldHistory, course: null }),

  // ── WIUT: document-based entry (maths proof + English); per-programme 2026-2027 pages ──────────────────────────────
  // Requirements re-read on every programme page on 2026-11-03 ("2026-2027 Academic Year" above each Entry Requirements block).
  // English proof is required, but a student who already holds IELTS needs no preparation for it, so IELTS is an optional extra
  // wherever the package has another subject; the law package has only the English requirement.
  pack('uni-wiut-cs', 'uni-wiut', 'WIUT', l('Kompyuter fanlari', 'Компьютерные науки', 'Computer Science'),
    [{ label: WIUT_MATH, course: COURSE.math }, { label: SUBJECT.ielts('6.5'), course: COURSE.ielts, optional: true }],
    { url: 'https://wiut.uz/bsc-hons-in-computer-science', academicYear: '2026-2027', checkedOn: '2026-11-03', status: 'verified', note: 'BSc (Hons) in Computer Science, 2026-2027: Mathematics competence (a pass in a maths test approved by the University of Westminster, GCSE/O-level Mathematics grade C, SAT Mathematics 570, or a Foundation Quantitative Methods pass) and English (IELTS 6.5 with Writing 6.0, or TOEFL iBT 85 with Writing 22). No other entrance subject.' },
    ['wiut-cs']),
  pack('uni-wiut-business', 'uni-wiut', 'WIUT', l('Biznes, moliya va iqtisodiyot', 'Бизнес, финансы и экономика', 'Business, Finance and Economics'),
    [{ label: WIUT_MATH, course: COURSE.math }, { label: SUBJECT.ielts('6.5'), course: COURSE.ielts, optional: true }],
    { url: 'https://wiut.uz/finance', academicYear: '2026-2027', checkedOn: '2026-11-03', status: 'verified', note: 'Finance, Economics and Business Management pages, 2026-2027: the same Mathematics competence options and English (IELTS 6.5 with Writing 6.0, or TOEFL iBT 85 with Writing 22).' },
    ['wiut-finance', 'wiut-economics', 'wiut-business-management']),
  pack('uni-wiut-law', 'uni-wiut', 'WIUT', l('Huquq va xalqaro munosabatlar', 'Право и международные отношения', 'Law and International Relations'),
    [{ label: SUBJECT.ielts('6.5'), course: COURSE.ielts }],
    { url: 'https://wiut.uz/commercial-law', academicYear: '2026-2027', checkedOn: '2026-11-03', status: 'verified', note: 'Commercial Law and International Relations and Law pages, 2026-2027: English only (IELTS 6.5 with Writing 6.0, or TOEFL iBT 88 with Writing 21); no Mathematics requirement.' },
    ['wiut-commercial-law', 'wiut-ir-law']),
  pack('uni-wiut-foundation', 'uni-wiut', 'WIUT', l('Xalqaro Foundation sertifikati', 'Международный Foundation-сертификат', 'International Foundation Studies'),
    [{ label: l('Matematika (WIUT kiriş matematika imtihoni)', 'Математика (вступительный экзамен WIUT по математике)', 'Mathematics (WIUT Mathematics Entrance Exam)'), course: COURSE.math }, { label: SUBJECT.ielts('6.0'), course: COURSE.ielts, optional: true }],
    { url: 'https://wiut.uz/certificate-international-foundation-studies', academicYear: '2026-2027', checkedOn: '2026-11-03', status: 'verified', note: 'Certificate in International Foundation Studies, 2026-2027: WIUT Mathematics Entrance Exam (or GCSE/O-level grade C, SAT Mathematics 570, Pre-Foundation or Academic Lyceum routes) and English (IELTS 6.0 with Writing 5.0, or TOEFL iBT 78 with Writing 17).' },
    ['wiut-foundation']),
  // Business Information Systems: the programme page states no entry requirements, so it has no package.

  // ── Turin Polytechnic (TTPU): own computer-based exam; 2026/2027 regulation lists subjects for some programmes only ──
  pack('uni-ttpu-engineering', 'uni-ttpu', 'Turin', l('Muhandislik (mexanika, quriliş, kompyuter) — 2-kursga kiriş', 'Инженерия (механика, строительство, компьютерная) — поступление на 2 курс', 'Engineering (Mechanical, Civil, Computer) — Year 2 entry'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: SUBJECT.physics, course: COURSE.physics }, { label: SUBJECT.english, course: COURSE.english }, { label: SUBJECT.logic, course: null }],
    { url: 'https://qabul.turin.uz/regulations/bachelor', academicYear: '2026/2027', status: 'verified', note: 'Regulation section 2.5: 42-question exam in English (Mathematics 18, Physics 12, English 6, Logic 6) for the Year-2 route of the three partnership programmes.' }),
  pack('uni-ttpu-economics', 'uni-ttpu', 'Turin', l('Iqtisodiyot', 'Экономика', 'Economics'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: SUBJECT.logic, course: null }],
    { url: 'https://qabul.turin.uz/regulations/bachelor', academicYear: '2026/2027', status: 'verified', note: 'Regulation sections 2.4 and 4.1: Mathematics 30 plus Logic 10; an IELTS certificate does not exempt Economics applicants.' }),
  pack('uni-ttpu-aviation', 'uni-ttpu', 'Turin', l('Aviatsiya muhandisligi', 'Авиационная инженерия', 'Aviation Engineering'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: SUBJECT.logic, course: null }],
    { url: 'https://qabul.turin.uz/regulations/bachelor', academicYear: '2026/2027', status: 'verified', note: 'Regulation sections 2.4 and 4.1: Mathematics 30 plus Logic 10, exam in English only.' }),
  pack('uni-ttpu-standard', 'uni-ttpu', 'Turin', l('Boşqa bakalavr yönalişlari (standart imtihon)', 'Остальные бакалаврские направления (стандартный экзамен)', 'Other bachelor programmes (standard exam)'),
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
  pack('uni-mdis-foundation', 'uni-mdis', 'MDIS', l('Foundation yili (biznes bakalavr dasturlariga yöl)', 'Foundation-год (путь к бакалаврским программам по бизнесу)', 'Foundation Year (route to business bachelor programmes)'),
    [{ label: l('Ingliz tili (IELTS yoki MDIS English Test 5.5+)', 'Английский язык (IELTS или MDIS English Test 5.5+)', 'English (IELTS or MDIS English Test 5.5+)'), course: COURSE.ielts }],
    { url: 'https://mdis.uz/en/menu/foundation-year', academicYear: '2025', checkedOn: '2026-11-03', status: 'needs_review', note: 'To be verified: the Foundation Year page (read 2026-11-03) still gives the 2025 registration window (1 March to 15 August 2025). No subject exam: IELTS or MDIS English Test 5.5 (TOEFL iBT 46-59), with 6.0 and above placed first; bachelor degrees are entered through the Foundation Year or transfer. No 2026 intake is stated.' },
    // Bachelor degrees are entered through the Foundation Year (or transfer), so this package serves every MDIS direction.
    ['mdis-foundation', ...[1, 2, 3, 4, 5, 6].map((i) => `mdis-sunderland-${i}`), ...[1, 2, 3, 4].map((i) => `mdis-teesside-${i}`)]),

  // ── UWED: state exam (DTM) with three mandatory subjects plus two direction subjects; 2026/2027 bachelor page ─────────
  // Mother tongue, History of Uzbekistan, History and Legal sciences have no ILMORA course, so these stay drafts.
  pack('uni-uwed-politics', 'uni-uwed', 'UWED', l('Siyosatşunoslik va xalqaro munosabatlar', 'Политология и международные отношения', 'Political Science and International Relations'),
    [{ label: SUBJECT.motherTongue, course: null }, { label: SUBJECT.math, course: COURSE.math }, { label: SUBJECT.historyUz, course: null }, { label: SUBJECT.history, course: null }, { label: SUBJECT.foreign, course: COURSE.english }],
    { url: 'https://uwed.uz/admission/bachelor', academicYear: '2026/2027', status: 'verified', note: 'State exam, 90 tests: three mandatory subjects (10 tests each) plus History (30) and a foreign language (30). The page does not name which foreign language; ILMORA maps it to English as its own choice.' }),
  pack('uni-uwed-economy', 'uni-uwed', 'UWED', l('Jahon iqtisodiyoti va xalqaro iqtisodiy munosabatlar', 'Мировая экономика и международные экономические отношения', 'World Economy and International Economic Relations'),
    [{ label: SUBJECT.motherTongue, course: null }, { label: l('Matematika (majburiy fan va yönaliş fani)', 'Математика (обязательный и профильный предмет)', 'Mathematics (mandatory and direction subject)'), course: COURSE.math }, { label: SUBJECT.historyUz, course: null }, { label: SUBJECT.foreign, course: COURSE.english }],
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
    [{ label: SUBJECT.math, course: COURSE.math }, { label: l('Ingliz tili (IELTS 5.5 bölsa, ingliz tili testidan ozod)', 'Английский язык (при IELTS 5.5 тест по английскому не требуется)', 'English (IELTS 5.5 exempts from the English test)'), course: COURSE.english }],
    { url: 'https://kiut.uz/en/admissions/tashkent-admission/', academicYear: '', checkedOn: '2026-11-03', status: 'needs_review', note: 'To be verified: the 2026/2027 admission table lists these programmes with "Test in the relevant subject" but names no subjects; Mathematics and English (IELTS 5.5 exempts from English) come from the programme pages (Finance re-read 2026-11-03), which state no year.' },
    ['Business Management', 'International Economic Relations', 'International Marketing', 'Accounting', 'Banking', 'Finance'].map(kiutId)),
  pack('uni-kiut-engineering', 'uni-kiut', 'KIUT', l('Muhandislik va axborot tizimlari', 'Инженерия и информационные системы', 'Engineering and Information Systems'),
    [{ label: SUBJECT.math, course: COURSE.math }, { label: SUBJECT.physics, course: COURSE.physics }],
    { url: 'https://kiut.uz/en/admissions/tashkent-admission/', academicYear: '', checkedOn: '2026-11-03', status: 'needs_review', note: 'To be verified: the 2026/2027 admission table names no subjects; Mathematics and Physics come from the Information System, Mechatronics, Mechanical, Electrical, Renewable Energy, Lift, Traffic and Civil Engineering programme pages, which state no year.' },
    ['Civil Engineering', 'Renewable Energy', 'Lift Engineering', 'Information Systems Engineering', 'Electrical Engineering', 'Mechatronics', 'Mechanical Engineering', 'Traffic Management'].map(kiutId)),
  pack('uni-kiut-medicine', 'uni-kiut', 'KIUT', l('Davolaş işi va stomatologiya', 'Лечебное дело и стоматология', 'General Medicine and Dentistry'),
    [{ label: SUBJECT.biology, course: null }, { label: SUBJECT.chemistry, course: COURSE.chemistry }, { label: MOTHER_TONGUE_LIT, course: null }],
    { url: 'https://kiut.uz/en/programs/bachelors-programs/faculty-directions/General-Medicine/', academicYear: '', checkedOn: '2026-11-03', status: 'needs_review', note: 'To be verified: the General Medicine page (re-read 2026-11-03) and the Dentistry page list Biology, Chemistry and Mother Tongue and Literature; neither states a year, and the 2026/2027 admission table names no subjects.' },
    ['General Medicine', 'Dentistry'].map(kiutId)),
  pack('uni-kiut-pediatrics', 'uni-kiut', 'KIUT', l('Pediatriya', 'Педиатрия', 'Pediatrics'),
    [CHEMISTRY, BIOLOGY],
    { url: 'https://kiut.uz/en/admissions/tashkent-admission/', academicYear: '', checkedOn: '2026-11-03', status: 'needs_review', note: 'To be verified: the Pediatrics programme page lists Chemistry and Biology and states no year; the 2026/2027 admission table names no subjects.' },
    [kiutId('Pediatrics')]),

  // ── Central Asian University (formerly AKFA): own online/offline exams, English-taught; regulations page states 2027-2028 ──
  pack('uni-cau-business-engineering', 'uni-cau', 'CAU', l('Kompyuter fanlari, muhandislik, biznes va iqtisodiyot', 'Компьютерные науки, инженерия, бизнес и экономика', 'Computer Science, Engineering, Business and Economics'),
    [{ label: l('Matematika (CAU kiriş imtihoni, ötiş bali 50%)', 'Математика (вступительный экзамен CAU, проходной балл 50%)', 'Mathematics (CAU entrance exam, pass mark 50%)'), course: COURSE.math }, { label: l('Ingliz tili (IELTS 5.5 yoki unga teng bölsa, imtihondan ozod)', 'Английский язык (при IELTS 5.5 или эквиваленте экзамен не нужен)', 'English (IELTS 5.5 or equivalent exempts from the exam)'), course: COURSE.ielts }],
    { url: 'https://centralasian.uz/admissionregulations', academicYear: '2027-2028', status: 'verified', note: 'Admission regulations: own exams (Mathematics 20 questions / 45 min, English 60 questions / 30 min, pass mark 50%) plus an interview; the Business and Engineering faculties accept IELTS 5.5 for the English exemption. The Computer Science page repeats Mathematics (min 50%) and IELTS 5.5; program pages also show 2026-2027 tuition.' },
    ['B.S. in Computer Science', 'B.S. in Biomedical Engineering', 'B.S. in Industrial Engineering', 'B.S. in Architecture & Design', 'B.Sc. in Accounting & Finance', 'B.A. in Management', 'B.Sc. in Economics', 'B.A. in International Business (Dual Degree)', 'B.A. in Marketing'].map(cauId)),
  pack('uni-cau-medicine', 'uni-cau', 'CAU', l('Tibbiyot va stomatologiya (M.D., D.D.S.)', 'Медицина и стоматология (M.D., D.D.S.)', 'Medicine and Dentistry (M.D., D.D.S.)'),
    [BIOLOGY, CHEMISTRY, { label: SUBJECT.ielts('6.0'), course: COURSE.ielts }],
    { url: 'https://centralasian.uz/admissionregulations', academicYear: '2027-2028', status: 'verified', note: 'Admission regulations: own Biology and Chemistry exams (20 questions / 45 min each, pass mark 50%) and English (IELTS 6.0 or TOEFL iBT 60 exempts). The Medicine and Dentistry pages cite both 2026-2027 and 2027-2028 intakes with the same subjects.' },
    ['cau-medicine', 'cau-dentistry']),
  pack('uni-cau-hospitality', 'uni-cau', 'CAU', l('Xalqaro mehmondorçilik menejmenti va turizm', 'Международный гостиничный менеджмент и туризм', 'International Hospitality Management and Tourism'),
    [{ label: CAU_ENGLISH_ONLY, course: COURSE.ielts }],
    { url: 'https://centralasian.uz/hospitality-management-tourism', academicYear: '2026-2027', checkedOn: '2026-11-03', status: 'needs_review', note: 'To be verified: the programme page (dual degree with HTMi Switzerland, 2026-2027 tuition) states "Entrance exam: English only (or IELTS 5.5); Mathematics is not required", while the admission regulations list a Mathematics exemption for Hospitality applicants, which implies a Mathematics exam.' },
    [cauId('B.A. in International Hospitality Management & Tourism')]),

  // ── Millat Umidi University: own Maths & Logic exam for every applicant, plus IELTS or the MU English test for English-taught
  // programmes, plus an interview (Admissions 2026/2027, read 2026-11-03) ─────────────────────────────────────────────────────
  pack('uni-mu-business', 'uni-millat-umidi', 'MU', l('Biznes va moliya (ingliz tilida)', 'Бизнес и финансы (на английском)', 'Business and Finance (English-taught)'),
    [{ label: MU_MATH_LOGIC, course: COURSE.math }, { label: MU_ENGLISH, course: COURSE.ielts, optional: true }],
    { url: 'https://millatumidi.uz/admissions/entry-requirements', academicYear: '2026-2027', checkedOn: '2026-11-03', status: 'needs_review', note: 'To be verified: Admissions 2026/2027 requires a Maths & Logic exam of every applicant and IELTS (or the MU English test) for English-taught programmes, plus an interview. The Applied Accounting and Finance page names its exam only as "core subjects", and the IELTS minimum differs between pages (5.0 on the programme cards and FAQ, 5.5 in the language table).' },
    ['mu-accounting-finance', 'mu-business-management']),
  pack('uni-mu-business-national', 'uni-millat-umidi', 'MU', l('Biznes, buxgalteriya va turizm (özbek / rus tilida)', 'Бизнес, бухгалтерия и туризм (на узбекском / русском)', 'Business, Accounting and Tourism (Uzbek / Russian-taught)'),
    [{ label: MU_MATH_LOGIC, course: COURSE.math }],
    { url: 'https://millatumidi.uz/admissions', academicYear: '2026-2027', checkedOn: '2026-11-03', status: 'needs_review', note: 'To be verified: the Applied Accounting (Uzbek), Business Administration and Tourism and Hospitality pages name an entrance examination and an interview but not its subjects; the admissions page states the Maths & Logic exam for all applicants (2026/2027).' },
    ['mu-accounting-uz', 'mu-business-administration', 'mu-tourism']),
  pack('uni-mu-software', 'uni-millat-umidi', 'MU', l('Dasturiy injiniring', 'Программная инженерия', 'Software Engineering'),
    [{ label: MU_MATH_LOGIC, course: COURSE.math }, { label: MU_ENGLISH, course: COURSE.ielts, optional: true }],
    { url: 'https://millatumidi.uz/software-engineering-program', academicYear: '2026-2027', checkedOn: '2026-11-03', status: 'needs_review', note: 'To be verified: the Software Engineering page names an entrance exam in mathematics and logic, IELTS 5.0+ or the internal English test and a technical interview; the Uzbek-taught track needs no English proof. The admissions language table gives IELTS 5.5+ instead.' },
    ['mu-software-engineering', 'mu-software-engineering-uz']),
  pack('uni-mu-elt', 'uni-millat-umidi', 'MU', l('Ingliz tili öqitiş metodikasi (English Language Teaching)', 'Методика преподавания английского языка (English Language Teaching)', 'English Language Teaching'),
    [{ label: MU_ENGLISH_ELT, course: COURSE.ielts }],
    { url: 'https://millatumidi.uz/english-language-teaching-program', academicYear: '2026-2027', checkedOn: '2026-11-03', status: 'verified', note: 'English Language Teaching page and the admissions language table (Admissions 2026/2027) agree: entrance examination in English, IELTS 5.5+ (or the internal English test) and a teaching-aptitude interview.' },
    ['mu-english-language-teaching']),

  // ── State-test universities (NUUz, TUIT, TSUE, TSUL, TSMU): three mandatory subjects + two direction subjects ──────────
  // The per-direction subjects come from the state testing agency directory (my.uzbmb.uz), which shows scores for 2023-2025 and
  // no admission year, so those are needs_review. TSUL states them for 2026/2027 on its own page. Mother tongue and History of
  // Uzbekistan have no ILMORA course, so none of these can be published until such courses exist.
  pack('uni-nuuz-it', 'uni-nuuz', 'NUUz', l('Sun’iy intellekt, kiberxavfsizlik, axborot tizimlari', 'Искусственный интеллект, кибербезопасность, информационные системы', 'Artificial Intelligence, Cybersecurity, Information Systems'),
    stateTest([MATH, PHYSICS]),
    { url: 'https://my.uzbmb.uz/university-about-direction/314', academicYear: '', status: 'needs_review', note: 'State testing agency directory lists Mathematics and Physics as the direction subjects; the page shows 2023-2025 scores and no admission year. The 2026/27 test structure (90 questions, 189 points) is confirmed on qabul.nuu.uz.' }),
  pack('uni-nuuz-economics', 'uni-nuuz', 'NUUz', l('Iqtisodiyot, menejment, moliya, bank işi', 'Экономика, менеджмент, финансы, банковское дело', 'Economics, Management, Finance, Banking'),
    stateTest([MATH, FOREIGN]),
    { url: 'https://my.uzbmb.uz/university-about-direction/314', academicYear: '', status: 'needs_review', note: 'Directory lists Mathematics and a foreign language; no admission year. A B1 certificate earns 75% and B2 or higher 100% of the foreign-language score (Cabinet Res. 578).' }),
  pack('uni-nuuz-chemistry', 'uni-nuuz', 'NUUz', l('Kimyo', 'Химия', 'Chemistry'),
    stateTest([CHEMISTRY, MATH]),
    { url: 'https://my.uzbmb.uz/university-about-direction/314', academicYear: '', status: 'needs_review', note: 'Directory lists Chemistry and Mathematics; no admission year.' }),
  pack('uni-tuit-it', 'uni-tuit', 'TUIT', l('Axborot texnologiyalari, telekommunikatsiya va muhandislik yönalişlari', 'Направления ИТ, телекоммуникаций и инженерии', 'IT, telecommunications and engineering directions'),
    stateTest([MATH, PHYSICS]),
    { url: 'https://my.uzbmb.uz/university-simple?InfoSimpleDirectionSearch%5Bedu_id%5D=380', academicYear: '2026/2027', checkedOn: '2026-11-03', status: 'needs_review', note: 'To be confirmed: TUIT announces 2026/2027 admission (admission.tuit.uz) and the Ministry confirms the 2026/2027 state test (three mandatory subjects, 10 questions each, then 30 questions in each of two specialised subjects). The specialised pair Mathematics + Physics (Physics + Mathematics for Electrical Engineering and Mechatronics) comes from the State Testing Agency directory for TUIT, which states no year; TUIT’s faculty pages still use the older direction codes.' },
    ['Computer Engineering', 'Artificial Intelligence', 'Mechatronics and Robotics', 'Postal Communication Technology', 'Software Engineering', 'Applied Mathematics', 'Information Security', 'Cybersecurity Engineering', 'Telecommunication Technologies', 'Infocommunication Engineering', 'Television Technologies', 'Information Systems and Technologies', 'Radio-electronic Devices and Systems', 'Wireless Communication and Broadcasting Engineering', 'Electrical Engineering'].map(tuitId)),
  pack('uni-tuit-business', 'uni-tuit', 'TUIT', l('Iqtisodiyot, menejment va logistika', 'Экономика, менеджмент и логистика', 'Economics, Management and Logistics'),
    stateTest([MATH, FOREIGN]),
    { url: 'https://my.uzbmb.uz/university-simple?InfoSimpleDirectionSearch%5Bedu_id%5D=380', academicYear: '2026/2027', checkedOn: '2026-11-03', status: 'needs_review', note: 'To be confirmed: Mathematics and a foreign language as the specialised pair for Economics, Management and Logistics come from the State Testing Agency directory for TUIT, which states no year. Business Management and Marketing are on TUIT’s 2026/2027 fee list but have no entry in the directory, so they have no package.' },
    ['Economics', 'Management', 'Logistics'].map(tuitId)),
  pack('uni-tsue-economics', 'uni-tsue', 'TSUE', l('Iqtisodiyot, moliya, biznes, xalqaro iqtisodiyot va logistika', 'Экономика, финансы, бизнес, мировая экономика и логистика', 'Economics, Finance, Business, World Economy and Logistics'),
    stateTest([MATH, FOREIGN]),
    { url: 'https://tsue.uz/media/uploads/2026/06/17/nptqbl.pdf', academicYear: '2026/2027', checkedOn: '2026-11-03', status: 'verified', note: 'National 2026/2027 subject list (approved 30.01.2026 by the Ministry with the State Testing Agency), posted by TSUE: Mathematics as the first and a foreign language as the second specialised subject for Economics, Finance and Financial Technologies, Banking, Accounting, Taxes and Taxation, Statistics, Management, Business Management, Human Resource Management, World Economy and International Economic Relations, Marketing, Trade Business and Logistics; my.uzbmb.uz (TSUE, edu_id 324) gives the same pairs.' },
    ['Economics', 'Finance and Financial Technologies', 'Banking', 'Accounting', 'Taxes and Taxation', 'Statistics', 'Management', 'Business Management', 'Human Resource Management', 'World Economy and International Economic Relations', 'Trade Business', 'Logistics', 'Marketing'].map(tsueId)),
  pack('uni-tsue-it', 'uni-tsue', 'TSUE', l('Axborot tizimlari, axborot xavfsizligi va sun’iy intellekt', 'Информационные системы, информационная безопасность и искусственный интеллект', 'Information Systems, Information Security and Artificial Intelligence'),
    stateTest([MATH, PHYSICS]),
    { url: 'https://tsue.uz/media/uploads/2026/06/17/nptqbl.pdf', academicYear: '2026/2027', checkedOn: '2026-11-03', status: 'verified', note: 'National 2026/2027 subject list posted by TSUE: Mathematics and Physics as the specialised subjects for Information Systems and Technologies, Information Security and Artificial Intelligence.' },
    ['Information Systems and Technologies', 'Information Security', 'Artificial Intelligence'].map(tsueId)),
  pack('uni-tsue-tourism', 'uni-tsue', 'TSUE', l('Turizm va mehmondöstlik', 'Туризм и гостеприимство', 'Tourism and Hospitality'),
    stateTest([{ label: SUBJECT.history, course: null }, FOREIGN]),
    { url: 'https://tsue.uz/media/uploads/2026/06/17/nptqbl.pdf', academicYear: '2026/2027', checkedOn: '2026-11-03', status: 'verified', note: 'National 2026/2027 subject list posted by TSUE: History as the first and a foreign language as the second specialised subject for Tourism and Hospitality. ILMORA has no History course yet.' },
    [tsueId('Tourism and Hospitality')]),
  pack('uni-tsul-law', 'uni-tsul', 'TSUL', l('Yurisprudensiya', 'Юриспруденция', 'Jurisprudence'),
    stateTest([{ label: l('Huquqşunoslik (davlat va huquq asoslari)', 'Правоведение (основы государства и права)', 'Law (fundamentals of state and law)'), course: null }, FOREIGN]),
    { url: 'https://tsul.uz/uz/general-page/bakalavriat', academicYear: '2026/2027', status: 'verified', note: 'TSUL’s own 2026/2027 page names Law as the first and a foreign language as the second direction subject (state test, 90 questions). Raqamli huquq and Xalqaro huquq are admitted by an IQ test and a B2 certificate instead.' }),
  pack('uni-tsul-governance', 'uni-tsul', 'TSUL', l('Davlat va jamiyat boşqaruvi', 'Государственное и общественное управление', 'State and Public Administration'),
    stateTest([{ label: SUBJECT.history, course: null }, FOREIGN]),
    { url: 'https://tsul.uz/uz/general-page/bakalavriat', academicYear: '2026/2027', status: 'verified', note: 'TSUL’s own 2026/2027 page names History and a foreign language as the direction subjects (state test, 90 questions).' }),
  pack('uni-tsmu-medicine', 'uni-tsmu', 'TSMU', l('Davolaş işi, pediatriya, stomatologiya', 'Лечебное дело, педиатрия, стоматология', 'General Medicine, Pediatrics, Dentistry'),
    stateTest([BIOLOGY, CHEMISTRY]),
    { url: 'https://my.uzbmb.uz/university-about-direction/444', academicYear: '', status: 'needs_review', note: 'Directory lists Biology and Chemistry; no admission year. Tashkent Medical Academy was merged into Tashkent State Medical University in 2025, and the university’s own pages name no subjects.' }),

  // ── Preparation tracks (general preparation; each package names the official source of its subject combination) ───────
  trackPack('prep-general-state', 'prep-general', 'ADM', l('Davlat testi: majburiy fanlar', 'Государственный тест: обязательные предметы', 'State test: mandatory subjects'),
    stateTest([]),
    { url: 'https://my.uzbmb.uz', academicYear: '', checkedOn: '2026-11-03', status: 'needs_review', note: 'To be confirmed: general preparation for the three mandatory subjects of the national state test (native language, mathematics, history of Uzbekistan), the curriculum of ILMORA’s DTM course. Universities add two specialised subjects per direction, which this package does not cover; check them for your direction.' },
    ['prep-general-state']),
  trackPack('prep-general-international', 'prep-general', 'ADM', l('Xalqaro va xususiy universitetlar: matematika va ingliz tili', 'Международные и частные университеты: математика и английский', 'International and private universities: Mathematics and English'),
    [MATH, { label: ENGLISH_BY_UNIVERSITY, course: COURSE.ielts, optional: true }],
    { url: 'https://millatumidi.uz/admissions/entry-requirements', academicYear: '2026-2027', checkedOn: '2026-11-03', status: 'needs_review', note: 'To be confirmed: general preparation, not a programme of one university. Requirements differ: Millat Umidi asks a Maths & Logic exam and IELTS 5.0+ or its English test for English-taught programmes, WIUT Foundation its Mathematics Entrance Exam and IELTS 6.0, INHA its own exam and an English certificate.' },
    ['prep-general-international']),
  trackPack('prep-medical-state', 'prep-medical', 'MED', l('Davlat tibbiyot oliygohlari: biologiya va kimyo', 'Государственные медицинские вузы: биология и химия', 'State medical universities: Biology and Chemistry'),
    stateTest([BIOLOGY, CHEMISTRY]),
    { url: 'https://my.uzbmb.uz/university-about-direction/444', academicYear: '', checkedOn: '2026-11-03', status: 'needs_review', note: 'General preparation, not a programme of TSUE or any other university. The State Testing Agency directory lists Biology and Chemistry as the specialised subjects of General Medicine, Pediatrics and Dentistry at Tashkent State Medical University and states no year; check the subjects of your target university. ILMORA has no Biology course yet.' },
    ['prep-medical-state']),
  trackPack('prep-medical-english', 'prep-medical', 'MED', l('Ingliz tilidagi tibbiyot dasturlari: biologiya, kimyo va IELTS', 'Медицинские программы на английском: биология, химия и IELTS', 'English-taught medical programmes: Biology, Chemistry and IELTS'),
    [BIOLOGY, CHEMISTRY, { label: SUBJECT.ielts('5.5–6.0'), course: COURSE.ielts }],
    { url: 'https://centralasian.uz/admissionregulations', academicYear: '2027-2028', checkedOn: '2026-11-03', status: 'needs_review', note: 'General preparation, not a programme of one university. Central Asian University asks for Biology and Chemistry exams and IELTS 6.0 for Medicine and Dentistry (admission regulations), and New Uzbekistan University for a Biology and Chemistry test and IELTS 5.5 (newuu.uz M.D. page). Requirements differ by university, so confirm them for yours. ILMORA has no Biology course yet.' },
    ['prep-medical-english']),
  trackPack('prep-law-tsul-jurisprudence', 'prep-law', 'LAW', l('Yurisprudensiya (TDYU): huquqşunoslik va çet tili', 'Юриспруденция (ТГЮУ): правоведение и иностранный язык', 'Jurisprudence (TSUL): Law and a foreign language'),
    stateTest([{ label: TSUL_LAW, course: null }, FOREIGN]),
    { url: 'https://tsul.uz/uz/general-page/bakalavriat', academicYear: '2026/2027', checkedOn: '2026-11-03', status: 'verified', note: 'Tashkent State University of Law, own 2026/2027 bachelor page: Law (fundamentals of state and law) as the first and a foreign language as the second specialised subject of the state test. ILMORA has no Law course yet; the foreign language is prepared with English.' },
    ['prep-law-tsul-jurisprudence']),
  trackPack('prep-law-tsul-administration', 'prep-law', 'LAW', l('Davlat va jamiyat boşqaruvi (TDYU): tarix va çet tili', 'Государственное и общественное управление (ТГЮУ): история и иностранный язык', 'State and Public Administration (TSUL): History and a foreign language'),
    stateTest([{ label: SUBJECT.history, course: null }, FOREIGN]),
    { url: 'https://tsul.uz/uz/general-page/bakalavriat', academicYear: '2026/2027', checkedOn: '2026-11-03', status: 'verified', note: 'Tashkent State University of Law, own 2026/2027 bachelor page: History and a foreign language as the specialised subjects of the state test. ILMORA has no History course yet.' },
    ['prep-law-tsul-administration']),
  trackPack('prep-law-uwed', 'prep-law', 'LAW', l('Yurisprudensiya (JIDU): huquqşunoslik fanlari va çet tili', 'Юриспруденция (УМЭД): правовые дисциплины и иностранный язык', 'Jurisprudence (UWED): Legal sciences and a foreign language'),
    stateTest([{ label: SUBJECT.legal, course: null }, FOREIGN]),
    { url: 'https://uwed.uz/admission/bachelor', academicYear: '2026/2027', checkedOn: '2026-11-03', status: 'verified', note: 'University of World Economy and Diplomacy, own 2026/2027 bachelor page: state exam of 90 tests with Legal sciences (30) and a foreign language (30) after the three mandatory subjects. The page does not name which foreign language; ILMORA maps it to English as its own choice.' },
    ['prep-law-uwed']),
  trackPack('prep-it-state', 'prep-it', 'IT', l('IT yönalişlari (davlat testi): matematika va fizika', 'Направления ИТ (государственный тест): математика и физика', 'IT directions (state test): Mathematics and Physics'),
    [...stateTest([MATH, PHYSICS]), PROGRAMMING_EXTRA],
    { url: NATIONAL_SUBJECT_LIST, academicYear: '2026/2027', checkedOn: '2026-11-03', status: 'verified', note: 'National 2026/2027 subject list posted by TSUE: Mathematics and Physics as the specialised subjects for Information Systems and Technologies, Information Security and Artificial Intelligence. General preparation, not a programme of one university. Programming is an ILMORA extra, not an entrance subject.' },
    ['prep-it-state']),
  trackPack('prep-it-engineering', 'prep-it', 'IT', l('Muhandislik va telekommunikatsiya (davlat testi): matematika va fizika', 'Инженерия и телекоммуникации (государственный тест): математика и физика', 'Engineering and telecommunications (state test): Mathematics and Physics'),
    stateTest([MATH, PHYSICS]),
    { url: 'https://my.uzbmb.uz/university-simple?InfoSimpleDirectionSearch%5Bedu_id%5D=380', academicYear: '2026/2027', checkedOn: '2026-11-03', status: 'needs_review', note: 'To be confirmed: general preparation, not a programme of one university. Mathematics and Physics as the specialised pair of engineering and telecommunications directions come from the State Testing Agency directory for TUIT, which states no year; check your direction.' },
    ['prep-it-engineering']),
  trackPack('prep-it-international', 'prep-it', 'IT', l('Ingliz tilidagi IT dasturlari: matematika, fizika va IELTS', 'ИТ-программы на английском: математика, физика и IELTS', 'English-taught IT programmes: Mathematics, Physics and IELTS'),
    [MATH, PHYSICS, ieltsExtra('5.0', '50')],
    { url: 'https://inha.uz/prospective-students/admissions/application-guideline/', academicYear: '2026-2027', checkedOn: INHA_CHECKED, status: 'needs_review', note: 'To be confirmed: general preparation, not a programme of one university. INHA’s 2026-2027 guideline asks Mathematics and Physics in its own exam and an English certificate; other English-taught programmes differ, so check yours.' },
    ['prep-it-international']),
  trackPack('prep-economics-state', 'prep-economics', 'ECO', l('Iqtisodiyot yönalişlari (davlat testi): matematika va çet tili', 'Экономические направления (государственный тест): математика и иностранный язык', 'Economics directions (state test): Mathematics and a foreign language'),
    stateTest([MATH, FOREIGN]),
    { url: NATIONAL_SUBJECT_LIST, academicYear: '2026/2027', checkedOn: '2026-11-03', status: 'verified', note: 'National 2026/2027 subject list posted by TSUE: Mathematics as the first and a foreign language as the second specialised subject for Economics, Finance, Banking, Accounting, Management, Marketing and related directions. General preparation, not a programme of one university. The list does not name the language; ILMORA maps it to English as its own choice. ILMORA has no separate economics course.' },
    ['prep-economics-state']),
  trackPack('prep-economics-english', 'prep-economics', 'ECO', l('Ingliz tilidagi biznes dasturlari: matematika va IELTS', 'Бизнес-программы на английском: математика и IELTS', 'English-taught business programmes: Mathematics and IELTS'),
    [MATH, { label: ENGLISH_BY_UNIVERSITY, course: COURSE.ielts, optional: true }],
    { url: 'https://wiut.uz/finance', academicYear: '2026-2027', checkedOn: '2026-11-03', status: 'needs_review', note: 'To be confirmed: general preparation, not a programme of one university. WIUT’s Finance, Economics and Business Management pages ask Mathematics competence and IELTS 6.5; other business programmes differ, so check yours.' },
    ['prep-economics-english']),
]
