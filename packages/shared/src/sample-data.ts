// Sample dataset for ILMORA (fictional centers, teachers, courses, students). Used by the web demo mode
// and by the API seed so both start from the same catalog. Ids are stable and double as slugs.
import type { Category, Center, Course, L, Playlist, Resource, SiteConfig, Student, Subject, Teacher, Video } from './types.js'

const l = (uz: string, ru: string, en: string): L => ({ uz, ru, en })
const NOW = '2026-09-20T09:00:00.000Z'

const pub = (featured = false) => ({
  status: 'published' as const,
  visibility: 'public' as const,
  audience: { studentIds: [], groupIds: [] },
  featured,
  updatedAt: NOW,
})

// ─── Centers (fictional) ─────────────────────────────────────────────────────
export const centers: Center[] = [
  { id: 'ce-oltin', name: 'Oltin Kalit Learning Center (demo)', district: l('Yunusobod', 'Юнусабад', 'Yunusabad'), description: l('Tillar va akademik tayyorgarlik böyiça namuna markaz.', 'Демо-центр языков и академической подготовки.', 'Sample center for languages and academic preparation.'), tone: '#C8AD7F' },
  { id: 'ce-tafakkur', name: 'Tafakkur Hub (demo)', district: l('Mirzo Uluğbek', 'Мирзо-Улугбек', 'Mirzo Ulugbek'), description: l('Matematika va universitetga tayyorgarlik böyiça namuna markaz.', 'Демо-центр математики и подготовки к вузу.', 'Sample center for mathematics and university preparation.'), tone: '#163C35' },
  { id: 'ce-chilonzor', name: 'Chilonzor Tech Lab (demo)', district: l('Çilonzor', 'Чиланзар', 'Chilanzar'), description: l('IT va dasturlaş böyiça namuna laboratoriya.', 'Демо-лаборатория IT и программирования.', 'Sample lab for IT and programming.'), tone: '#4E6E68' },
  { id: 'ce-nova', name: 'Nova Steps Academy (demo)', district: l('Yakkasaroy', 'Яккасарай', 'Yakkasaray'), description: l('Tabiiy fanlar böyiça namuna akademiya.', 'Демо-академия естественных наук.', 'Sample academy for sciences.'), tone: '#8A9A7B' },
  { id: 'ce-mezon', name: 'Mezon Design School (demo)', district: l('Şayxontohur', 'Шайхантахур', 'Shaykhantakhur'), description: l('Dizayn va interyer böyiça namuna maktab.', 'Демо-школа дизайна и интерьера.', 'Sample school for design and interiors.'), tone: '#A67C52' },
  { id: 'ce-ustoz', name: 'Ustoz Craft Workshop (demo)', district: l('Sergeli', 'Сергели', 'Sergeli'), description: l('Mebelsozlik va hunarmandçilik böyiça namuna ustaxona.', 'Демо-мастерская мебельного дела и ремёсел.', 'Sample workshop for furniture making and crafts.'), tone: '#6B4F3A' },
]

// ─── Categories ──────────────────────────────────────────────────────────────
export const categories: Category[] = [
  { id: 'cat-english', name: l('Ingliz tili', 'Английский', 'English'), glyph: 'A' },
  { id: 'cat-math', name: l('Matematika', 'Математика', 'Mathematics'), glyph: '∑' },
  { id: 'cat-it', name: l('IT', 'IT', 'IT'), glyph: '</>' },
  { id: 'cat-sciences', name: l('Tabiiy fanlar', 'Естественные науки', 'Sciences'), glyph: '⚗' },
  { id: 'cat-languages', name: l('Boşqa tillar', 'Другие языки', 'Other Languages'), glyph: '文' },
  { id: 'cat-university', name: l('Universitetga tayyorgarlik', 'Подготовка к вузу', 'University Preparation'), glyph: '◈' },
  { id: 'cat-furniture', name: l('Mebelsozlik', 'Мебельное дело', 'Furniture Making'), glyph: '⌂' },
  { id: 'cat-design', name: l('Dizayn va interyer', 'Дизайн и интерьеры', 'Design & Interiors'), glyph: '◐' },
]

// ─── Teachers ────────────────────────────────────────────────────────────────
export const teachers: Teacher[] = [
  { id: 't-dilnoza', name: 'Dilnoza Karimova (demo)', title: l('Ingliz tili öqituvçisi', 'Преподаватель английского', 'English teacher'), bio: l('Umumiy ingliz tili va IELTS tayyorgarligi böyiça darslar. Namuna profil.', 'Занятия по общему английскому и подготовке к IELTS. Демо-профиль.', 'General English and IELTS preparation lessons. Sample profile.'), expertise: ['Umumiy ingliz tili', 'IELTS', 'Og‘zaki nutq'], centerId: 'ce-oltin', avatarSeed: 1, avatarUrl: '/images/teachers/dilnoza-karimova.jpg', bannerTone: '#163C35', featured: { type: 'course', id: 'c-ielts' }, tagline: l('Ingliz tilida öylaşni örganing', 'Учитесь думать на английском', 'Learn to think in English'), channelActive: true },
  { id: 't-jamshid', name: 'Jamshid Toshpo‘latov (demo)', title: l('Matematika öqituvçisi', 'Преподаватель математики', 'Mathematics teacher'), bio: l('Algebra, funksiyalar va olimpiada matematikasi. Namuna profil.', 'Алгебра, функции и олимпиадная математика. Демо-профиль.', 'Algebra, functions and olympiad mathematics. Sample profile.'), expertise: ['Algebra', 'Olimpiada', 'Funksiyalar'], centerId: 'ce-tafakkur', avatarSeed: 2, avatarUrl: '/images/teachers/jamshid-toshpulatov.jpg', bannerTone: '#4E6E68', featured: { type: 'playlist', id: 'pl-algebra' }, tagline: l('Matematika — fikrlaş tili', 'Математика — язык мышления', 'Mathematics is a language of thinking'), channelActive: true },
  { id: 't-aziza', name: 'Aziza Rahimova (demo)', title: l('Frontend böyiça mentor', 'Frontend-ментор', 'Frontend mentor'), bio: l('HTML, CSS, JavaScript va React böyiça amaliy kurslar. Namuna profil.', 'Практические курсы по HTML, CSS, JavaScript и React. Демо-профиль.', 'Hands-on courses on HTML, CSS, JavaScript and React. Sample profile.'), expertise: ['HTML/CSS', 'JavaScript', 'React'], centerId: 'ce-chilonzor', avatarSeed: 3, avatarUrl: '/images/teachers/aziza-rahimova.jpg', bannerTone: '#202725', featured: { type: 'course', id: 'c-frontend' }, tagline: l('Kod yozing, portfolio yarating', 'Пишите код, создавайте портфолио', 'Write code, build a portfolio'), channelActive: true },
  { id: 't-bekzod', name: 'Bekzod Nazarov (demo)', title: l('Mebel ustasi va öqituvçi', 'Мастер-мебельщик и преподаватель', 'Furniture maker & instructor'), bio: l('20 yildan ortiq ustaxona tajribasi (namuna). Bazis kursi muallifi: eskizdan yiğişgaça.', 'Более 20 лет опыта в мастерской (демо). Автор курса Bazis: от эскиза до сборки.', 'Over 20 years of workshop experience (sample). Author of the Bazis course: from sketch to assembly.'), expertise: ['Mebel dizayni', 'Duradgorlik', '3D modellashtirish'], centerId: 'ce-ustoz', avatarSeed: 4, avatarUrl: '/images/teachers/bekzod-nazarov.jpg', bannerTone: '#6B4F3A', featured: { type: 'course', id: 'c-bazis' }, tagline: l('Yoğoç bilan gaplaşişni örganing', 'Научитесь говорить с деревом', 'Learn to speak with wood'), channelActive: true },
  { id: 't-malika', name: 'Malika Yusupova (demo)', title: l('Interyer dizayneri', 'Дизайнер интерьеров', 'Interior designer'), bio: l('Interyer asoslari va 3D vizualizatsiya. Namuna profil.', 'Основы интерьера и 3D-визуализация. Демо-профиль.', 'Interior fundamentals and 3D visualization. Sample profile.'), expertise: ['Interyer dizayni', 'Rang va yorug‘lik', '3D vizualizatsiya'], centerId: 'ce-mezon', avatarSeed: 5, avatarUrl: '/images/teachers/malika-yusupova.jpg', bannerTone: '#A67C52', featured: { type: 'course', id: 'c-interior' }, tagline: l('Makon insonga xizmat qilsin', 'Пространство должно служить человеку', 'Space should serve people'), channelActive: true },
  { id: 't-sardor', name: 'Sardor Alimov (demo)', title: l('Fizika va kimyo öqituvçisi', 'Преподаватель физики и химии', 'Physics & chemistry teacher'), bio: l('Fizika asoslari va kimyo laboratoriya amaliyoti. Namuna profil.', 'Основы физики и лабораторная практика по химии. Демо-профиль.', 'Physics foundations and chemistry lab practice. Sample profile.'), expertise: ['Fizika', 'Kimyo', 'Laboratoriya amaliyoti'], centerId: 'ce-nova', avatarSeed: 6, bannerTone: '#8A9A7B', tagline: l('Tajriba orqali tuşuniş', 'Понимание через эксперимент', 'Understanding through experiment'), channelActive: true },
  { id: 't-kamola', name: 'Kamola Ergasheva (demo)', title: l('Nemis va koreys tili öqituvçisi', 'Преподаватель немецкого и корейского', 'German & Korean teacher'), bio: l('Nemis tili A1 va boşlanğiç koreys tili. Namuna profil.', 'Немецкий A1 и корейский для начинающих. Демо-профиль.', 'German A1 and Korean for beginners. Sample profile.'), expertise: ['Nemis tili', 'Koreys tili'], centerId: 'ce-oltin', avatarSeed: 7, bannerTone: '#C8AD7F', tagline: l('Har bir til — yangi dunyo', 'Каждый язык — новый мир', 'Every language is a new world'), channelActive: true },
  { id: 't-rustam', name: 'Rustam Xolmatov (demo)', title: l('Universitetga tayyorlov öqituvçisi', 'Преподаватель подготовки к вузу', 'University prep instructor'), bio: l('DTM va SAT tayyorgarligi. Namuna profil.', 'Подготовка к ДТМ и SAT. Демо-профиль.', 'DTM and SAT preparation. Sample profile.'), expertise: ['DTM', 'SAT', 'Test strategiyasi'], centerId: 'ce-tafakkur', avatarSeed: 8, bannerTone: '#163C35', tagline: l('Strategiya + bilim = natija', 'Стратегия + знания = результат', 'Strategy + knowledge = results'), channelActive: true },
  { id: 't-nilufar', name: 'Nilufar Sodiqova (demo)', title: l('Python va ma’lumotlar tahlili', 'Python и анализ данных', 'Python & data analysis'), bio: l('Python asoslari va ma’lumotlar tahlili. Namuna profil.', 'Основы Python и анализ данных. Демо-профиль.', 'Python fundamentals and data analysis. Sample profile.'), expertise: ['Python', 'Pandas', 'Ma’lumotlar vizualizatsiyasi'], centerId: 'ce-chilonzor', avatarSeed: 9, bannerTone: '#4E6E68', tagline: l('Ma’lumotlar gapirsin', 'Пусть данные говорят', 'Let the data speak'), channelActive: false },
]

