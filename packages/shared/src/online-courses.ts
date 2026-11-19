import type { CertificateKind, L, Level } from './types.js'

/**
 * The curated online catalog: real courses published by their providers, opened on the provider's own site.
 *
 * Every fact below was read from the course's own page and re-checked on the date in its `source` (the first sixteen on
 * 2026-10-31, the twelve added later on 2026-11-19). Where a page did not state a
 * length, a level or a certificate, the field is left empty (`durationText: null`, certificate `NONE`) instead of
 * guessed. Titles, providers, instructors and curriculum items are the providers' own wording; the summaries and
 * descriptions are written in our own words, in three languages. Prices are not stored: online courses are free to take.
 * No provider images are used (their licences were not checked); cards use ILMORA's own category photographs.
 *
 * `levelBasis` records where the difficulty comes from, because most providers do not label one.
 */
export type OnlineCategorySlug = 'python' | 'frontend' | 'backend' | 'ai-ml' | 'ui-ux' | 'graphic-design' | 'economics' | 'english' | 'math' | 'sciences' | 'it'

export interface OnlineCourseSeed {
  id: string
  slug: string
  category: OnlineCategorySlug
  /** As published by the provider (a proper name, the same in every language). */
  title: string
  provider: string
  /** The instructor or teaching team the provider names; null when the page names nobody. */
  instructor: string | null
  /** The course page on the provider's own site. */
  url: string
  level: Level
  levelBasis: string
  certificate: CertificateKind
  durationText: L | null
  summary: L
  description: L
  /** Section or module titles as the provider lists them. */
  curriculum: string[]
  source: { verifiedOn: string; note: string }
}

const l = (uz: string, ru: string, en: string): L => ({ uz, ru, en })
const VERIFIED = '2026-10-31'
/** The date the courses added in November 2026 were read from their pages. */
const VERIFIED_NOV = '2026-11-19'

/** Categories the online catalog adds. `english`, `math`, `sciences` and `it` already exist in the ILMORA seed and are reused by slug. */
export const ONLINE_CATEGORIES: { id: string; slug: OnlineCategorySlug; name: L; glyph: string; sortOrder: number }[] = [
  { id: 'cat-python', slug: 'python', name: l('Python', 'Python', 'Python'), glyph: 'Py', sortOrder: 8 },
  { id: 'cat-frontend', slug: 'frontend', name: l('Frontend', 'Frontend', 'Frontend'), glyph: '‹/›', sortOrder: 9 },
  { id: 'cat-backend', slug: 'backend', name: l('Backend', 'Backend', 'Backend'), glyph: '{ }', sortOrder: 10 },
  { id: 'cat-ai-ml', slug: 'ai-ml', name: l('Sun’iy intellekt va ML', 'ИИ и машинное обучение', 'AI & Machine Learning'), glyph: 'AI', sortOrder: 11 },
  { id: 'cat-ui-ux', slug: 'ui-ux', name: l('UI/UX dizayn', 'UI/UX-дизайн', 'UI/UX Design'), glyph: 'UX', sortOrder: 12 },
  { id: 'cat-graphic-design', slug: 'graphic-design', name: l('Grafik dizayn', 'Графический дизайн', 'Graphic Design'), glyph: '✎', sortOrder: 13 },
  { id: 'cat-economics', slug: 'economics', name: l('Iqtisodiyot', 'Экономика', 'Economics'), glyph: '%', sortOrder: 14 },
]