export const subjects: Subject[] = [
  { id: 'sub-eng', teacherId: 't-dilnoza', name: l('Ingliz tili', 'Английский язык', 'English'), description: l('Umumiy va imtihon tayyorgarligi', 'Общий и экзаменационный', 'General and exam preparation') },
  { id: 'sub-math', teacherId: 't-jamshid', name: l('Matematika', 'Математика', 'Mathematics'), description: l('Maktab va olimpiada', 'Школьная и олимпиадная', 'School and olympiad') },
  { id: 'sub-web', teacherId: 't-aziza', name: l('Veb-dasturlaş', 'Веб-разработка', 'Web development'), description: l('Frontend asoslari', 'Основы frontend', 'Frontend fundamentals') },
  { id: 'sub-furniture', teacherId: 't-bekzod', name: l('Mebelsozlik', 'Мебельное дело', 'Furniture making'), description: l('Loyihalaş va yiğiş', 'Проектирование и сборка', 'Design and assembly') },
  { id: 'sub-interior', teacherId: 't-malika', name: l('Interyer dizayni', 'Дизайн интерьера', 'Interior design'), description: l('Asoslar va vizualizatsiya', 'Основы и визуализация', 'Fundamentals and visualization') },
  { id: 'sub-physics', teacherId: 't-sardor', name: l('Fizika', 'Физика', 'Physics'), description: l('Asosiy kurs', 'Базовый курс', 'Core course') },
  { id: 'sub-chem', teacherId: 't-sardor', name: l('Kimyo', 'Химия', 'Chemistry'), description: l('Laboratoriya amaliyoti', 'Лабораторная практика', 'Lab practice') },
  { id: 'sub-german', teacherId: 't-kamola', name: l('Nemis tili', 'Немецкий язык', 'German'), description: l('A1 daraja', 'Уровень A1', 'A1 level') },
  { id: 'sub-korean', teacherId: 't-kamola', name: l('Koreys tili', 'Корейский язык', 'Korean'), description: l('Boşlanğiç', 'Начальный', 'Beginner') },
  { id: 'sub-uni', teacherId: 't-rustam', name: l('Universitetga tayyorgarlik', 'Подготовка к вузу', 'University prep'), description: l('DTM va SAT', 'ДТМ и SAT', 'DTM and SAT') },
  { id: 'sub-python', teacherId: 't-nilufar', name: l('Python', 'Python', 'Python'), description: l('Dasturlaş va tahlil', 'Программирование и анализ', 'Programming and analysis') },
]

// ─── Courses ─────────────────────────────────────────────────────────────────
const g = (courseId: string, suffix: string, name: string, days: number[], start: string, end: string, room: string, capacity: number) => ({
  id: `g-${courseId.replace('c-', '')}-${suffix}`, courseId, name, days, start, end, room, capacity,
})

export const courses: Course[] = [
  {
    id: 'c-general-english', ...pub(false), title: l('Umumiy ingliz tili B1', 'Общий английский B1', 'General English B1'), categoryId: 'cat-english', centerId: 'ce-oltin', teacherId: 't-dilnoza', subjectId: 'sub-eng',
    summary: l('Nutq, tinglaş va grammatika — muvozanatli haftalik dastur.', 'Речь, аудирование и грамматика — сбалансированная недельная программа.', 'Speaking, listening and grammar in a balanced weekly program.'),
    description: l('B1 darajasidagi umumiy ingliz tili kursi: kiçik guruhlar, haftada uç marta, amaliy muloqotga urğu.', 'Курс общего английского уровня B1: небольшие группы, три раза в неделю, упор на практику общения.', 'General English at B1: small groups, three times a week, with emphasis on practical communication.'),
    curriculum: [l('Kundalik muloqot', 'Повседневное общение', 'Everyday conversation'), l('Grammatika: zamonlar', 'Грамматика: времена', 'Grammar: tenses'), l('Tinglaş strategiyalari', 'Стратегии аудирования', 'Listening strategies'), l('Luğat boyitiş', 'Расширение словаря', 'Vocabulary building'), l('Yozma ifoda', 'Письменная речь', 'Writing basics')],
    level: 'intermediate', durationMonths: 4, price: 650000, coverSeed: 11,
    groups: [g('c-general-english', 'a', 'B1 — Evening', [0, 2, 4], '18:00', '19:30', '204', 12), g('c-general-english', 'b', 'B1 — Morning', [1, 3], '10:00', '12:00', '201', 10)],
  },
  {
    id: 'c-ielts', ...pub(true), title: l('IELTS intensiv', 'IELTS интенсив', 'IELTS Intensive'), categoryId: 'cat-english', centerId: 'ce-oltin', teacherId: 't-dilnoza', subjectId: 'sub-eng',
    summary: l('Tört könikma, haftalik sinov testlari va individual fikr-mulohaza.', 'Четыре навыка, еженедельные пробные тесты и индивидуальная обратная связь.', 'Four skills, weekly mock tests and individual feedback.'),
    description: l('IELTS 6.5+ maqsad qilganlar uçun intensiv dastur. Har hafta bitta töliq sinov testi va yozma işlar tahlili.', 'Интенсивная программа для тех, кто нацелен на IELTS 6.5+. Каждую неделю полный пробный тест и разбор письменных работ.', 'An intensive program for candidates targeting IELTS 6.5+. One full mock test each week and writing analysis.'),
    curriculum: [l('Listening taktikalari', 'Тактики Listening', 'Listening tactics'), l('Reading: tez köz yugurtiriş va ma’lumot izlaş', 'Reading: skimming и scanning', 'Reading: skimming and scanning'), l('Writing Task 1 va 2', 'Writing Task 1 и 2', 'Writing Task 1 and 2'), l('Speaking: 3 qism', 'Speaking: 3 части', 'Speaking: 3 parts'), l('Haftalik sinov testi', 'Еженедельный пробный тест', 'Weekly mock test')],
    level: 'advanced', durationMonths: 3, price: 900000, coverSeed: 12,
    groups: [g('c-ielts', 'a', 'IELTS — Evening', [1, 3], '18:30', '20:30', '205', 10)],
  },
  {
    id: 'c-algebra', ...pub(false), title: l('Algebra va funksiyalar', 'Алгебра и функции', 'Algebra & Functions'), categoryId: 'cat-math', centerId: 'ce-tafakkur', teacherId: 't-jamshid', subjectId: 'sub-math',
    summary: l('Maktab algebrasini mustahkamlaş va funksiyalarni çuqur tuşuniş.', 'Закрепление школьной алгебры и глубокое понимание функций.', 'Consolidate school algebra and understand functions deeply.'),
    description: l('9–11-sinf öquvçilari uçun algebra kursi. Har dars — nazariya, misollar va uy vazifasi tahlili.', 'Курс алгебры для 9–11 классов. Каждое занятие — теория, примеры и разбор домашнего задания.', 'Algebra course for grades 9–11. Each lesson combines theory, worked examples and homework review.'),
    curriculum: [l('Köphadlar', 'Многочлены', 'Polynomials'), l('Tenglamalar va tengsizliklar', 'Уравнения и неравенства', 'Equations and inequalities'), l('Funksiyalar va grafiklar', 'Функции и графики', 'Functions and graphs'), l('Logarifmlar', 'Логарифмы', 'Logarithms'), l('Trigonometriya asoslari', 'Основы тригонометрии', 'Trigonometry basics')],
    level: 'intermediate', durationMonths: 5, price: 550000, coverSeed: 13,
    groups: [g('c-algebra', 'a', 'Algebra — Evening', [0, 2], '17:00', '18:30', '12', 14)],
  },
  {
    id: 'c-olympiad-math', ...pub(false), title: l('Olimpiada matematikasi', 'Олимпиадная математика', 'Olympiad Mathematics'), categoryId: 'cat-math', centerId: 'ce-tafakkur', teacherId: 't-jamshid', subjectId: 'sub-math',
    summary: l('Nostandart masalalar, isbotlaş va musobaqa strategiyasi.', 'Нестандартные задачи, доказательства и стратегия соревнований.', 'Non-standard problems, proofs and competition strategy.'),
    description: l('Şanba kunlari uç soatlik çuqurlaştirilgan maşğulot. Kombinatorika, sonlar nazariyasi va geometriya.', 'Трёхчасовые углублённые занятия по субботам. Комбинаторика, теория чисел и геометрия.', 'Three-hour deep-dive sessions on Saturdays. Combinatorics, number theory and geometry.'),
    curriculum: [l('Kombinatorika', 'Комбинаторика', 'Combinatorics'), l('Sonlar nazariyasi', 'Теория чисел', 'Number theory'), l('Geometriya isbotlari', 'Геометрические доказательства', 'Geometry proofs'), l('Invariantlar', 'Инварианты', 'Invariants')],
    level: 'advanced', durationMonths: 6, price: 700000, coverSeed: 14,
    groups: [g('c-olympiad-math', 'a', 'Olympiad — Saturday', [5], '10:00', '13:00', '14', 12)],
  },
  {
    id: 'c-frontend', ...pub(true), title: l('Frontend dasturlaş', 'Frontend-разработка', 'Frontend Development'), categoryId: 'cat-it', centerId: 'ce-chilonzor', teacherId: 't-aziza', subjectId: 'sub-web',
    summary: l('HTML, CSS, JavaScript va React — portfolio loyihasi bilan.', 'HTML, CSS, JavaScript и React — с проектом для портфолио.', 'HTML, CSS, JavaScript and React with a portfolio project.'),
    description: l('Noldan boşlab frontend: semantik HTML, zamonaviy CSS, JavaScript asoslari va React komponentlari. Kurs oxirida şaxsiy loyiha.', 'Frontend с нуля: семантический HTML, современный CSS, основы JavaScript и компоненты React. В конце — личный проект.', 'Frontend from scratch: semantic HTML, modern CSS, JavaScript fundamentals and React components. Ends with a personal project.'),
    curriculum: [l('HTML va kiriş imkoniyati', 'HTML и доступность', 'HTML and accessibility'), l('CSS bilan maket: Flexbox, Grid', 'CSS-раскладка: Flexbox, Grid', 'CSS layout: Flexbox, Grid'), l('JavaScript asoslari', 'Основы JavaScript', 'JavaScript fundamentals'), l('DOM va hodisalar', 'DOM и события', 'DOM and events'), l('React komponentlari', 'Компоненты React', 'React components'), l('Portfolio loyihasi', 'Проект для портфолио', 'Portfolio project')],
    level: 'beginner', durationMonths: 6, price: 950000, coverSeed: 15,
    groups: [g('c-frontend', 'a', 'Frontend — Evening', [1, 3], '19:00', '21:00', 'Lab 2', 12), g('c-frontend', 'b', 'Frontend — Weekend', [5, 6], '11:00', '13:00', 'Lab 1', 12)],
  },
  {
    id: 'c-python', ...pub(false), title: l('Python va ma’lumotlar tahlili', 'Python и анализ данных', 'Python & Data Analysis'), categoryId: 'cat-it', centerId: 'ce-chilonzor', teacherId: 't-nilufar', subjectId: 'sub-python',
    summary: l('Python asoslaridan pandas va vizualizatsiyagaça.', 'От основ Python до pandas и визуализации.', 'From Python basics to pandas and visualization.'),
    description: l('Amaliy Python: sintaksis, ma’lumot tuzilmalari, fayllar bilan işlaş, pandas va grafiklar.', 'Практический Python: синтаксис, структуры данных, работа с файлами, pandas и графики.', 'Practical Python: syntax, data structures, file handling, pandas and charts.'),
    curriculum: [l('Sintaksis va turlar', 'Синтаксис и типы', 'Syntax and types'), l('Funksiyalar va modullar', 'Функции и модули', 'Functions and modules'), l('pandas bilan tahlil', 'Анализ с pandas', 'Analysis with pandas'), l('Vizualizatsiya', 'Визуализация', 'Visualization')],
    level: 'beginner', durationMonths: 4, price: 850000, coverSeed: 16,
    groups: [g('c-python', 'a', 'Python — Evening', [0, 2], '19:00', '20:30', 'Lab 3', 12)],
  },
  {
    id: 'c-physics', ...pub(false), title: l('Fizika asoslari', 'Основы физики', 'Physics Foundations'), categoryId: 'cat-sciences', centerId: 'ce-nova', teacherId: 't-sardor', subjectId: 'sub-physics',
    summary: l('Mexanika va elektr — tajriba va masalalar orqali.', 'Механика и электричество — через опыты и задачи.', 'Mechanics and electricity through experiments and problems.'),
    description: l('Fizikani tuşuniş uçun kurs: har mavzuda demonstratsiya tajribasi va masala yeçiş.', 'Курс для понимания физики: в каждой теме демонстрационный опыт и решение задач.', 'A course for understanding physics: every topic includes a demonstration and problem solving.'),
    curriculum: [l('Kinematika', 'Кинематика', 'Kinematics'), l('Dinamika', 'Динамика', 'Dynamics'), l('Energiya', 'Энергия', 'Energy'), l('Elektr zanjirlari', 'Электрические цепи', 'Electric circuits')],
    level: 'beginner', durationMonths: 4, price: 500000, coverSeed: 17,
    groups: [g('c-physics', 'a', 'Physics — Evening', [1, 3], '17:00', '18:30', '7', 14)],
  },
  {
    id: 'c-chemistry', ...pub(false), title: l('Kimyo laboratoriya amaliyoti', 'Лабораторная практика по химии', 'Chemistry Lab Practice'), categoryId: 'cat-sciences', centerId: 'ce-nova', teacherId: 't-sardor', subjectId: 'sub-chem',
    summary: l('Xavfsiz laboratoriya işlari va kimyoviy reaksiyalar amaliyoti.', 'Безопасная лабораторная работа и практика химических реакций.', 'Safe lab work and hands-on chemical reactions.'),
    description: l('Şanba kunlari laboratoriyada amaliy maşğulotlar: eritmalar, titrlaş, organik sintez asoslari.', 'Практические занятия в лаборатории по субботам: растворы, титрование, основы органического синтеза.', 'Saturday lab sessions: solutions, titration, basics of organic synthesis.'),
    curriculum: [l('Laboratoriya xavfsizligi', 'Безопасность в лаборатории', 'Lab safety'), l('Eritmalar va konsentratsiya', 'Растворы и концентрация', 'Solutions and concentration'), l('Titrlaş', 'Титрование', 'Titration'), l('Organik sintez asoslari', 'Основы органического синтеза', 'Organic synthesis basics')],
    level: 'intermediate', durationMonths: 3, price: 520000, coverSeed: 18,
    groups: [g('c-chemistry', 'a', 'Chem Lab — Saturday', [5], '14:00', '16:00', 'Lab A', 10)],
  },
  {
    id: 'c-german', ...pub(false), title: l('Nemis tili A1', 'Немецкий язык A1', 'German A1'), categoryId: 'cat-languages', centerId: 'ce-oltin', teacherId: 't-kamola', subjectId: 'sub-german',
    summary: l('Noldan A1 darajasigaça: talaffuz, asosiy grammatika va muloqot.', 'С нуля до A1: произношение, базовая грамматика и общение.', 'From zero to A1: pronunciation, core grammar and conversation.'),
    description: l('Boşlanğiç nemis tili kursi. Haftada uç marta, muloqot va tinglaşga alohida e’tibor.', 'Курс немецкого для начинающих. Три раза в неделю, особое внимание общению и аудированию.', 'Beginner German course. Three times a week with emphasis on conversation and listening.'),
    curriculum: [l('Alifbo va talaffuz', 'Алфавит и произношение', 'Alphabet and pronunciation'), l('Tanişuv va kundalik iboralar', 'Знакомство и повседневные фразы', 'Introductions and everyday phrases'), l('Artikllar va kelişiklar', 'Артикли и падежи', 'Articles and cases'), l('Hozirgi zamon', 'Настоящее время', 'Present tense')],
    level: 'beginner', durationMonths: 4, price: 600000, coverSeed: 19,
    groups: [g('c-german', 'a', 'German — Evening', [0, 2, 4], '18:00', '19:30', '103', 12), g('c-german', 'b', 'German — Morning', [1, 3], '09:00', '10:30', '103', 10)],
  },
  {
    id: 'c-korean', ...pub(false), title: l('Koreys tili boşlanğiç', 'Корейский для начинающих', 'Korean for Beginners'), categoryId: 'cat-languages', centerId: 'ce-oltin', teacherId: 't-kamola', subjectId: 'sub-korean',
    summary: l('Hangul, asosiy grammatika va TOPIK I darajasiga yönaliş.', 'Хангыль, базовая грамматика и ориентация на TOPIK I.', 'Hangul, core grammar and a path toward TOPIK I.'),
    description: l('Koreys yozuvi va boşlanğiç muloqot. Kurs TOPIK I darajasiga tayyorgarlik uçun asos yaratadi.', 'Корейская письменность и начальное общение. Курс закладывает основу для TOPIK I.', 'Korean script and beginner conversation. Lays the foundation for TOPIK I.'),
    curriculum: [l('Hangul', 'Хангыль', 'Hangul'), l('Salomlaşuv va hurmat darajalari', 'Приветствия и уровни вежливости', 'Greetings and politeness levels'), l('Sonlar va vaqt', 'Числа и время', 'Numbers and time'), l('Asosiy fe’llar', 'Основные глаголы', 'Core verbs')],
    level: 'beginner', durationMonths: 4, price: 620000, coverSeed: 20,
    groups: [g('c-korean', 'a', 'Korean — Evening', [1, 3], '18:00', '19:30', '104', 12)],
  },
  {
    id: 'c-dtm', ...pub(false), title: l('DTMga tayyorgarlik', 'Подготовка к ДТМ', 'University Entrance Prep (DTM)'), categoryId: 'cat-university', centerId: 'ce-tafakkur', teacherId: 't-rustam', subjectId: 'sub-uni',
    summary: l('Majburiy fanlar va test strategiyasi — dam oliş kunlarida.', 'Обязательные предметы и стратегия теста — по выходным.', 'Compulsory subjects and test strategy on weekends.'),
    description: l('Universitetga kiriş testiga tizimli tayyorgarlik. Dam oliş kunlari ertalab, har oy nazorat testi.', 'Системная подготовка к вступительному тесту. Утро по выходным, контрольный тест каждый месяц.', 'Systematic preparation for the university entrance test. Weekend mornings, monthly progress test.'),
    curriculum: [l('Ona tili va adabiyot', 'Родной язык и литература', 'Native language and literature'), l('Matematika', 'Математика', 'Mathematics'), l('Özbekiston tarixi', 'История Узбекистана', 'History of Uzbekistan'), l('Test strategiyasi', 'Стратегия теста', 'Test strategy')],
    level: 'intermediate', durationMonths: 8, price: 750000, coverSeed: 21,
    groups: [g('c-dtm', 'a', 'DTM — Weekend', [5, 6], '09:00', '12:00', '21', 16)],
  },
  {
    id: 'c-sat', ...pub(false), title: l('SAT: Math va Reading', 'SAT: Math и Reading', 'SAT Math & Reading'), categoryId: 'cat-university', centerId: 'ce-tafakkur', teacherId: 't-rustam', subjectId: 'sub-uni',
    summary: l('Xalqaro universitetlar uçun SAT tayyorgarligi.', 'Подготовка к SAT для международных университетов.', 'SAT preparation for international universities.'),
    description: l('Digital SAT formatida maşğulotlar: matematika modullari, öqiş va yoziş, vaqtni boşqariş.', 'Занятия в формате Digital SAT: модули математики, чтение и письмо, управление временем.', 'Sessions in the Digital SAT format: math modules, reading and writing, time management.'),
    curriculum: [l('Algebra va masalalar yeçiş', 'Алгебра и задачи', 'Algebra and problem solving'), l('Reading: dalil topiş', 'Reading: поиск доказательств', 'Reading: evidence'), l('Writing: ingliz tili qoidalari', 'Writing: стандартный английский', 'Writing: standard English'), l('Vaqt strategiyasi', 'Стратегия времени', 'Timing strategy')],
    level: 'advanced', durationMonths: 4, price: 880000, coverSeed: 22,
    groups: [g('c-sat', 'a', 'SAT — Afternoon', [1, 3], '16:00', '18:00', '22', 12)],
  },
  {
    id: 'c-bazis', ...pub(true), title: l('Bazis', 'Bazis', 'Bazis'), categoryId: 'cat-furniture', centerId: 'ce-ustoz', teacherId: 't-bekzod', subjectId: 'sub-furniture',
    summary: l('Mebel eskizidan tayyor buyumgaça: ölçov, material, furnitura, 3D va yiğiş.', 'От эскиза мебели до готового изделия: замеры, материалы, фурнитура, 3D и сборка.', 'From furniture sketch to finished piece: measurements, materials, fittings, 3D and assembly.'),
    description: l('Bazis — mebelsozlik böyiça amaliy kurs. Talabalar öz loyihasini eskizdan boşlab, ölçov va material tanlovi orqali yiğilgan buyumgaça olib boradi. Ustaxonada xavfsizlik — birinçi darsdan.', 'Bazis — практический курс мебельного дела. Студенты ведут собственный проект от эскиза через замеры и выбор материалов до собранного изделия. Безопасность в мастерской — с первого занятия.', 'Bazis is a hands-on furniture making course. Students take their own project from sketch through measurements and material selection to an assembled piece. Workshop safety from lesson one.'),
    curriculum: [l('Mebel eskizlari', 'Эскизы мебели', 'Furniture sketches'), l('Ölçovlar va çizmalar', 'Замеры и чертежи', 'Measurements and drawings'), l('Materiallar: yoğoç, MDF, laminat', 'Материалы: дерево, МДФ, ламинат', 'Materials: wood, MDF, laminate'), l('Furnitura va birikmalar', 'Фурнитура и соединения', 'Fittings and joints'), l('Boşlanğiç 3D modellaştiriş', 'Базовое 3D-моделирование', 'Basic 3D modeling'), l('Yiğiş va pardozlaş', 'Сборка и отделка', 'Assembly and finishing'), l('Ustaxona xavfsizligi', 'Безопасность в мастерской', 'Workshop safety')],
    level: 'beginner', durationMonths: 5, price: 1200000, coverSeed: 23, meyosGrant: true,
    groups: [g('c-bazis', 'a', 'Bazis — Saturday Studio', [5], '10:00', '14:00', 'Workshop 1', 8), g('c-bazis', 'b', 'Bazis — Wednesday Evening', [2], '18:00', '20:00', 'Workshop 1', 8)],
  },
  {
    id: 'c-restoration', ...pub(false), title: l('Mebelni tiklaş asoslari', 'Основы реставрации мебели', 'Furniture Restoration Basics'), categoryId: 'cat-furniture', centerId: 'ce-ustoz', teacherId: 't-bekzod', subjectId: 'sub-furniture',
    summary: l('Eski mebelga ikkinçi hayot: tozalaş, ta’mirlaş, qayta pardozlaş.', 'Вторая жизнь старой мебели: очистка, ремонт, повторная отделка.', 'A second life for old furniture: cleaning, repair, refinishing.'),
    description: l('Yakşanba kunlari ustaxonada: sirt tahlili, yoğoç ta’miri, lak va moy bilan pardozlaş.', 'По воскресеньям в мастерской: анализ поверхности, ремонт дерева, отделка лаком и маслом.', 'Sundays in the workshop: surface assessment, wood repair, finishing with lacquer and oil.'),
    curriculum: [l('Sirt tahlili', 'Анализ поверхности', 'Surface assessment'), l('Yoğoç ta’miri', 'Ремонт дерева', 'Wood repair'), l('Pardozlaş: lak va moy', 'Отделка: лак и масло', 'Finishing: lacquer and oil'), l('Furnitura almaştiriş', 'Замена фурнитуры', 'Replacing fittings')],
    level: 'beginner', durationMonths: 3, price: 800000, coverSeed: 24,
    groups: [g('c-restoration', 'a', 'Restoration — Sunday', [6], '10:00', '13:00', 'Workshop 2', 8)],
  },
  {
    id: 'c-interior', ...pub(true), title: l('Interyer dizayni asoslari', 'Основы дизайна интерьера', 'Interior Design Fundamentals'), categoryId: 'cat-design', centerId: 'ce-mezon', teacherId: 't-malika', subjectId: 'sub-interior',
    summary: l('Kompozitsiya, rang, yoruğlik va reja — uy va ofis makonlari uçun.', 'Композиция, цвет, свет и планировка — для жилых и офисных пространств.', 'Composition, color, light and layout for homes and offices.'),
    description: l('Interyer dizaynining amaliy asoslari: loyiha topşiriği, rejalaştiriş, rang palitrasi, materiallar va yoruğlik. Kurs yakunida konsept-loyiha.', 'Практические основы дизайна интерьера: бриф, планировка, цветовая палитра, материалы и свет. В финале — концепт-проект.', 'Practical fundamentals of interior design: brief, planning, color palette, materials and lighting. Ends with a concept project.'),
    curriculum: [l('Loyiha topşiriği va foydalanuvçi ehtiyojlari', 'Бриф и потребности пользователя', 'Brief and user needs'), l('Rejalaştiriş va ergonomika', 'Планировка и эргономика', 'Planning and ergonomics'), l('Rang va materiallar', 'Цвет и материалы', 'Color and materials'), l('Yoruğlik dizayni', 'Световой дизайн', 'Lighting design'), l('Konsept taqdimoti', 'Презентация концепта', 'Concept presentation')],
    level: 'beginner', durationMonths: 4, price: 1000000, coverSeed: 25,
    groups: [g('c-interior', 'a', 'Interior — Evening', [0, 2], '18:30', '20:30', 'Studio A', 10)],
  },
  {
    id: 'c-3d-interior', ...pub(false), title: l('3D interyer vizualizatsiyasi', '3D-визуализация интерьера', '3D Interior Visualization'), categoryId: 'cat-design', centerId: 'ce-mezon', teacherId: 't-malika', subjectId: 'sub-interior',
    summary: l('Modellaştiriş, materiallar, yoruğlik va render — mijoz uçun taqdimot.', 'Моделирование, материалы, свет и рендер — презентация для клиента.', 'Modeling, materials, lighting and rendering for client presentations.'),
    description: l('Interyer vizualizatsiyasi böyiça amaliy kurs: xona modeli, mebel joylaşuvi, materiallar, kamera va render sozlamalari.', 'Практический курс визуализации интерьера: модель комнаты, расстановка мебели, материалы, камера и настройки рендера.', 'A practical interior visualization course: room model, furniture placement, materials, camera and render settings.'),
    curriculum: [l('Xona modelini quriş', 'Построение модели комнаты', 'Building the room model'), l('Mebel va aksessuarlar', 'Мебель и аксессуары', 'Furniture and accessories'), l('Materiallar va teksturalar', 'Материалы и текстуры', 'Materials and textures'), l('Yoruğlik va kamera', 'Свет и камера', 'Lighting and camera'), l('Render va yakuniy işlov', 'Рендер и постобработка', 'Rendering and post-processing')],
    level: 'intermediate', durationMonths: 4, price: 1100000, coverSeed: 26,
    groups: [g('c-3d-interior', 'a', '3D Viz — Evening', [1, 3], '18:30', '20:30', 'Studio B', 10)],
  },
]