export const ONLINE_COURSES: OnlineCourseSeed[] = [
  // ── Python ──────────────────────────────────────────────────────────────
  {
    id: 'c-online-cs50p', slug: 'cs50-introduction-to-programming-with-python', category: 'python',
    title: 'CS50’s Introduction to Programming with Python', provider: 'Harvard CS50 (OpenCourseWare)', instructor: 'David J. Malan', url: 'https://cs50.harvard.edu/python/',
    level: 'beginner', levelBasis: 'Titled an introduction; the page lists no prerequisites.', certificate: 'FREE',
    durationText: l('10 haftalik material', '10 недель материала', '10 weeks of material'),
    summary: l('Harvardning CS50 jamoasidan Python dasturlaşga kiriş kursi.', 'Вводный курс по программированию на Python от команды CS50 Гарварда.', 'Harvard CS50’s introduction to programming with Python.'),
    description: l(
      'Ön haftalik material: funksiyalar, şartlar, sikllar, istisnolar, kutubxonalar, unit-testlar, fayllar bilan işlaş, regulyar ifodalar va ob’ektga yönaltirilgan dasturlaş. Kursni CS50 saytida bepul öqiş mumkin. Har bir topşiriq va yakuniy loyihadan kamida 70% ball olsangiz, bepul CS50 sertifikati beriladi; edX orqali tasdiqlangan sertifikat ham taklif etiladi.',
      'Десять недель материала: функции, условия, циклы, исключения, библиотеки, юнит-тесты, работа с файлами, регулярные выражения и объектно-ориентированное программирование. Курс можно проходить бесплатно на сайте CS50. При результате не ниже 70% по каждому заданию и итоговому проекту выдаётся бесплатный сертификат CS50; верифицированный сертификат предлагается через edX.',
      'Ten weeks of material on functions, conditionals, loops, exceptions, libraries, unit tests, file I/O, regular expressions and object-oriented programming. Anyone can follow it free on the CS50 site. Scoring at least 70% on each problem set and the final project earns a free CS50 Certificate; a verified certificate is offered through edX.',
    ),
    curriculum: ['Functions, Variables', 'Conditionals', 'Loops', 'Exceptions', 'Libraries', 'Unit Tests', 'File I/O', 'Regular Expressions', 'Object-Oriented Programming', 'Et Cetera'],
    source: { verifiedOn: VERIFIED, note: 'cs50.harvard.edu/python and /python/certificate/: free via OpenCourseWare; a free CS50 Certificate for at least 70% on each problem and the final project; an edX verified certificate is offered separately (no price on the page).' },
  },
  {
    id: 'c-online-py4e', slug: 'python-for-everybody-py4e', category: 'python',
    title: 'Python for Everybody (PY4E)', provider: 'PY4E · University of Michigan', instructor: 'Charles R. Severance', url: 'https://www.py4e.com/',
    level: 'beginner', levelBasis: 'Titled “for Everybody”; the first lessons are installing Python and “Why Program?”.', certificate: 'NONE',
    durationText: null,
    summary: l('Darslik, ma’ruzalar va avtomatik tekşiriladigan topşiriqlar bilan Python’ga bepul, oçiq kiriş.', 'Бесплатное открытое введение в Python с учебником, лекциями и автопроверяемыми заданиями.', 'A free, open introduction to programming in Python with a textbook, lectures and auto-graded assignments.'),
    description: l(
      'Michigan universiteti professori Charles R. Severance yaratgan kurs: bepul kitob va video ma’ruzalar asosida. Saytda 17 ta dars bor — Python’ni örnatişdan röyxat, luğat, regulyar ifodalar, veb-xizmatlar va ma’lumotlar bazalari orqali ma’lumotlarni vizuallaştirişgaça; tizimga kirsangiz, baholar daftari va nişonlar mavjud. Bepul sertifikatlar sahifada faqat Michigan universiteti talabalari va xodimlari uçun tilga olingan.',
      'Курс Чарльза Северанса из Мичиганского университета на основе бесплатной книги и видеолекций. На сайте 17 уроков — от установки Python через списки, словари, регулярные выражения, веб-сервисы и базы данных до визуализации данных; после входа доступны журнал оценок и значки. Бесплатные сертификаты на странице упомянуты только для студентов и сотрудников Мичиганского университета.',
      'Built by Charles R. Severance of the University of Michigan around a free book and video lectures. The site lists 17 lessons, from installing Python through lists, dictionaries, regular expressions, web services and databases to data visualisation, and offers a grade book and badges when you log in. Free certificates are mentioned only for University of Michigan students and staff.',
    ),
    curriculum: ['Installing Python', 'Why Program?', 'Variables, expressions and statements', 'Conditional Execution', 'Functions', 'Loops and Iterations', 'Strings', 'Files', 'Lists', 'Dictionaries', 'Tuples', 'Regular Expressions', 'Network Programming', 'Using Web Services', 'Object-Oriented Programming', 'Databases', 'Data Visualization'],
    source: { verifiedOn: VERIFIED, note: 'py4e.com and its lessons page: free, open and online; no duration or level stated; certificates mentioned only for University of Michigan students and staff.' },
  },

  // ── Frontend ────────────────────────────────────────────────────────────
  {
    id: 'c-online-mdn-learn', slug: 'mdn-learn-web-development', category: 'frontend',
    title: 'Learn web development', provider: 'MDN Web Docs (Mozilla)', instructor: 'MDN Web Docs contributors', url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development',
    level: 'beginner', levelBasis: 'The page presents the path as taking you from complete beginner to a comfortable front-end developer.', certificate: 'NONE',
    durationText: null,
    summary: l('MDN’ning boşlovçidan frontend dasturçigaça tuzilgan öquv yöli.', 'Структурированный путь MDN от новичка до фронтенд-разработчика.', 'MDN’s structured path from complete beginner to front-end developer.'),
    description: l(
      'Asosiy modullar HTML, CSS (matn va maket), JavaScript, freymvorklar, qulaylik (accessibility), dasturçilar uçun dizayn va versiyalarni boşqarişni qamrab oladi; boşlanğiç va kengaytirilgan modullar undan oldin va keyin keladi. MDN darsliklari oçiq; sahifada sertifikat tilga olinmagan.',
      'Основные модули охватывают HTML, CSS (текст и вёрстку), JavaScript, фреймворки, доступность, дизайн для разработчиков и контроль версий; вводные и расширенные модули идут до и после них. Учебные материалы MDN открыты; о сертификатах на странице не упоминается.',
      'The core modules cover HTML, CSS text and layout, JavaScript, frameworks, accessibility, design for developers and version control, with getting-started and extension modules before and after. MDN’s tutorials are openly available; the page mentions no certificate.',
    ),
    curriculum: ['Structuring content with HTML', 'CSS styling basics', 'CSS text styling', 'CSS layout', 'Dynamic scripting with JavaScript', 'JavaScript frameworks and libraries', 'Accessibility', 'Design for developers', 'Version control'],
    source: { verifiedOn: VERIFIED, note: 'MDN “Learn web development”: no price or paywall shown; the 9 core modules listed; no certificate mentioned.' },
  },
  {
    id: 'c-online-odin-foundations', slug: 'the-odin-project-foundations', category: 'frontend',
    title: 'Foundations (The Odin Project)', provider: 'The Odin Project', instructor: 'The Odin Project community', url: 'https://www.theodinproject.com/paths/foundations/courses/foundations',
    level: 'beginner', levelBasis: 'It is the first course of the path and teaches the basic tools from scratch.', certificate: 'NONE',
    durationText: null,
    summary: l('The Odin Project’ning birinçi kursi: Git, HTML, CSS, Flexbox va JavaScript asoslari.', 'Первый курс The Odin Project: Git, HTML, CSS, Flexbox и основы JavaScript.', 'The first course of The Odin Project: Git, HTML, CSS, Flexbox and JavaScript basics.'),
    description: l(
      'Amaliy, loyihalarga asoslangan boşlaniş: sahifada 41 ta dars va beşta loyiha körsatilgan (retseptlar sahifasi, landing, toş-qayçi-qoğoz, Etch-a-Sketch, kalkulyator). The Odin Project oçiq kodli hamjamiyat tomonidan yuritiladi va yölni bepul deb ta’riflaydi; kurs sahifasida sertifikat tilga olinmagan.',
      'Практический старт на проектах: на странице указаны 41 урок и пять проектов (страница рецептов, лендинг, камень-ножницы-бумага, Etch-a-Sketch, калькулятор). The Odin Project ведёт open-source сообщество и называет обучение бесплатным; о сертификатах на странице курса не упоминается.',
      'A hands-on, project-based start: the page lists 41 lessons and five projects (a recipes page, a landing page, rock paper scissors, Etch-a-Sketch and a calculator). The Odin Project is run by an open-source community and describes learning on its paths as free; the course page mentions no certificate.',
    ),
    curriculum: ['Introduction', 'Prerequisites', 'Git Basics', 'HTML Foundations', 'CSS Foundations', 'Flexbox', 'JavaScript Basics', 'Conclusion'],
    source: { verifiedOn: VERIFIED, note: 'Foundations course page (41 lessons, 5 projects); the Full Stack JavaScript path page invites visitors to start for free.' },
  },

  // ── Backend ─────────────────────────────────────────────────────────────
  {
    id: 'c-online-cs50w', slug: 'cs50-web-programming-with-python-and-javascript', category: 'backend',
    title: 'CS50’s Web Programming with Python and JavaScript', provider: 'Harvard CS50 (OpenCourseWare)', instructor: 'Brian Yu and David J. Malan', url: 'https://cs50.harvard.edu/web/',
    level: 'intermediate', levelBasis: 'The page requires CS50x or experience in any programming language first.', certificate: 'FREE',
    durationText: l('9 haftalik material va yakuniy loyiha', '9 недель материала и итоговый проект', '9 weeks of material plus a final project'),
    summary: l('Harvardning CS50 jamoasidan Python, JavaScript va SQL bilan veb-ilovalar yaratiş kursi.', 'Курс CS50 Гарварда по созданию веб-приложений на Python, JavaScript и SQL.', 'Harvard CS50’s course on building web apps with Python, JavaScript and SQL.'),
    description: l(
      'Töqqiz hafta va yakuniy loyiha: HTML/CSS, Git, Python, Django, SQL va migratsiyalar, JavaScript, interfeyslar, testlaş va CI/CD, masştablaş va xavfsizlik. Oldindan CS50x yoki istalgan tilda dasturlaş tajribasi kerak. CS50 saytida bepul. Har bir loyihadan, jumladan yakuniy loyihadan kamida 70% ball olsangiz, bepul CS50 sertifikati beriladi; edX tasdiqlangan sertifikati va kredit alohida taklif etiladi.',
      'Девять недель и итоговый проект: HTML/CSS, Git, Python, Django, SQL и миграции, JavaScript, интерфейсы, тестирование и CI/CD, масштабируемость и безопасность. Нужен предварительный опыт: CS50x или программирование на любом языке. Бесплатно на сайте CS50. За результат не ниже 70% по каждому проекту, включая итоговый, выдаётся бесплатный сертификат CS50; верифицированный сертификат edX и зачётные кредиты предлагаются отдельно.',
      'Nine weeks plus a final project on HTML/CSS, Git, Python, Django, SQL and migrations, JavaScript, user interfaces, testing and CI/CD, scalability and security. The prerequisite is CS50x or experience in any programming language. Free on the CS50 site. Scoring at least 70% on each project, including the final project, earns a free CS50 Certificate; an edX verified certificate and credit are offered separately.',
    ),
    curriculum: ['HTML, CSS', 'Git', 'Python', 'Django', 'SQL, Models, and Migrations', 'JavaScript', 'User Interfaces', 'Testing, CI/CD', 'Scalability and Security'],
    source: { verifiedOn: VERIFIED, note: 'cs50.harvard.edu/web and /web/certificate/: free; 9 weeks of material; a free CS50 Certificate for at least 70% on each project including the final project; edX verified certificate and transfer credit offered separately (no prices on the page).' },
  },
  {
    id: 'c-online-mdn-express', slug: 'mdn-express-web-framework-nodejs', category: 'backend',
    title: 'Express web framework (Node.js/JavaScript)', provider: 'MDN Web Docs (Mozilla)', instructor: 'MDN Web Docs contributors', url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/Express_Nodejs',
    level: 'intermediate', levelBasis: 'The page recommends understanding server-side programming first and prior programming and JavaScript knowledge.', certificate: 'NONE',
    durationText: null,
    summary: l('MDN’ning Express va Node.js bilan server tomoni dasturlaş böyiça darsliklar turkumi.', 'Серия руководств MDN по серверной разработке на Express и Node.js.', 'MDN’s tutorial series on server-side development with Express and Node.js.'),
    description: l(
      'Qadam-baqadam “Local Library” veb-saytini yaratasiz: muhitni sozlaş, marşrutlar va kontrollerlar, Mongoose orqali MongoDB, şakllar va işga tuşiriş. Sahifa avval server tomoni dasturlaşni va dasturlaş/JavaScript asoslarini bilişni tavsiya qiladi; sertifikat tilga olinmagan.',
      'Шаг за шагом вы создаёте сайт «Local Library»: настройка среды, маршруты и контроллеры, MongoDB через Mongoose, формы и развёртывание. Страница советует сначала разобраться в серверном программировании и знать основы программирования и JavaScript; о сертификате не упоминается.',
      'You build a “Local Library” website step by step: environment setup, routes and controllers, a MongoDB database through Mongoose, forms and deployment. The page recommends understanding server-side programming first, plus programming and JavaScript knowledge; it mentions no certificate.',
    ),
    curriculum: ['Express/Node introduction', 'Setting up a Node (Express) development environment', 'Express Tutorial: The Local Library website', 'Express Tutorial Part 2: Creating a skeleton website', 'Express Tutorial Part 3: Using a Database (with Mongoose)', 'Express Tutorial Part 4: Routes and controllers', 'Express Tutorial Part 5: Displaying library data', 'Express Tutorial Part 6: Working with forms', 'Express Tutorial Part 7: Deploying to production'],
    source: { verifiedOn: VERIFIED, note: 'MDN Express tutorial index: nine parts listed; no price or paywall shown; no certificate mentioned.' },
  },

  // ── AI & Machine Learning ───────────────────────────────────────────────
  {
    id: 'c-online-fastai', slug: 'fast-ai-practical-deep-learning-for-coders', category: 'ai-ml',
    title: 'Practical Deep Learning for Coders', provider: 'fast.ai', instructor: 'Jeremy Howard', url: 'https://course.fast.ai/',
    level: 'intermediate', levelBasis: 'The page expects about a year of coding (ideally Python) and high-school maths.', certificate: 'NONE',
    durationText: l('9 ta dars, har biri taxminan 90 daqiqa', '9 уроков примерно по 90 минут', '9 lessons of about 90 minutes each'),
    summary: l('Dasturlay oladiganlar uçun fast.ai’ning bepul çuqur örganiş kursi.', 'Бесплатный курс fast.ai по глубокому обучению для тех, кто уже умеет программировать.', 'fast.ai’s free deep learning course for people who can already code.'),
    description: l(
      'Töqqizta amaliy dars: modellarni öqitiş va joylaştiriş, neyron tarmoq asoslari, NLP, tasodifiy örmonlar, hamkorlikdagi filtrlaş, konvolyutsiyalar va ma’lumotlar etikasi böyiça qöşimça dars. Sahifa kamida bir yillik dasturlaş (yaxşisi Python) va maktab matematikasini talab qiladi; bu Part 1, 2022 naşri. Sertifikat tilga olinmagan.',
      'Девять практических уроков: обучение и развёртывание моделей, основы нейросетей, NLP, случайные леса, коллаборативная фильтрация, свёртки и бонусный урок по этике данных. Страница ожидает около года программирования (лучше на Python) и школьную математику; это издание Part 1, 2022. О сертификате не упоминается.',
      'Nine hands-on lessons: training and deploying models, neural net foundations, NLP, random forests, collaborative filtering, convolutions and a bonus lesson on data ethics. The page expects about a year of coding (ideally Python) and high-school maths; this is the Part 1, 2022 edition. No certificate is mentioned.',
    ),
    curriculum: ['Getting started', 'Deployment', 'Neural net foundations', 'Natural Language (NLP)', 'From-scratch model', 'Random forests', 'Collaborative filtering', 'Convolutions (CNNs)', 'Bonus: Data ethics'],
    source: { verifiedOn: VERIFIED, note: 'course.fast.ai: described as a free course; 9 lessons of about 90 minutes; prerequisites stated; Part 1, 2022 edition.' },
  },
  {
    id: 'c-online-cs50ai', slug: 'cs50-introduction-to-artificial-intelligence-with-python', category: 'ai-ml',
    title: 'CS50’s Introduction to Artificial Intelligence with Python', provider: 'Harvard CS50 (OpenCourseWare)', instructor: 'Brian Yu and David J. Malan', url: 'https://cs50.harvard.edu/ai/',
    level: 'intermediate', levelBasis: 'The page requires CS50x or at least one year of Python experience.', certificate: 'FREE',
    durationText: l('7 haftalik material', '7 недель материала', '7 weeks of material'),
    summary: l('Harvardning CS50 jamoasidan zamonaviy sun’iy intellekt ğoyalari böyiça Python kursi.', 'Курс CS50 Гарварда на Python об идеях, лежащих в основе современного ИИ.', 'Harvard CS50’s Python course on the ideas behind modern AI.'),
    description: l(
      'Yetti hafta: qidiruv, bilim, noaniqlik, optimallaştiriş, örganiş, neyron tarmoqlar va til. Oldindan CS50x yoki kamida bir yillik Python tajribasi kerak. CS50 saytida bepul. Har bir loyihadan kamida 70% ball olsangiz, bepul CS50 sertifikati beriladi; edX tasdiqlangan sertifikati alohida taklif etiladi.',
      'Семь недель: поиск, знания, неопределённость, оптимизация, обучение, нейронные сети и язык. Нужен CS50x или минимум год опыта на Python. Бесплатно на сайте CS50. За результат не ниже 70% по каждому проекту выдаётся бесплатный сертификат CS50; верифицированный сертификат edX предлагается отдельно.',
      'Seven weeks: search, knowledge, uncertainty, optimization, learning, neural networks and language. The prerequisite is CS50x or at least a year of Python. Free on the CS50 site. Scoring at least 70% on each project earns a free CS50 Certificate; an edX verified certificate is offered separately.',
    ),
    curriculum: ['Search', 'Knowledge', 'Uncertainty', 'Optimization', 'Learning', 'Neural Networks', 'Language'],
    source: { verifiedOn: VERIFIED, note: 'cs50.harvard.edu/ai and /ai/certificate/: free via OpenCourseWare; seven weeks; a free CS50 Certificate for at least 70% on each project; an edX verified certificate is offered separately (no price on the page).' },
  },

  // ── UI/UX Design ────────────────────────────────────────────────────────
  {
    id: 'c-online-ou-interaction-design', slug: 'ou-an-introduction-to-interaction-design', category: 'ui-ux',
    title: 'An introduction to interaction design', provider: 'The Open University (OpenLearn)', instructor: null, url: 'https://www.open.edu/openlearn/science-maths-technology/an-introduction-interaction-design/content-section-overview',
    level: 'intermediate', levelBasis: 'The page labels it “Level 2: Intermediate”.', certificate: 'FREE',
    durationText: l('10 soatlik öqiş', '10 часов обучения', '10 hours of study'),
    summary: l('The Open University’dan ilovalar va veb-saytlar kabi interaktiv mahsulotlarni loyihalaşga bepul 10 soatlik kiriş.', 'Бесплатное 10-часовое введение в проектирование интерактивных продуктов от The Open University.', 'A free 10-hour introduction to designing interactive products, from The Open University.'),
    description: l(
      'Tört bölim: interaksiya dizayni nima, foydalanuvçiga yönaltirilgan dizayn maqsadlari va tamoyillari, dizayn kontekstidagi “kim, qayerda va nima”, hamda interaksiya dizayni faoliyatlari va usullari. OU’ning TM356 moduli asosidagi moslaştirilgan parça. Yakunlaganda bepul iştirok töğrisidagi bayonot beriladi.',
      'Четыре раздела: что такое проектирование взаимодействия, цели и принципы пользовательно-ориентированного дизайна, «кто, где и что» в контексте дизайна, а также активности и методы проектирования взаимодействия. Адаптированный фрагмент модуля OU TM356. По завершении выдаётся бесплатное заявление об участии.',
      'Four sections: what interaction design is, the goals and principles of user-centred design, the “who, where and what” of the design context, and interaction design activities and methods. It is an adapted extract of the OU module TM356. Completion earns a free statement of participation.',
    ),
    curriculum: ['What is interaction design', 'Goals and principles of user-centred design', 'The ‘who, where and what’ of the design context', 'Interaction design activities and methods'],
    source: { verifiedOn: VERIFIED, note: 'OpenLearn: free to enrol; 10 hours; Level 2 Intermediate; free statement of participation on completion.' },
  },
  {
    id: 'c-online-figma-getting-started', slug: 'figma-getting-started-in-design', category: 'ui-ux',
    title: 'Getting started in design', provider: 'Figma', instructor: null, url: 'https://www.figma.com/resource-library/getting-started-in-design/',
    level: 'beginner', levelBasis: 'Titled “Getting started”; the page frames it as an introduction.', certificate: 'NONE',
    durationText: null,
    summary: l('Figma’ning raqamli dizaynga bepul, öz tezligingizda ötiladigan kirişi.', 'Бесплатное введение Figma в цифровой дизайн в собственном темпе.', 'Figma’s free self-paced introduction to digital design.'),
    description: l(
      'Mavzular: UI dizayn, prototiplaş, dizayn tizimlari va sxematik maketlar. Sahifa kursni hafta oxirida şoşilib ötmaslikni, dizayn maşqlarini bosqiç sifatida işlatişni maslahat beradi. Sertifikat tilga olinmagan.',
      'Темы: UI-дизайн, прототипирование, дизайн-системы и вайрфреймы. Страница советует не проходить курс за выходные, а использовать дизайн-упражнения как этапы. О сертификате не упоминается.',
      'Lesson areas: UI design, prototyping, design systems and wireframing. The page advises against rushing it in a weekend and suggests using the design exercises as milestones. It mentions no certificate.',
    ),
    curriculum: ['UI design', 'Prototyping', 'Design systems', 'Wireframing'],
    source: { verifiedOn: VERIFIED, note: 'Figma resource library page: described as a free course; four lesson areas; no duration or certificate stated.' },
  },

  // ── Graphic Design ──────────────────────────────────────────────────────
  {
    id: 'c-online-calarts-graphic-design', slug: 'calarts-fundamentals-of-graphic-design', category: 'graphic-design',
    title: 'Fundamentals of Graphic Design', provider: 'CalArts on Coursera', instructor: 'Michael Worthington', url: 'https://www.coursera.org/learn/fundamentals-of-graphic-design',
    level: 'beginner', levelBasis: 'The page labels it Beginner with no prior experience required.', certificate: 'PAID',
    durationText: l('taxminan 8 soat (kurs sarlavhasiga köra)', 'около 8 часов (по заголовку курса)', 'about 8 hours (per the course header)'),
    summary: l('CalArts’ning vizual kommunikatsiya asoslari böyiça boşlovçilar uçun Coursera kursi.', 'Курс CalArts на Coursera для начинающих об основах визуальной коммуникации.', 'CalArts’ beginner course on the basics of visual communication, on Coursera.'),
    description: l(
      'Tört modul: tasvir yaratiş va vizual kommunikatsiya, tipografiya va harf anatomiyasi, şakl va rang nazariyasi, kompozitsiya va vizual iyerarxiya. Dasturlar emas, tamoyillar örgatiladi. Röyxatdan ötiş bepul; baholanadigan topşiriqlar va sertifikat Coursera’ning pullik sertifikat imkoniyatini talab qiladi.',
      'Четыре модуля: создание изображений и визуальная коммуникация, типографика и анатомия букв, форма и теория цвета, композиция и визуальная иерархия. Учат принципам, а не программам. Запись бесплатна; оцениваемые задания и сертификат требуют платной опции Certificate на Coursera.',
      'Four modules: imagemaking and visual communication, typography and letterform anatomy, shape and colour theory, composition and visual hierarchy. It teaches principles rather than software. Enrolling is free; graded assignments and the shareable certificate need Coursera’s paid Certificate option.',
    ),
    curriculum: ['Imagemaking and Visual Communication', 'Typography and Letterform Anatomy', 'Shape and Color Theory', 'Composition and Visual Hierarchy'],
    source: { verifiedOn: VERIFIED, note: 'Coursera page: “Enroll for free”; assignments and certificate need the purchased Certificate experience; the page gives inconsistent hour figures, so the header value is quoted.' },
  },
  {
    id: 'c-online-calarts-typography', slug: 'calarts-introduction-to-typography', category: 'graphic-design',
    title: 'Introduction to Typography', provider: 'CalArts on Coursera', instructor: 'Anther Kiley', url: 'https://www.coursera.org/learn/typography',
    level: 'beginner', levelBasis: 'The page labels it Beginner.', certificate: 'PAID',
    durationText: null,
    summary: l('CalArts’ning tipografiya böyiça boşlovçilar uçun Coursera kursi.', 'Курс CalArts на Coursera для начинающих по типографике.', 'CalArts’ beginner course on typography, on Coursera.'),
    description: l(
      'Tört haftalik blok: anatomiya va ölçamlar, tarixiy kontekst va tasnif, modul töri tizimlari va iyerarxiya, ekspressiv tipografiya va plakat dizayni; sakkizta topşiriq bor. Röyxatdan ötiş bepul; topşiriqlar va sertifikat Coursera’ning pullik sertifikat imkoniyatini talab qiladi.',
      'Четыре недельных блока: анатомия и метрики, исторический контекст и классификация, модульные сетки и иерархия, выразительная типографика и дизайн плаката; восемь заданий. Запись бесплатна; задания и сертификат требуют платной опции Certificate на Coursera.',
      'Four weekly units: anatomy and metrics, historical context and classification, grid systems and hierarchy, expressive typography and poster design, with eight assignments. Enrolling is free; assignments and the shareable certificate need Coursera’s paid Certificate option.',
    ),
    curriculum: ['Week 1: Anatomy & Metrics', 'Week 2: Historical Context & Classification', 'Week 3: Grid Systems & Typographic Hierarchy', 'Week 4: Expressive Typography & Poster Design'],
    source: { verifiedOn: VERIFIED, note: 'Coursera page: “Enroll for free”; assignments and certificate need the purchased Certificate experience; its duration figures are inconsistent, so none is shown.' },
  },

  // ── English ─────────────────────────────────────────────────────────────
  {
    id: 'c-online-ou-english-skills', slug: 'ou-english-skills-for-learning', category: 'english',
    title: 'English: skills for learning', provider: 'The Open University (OpenLearn)', instructor: 'Anna Calvi', url: 'https://www.open.edu/openlearn/education-development/english-skills-learning',
    level: 'beginner', levelBasis: 'The page labels it “Level 1: Introductory”.', certificate: 'FREE',
    durationText: l('taxminan 8 hafta, haftasiga taxminan 3 soat', 'около 8 недель по примерно 3 часа в неделю', 'about 8 weeks at roughly 3 hours a week'),
    summary: l('The Open University’ning akademik öqiş va yoziş böyiça bepul kiriş kursi.', 'Бесплатный вводный курс The Open University по академическому чтению и письму.', 'The Open University’s free introductory course on academic reading and writing.'),
    description: l(
      'Taxminan sakkiz hafta, haftasiga uç soat: faol öqiş, manbalardan yozuvda foydalaniş, topşiriqlar va esse yoziş, ğoyalarni boğlaş, akademik uslub, luğat va gap tuzilişi. Yakunlaganda bepul iştirok töğrisidagi bayonot va OU raqamli nişoni beriladi (nişon OU tomonidan akkreditatsiya qilinmagan).',
      'Около восьми недель по три часа: активное чтение, использование источников в письме, задания и эссе, связность, академический стиль, лексика и построение предложений. По завершении выдаются бесплатное заявление об участии и цифровой значок OU (значок не аккредитован OU).',
      'About eight weeks at roughly three hours a week: active reading, using sources in your writing, assignments and essays, linking ideas, academic style, vocabulary and sentence structure. Completion earns a free statement of participation and an OU digital badge (the badge is not accredited by the OU).',
    ),
    curriculum: ['Week 1: Reading skills for university study', 'Week 2: Using ideas and information from your readings in your writing', 'Week 3: Writing university assignments', 'Week 4: Writing well-organised essays', 'Week 5: Linking ideas', 'Week 6: Understanding and using academic style', 'Week 7: Learning new specialised and academic vocabulary', 'Week 8: Structuring sentences and word groups'],
    source: { verifiedOn: VERIFIED, note: 'OpenLearn page: free, self-paced; about 8 weeks at 3 hours a week; Level 1 Introductory; free statement of participation and badge.' },
  },
  {
    id: 'c-online-ou-everyday-english-1', slug: 'ou-everyday-english-1', category: 'english',
    title: 'Everyday English 1', provider: 'The Open University (OpenLearn)', instructor: null, url: 'https://www.open.edu/openlearn/languages/everyday-english-1/content-section-overview',
    level: 'beginner', levelBasis: 'The page labels it “Level 1: Introductory”.', certificate: 'FREE',
    durationText: l('48 soatlik öqiş', '48 часов обучения', '48 hours of study'),
    summary: l('OU’ning kundalik ingliz tili böyiça bepul kursi: gapiriş, tinglaş, öqiş va yoziş.', 'Бесплатный курс OU по практическому английскому: говорение, аудирование, чтение и письмо.', 'A free Open University course on practical everyday English: speaking, listening, reading and writing.'),
    description: l(
      'Uçta maşğulotda 48 soatlik öqiş. U Uelsda mavjud rasmiy English Essential Skills 1-daraja malakasiga yaxşi tayyorgarlik böladi, ammo Angliyada qöllanadigan English Functional Skills 1-daraja dasturini töliq qamramaydi. Bepul iştirok töğrisidagi bayonot mavjud; jarayonni kuzatiş uçun röyxatdan ötiş kerak.',
      '48 часов обучения в трёх сессиях. Курс хорошо готовит к официальной квалификации English Essential Skills Level 1, доступной в Уэльсе, но не охватывает всю программу English Functional Skills Level 1, действующую в Англии. Доступно бесплатное заявление об участии; для отслеживания прогресса нужна регистрация.',
      '48 hours of study in three sessions. It is good preparation for the formal English Essential Skills Level 1 qualification available in Wales, but does not cover all of the English Functional Skills Level 1 curriculum used in England. A free statement of participation is available; signing up is needed to track progress.',
    ),
    curriculum: ['Session 1: Speaking and listening', 'Session 2: Reading', 'Session 3: Writing'],
    source: { verifiedOn: VERIFIED, note: 'OpenLearn page: free; 48 hours; Level 1 Introductory; free statement of participation; written by Bedford College Group with Middlesbrough College, West Herts College and the OU.' },
  },
  {
    id: 'c-online-ou-essay-report-writing', slug: 'ou-essay-and-report-writing-skills', category: 'english',
    title: 'Essay and report writing skills', provider: 'The Open University (OpenLearn)', instructor: null, url: 'https://www.open.edu/openlearn/education-development/essay-and-report-writing-skills/content-section-0',
    level: 'beginner', levelBasis: 'The page labels it “Level 1: Introductory”.', certificate: 'FREE',
    durationText: l('15 soatlik öqiş', '15 часов обучения', '15 hours of study'),
    summary: l('The Open University’ning esse va hisobot yoziş böyiça bepul kursi.', 'Бесплатный курс The Open University о том, как писать эссе и отчёты.', 'The Open University’s free course on writing essays and reports.'),
    description: l(
      'Yozma işning barça bosqiçlari: topşiriqni tuşuniş, tayyorgarlik, reja tuziş, qoralama yoziş, sayqallaş va öqituvçi fikrini tahlil qiliş. Kursni röyxatdan ötmasdan boşlaş mumkin; yakunlaganda bepul iştirok töğrisidagi bayonot beriladi. Bu IELTS kursi emas — ingliz tilida akademik yoziş könikmalari uçun.',
      'Все этапы письменной работы: понимание задания, подготовка, планирование, черновик, доработка и разбор замечаний преподавателя. Начать можно без регистрации; по завершении выдаётся бесплатное заявление об участии. Это не курс IELTS — он о навыках академического письма на английском.',
      'Every stage of a written assignment: understanding the task, preparation, planning, drafting, polishing and reflecting on tutor feedback. You can start without signing up; completion earns a free statement of participation. It is not an IELTS course — it builds academic writing skills in English.',
    ),
    curriculum: ['1 Good practice in writing', '2 Identifying key concerns', '3 The purpose of writing', '4 Understanding the task', '5 Preparation', '6 Planning', '7 Drafting', '8 Polishing', '9 Letting go', '10 Reflecting on tutor feedback', 'Conclusion'],
    source: { verifiedOn: VERIFIED_NOV, note: 'OpenLearn page: “Free course”; “15 hours study”; Level 1 Introductory; free statement of participation on completion; can be started without signing up; ten numbered sections and a conclusion.' },
  },
  {
    id: 'c-online-saylor-esl003', slug: 'saylor-esl003-upper-intermediate-english', category: 'english',
    title: 'ESL003: Upper-Intermediate English as a Second Language', provider: 'Saylor University', instructor: null, url: 'https://learn.saylor.org/course/esl003',
    level: 'intermediate', levelBasis: 'The page labels it “CEFR Level B2”.', certificate: 'FREE',
    durationText: l('14 soat', '14 часов', '14 hours'),
    summary: l('Saylor University’ning B2 darajadagi ingliz tili böyiça bepul kursi.', 'Бесплатный курс английского уровня B2 от Saylor University.', 'Saylor University’s free English course at CEFR level B2.'),
    description: l(
      'Tört bölim: til könikmalari, matnni tuşunib öqiş, öqiş orqali tilni yaxşilaş va öqiganlar asosida yoziş. Kurs va undagi barça materiallar bepul; öqituvçi va qat’iy jadval yöq. Yakuniy imtihonni kamida 70% bilan topşirganlarga bepul sertifikat beriladi; bölimlar va imtihon uçun bepul röyxatdan ötiş kerak.',
      'Четыре раздела: языковые навыки, чтение с пониманием, чтение для развития языка и письмо на основе прочитанного. Курс и все его материалы бесплатны; преподавателя и жёсткого расписания нет. Тем, кто сдаст итоговый экзамен не ниже чем на 70%, выдаётся бесплатный сертификат; для разделов и экзамена нужна бесплатная регистрация.',
      'Four units: language skills, reading to comprehend, reading to improve and reading to write. The course and everything linked in it are free, with no instructor or fixed schedule. A free certificate is awarded for at least 70% on the final exam; a free account is needed for the units and the exam.',
    ),
    curriculum: ['Unit 1: Language Skills', 'Unit 2: Reading to Comprehend', 'Unit 3: Reading to Improve', 'Unit 4: Reading to Write'],
    source: { verifiedOn: VERIFIED_NOV, note: 'Course page: “Time: 14 hours”, “Free Certificate”, “CEFR Level B2”. Syllabus page: the course is entirely free to enroll in and to access; a free final exam awards a completion certificate at 70% or more; the four units.' },
  },

  // ── Mathematics ─────────────────────────────────────────────────────────
  {
    id: 'c-online-mit-calculus', slug: 'mit-ocw-single-variable-calculus', category: 'math',
    title: 'Single Variable Calculus (MIT 18.01SC)', provider: 'MIT OpenCourseWare', instructor: 'David Jerison', url: 'https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/',
    level: 'intermediate', levelBasis: 'The page labels it Undergraduate.', certificate: 'NONE',
    durationText: null,
    summary: l('MIT OpenCourseWare’ning mustaqil örganiş uçun bir özgaruvçili matematik tahlil kursi.', 'Курс MIT OpenCourseWare для самостоятельного изучения матанализа одной переменной.', 'MIT OpenCourseWare’s self-study single-variable calculus course.'),
    description: l(
      'Differensiallaş va uning tatbiqlari, aniq integral, integrallaş usullari va çeksiz qatorlarga kiriş; ma’ruza va maşğulot videolari, masalalar, imtihonlar va yeçimlar bilan. MIT OpenCourseWare bepul va oçiq; kredit yoki sertifikat berilmaydi.',
      'Дифференцирование и его применения, определённый интеграл, методы интегрирования и введение в бесконечные ряды; с видео лекций и семинаров, задачами, экзаменами и решениями. MIT OpenCourseWare бесплатен и открыт; кредиты и сертификаты не выдаются.',
      'Differentiation and its applications, the definite integral, techniques of integration and an introduction to infinite series, with lecture and recitation videos, problem sets, exams and solutions. MIT OpenCourseWare is free and open; it does not give credit or certificates.',
    ),
    curriculum: ['Differentiation', 'Applications of Differentiation', 'The Definite Integral and its Applications', 'Techniques of Integration', 'Exploring the Infinite', 'Final Exam'],
    source: { verifiedOn: VERIFIED, note: 'Course page (units and level); price and “no credit or certificate” statements come from the OCW About page, which applies to the whole site.' },
  },
  {
    id: 'c-online-mit-linear-algebra', slug: 'mit-ocw-linear-algebra', category: 'math',
    title: 'Linear Algebra (MIT 18.06SC)', provider: 'MIT OpenCourseWare', instructor: 'Gilbert Strang', url: 'https://ocw.mit.edu/courses/18-06sc-linear-algebra-fall-2011/',
    level: 'intermediate', levelBasis: 'The page labels it Undergraduate.', certificate: 'NONE',
    durationText: null,
    summary: l('MIT OpenCourseWare’ning Gilbert Strang öqiydigan çiziqli algebra kursi.', 'Курс линейной алгебры MIT OpenCourseWare, который ведёт Гилберт Стрэнг.', 'MIT OpenCourseWare’s linear algebra course, taught by Gilbert Strang.'),
    description: l(
      'Uç bölim: Ax = b va törtta qism fazo; eng kiçik kvadratlar, determinantlar va xos qiymatlar; musbat aniq matritsalar va tatbiqlar — videolar, konspektlar, yeçimli masalalar va imtihonlar bilan. Bepul va oçiq; kredit yoki sertifikat berilmaydi.',
      'Три раздела: Ax = b и четыре подпространства; метод наименьших квадратов, определители и собственные значения; положительно определённые матрицы и применения — с видео, конспектами, задачами с решениями и экзаменами. Бесплатно и открыто; кредиты и сертификаты не выдаются.',
      'Three units: Ax = b and the four subspaces; least squares, determinants and eigenvalues; positive definite matrices and applications, with videos, notes, problem sets with solutions and exams. Free and open; no credit or certificates.',
    ),
    curriculum: ['Unit I: Ax = b and the Four Subspaces', 'Unit II: Least Squares, Determinants and Eigenvalues', 'Unit III: Positive Definite Matrices and Applications', 'Final Course Review'],
    source: { verifiedOn: VERIFIED, note: 'Course page (units and level); price and “no credit or certificate” statements come from the OCW About page, which applies to the whole site.' },
  },
  {
    id: 'c-online-khan-algebra-1', slug: 'khan-academy-algebra-1', category: 'math',
    title: 'Algebra 1', provider: 'Khan Academy', instructor: null, url: 'https://www.khanacademy.org/math/algebra',
    level: 'beginner', levelBasis: 'No level label on the page; it is the first algebra course and offers “Get ready for Algebra 1” to those who are not ready.', certificate: 'NONE',
    durationText: null,
    summary: l('Khan Academy’ning algebra asoslari böyiça bepul kursi; özbek tilidagi versiyasi ham bor.', 'Бесплатный курс Khan Academy по основам алгебры; есть версия на узбекском языке.', 'Khan Academy’s free course on the foundations of algebra; an Uzbek-language version exists.'),
    description: l(
      'Tenglama va tengsizliklar, çiziqli tenglamalar va grafiklar, tenglamalar sistemalari, funksiyalar, ketma-ketliklar, daraja va ildizlar, kvadrat funksiyalar: video darslar va maşqlar bilan. Khan Academy notijorat taşkilot, kurslari bepul; sahifada sertifikat tilga olinmagan. Kursning özbek tilidagi versiyasi uz.khanacademy.org saytida oçiladi.',
      'Уравнения и неравенства, линейные уравнения и графики, системы уравнений, функции, последовательности, степени и корни, квадратичные функции: с видеоуроками и упражнениями. Khan Academy — некоммерческая организация, её курсы бесплатны; о сертификате на странице не упоминается. Версия курса на узбекском языке открывается на uz.khanacademy.org.',
      'Equations and inequalities, linear equations and graphs, systems of equations, functions, sequences, exponents and radicals, and quadratic functions, with video lessons and practice. Khan Academy is a nonprofit and its courses are free; the page mentions no certificate. An Uzbek-language version of the course opens at uz.khanacademy.org.',
    ),
    curriculum: ['Algebra foundations', 'Solving equations & inequalities', 'Working with units', 'Linear equations & graphs', 'Forms of linear equations', 'Systems of equations', 'Inequalities (systems & graphs)', 'Functions', 'Sequences', 'Absolute value & piecewise functions', 'Exponents & radicals', 'Exponential growth & decay', 'Quadratics: Multiplying & factoring', 'Quadratic functions & equations', 'Irrational numbers', 'Creativity in algebra'],
    source: { verifiedOn: VERIFIED_NOV, note: 'Khan Academy’s page footer: “Our mission is to provide a free, world-class education to anyone, anywhere”; the page mentions no certificate. The page lists 17 units (the last is “Teacher resources”, not listed here). The Uzbek version (uz.khanacademy.org/math/algebra, “Algebra I”, 17 boʻlim) loaded the same day.' },
  },
  {
    id: 'c-online-khan-precalculus', slug: 'khan-academy-precalculus', category: 'math',
    title: 'Precalculus', provider: 'Khan Academy', instructor: null, url: 'https://www.khanacademy.org/math/precalculus',
    level: 'intermediate', levelBasis: 'No level label on the page; it offers “Get ready for Precalculus” to those who are not ready, so it is placed above the introductory algebra course.', certificate: 'NONE',
    durationText: null,
    summary: l('Khan Academy’ning matematik tahlilga tayyorlovçi bepul kursi; özbek tilidagi versiyasi ham bor.', 'Бесплатный курс Khan Academy, готовящий к математическому анализу; есть версия на узбекском языке.', 'Khan Academy’s free course that prepares for calculus; an Uzbek-language version exists.'),
    description: l(
      'Ön bölim: murakkab va teskari funksiyalar, trigonometriya, kompleks sonlar, ratsional funksiyalar, konus kesimlari, vektorlar, matritsalar, ehtimollik va kombinatorika, qatorlar, funksiyaning çegaraviy qiymati va uzluksizlik. Kurs bepul; sahifada sertifikat tilga olinmagan. Özbek tilidagi versiyasi («Matematik analiz asoslari») uz.khanacademy.org saytida oçiladi va unda bölimlar kamroq.',
      'Десять разделов: сложные и обратные функции, тригонометрия, комплексные числа, рациональные функции, конические сечения, векторы, матрицы, вероятность и комбинаторика, ряды, пределы и непрерывность. Курс бесплатный; о сертификате на странице не упоминается. Версия на узбекском языке («Matematik analiz asoslari») открывается на uz.khanacademy.org, разделов в ней меньше.',
      'Ten units: composite and inverse functions, trigonometry, complex numbers, rational functions, conic sections, vectors, matrices, probability and combinatorics, series, and limits and continuity. The course is free; the page mentions no certificate. The Uzbek-language version (“Matematik analiz asoslari”) opens at uz.khanacademy.org and has fewer units.',
    ),
    curriculum: ['Composite and inverse functions', 'Trigonometry', 'Complex numbers', 'Rational functions', 'Conic sections', 'Vectors', 'Matrices', 'Probability and combinatorics', 'Series', 'Limits and continuity'],
    source: { verifiedOn: VERIFIED_NOV, note: 'Khan Academy’s page footer: “Our mission is to provide a free, world-class education to anyone, anywhere”; the page mentions no certificate. The page shows 10 units. The Uzbek version (uz.khanacademy.org/math/precalculus, “Matematik analiz asoslari”, 7 boʻlim) loaded the same day.' },
  },
  {
    id: 'c-online-ou-maths-science-technology', slug: 'ou-mathematics-for-science-and-technology', category: 'math',
    title: 'Mathematics for science and technology', provider: 'The Open University (OpenLearn)', instructor: null, url: 'https://www.open.edu/openlearn/science-maths-technology/mathematics-science-and-technology/content-section-overview',
    level: 'beginner', levelBasis: 'The page labels it “Level 1: Introductory”.', certificate: 'FREE',
    durationText: l('24 soatlik öqiş', '24 часа обучения', '24 hours of study'),
    summary: l('The Open University’ning fan va texnika uçun zarur matematika böyiça bepul kursi.', 'Бесплатный курс The Open University по математике для естественных наук и техники.', 'The Open University’s free course on the mathematics needed for science and technology.'),
    description: l(
      'Sakkiz hafta: darajalar va ilmiy yozuv, ölçovlar, algebraga kiriş, trigonometriya, logarifmlar, ehtimollik va statistika. Kursni röyxatdan ötmasdan boşlaş mumkin; yakunlaganda bepul iştirok töğrisidagi bayonot va OU raqamli nişoni beriladi (nişon OU tomonidan akkreditatsiya qilinmagan).',
      'Восемь недель: степени и научная запись чисел, измерения, введение в алгебру, тригонометрия, логарифмы, вероятность и статистика. Начать можно без регистрации; по завершении выдаются бесплатное заявление об участии и цифровой значок OU (значок не аккредитован OU).',
      'Eight weeks: powers and scientific notation, measurements, an introduction to algebra, trigonometry, logarithms, probability and statistics. You can start without signing up; completion earns a free statement of participation and an OU digital badge (the badge is not accredited by the OU).',
    ),
    curriculum: ['Introduction and guidance', 'Week 1: Powers and scientific notation', 'Week 2: Measurements', 'Week 3: Introduction to algebra', 'Week 4: Starting with trigonometry', 'Week 5: Logarithms', 'Week 6: Probability', 'Week 7: Statistics and repeated measurements', 'Week 8: Statistics and sampling'],
    source: { verifiedOn: VERIFIED_NOV, note: 'OpenLearn page: “Free course”; “24 hours study”; Level 1 Introductory; free statement of participation on completion and a digital badge; can be started without signing up; eight weeks.' },
  },

  // ── Natural sciences ────────────────────────────────────────────────────
  {
    id: 'c-online-mit-classical-mechanics', slug: 'mit-ocw-classical-mechanics', category: 'sciences',
    title: 'Classical Mechanics (MIT 8.01SC)', provider: 'MIT OpenCourseWare', instructor: 'Deepto Chakrabarty, Peter Dourmashkin, Michelle Tomasik, Anna Frebel, Vladan Vuletic', url: 'https://ocw.mit.edu/courses/8-01sc-classical-mechanics-fall-2016/',
    level: 'intermediate', levelBasis: 'The page labels it Undergraduate; the syllabus names no prerequisites and 18.01SC Single Variable Calculus as a corequisite.', certificate: 'NONE',
    durationText: l('12 haftaga bölingan', 'разбит на 12 недель', 'organised in twelve weeks'),
    summary: l('MIT OpenCourseWare’ning mustaqil örganiş uçun klassik mexanika kursi.', 'Курс MIT OpenCourseWare по классической механике для самостоятельного изучения.', 'MIT OpenCourseWare’s self-study course in classical mechanics.'),
    description: l(
      'Ön ikki hafta: kinematika, Nyuton qonunlari, aylanma harakat, impuls, iş va energiya, töqnaşuvlar nazariyasi, aylanma harakat dinamikasi va burçak momenti. Kurs matematik tahlilga tayanadi: 18.01SC kursini parallel öqiş tavsiya etiladi. MIT OpenCourseWare bepul va oçiq; kredit yoki sertifikat berilmaydi.',
      'Двенадцать недель: кинематика, законы Ньютона, движение по окружности, импульс, работа и энергия, теория столкновений, вращательное движение и момент импульса. Курс опирается на математический анализ: параллельно рекомендуется проходить 18.01SC. MIT OpenCourseWare бесплатен и открыт; кредиты и сертификаты не выдаются.',
      'Twelve weeks: kinematics, Newton’s laws, circular motion, momentum, work and energy, collision theory, rotational motion and angular momentum. The course is calculus-based: 18.01SC is its corequisite. MIT OpenCourseWare is free and open; it does not give credit or certificates.',
    ),
    curriculum: ['Review: Vectors', 'Week 1: Kinematics', "Week 2: Newton's Laws", 'Week 3: Circular Motion', 'Week 4: Drag Forces, Constraints and Continuous Systems', 'Week 5: Momentum and Impulse', 'Week 6: Continuous Mass Transfer', 'Week 7: Kinetic Energy and Work', 'Week 8: Potential Energy and Energy Conservation', 'Week 9: Collision Theory', 'Week 10: Rotational Motion', 'Week 11: Angular Momentum', 'Week 12: Rotations and Translation - Rolling'],
    source: { verifiedOn: VERIFIED_NOV, note: 'Course page (8.01SC, Fall 2016, Undergraduate, instructors, weeks); syllabus page (no prerequisites, 18.01SC corequisite, twelve weeks); price and “no credit or certification” statements come from the OCW About page, which applies to the whole site.' },
  },
  {
    id: 'c-online-khan-ap-physics-1', slug: 'khan-academy-ap-college-physics-1', category: 'sciences',
    title: 'AP®/College Physics 1', provider: 'Khan Academy', instructor: null, url: 'https://www.khanacademy.org/science/ap-college-physics-1',
    level: 'intermediate', levelBasis: 'No separate level label on the page; the title places it at AP and college level.', certificate: 'NONE',
    durationText: null,
    summary: l('Khan Academy’ning mexanika böyiça bepul fizika kursi.', 'Бесплатный курс физики Khan Academy по механике.', 'Khan Academy’s free physics course on mechanics.'),
    description: l(
      'Töqqiz bölim: kinematika, kuç va ilgarilanma harakat dinamikasi, iş, energiya va quvvat, impuls, aylanma harakat, tebranişlar va suyuqliklar. Kurs AQŞning AP Physics 1 imtihoniga moslangan, oxirgi bölim — imtihonga takrorlaş. Kurs bepul; sahifada sertifikat tilga olinmagan.',
      'Девять разделов: кинематика, сила и динамика поступательного движения, работа, энергия и мощность, импульс, вращательное движение, колебания и жидкости. Курс построен по программе американского экзамена AP Physics 1, последний раздел — повторение к экзамену. Курс бесплатный; о сертификате на странице не упоминается.',
      'Nine units: kinematics, force and translational dynamics, work, energy and power, linear momentum, rotational motion, oscillations and fluids. The course follows the US AP Physics 1 exam and its last unit is exam review. It is free; the page mentions no certificate.',
    ),
    curriculum: ['Kinematics', 'Force and translational dynamics', 'Work, energy, and power', 'Linear momentum', 'Torque and rotational dynamics', 'Energy and momentum of rotating systems', 'Oscillations', 'Fluids', 'AP Physics 1 review'],
    source: { verifiedOn: VERIFIED_NOV, note: 'Khan Academy’s page footer: “Our mission is to provide a free, world-class education to anyone, anywhere”; the page mentions no certificate. The page shows 9 units.' },
  },
  {
    id: 'c-online-mit-chemical-science', slug: 'mit-ocw-principles-of-chemical-science', category: 'sciences',
    title: 'Principles of Chemical Science (MIT 5.111SC)', provider: 'MIT OpenCourseWare', instructor: 'Catherine Drennan', url: 'https://ocw.mit.edu/courses/5-111sc-principles-of-chemical-science-fall-2014/',
    level: 'intermediate', levelBasis: 'The page labels it Undergraduate and names one year of high school chemistry as the expected background.', certificate: 'NONE',
    durationText: l('taxminan 150 soat', 'около 150 часов', 'about 150 hours'),
    summary: l('MIT OpenCourseWare’ning umumiy kimyo asoslari böyiça mustaqil örganiş kursi.', 'Курс MIT OpenCourseWare по основам общей химии для самостоятельного изучения.', 'MIT OpenCourseWare’s self-study course on the principles of general chemistry.'),
    description: l(
      'Beş bölim: atom tuzilişi, kimyoviy boğlaniş va molekulalar tuzilişi, termodinamika va kimyoviy muvozanat, ötiş metallari va oksidlaniş-qaytariliş reaksiyalari, kimyoviy kinetika. Kutilgan tayyorgarlik — maktabda bir yillik kimyo. MIT OpenCourseWare bepul va oçiq; kredit yoki sertifikat berilmaydi.',
      'Пять разделов: строение атома, химическая связь и строение молекул, термодинамика и химическое равновесие, переходные металлы и окислительно-восстановительные реакции, химическая кинетика. Ожидаемая подготовка — год школьной химии. MIT OpenCourseWare бесплатен и открыт; кредиты и сертификаты не выдаются.',
      'Five units: the atom, chemical bonding and structure, thermodynamics and chemical equilibrium, transition metals and oxidation-reduction reactions, and chemical kinetics. One year of high school chemistry is the expected background. MIT OpenCourseWare is free and open; it does not give credit or certificates.',
    ),
    curriculum: ['Unit I: The Atom', 'Unit II: Chemical Bonding & Structure', 'Unit III: Thermodynamics & Chemical Equilibrium', 'Unit IV: Transition Metals & Oxidation-Reduction Reactions', 'Unit V: Chemical Kinetics'],
    source: { verifiedOn: VERIFIED_NOV, note: 'Course page (5.111SC, Fall 2014, Undergraduate, instructor, the five units, which the page prints in capitals); syllabus page (no formal prerequisites, about 150 hours); price and “no credit or certification” statements come from the OCW About page, which applies to the whole site.' },
  },
  {
    id: 'c-online-mit-biology', slug: 'mit-ocw-fundamentals-of-biology', category: 'sciences',
    title: 'Fundamentals of Biology (MIT 7.01SC)', provider: 'MIT OpenCourseWare', instructor: 'Eric Lander, Robert Weinberg, Tyler Jacks, Hazel Sive, Graham Walker, Sallie Chisholm, Michelle Mischke', url: 'https://ocw.mit.edu/courses/7-01sc-fundamentals-of-biology-fall-2011/',
    level: 'intermediate', levelBasis: 'The page labels it Undergraduate; the syllabus names no formal prerequisites.', certificate: 'NONE',
    durationText: l('taxminan 150 soat', 'около 150 часов', 'about 150 hours'),
    summary: l('MIT OpenCourseWare’ning biologiya asoslari böyiça mustaqil örganiş kursi.', 'Курс MIT OpenCourseWare по основам биологии для самостоятельного изучения.', 'MIT OpenCourseWare’s self-study course on the fundamentals of biology.'),
    description: l(
      'Tört bölim: bioximiya, molekulyar biologiya, genetika va rekombinant DNK. Kurs mustaqil örganiş uçun tuzilgan; rasmiy dastlabki talablar yöq. MIT OpenCourseWare bepul va oçiq; kredit yoki sertifikat berilmaydi.',
      'Четыре раздела: биохимия, молекулярная биология, генетика и рекомбинантная ДНК. Курс составлен для самостоятельного изучения; формальных требований к подготовке нет. MIT OpenCourseWare бесплатен и открыт; кредиты и сертификаты не выдаются.',
      'Four units: biochemistry, molecular biology, genetics and recombinant DNA. The course is designed for independent study and has no formal prerequisites. MIT OpenCourseWare is free and open; it does not give credit or certificates.',
    ),
    curriculum: ['Biochemistry', 'Molecular Biology', 'Genetics', 'Recombinant DNA'],
    source: { verifiedOn: VERIFIED_NOV, note: 'Course page (7.01SC, Fall 2011, Undergraduate, instructors, four units, designed for independent study); syllabus page (no formal prerequisites, about 150 hours); price and “no credit or certification” statements come from the OCW About page, which applies to the whole site.' },
  },

  // ── Computer science ────────────────────────────────────────────────────
  {
    id: 'c-online-cs50x', slug: 'cs50-introduction-to-computer-science', category: 'it',
    title: 'CS50’s Introduction to Computer Science', provider: 'Harvard CS50 (OpenCourseWare)', instructor: 'David J. Malan', url: 'https://cs50.harvard.edu/x/',
    level: 'beginner', levelBasis: 'The page says it is for students with or without prior programming experience.', certificate: 'FREE',
    durationText: l('11 haftalik material', '11 недель материала', '11 weeks of material'),
    summary: l('Harvardning CS50 jamoasidan kompyuter fanlariga kiriş kursi.', 'Вводный курс по информатике от команды CS50 Гарварда.', 'Harvard CS50’s introduction to computer science.'),
    description: l(
      'Ön bir haftalik material: Scratch, C, massivlar, algoritmlar, xotira, ma’lumotlar tuzilmalari, Python, SQL, HTML, CSS, JavaScript va Flask; oxirida yakuniy loyiha. Dasturlaş tajribasi şart emas. Kursni CS50 saytida bepul öqiş mumkin. Har bir topşiriq va yakuniy loyihadan kamida 70% olganlarga bepul CS50 sertifikati beriladi; edX’ning tasdiqlangan sertifikati alohida va pullik.',
      'Одиннадцать недель материала: Scratch, C, массивы, алгоритмы, память, структуры данных, Python, SQL, HTML, CSS, JavaScript и Flask; в конце итоговый проект. Опыт программирования не обязателен. Курс можно бесплатно пройти на сайте CS50. Тем, кто наберёт не менее 70% за каждое задание и итоговый проект, выдаётся бесплатный сертификат CS50; подтверждённый сертификат edX — отдельный и платный.',
      'Eleven weeks of material: Scratch, C, arrays, algorithms, memory, data structures, Python, SQL, HTML, CSS, JavaScript and Flask, ending with a final project. No programming experience is needed. Anyone can follow it free on the CS50 site. Scoring at least 70% on each problem set and the final project earns a free CS50 Certificate; the verified certificate from edX is separate and paid.',
    ),
    curriculum: ['Week 0 Scratch', 'Week 1 C', 'Week 2 Arrays', 'Week 3 Algorithms', 'Week 4 Memory', 'Week 5 Data Structures', 'Week 6 Python', 'Week 7 SQL', 'Artificial Intelligence', 'Week 8 HTML, CSS, JavaScript', 'Week 9 Flask', 'Week 10 The End', 'Final Project'],
    source: { verifiedOn: VERIFIED_NOV, note: 'cs50.harvard.edu/x and /x/certificate/: free via OpenCourseWare (“CS50x is free to take”); eleven weeks of material; a free CS50 Certificate for at least 70% on each problem set and the final project; an edX verified certificate is offered separately. The address stays the same while the edition changes each year (CS50x 2026 on the day it was read).' },
  },

  // ── Economics ───────────────────────────────────────────────────────────
  {
    id: 'c-online-mit-microeconomics', slug: 'mit-ocw-principles-of-microeconomics', category: 'economics',
    title: 'Principles of Microeconomics (MIT 14.01SC)', provider: 'MIT OpenCourseWare', instructor: 'Jonathan Gruber', url: 'https://ocw.mit.edu/courses/14-01sc-principles-of-microeconomics-fall-2011/',
    level: 'intermediate', levelBasis: 'The page labels it Undergraduate and calls it an introductory undergraduate course; the syllabus asks for basic single-variable calculus.', certificate: 'NONE',
    durationText: null,
    summary: l('MIT OpenCourseWare’ning mikroiqtisodiyot asoslari böyiça mustaqil örganiş kursi.', 'Курс MIT OpenCourseWare по основам микроэкономики для самостоятельного изучения.', 'MIT OpenCourseWare’s self-study course on the principles of microeconomics.'),
    description: l(
      'Yetti bölim: talab va taklif, iste’molçi nazariyasi, işlab çiqaruvçi nazariyasi, farovonlik iqtisodiyoti, monopoliya va oligopoliya, tenglik va samaradorlik. Bir özgaruvçili matematik tahlil asoslari kerak böladi. MIT OpenCourseWare bepul va oçiq; kredit yoki sertifikat berilmaydi.',
      'Семь разделов: спрос и предложение, теория потребителя, теория производителя, экономика благосостояния, монополия и олигополия, справедливость и эффективность. Понадобятся основы анализа функций одной переменной. MIT OpenCourseWare бесплатен и открыт; кредиты и сертификаты не выдаются.',
      'Seven units: supply and demand, consumer theory, producer theory, welfare economics, monopoly and oligopoly, and equity and efficiency. It uses some basic single-variable calculus. MIT OpenCourseWare is free and open; it does not give credit or certificates.',
    ),
    curriculum: ['Unit 1: Supply and Demand', 'Unit 2: Consumer Theory', 'Unit 3: Producer Theory', 'Unit 4: Welfare Economics', 'Unit 5: Monopoly and Oligopoly', 'Unit 6: Topics in Intermediate Microeconomics', 'Unit 7: Equity and Efficiency'],
    source: { verifiedOn: VERIFIED_NOV, note: 'Course page (14.01SC, Fall 2011, Undergraduate, instructor, seven units, designed for independent study); syllabus page (basic uni-variate calculus, no other prerequisites); price and “no credit or certification” statements come from the OCW About page, which applies to the whole site.' },
  },
  {
    id: 'c-online-khan-microeconomics', slug: 'khan-academy-microeconomics', category: 'economics',
    title: 'Microeconomics', provider: 'Khan Academy', instructor: null, url: 'https://www.khanacademy.org/economics-finance-domain/microeconomics',
    level: 'beginner', levelBasis: 'No level label and no prerequisites on the page; the first unit is “Basic economic concepts”.', certificate: 'NONE',
    durationText: null,
    summary: l('Khan Academy’ning mikroiqtisodiyot böyiça bepul kursi.', 'Бесплатный курс Khan Academy по микроэкономике.', 'Khan Academy’s free course on microeconomics.'),
    description: l(
      'Töqqiz bölim: asosiy iqtisodiy tuşunçalar, talab, taklif va bozor muvozanati, elastiklik, iste’molçi nazariyasi, işlab çiqariş qarorlari va foyda, raqobat şakllari, omillar bozori, bozor nosozliklari va davlatning roli. Kurs bepul; sahifada sertifikat tilga olinmagan.',
      'Девять разделов: базовые экономические понятия, спрос, предложение и рыночное равновесие, эластичность, теория потребителя, производственные решения и прибыль, формы конкуренции, рынки факторов производства, провалы рынка и роль государства. Курс бесплатный; о сертификате на странице не упоминается.',
      'Nine units: basic economic concepts, supply, demand and market equilibrium, elasticity, consumer theory, production decisions and economic profit, forms of competition, factor markets, and market failure and the role of government. The course is free; the page mentions no certificate.',
    ),
    curriculum: ['Basic economic concepts', 'Supply, demand, and market equilibrium', 'Elasticity', 'Consumer and producer surplus, market interventions, and international trade', 'Consumer theory', 'Production decisions and economic profit', 'Forms of competition', 'Factor markets', 'Market failure and the role of government'],
    source: { verifiedOn: VERIFIED_NOV, note: 'Khan Academy’s page footer: “Our mission is to provide a free, world-class education to anyone, anywhere”; the page mentions no certificate. The page shows 9 units.' },
  },
]