// ─── Videos ──────────────────────────────────────────────────────────────────
const yt = (id: string) => ({ kind: 'link' as const, url: `https://www.youtube.com/watch?v=${id}` })

export const videos: Video[] = [
  { id: 'v-bazis-intro', ...pub(true), teacherId: 't-bekzod', courseId: 'c-bazis', title: l('Bazis: kursga kiriş', 'Bazis: введение в курс', 'Bazis: course introduction'), description: l('Kurs tuzilmasi, ustaxona qoidalari va birinçi loyiha ğoyasi.', 'Структура курса, правила мастерской и идея первого проекта.', 'Course structure, workshop rules and the first project idea.'), source: yt('demo-bazis-intro'), durationSec: 540, coverSeed: 31 },
  { id: 'v-bazis-measure', status: 'published', visibility: 'private', audience: { studentIds: [], groupIds: ['g-bazis-a', 'g-bazis-b'] }, featured: false, updatedAt: NOW, teacherId: 't-bekzod', courseId: 'c-bazis', title: l('Ölçov oliş: stol va stul', 'Снятие замеров: стол и стул', 'Measuring: table and chair'), description: l('Faqat Bazis guruhlari uçun: ölçov varaği bilan işlaş.', 'Только для групп Bazis: работа с листом замеров.', 'For Bazis groups only: working with the measurement sheet.'), source: yt('demo-bazis-measure'), durationSec: 1260, coverSeed: 32 },
  { id: 'v-bazis-joints', status: 'published', visibility: 'private', audience: { studentIds: [], groupIds: ['g-bazis-a'] }, featured: false, updatedAt: NOW, teacherId: 't-bekzod', courseId: 'c-bazis', title: l('Birikmalar: şkant va konfirmat', 'Соединения: шкант и конфирмат', 'Joints: dowel and confirmat'), description: l('Şanba studiyasi uçun: birikma turlari va amaliy körsatma.', 'Для субботней студии: типы соединений и практическая демонстрация.', 'For the Saturday studio: joint types and a hands-on demonstration.'), source: yt('demo-bazis-joints'), durationSec: 980, coverSeed: 33 },
  { id: 'v-bazis-3d-draft', status: 'draft', visibility: 'public', audience: { studentIds: [], groupIds: [] }, featured: false, updatedAt: NOW, teacherId: 't-bekzod', courseId: 'c-bazis', title: l('Boşlanğiç 3D: birinçi model', 'Базовое 3D: первая модель', 'Basic 3D: first model'), description: l('Qoralama — hali naşr etilmagan.', 'Черновик — ещё не опубликован.', 'Draft — not yet published.'), source: yt('demo-bazis-3d'), durationSec: 1500, coverSeed: 34 },
  { id: 'v-ielts-writing', ...pub(true), teacherId: 't-dilnoza', courseId: 'c-ielts', title: l('IELTS Writing Task 2: tuzilma', 'IELTS Writing Task 2: структура', 'IELTS Writing Task 2: structure'), description: l('Inşo tuzilmasi va baholaş mezonlari.', 'Структура эссе и критерии оценки.', 'Essay structure and assessment criteria.'), source: yt('demo-ielts-w2'), durationSec: 1120, coverSeed: 35 },
  { id: 'v-ielts-speaking', ...pub(false), teacherId: 't-dilnoza', courseId: 'c-ielts', title: l('Speaking Part 2: savol kartasi bilan işlaş', 'Speaking Part 2: работа с карточкой', 'Speaking Part 2: working with the cue card'), description: l('Bir daqiqalik tayyorgarlikdan maksimal foyda oliş.', 'Максимум пользы от минуты подготовки.', 'Getting the most out of the one-minute preparation.'), source: yt('demo-ielts-s2'), durationSec: 760, coverSeed: 36 },
  { id: 'v-eng-private', status: 'published', visibility: 'private', audience: { studentIds: ['s-aziz'], groupIds: [] }, featured: false, updatedAt: NOW, teacherId: 't-dilnoza', courseId: 'c-general-english', title: l('Şaxsiy fikr-mulohaza: talaffuz', 'Личная обратная связь: произношение', 'Personal feedback: pronunciation'), description: l('Bitta talabaga biriktirilgan yopiq video.', 'Приватное видео, назначенное одному студенту.', 'Private video assigned to a single student.'), source: yt('demo-eng-feedback'), durationSec: 420, coverSeed: 37 },
  { id: 'v-algebra-1', ...pub(false), teacherId: 't-jamshid', courseId: 'c-algebra', title: l('Kvadrat funksiya grafigi', 'График квадратичной функции', 'Graph of a quadratic function'), description: l('Uçi, öqi va nol nuqtalari.', 'Вершина, ось и нули.', 'Vertex, axis and zeros.'), source: yt('demo-alg-1'), durationSec: 900, coverSeed: 38 },
  { id: 'v-algebra-2', ...pub(false), teacherId: 't-jamshid', courseId: 'c-algebra', title: l('Logarifm xossalari', 'Свойства логарифмов', 'Properties of logarithms'), description: l('Asosiy xossalar va misollar.', 'Основные свойства и примеры.', 'Core properties and examples.'), source: yt('demo-alg-2'), durationSec: 840, coverSeed: 39 },
  { id: 'v-frontend-flex', ...pub(true), teacherId: 't-aziza', courseId: 'c-frontend', title: l('Flexbox 20 daqiqada', 'Flexbox за 20 минут', 'Flexbox in 20 minutes'), description: l('Asosiy xossalar va amaliy maket.', 'Основные свойства и практическая раскладка.', 'Core properties and a practical layout.'), source: yt('demo-flex'), durationSec: 1200, coverSeed: 40 },
  { id: 'v-frontend-react', status: 'published', visibility: 'private', audience: { studentIds: [], groupIds: ['g-frontend-a'] }, featured: false, updatedAt: NOW, teacherId: 't-aziza', courseId: 'c-frontend', title: l('Uy vazifasi tahlili: React holati', 'Разбор домашнего задания: состояние React', 'Homework review: React state'), description: l('Keçki guruh uçun yopiq tahlil.', 'Приватный разбор для вечерней группы.', 'Private review for the evening group.'), source: yt('demo-react-hw'), durationSec: 1500, coverSeed: 41 },
  { id: 'v-interior-color', ...pub(false), teacherId: 't-malika', courseId: 'c-interior', title: l('Rang palitrasi: 60-30-10 qoidasi', 'Цветовая палитра: правило 60-30-10', 'Color palette: the 60-30-10 rule'), description: l('Interyerda rang muvozanati.', 'Баланс цвета в интерьере.', 'Color balance in interiors.'), source: yt('demo-color'), durationSec: 660, coverSeed: 42 },
  { id: 'v-physics-old', status: 'archived', visibility: 'public', audience: { studentIds: [], groupIds: [] }, featured: false, updatedAt: NOW, teacherId: 't-sardor', courseId: 'c-physics', title: l('Eski dastur: kinematika (2024)', 'Старая программа: кинематика (2024)', 'Old syllabus: kinematics (2024)'), description: l('Arxivlangan video.', 'Архивное видео.', 'Archived video.'), source: yt('demo-phys-old'), durationSec: 1000, coverSeed: 43 },
]

export const playlists: Playlist[] = [
  { id: 'pl-bazis', ...pub(true), teacherId: 't-bekzod', title: l('Bazis: eskizdan yiğişgaça', 'Bazis: от эскиза до сборки', 'Bazis: from sketch to assembly'), description: l('Kursning asosiy video darslari ketma-ketlikda.', 'Основные видеоуроки курса по порядку.', 'The course’s core video lessons in order.'), videoIds: ['v-bazis-intro', 'v-bazis-measure', 'v-bazis-joints', 'v-bazis-3d-draft'], coverSeed: 51 },
  { id: 'pl-ielts', ...pub(false), teacherId: 't-dilnoza', title: l('IELTS: Writing va Speaking', 'IELTS: Writing и Speaking', 'IELTS: Writing & Speaking'), description: l('Yozma va oğzaki qismlar uçun strategiyalar.', 'Стратегии для письменной и устной частей.', 'Strategies for the writing and speaking parts.'), videoIds: ['v-ielts-writing', 'v-ielts-speaking'], coverSeed: 52 },
  { id: 'pl-algebra', ...pub(true), teacherId: 't-jamshid', title: l('Algebra: funksiyalar', 'Алгебра: функции', 'Algebra: functions'), description: l('Funksiyalar böyiça qisqa darslar.', 'Короткие уроки по функциям.', 'Short lessons on functions.'), videoIds: ['v-algebra-1', 'v-algebra-2'], coverSeed: 53 },
  { id: 'pl-frontend-private', status: 'published', visibility: 'private', audience: { studentIds: [], groupIds: ['g-frontend-a'] }, featured: false, updatedAt: NOW, teacherId: 't-aziza', title: l('Keçki guruh: uy vazifalari tahlili', 'Вечерняя группа: разборы домашних заданий', 'Evening group: homework reviews'), description: l('Faqat keçki guruh uçun.', 'Только для вечерней группы.', 'Evening group only.'), videoIds: ['v-frontend-react', 'v-frontend-flex'], coverSeed: 54 },
]

export const resources: Resource[] = [
  { id: 'r-bazis-sheet', status: 'published', visibility: 'private', audience: { studentIds: [], groupIds: ['g-bazis-a', 'g-bazis-b'] }, featured: false, updatedAt: NOW, teacherId: 't-bekzod', courseId: 'c-bazis', title: l('Bazis: ölçov varaği', 'Bazis: лист замеров', 'Bazis: measurement sheet'), description: l('Loyihangiz uçun töldiriladigan ölçov varaği (namuna PDF).', 'Заполняемый лист замеров для вашего проекта (демо PDF).', 'Fillable measurement sheet for your project (sample PDF).'), kind: 'pdf', file: { name: 'bazis-measurement-sheet.pdf', size: 184320, mime: 'application/pdf' }, pages: 2 },
  { id: 'r-bazis-safety', ...pub(true), teacherId: 't-bekzod', courseId: 'c-bazis', title: l('Ustaxona xavfsizligi qöllanmasi', 'Руководство по безопасности в мастерской', 'Workshop safety guide'), description: l('Har bir talaba birinçi darsdan oldin öqişi kerak (namuna).', 'Каждый студент должен прочитать перед первым занятием (демо).', 'Every student should read this before the first lesson (sample).'), kind: 'pdf', file: { name: 'workshop-safety-guide.pdf', size: 655360, mime: 'application/pdf' }, pages: 8 },
  { id: 'r-bazis-materials', ...pub(false), teacherId: 't-bekzod', courseId: 'c-bazis', title: l('Materiallar jadvali: yoğoç, MDF, laminat', 'Таблица материалов: дерево, МДФ, ламинат', 'Materials chart: wood, MDF, laminate'), description: l('Qalinlik, narx diapazoni va qöllaniş (namuna).', 'Толщина, диапазон цен и применение (демо).', 'Thickness, price range and use (sample).'), kind: 'sheet', file: { name: 'materials-chart.xlsx', size: 40960, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } },
  { id: 'r-ielts-templates', ...pub(false), teacherId: 't-dilnoza', courseId: 'c-ielts', title: l('IELTS Writing şablonlari', 'Шаблоны IELTS Writing', 'IELTS Writing templates'), description: l('Task 1 va Task 2 uçun tuzilma şablonlari (namuna).', 'Шаблоны структуры для Task 1 и Task 2 (демо).', 'Structure templates for Task 1 and Task 2 (sample).'), kind: 'pdf', file: { name: 'ielts-writing-templates.pdf', size: 245760, mime: 'application/pdf' }, pages: 6 },
  { id: 'r-frontend-checklist', status: 'published', visibility: 'private', audience: { studentIds: [], groupIds: ['g-frontend-a', 'g-frontend-b'] }, featured: false, updatedAt: NOW, teacherId: 't-aziza', courseId: 'c-frontend', title: l('Portfolio loyihasi: tekşiruv röyxati', 'Проект портфолио: чек-лист', 'Portfolio project checklist'), description: l('Loyihani topşirişdan oldin tekşiring (namuna).', 'Проверьте перед сдачей проекта (демо).', 'Check before submitting your project (sample).'), kind: 'doc', file: { name: 'portfolio-checklist.docx', size: 30720, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } },
  { id: 'r-interior-moodboard', ...pub(false), teacherId: 't-malika', courseId: 'c-interior', title: l('Ilhom taxtasi (moodboard) şabloni', 'Шаблон мудборда', 'Moodboard template'), description: l('Konsept taqdimoti uçun şablon (namuna).', 'Шаблон для презентации концепта (демо).', 'Template for the concept presentation (sample).'), kind: 'pdf', file: { name: 'moodboard-template.pdf', size: 1048576, mime: 'application/pdf' }, pages: 3 },
  { id: 'r-algebra-formulas', ...pub(false), teacherId: 't-jamshid', courseId: 'c-algebra', title: l('Formulalar töplami', 'Сборник формул', 'Formula sheet'), description: l('Algebra kursi uçun asosiy formulalar (namuna).', 'Основные формулы курса алгебры (демо).', 'Core formulas for the algebra course (sample).'), kind: 'pdf', file: { name: 'algebra-formulas.pdf', size: 122880, mime: 'application/pdf' }, pages: 4 },
  { id: 'r-draft-doc', status: 'draft', visibility: 'private', audience: { studentIds: [], groupIds: [] }, featured: false, updatedAt: NOW, teacherId: 't-bekzod', courseId: 'c-restoration', title: l('Tiklaş: lak turlari (qoralama)', 'Реставрация: виды лака (черновик)', 'Restoration: lacquer types (draft)'), description: l('Hali tayyor emas.', 'Ещё не готово.', 'Not ready yet.'), kind: 'doc', file: { name: 'lacquer-types.docx', size: 20480, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } },
]

// ─── Students (no personal data: display names + district only) ──────────────
// Enrollment is derived from these subscriptions, so rosters and capacity counts always match.
type SubSpec = { pkg: 'pkg-duo' | 'pkg-trio'; groups: string[]; started: string; renews: string; grant?: boolean }
const demoStudent = (id: string, displayName: string, district: string, preferredLang: 'uz' | 'ru' | 'en', sub?: SubSpec): Student => ({
  id,
  profile: { displayName, district, preferredLang, reminders: true },
  subscription: sub
    ? { packageId: sub.pkg, groupIds: sub.groups, status: 'active', startedAt: sub.started, renewsAt: sub.renews, payment: { method: 'card', simulated: true, confirmedAt: `${sub.started}T09:00:00.000Z` }, funding: { meyosGrant: !!sub.grant, courseIds: sub.grant ? ['c-bazis'] : [] } }
    : { packageId: null, groupIds: [], status: 'none' },
  savedCourseIds: [],
  savedTeacherIds: [],
  builder: { packageId: sub?.pkg ?? null, groupIds: sub ? [...sub.groups] : [], meyosGrant: !!sub?.grant },
})

export const students: Student[] = [
  { ...demoStudent('s-aziz', 'Aziz (demo)', 'Yunusobod', 'uz', { pkg: 'pkg-trio', groups: ['g-bazis-a', 'g-general-english-a', 'g-frontend-a'], started: '2026-09-01', renews: '2026-10-01', grant: true }), savedCourseIds: ['c-interior'], savedTeacherIds: ['t-malika'] },
  demoStudent('s-madina', 'Madina (demo)', 'Chilonzor', 'ru', { pkg: 'pkg-duo', groups: ['g-ielts-a', 'g-sat-a'], started: '2026-09-10', renews: '2026-10-10' }),
  { ...demoStudent('s-new', 'Yangi talaba (demo)', 'Sergeli', 'en'), savedCourseIds: ['c-bazis'] },
  demoStudent('s-jasur', 'Jasur (demo)', 'Mirzo Ulug‘bek', 'uz', { pkg: 'pkg-trio', groups: ['g-bazis-a', 'g-physics-a', 'g-interior-a'], started: '2026-09-03', renews: '2026-10-03' }),
  demoStudent('s-nigora', 'Nigora (demo)', 'Yakkasaroy', 'uz', { pkg: 'pkg-duo', groups: ['g-bazis-a', 'g-german-b'], started: '2026-09-05', renews: '2026-10-05', grant: true }),
  demoStudent('s-bobur', 'Bobur (demo)', 'Sergeli', 'ru', { pkg: 'pkg-duo', groups: ['g-bazis-a', 'g-python-a'], started: '2026-09-08', renews: '2026-10-08' }),
  demoStudent('s-sevara', 'Sevara (demo)', 'Shayxontohur', 'uz', { pkg: 'pkg-trio', groups: ['g-bazis-a', 'g-sat-a', 'g-chemistry-a'], started: '2026-09-12', renews: '2026-10-12' }),
  demoStudent('s-otabek', 'Otabek (demo)', 'Chilonzor', 'uz', { pkg: 'pkg-duo', groups: ['g-bazis-b', 'g-ielts-a'], started: '2026-09-14', renews: '2026-10-14' }),
  demoStudent('s-gulnoza', 'Gulnoza (demo)', 'Yunusobod', 'ru', { pkg: 'pkg-duo', groups: ['g-bazis-b', 'g-dtm-a'], started: '2026-09-15', renews: '2026-10-15', grant: true }),
  demoStudent('s-sherzod', 'Sherzod (demo)', 'Mirzo Ulug‘bek', 'uz', { pkg: 'pkg-trio', groups: ['g-frontend-a', 'g-algebra-a', 'g-restoration-a'], started: '2026-09-02', renews: '2026-10-02' }),
  demoStudent('s-zilola', 'Zilola (demo)', 'Yakkasaroy', 'en', { pkg: 'pkg-duo', groups: ['g-general-english-a', 'g-olympiad-math-a'], started: '2026-09-06', renews: '2026-10-06' }),
  demoStudent('s-dilshod', 'Dilshod (demo)', 'Shayxontohur', 'uz', { pkg: 'pkg-duo', groups: ['g-general-english-b', 'g-3d-interior-a'], started: '2026-09-09', renews: '2026-10-09' }),
  demoStudent('s-kamila', 'Kamila (demo)', 'Chilonzor', 'ru', { pkg: 'pkg-duo', groups: ['g-korean-a', 'g-interior-a'], started: '2026-09-11', renews: '2026-10-11' }),
  demoStudent('s-umid', 'Umid (demo)', 'Sergeli', 'uz', { pkg: 'pkg-trio', groups: ['g-frontend-b', 'g-python-a', 'g-ielts-a'], started: '2026-09-13', renews: '2026-10-13' }),
  demoStudent('s-laylo', 'Laylo (demo)', 'Yunusobod', 'uz', { pkg: 'pkg-duo', groups: ['g-german-a', 'g-physics-a'], started: '2026-09-16', renews: '2026-10-16' }),
]

// ─── Site configuration (template-driven) ────────────────────────────────────
export const site: SiteConfig = {
  brand: {
    name: 'ILMORA',
    heroHeadline: l('Turli öquv markazlari. Bitta abonement.', 'Разные учебные центры. Один абонемент.', 'Different education centers. One subscription.'),
    heroTagline: l('Bir abonement. Bir neçta imkoniyat.', 'Один абонемент. Множество возможностей.', 'One subscription. Many possibilities.'),
    primaryCta: l('Kurslarni tanlaş', 'Выбрать курсы', 'Choose courses'),
    footerNote: l('ILMORA — Toşkentdagi öquv markazlarini bitta abonementda birlaştiruvçi ta’lim platformasi.', 'ILMORA — образовательная платформа, объединяющая учебные центры Ташкента в одном абонементе.', 'ILMORA is an education platform that brings Tashkent learning centers together in one subscription.'),
    city: l('Toşkent şahri', 'г. Ташкент', 'Tashkent, Uzbekistan'),
  },
  theme: {
    colors: { ivory: '#F7F5F0', forest: '#163C35', charcoal: '#202725', champagne: '#C8AD7F', sage: '#E3EBE5', white: '#FFFFFF' },
    fonts: { display: 'Cormorant Garamond', body: 'Inter' },
    radius: 'soft',
  },
  nav: [
    { id: 'n-courses', label: l('Kurslar', 'Курсы', 'Courses'), path: '/courses', enabled: true },
    { id: 'n-teachers', label: l('Öqituvçilar', 'Преподаватели', 'Teachers'), path: '/teachers', enabled: true },
    { id: 'n-builder', label: l('Abonement', 'Абонемент', 'Subscription'), path: '/builder', enabled: true },
    { id: 'n-finder', label: l('Mening töplamim', 'Свой набор', 'My set'), path: '/course-finder', enabled: true },
    { id: 'n-how', label: l('Qanday işlaydi', 'Как это работает', 'How it works'), path: '/how-it-works', enabled: true },
    { id: 'n-universities', label: l('Universitetlar', 'Университеты', 'Universities'), path: '/universities', enabled: true },
    { id: 'n-centers', label: l('Markazlar uçun', 'Для центров', 'For centers'), path: '/centers', enabled: true },
    { id: 'n-faq', label: l('Savol-javob', 'FAQ', 'FAQ'), path: '/faq', enabled: true },
  ],
  pages: {
    home: [
      { id: 'h-hero', type: 'hero', enabled: true, title: l('', '', ''), subtitle: l('', '', '') },
      { id: 'h-discounts', type: 'discounts', enabled: true, title: l('Maxsus takliflar', 'Специальные предложения', 'Special Offers'), subtitle: l('Oflayn kurslarga vaqtinçalik çegirmalar. Çegirmali narx avtomatik hisoblanadi, asl narx saqlanadi.', 'Временные скидки на офлайн-курсы. Цена со скидкой рассчитывается автоматически, исходная цена сохраняется.', 'Limited-time discounts on offline courses. The discounted price is calculated for you; the original price stays visible.') },
      { id: 'h-marquee', type: 'marquee', enabled: true, title: l('Markazlar va yönalişlar', 'Центры и направления', 'Centers & categories'), subtitle: l('', '', '') },
      { id: 'h-packages', type: 'packages', enabled: true, title: l('Abonement paketlari', 'Пакеты абонемента', 'Subscription packages'), subtitle: l('Flex — ikki kurs, Winx — uç kurs yoki istalgan sondagi kursni özingiz tanlang. Oylik summa — tanlangan kurslar narxlari yiğindisi, yaşirin tölovlarsiz.', 'Flex — два курса, Winx — три курса или любое число курсов на ваш выбор. Месячная сумма — сумма цен выбранных курсов, без скрытых платежей.', 'Flex is two courses, Winx is three, or build your own with any number of courses. The monthly total is the sum of selected course prices, with no hidden fees.') },
      { id: 'h-journey', type: 'journey', enabled: true, title: l('', '', ''), subtitle: l('', '', '') },
      { id: 'h-universities', type: 'universities', enabled: true, title: l('Oliy ta’limga kiriş', 'Поступление в вузы', 'University Admission'), subtitle: l('Universitet va yönalişni tanlang — ILMORA kiriş fanlari böyiça kurslarni aniq oylik narxli bitta paketga jamlaydi.', 'Выберите университет и направление — ILMORA соберёт курсы по вступительным предметам в один пакет с понятной ценой в месяц.', 'Choose a university and a direction. ILMORA brings the courses for its entrance subjects into one package with a clear monthly price.') },
      { id: 'h-finder', type: 'courseFinder', enabled: true, title: l('Mening töplamim', 'Свой набор', 'My set'), subtitle: l('', '', '') },
      { id: 'h-featured', type: 'featuredCourses', enabled: true, title: l('Tavsiya etilgan kurslar', 'Рекомендуемые курсы', 'Featured courses'), subtitle: l('Markazlarimizning eng köp tanlanadigan kurslari.', 'Самые востребованные курсы наших центров.', 'The most chosen courses from our centers.'), count: 4 },
      { id: 'h-furniture', type: 'furnitureStory', enabled: true, title: l('Eskizdan buyumgaça', 'От эскиза до изделия', 'From sketch to object'), subtitle: l('Bazis — mebelsozlik böyiça amaliy kurs: ölçov, material, furnitura, 3D modellaştiriş va yiğiş. Ustaxona xavfsizligi bilan.', 'Bazis — практический курс мебельного дела: замеры, материалы, фурнитура, 3D-моделирование и сборка. С безопасностью в мастерской.', 'Bazis is a hands-on furniture course: measurements, materials, fittings, 3D modeling and assembly. Workshop safety included.') },
      { id: 'h-studio', type: 'studio3d', enabled: true, title: l('Bazis kursi', 'Курс Bazis', 'The Bazis course'), subtitle: l('Mebelsozlik böyiça amaliy dastur: eskiz, ölçov, material, furnitura, 3D model va yiğiş — öz loyihangiz bilan, ustaxonada.', 'Практическая программа по мебельному делу: эскиз, замеры, материалы, фурнитура, 3D-модель и сборка — с вашим собственным проектом, в мастерской.', 'A hands-on furniture programme: sketch, measurements, materials, fittings, 3D model and assembly, with your own project in the workshop.') },
      { id: 'h-categories', type: 'categories', enabled: true, title: l('Yönalişlar', 'Направления', 'Categories'), subtitle: l('Tildan mebelsozlikkaça — turli yönalişlar, bir neçta markaz.', 'От языков до мебельного дела — разные направления в нескольких центрах.', 'From languages to furniture making: many categories across several centers.') },
      { id: 'h-teachers', type: 'teachers', enabled: true, title: l('Öqituvçilar va kanallar', 'Преподаватели и каналы', 'Teachers & channels'), subtitle: l('Kurslar, video darslar, pleylistlar va materiallar — bir kanalda.', 'Курсы, видеоуроки, плейлисты и материалы — в одном канале.', 'Courses, video lessons, playlists and resources in one channel.'), count: 4 },
      { id: 'h-how', type: 'howItWorks', enabled: false, title: l('Qanday işlaydi', 'Как это работает', 'How it works'), subtitle: l('Uç qadam — va siz guruhdasiz.', 'Три шага — и вы в группе.', 'Three steps and you’re in a group.'), items: [
        { id: 'st1', title: l('Paketni tanlang', 'Выберите пакет', 'Choose a package'), body: l('Flex (2 kurs), Winx (3 kurs) yoki Mening töplamim (istalgan sondagi kurs).', 'Flex (2 курса), Winx (3 курса) или «Собрать свой набор» (любое число курсов).', 'Flex (2 courses), Winx (3 courses) or Build your own package (any number of courses).') },
        { id: 'st2', title: l('Kurs va guruhni tanlang', 'Выберите курс и группу', 'Pick courses and groups'), body: l('Jadval töqnaşuvlari avtomatik aniqlanadi.', 'Конфликты расписания определяются автоматически.', 'Schedule conflicts are detected automatically.') },
        { id: 'st3', title: l('Öqişni boşlang', 'Начните учиться', 'Start learning'), body: l('Har oy yangilang — guruhingizda davom eting.', 'Продлевайте каждый месяц — продолжайте в своей группе.', 'Renew monthly and continue in your group.') },
      ] },
      { id: 'h-faq', type: 'faq', enabled: true, title: l('Savollar', 'Вопросы', 'Questions'), subtitle: l('', '', ''), count: 4 },
      { id: 'h-centers', type: 'centerCta', enabled: true, title: l('Öquv markazi rahbarimisiz?', 'Вы руководите учебным центром?', 'Do you run an education center?'), subtitle: l('Kurslaringizni ILMORA abonementiga qöşiş uçun sörov qoldiring.', 'Оставьте запрос, чтобы добавить свои курсы в абонемент ILMORA.', 'Leave an inquiry to add your courses to the ILMORA subscription.') },
    ],
    howItWorks: [
      { id: 'hw-hero', type: 'richText', enabled: true, title: l('Qanday işlaydi', 'Как это работает', 'How it works'), subtitle: l('ILMORA turli markazlarning muntazam kurslarini bitta oylik abonementga jamlaydi.', 'ILMORA объединяет регулярные курсы разных центров в один месячный абонемент.', 'ILMORA gathers regular courses from different centers into one monthly subscription.'), body: l('Siz muayyan guruhga qöşilasiz, belgilangan jadvalga amal qilasiz va abonementni yangilaganingizda öqişni davom ettirasiz. Har bir kurs narxi şaffof — oylik summa tanlangan kurslar narxlari yiğindisidan iborat.', 'Вы присоединяетесь к конкретной группе, следуете фиксированному расписанию и продолжаете обучение при продлении. Цена каждого курса прозрачна — месячная сумма складывается из цен выбранных курсов.', 'You join a specific group, follow a fixed schedule and continue when you renew. Every course price is transparent: the monthly total is the sum of selected course prices.') },
      { id: 'hw-journey', type: 'journey', enabled: true, title: l('', '', ''), subtitle: l('', '', '') },
      { id: 'hw-steps', type: 'steps', enabled: false, title: l('Uç qadam', 'Три шага', 'Three steps'), subtitle: l('', '', ''), items: [
        { id: 's1', title: l('Paket', 'Пакет', 'Package'), body: l('Flex — ikki kurs, Winx — uç kurs, Mening töplamim — istalgan sondagi kurs. Paketlardagi kurslar sonini Super Admin belgilaydi.', 'Flex — два курса, Winx — три курса, «Собрать свой набор» — любое число курсов. Число курсов в пакетах задаёт Супер-админ.', 'Flex is two courses, Winx is three, Build your own package takes any number. Super Admin sets the package sizes.') },
        { id: 's2', title: l('Kurslar', 'Курсы', 'Courses'), body: l('Har bir kurs uçun guruh tanlang. Takroriy tanlov va jadval töqnaşuvi bloklanadi.', 'Выберите группу для каждого курса. Дубликаты и конфликты расписания блокируются.', 'Pick a group for each course. Duplicates and schedule conflicts are blocked.') },
        { id: 's3', title: l('Yangilaş', 'Продление', 'Renewal'), body: l('Har oy yangilang va öşa guruhda davom eting. Kabinetingiz tanlovingizdan yaratiladi.', 'Продлевайте каждый месяц и продолжайте в той же группе. Кабинет строится из вашего выбора.', 'Renew monthly and continue in the same group. Your dashboard is generated from your selection.') },
      ] },
      { id: 'hw-packages', type: 'packages', enabled: true, title: l('Paketlar', 'Пакеты', 'Packages'), subtitle: l('', '', '') },
      { id: 'hw-faq', type: 'faq', enabled: true, title: l('Savol-javob', 'FAQ', 'FAQ'), subtitle: l('', '', ''), count: 6 },
    ],
    centers: [
      { id: 'c-hero', type: 'richText', enabled: true, title: l('Öquv markazlari uçun', 'Для учебных центров', 'For education centers'), subtitle: l('Kurslaringizni ILMORA abonementiga qöşing va yangi talabalarga yeting.', 'Добавьте свои курсы в абонемент ILMORA и найдите новых студентов.', 'Add your courses to the ILMORA subscription and reach new students.'), body: l('ILMORA markazlar uçun texnik platforma va marketing kanali sifatida işlaydi. Siz kurs, guruh va jadvalni belgilaysiz; öqituvçilaringiz öz kanalida kontent yaratadi; talabalar abonement orqali guruhlaringizga qöşiladi.', 'ILMORA работает как техническая платформа и маркетинговый канал для центров. Вы определяете курсы, группы и расписание; ваши преподаватели создают контент на своих каналах; студенты присоединяются к вашим группам через абонемент.', 'ILMORA acts as a technical platform and marketing channel for centers. You define courses, groups and schedules; your teachers create content on their channels; students join your groups through the subscription.') },
      { id: 'c-steps', type: 'steps', enabled: true, title: l('Hamkorlik qadamlari', 'Шаги партнёрства', 'Partnership steps'), subtitle: l('', '', ''), items: [
        { id: 'p1', title: l('Sörov', 'Запрос', 'Inquiry'), body: l('Quyidagi formani töldiring.', 'Заполните форму ниже.', 'Fill in the form below.') },
        { id: 'p2', title: l('Şablonlar', 'Шаблоны', 'Templates'), body: l('Kurslaringiz admin şablonlari asosida kiritiladi.', 'Ваши курсы вносятся по шаблонам админа.', 'Your courses are entered using admin templates.') },
        { id: 'p3', title: l('Kanal', 'Канал', 'Channel'), body: l('Öqituvçilar öz kanalini oladi.', 'Преподаватели получают свои каналы.', 'Teachers get their own channels.') },
      ] },
      { id: 'c-list', type: 'centers', enabled: true, title: l('Markazlar', 'Центры', 'Centers'), subtitle: l('', '', '') },
      { id: 'c-form', type: 'inquiryForm', enabled: true, title: l('Sörov qoldiring', 'Оставьте запрос', 'Leave an inquiry'), subtitle: l('', '', '') },
    ],
  },
  faq: [
    { id: 'f1', q: l('Abonement narxi qanday hisoblanadi?', 'Как рассчитывается цена абонемента?', 'How is the subscription price calculated?'), a: l('Oylik summa — tanlangan kurslar narxlarining yiğindisi. Paket (Flex/Winx) faqat bir vaqtdagi kurslar sonini belgilaydi.', 'Месячная сумма — сумма цен выбранных курсов. Пакет (Flex/Winx) лишь определяет число одновременных курсов.', 'The monthly total is the sum of selected course prices. The package (Flex/Winx) only sets how many courses you take at once.') },
    { id: 'f2', q: l('Bir kursni ikki marta tanlaş mumkinmi?', 'Можно ли выбрать один курс дважды?', 'Can I select the same course twice?'), a: l('Yöq. Har bir kurs abonementda bir marta bölişi mumkin; takroriy tanlov bloklanadi.', 'Нет. Каждый курс может быть в абонементе один раз; дубликаты блокируются.', 'No. Each course may appear once in a subscription; duplicates are blocked.') },
    { id: 'f3', q: l('Jadval töqnaşsa nima böladi?', 'Что если расписания пересекаются?', 'What if schedules overlap?'), a: l('Abonement yiğuvçi töqnaşuvni darhol körsatadi va faollaştirişga ruxsat bermaydi. Boşqa guruhni tanlang.', 'Конструктор сразу показывает конфликт и не позволяет активировать. Выберите другую группу.', 'The builder flags the conflict immediately and blocks activation. Choose another group.') },
    { id: 'f4', q: l('Yangilaganda guruhim saqlanib qoladimi?', 'Сохраняется ли моя группа при продлении?', 'Do I keep my group when I renew?'), a: l('Ha. Yangilaganda siz öşa guruhlarda öqişni davom ettirasiz.', 'Да. При продлении вы продолжаете обучение в тех же группах.', 'Yes. When you renew, you continue in the same groups.') },
    { id: 'f5', q: l('Ommaviy video kursga bepul kiriş beradimi?', 'Даёт ли публичное видео бесплатный доступ к курсу?', 'Does a public video give free course access?'), a: l('Yöq. Köriniş va röyxatdan ötiş alohida: ommaviy sahifa yoki video pullik guruhda örin bermaydi.', 'Нет. Видимость и зачисление разделены: публичная страница или видео не даёт места в платной группе.', 'No. Visibility and enrollment are separate: a public page or video doesn’t grant a seat in a paid group.') },
    { id: 'f6', q: l('Yopiq materiallarni kim köradi?', 'Кто видит приватные материалы?', 'Who sees private materials?'), a: l('Faqat öqituvçi, vakolatli Super Admin va öqituvçi tanlagan talabalar yoki guruhlar.', 'Только преподаватель, уполномоченный Супер-админ и выбранные преподавателем студенты или группы.', 'Only the teacher, authorized Super Admin, and the students or groups the teacher selected.') },
  ],
  features: { teacherChannels: true, savedItems: true, centerInquiry: true, scrollVideo: true, threeD: true, announcements: true, faq: true, publicSearch: true },
  permissions: {
    teacher: { editCourses: true, editPrices: false, editSchedules: true, publishDirectly: true, customizeChannel: true, manageGroups: true, uploadResources: true },
    student: { saveItems: true, switchGroups: true, downloadResources: true },
  },
  packages: [
    { id: 'pkg-duo', name: l('Flex', 'Flex', 'Flex'), maxCourses: 2, description: l('Ikki kursni bir vaqtda öqing.', 'Два курса одновременно.', 'Two courses at the same time.'), perks: [l('Ikki guruh, ikki jadval', 'Две группы, два расписания', 'Two groups, two schedules'), l('Barça öqituvçi kanallariga kiriş', 'Доступ ко всем каналам преподавателей', 'Access to all teacher channels'), l('Guruh materiallari', 'Материалы групп', 'Group materials')], enabled: true, highlight: false },
    { id: 'pkg-trio', name: l('Winx', 'Winx', 'Winx'), maxCourses: 3, description: l('Uç kursni bir vaqtda öqing.', 'Три курса одновременно.', 'Three courses at the same time.'), perks: [l('Uç guruh, muvofiqlaştirilgan jadval', 'Три группы, согласованное расписание', 'Three groups, coordinated schedule'), l('Barça öqituvçi kanallariga kiriş', 'Доступ ко всем каналам преподавателей', 'Access to all teacher channels'), l('Guruh materiallari', 'Материалы групп', 'Group materials'), l('Ustuvor örin band qiliş', 'Приоритетное бронирование мест', 'Priority seat booking')], enabled: true, highlight: true },
  ],
  announcements: [
    { id: 'a1', title: l('Oktyabr guruhlari oçildi', 'Открыты группы на октябрь', 'October groups are open'), body: l('Bazis va Frontend kurslarida yangi guruhlar uçun örinlar çeklangan.', 'Места в новых группах Bazis и Frontend ограничены.', 'Seats in new Bazis and Frontend groups are limited.'), audience: 'all', enabled: true },
    { id: 'a2', title: l('Öqituvçilar uçun: köriniş sozlamalari', 'Для преподавателей: настройки видимости', 'For teachers: visibility settings'), body: l('Yopiq materiallar uçun auditoriya tanlaşni unutmang.', 'Не забывайте выбирать аудиторию для приватных материалов.', 'Remember to select an audience for private materials.'), audience: 'teachers', enabled: true },
  ],
  media: { heroVideoUrl: '/media/ilmora-commercial.mp4', heroPosterUrl: '', furnitureVideoUrl: '', furniturePosterUrl: '' },
  courseCard: { showCenter: true, showTeacher: true, showLevel: true, showSchedule: true, showCategory: true, priceStyle: 'emphasis' },
  // Card is the only method offered for now; the others stay defined so they can be switched on later.
  payments: { methods: [{ id: 'card', enabled: true }, { id: 'payme', enabled: false }, { id: 'click', enabled: false }, { id: 'cash', enabled: false }] },
  dashboards: {
    student: [
      { id: 'overview', enabled: true }, { id: 'subscription', enabled: true }, { id: 'courses', enabled: true }, { id: 'timetable', enabled: true },
      { id: 'videos', enabled: true }, { id: 'resources', enabled: true }, { id: 'attendance', enabled: true }, { id: 'saved', enabled: true }, { id: 'profile', enabled: true },
    ],
    teacher: [
      { id: 'overview', enabled: true }, { id: 'subjects', enabled: true }, { id: 'videos', enabled: true }, { id: 'playlists', enabled: true },
      { id: 'resources', enabled: true }, { id: 'groups', enabled: true }, { id: 'channel', enabled: true }, { id: 'visibility', enabled: true },
    ],
  },
}
