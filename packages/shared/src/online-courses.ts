import type { CertificateKind, L, Level } from './types.js'

/**
 * The curated online catalog: real courses published by their providers, opened on the provider's own site.
 *
 * Every fact below was read from the course's own page and re-checked on 2026-10-31 (see `source`). Where a page did not state a
 * length, a level or a certificate, the field is left empty (`durationText: null`, certificate `NONE`) instead of
 * guessed. Titles, providers, instructors and curriculum items are the providers' own wording; the summaries and
 * descriptions are written in our own words, in three languages. Prices are not stored: online courses are free to take.
 * No provider images are used (their licences were not checked); cards use ILMORA's own category photographs.
 *
 * `levelBasis` records where the difficulty comes from, because most providers do not label one.
 */
export type OnlineCategorySlug = 'python' | 'frontend' | 'backend' | 'ai-ml' | 'ui-ux' | 'graphic-design' | 'english' | 'math'

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

/** Categories the online catalog adds. `english` and `math` already exist in the ILMORA seed and are reused by slug. */
export const ONLINE_CATEGORIES: { id: string; slug: OnlineCategorySlug; name: L; glyph: string; sortOrder: number }[] = [
  { id: 'cat-python', slug: 'python', name: l('Python', 'Python', 'Python'), glyph: 'Py', sortOrder: 8 },
  { id: 'cat-frontend', slug: 'frontend', name: l('Frontend', 'Frontend', 'Frontend'), glyph: '‹/›', sortOrder: 9 },
  { id: 'cat-backend', slug: 'backend', name: l('Backend', 'Backend', 'Backend'), glyph: '{ }', sortOrder: 10 },
  { id: 'cat-ai-ml', slug: 'ai-ml', name: l('Sun’iy intellekt va ML', 'ИИ и машинное обучение', 'AI & Machine Learning'), glyph: 'AI', sortOrder: 11 },
  { id: 'cat-ui-ux', slug: 'ui-ux', name: l('UI/UX dizayn', 'UI/UX-дизайн', 'UI/UX Design'), glyph: 'UX', sortOrder: 12 },
  { id: 'cat-graphic-design', slug: 'graphic-design', name: l('Grafik dizayn', 'Графический дизайн', 'Graphic Design'), glyph: '✎', sortOrder: 13 },
]

export const ONLINE_COURSES: OnlineCourseSeed[] = [
  // ── Python ──────────────────────────────────────────────────────────────
  {
    id: 'c-online-cs50p', slug: 'cs50-introduction-to-programming-with-python', category: 'python',
    title: 'CS50’s Introduction to Programming with Python', provider: 'Harvard CS50 (OpenCourseWare)', instructor: 'David J. Malan', url: 'https://cs50.harvard.edu/python/',
    level: 'beginner', levelBasis: 'Titled an introduction; the page lists no prerequisites.', certificate: 'FREE',
    durationText: l('10 haftalik material', '10 недель материала', '10 weeks of material'),
    summary: l('Harvardning CS50 jamoasidan Python dasturlashga kirish kursi.', 'Вводный курс по программированию на Python от команды CS50 Гарварда.', 'Harvard CS50’s introduction to programming with Python.'),
    description: l(
      'O‘n haftalik material: funksiyalar, shartlar, sikllar, istisnolar, kutubxonalar, unit-testlar, fayllar bilan ishlash, regulyar ifodalar va ob’ektga yo‘naltirilgan dasturlash. Kursni CS50 saytida bepul o‘qish mumkin. Har bir topshiriq va yakuniy loyihadan kamida 70% ball olsangiz, bepul CS50 sertifikati beriladi; edX orqali tasdiqlangan sertifikat ham taklif etiladi.',
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
    summary: l('Darslik, ma’ruzalar va avtomatik tekshiriladigan topshiriqlar bilan Python’ga bepul, ochiq kirish.', 'Бесплатное открытое введение в Python с учебником, лекциями и автопроверяемыми заданиями.', 'A free, open introduction to programming in Python with a textbook, lectures and auto-graded assignments.'),
    description: l(
      'Michigan universiteti professori Charles R. Severance yaratgan kurs: bepul kitob va video ma’ruzalar asosida. Saytda 17 ta dars bor — Python’ni o‘rnatishdan ro‘yxat, lug‘at, regulyar ifodalar, veb-xizmatlar va ma’lumotlar bazalari orqali ma’lumotlarni vizuallashtirishgacha; tizimga kirsangiz, baholar daftari va nishonlar mavjud. Bepul sertifikatlar sahifada faqat Michigan universiteti talabalari va xodimlari uchun tilga olingan.',
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
    summary: l('MDN’ning boshlovchidan frontend dasturchigacha tuzilgan o‘quv yo‘li.', 'Структурированный путь MDN от новичка до фронтенд-разработчика.', 'MDN’s structured path from complete beginner to front-end developer.'),
    description: l(
      'Asosiy modullar HTML, CSS (matn va maket), JavaScript, freymvorklar, qulaylik (accessibility), dasturchilar uchun dizayn va versiyalarni boshqarishni qamrab oladi; boshlang‘ich va kengaytirilgan modullar undan oldin va keyin keladi. MDN darsliklari ochiq; sahifada sertifikat tilga olinmagan.',
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
    summary: l('The Odin Project’ning birinchi kursi: Git, HTML, CSS, Flexbox va JavaScript asoslari.', 'Первый курс The Odin Project: Git, HTML, CSS, Flexbox и основы JavaScript.', 'The first course of The Odin Project: Git, HTML, CSS, Flexbox and JavaScript basics.'),
    description: l(
      'Amaliy, loyihalarga asoslangan boshlanish: sahifada 41 ta dars va beshta loyiha ko‘rsatilgan (retseptlar sahifasi, landing, tosh-qaychi-qog‘oz, Etch-a-Sketch, kalkulyator). The Odin Project ochiq kodli hamjamiyat tomonidan yuritiladi va yo‘lni bepul deb ta’riflaydi; kurs sahifasida sertifikat tilga olinmagan.',
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
    summary: l('Harvardning CS50 jamoasidan Python, JavaScript va SQL bilan veb-ilovalar yaratish kursi.', 'Курс CS50 Гарварда по созданию веб-приложений на Python, JavaScript и SQL.', 'Harvard CS50’s course on building web apps with Python, JavaScript and SQL.'),
    description: l(
      'To‘qqiz hafta va yakuniy loyiha: HTML/CSS, Git, Python, Django, SQL va migratsiyalar, JavaScript, interfeyslar, testlash va CI/CD, masshtablash va xavfsizlik. Oldindan CS50x yoki istalgan tilda dasturlash tajribasi kerak. CS50 saytida bepul. Har bir loyihadan, jumladan yakuniy loyihadan kamida 70% ball olsangiz, bepul CS50 sertifikati beriladi; edX tasdiqlangan sertifikati va kredit alohida taklif etiladi.',
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
    summary: l('MDN’ning Express va Node.js bilan server tomoni dasturlash bo‘yicha darsliklar turkumi.', 'Серия руководств MDN по серверной разработке на Express и Node.js.', 'MDN’s tutorial series on server-side development with Express and Node.js.'),
    description: l(
      'Qadam-baqadam “Local Library” veb-saytini yaratasiz: muhitni sozlash, marshrutlar va kontrollerlar, Mongoose orqali MongoDB, shakllar va ishga tushirish. Sahifa avval server tomoni dasturlashni va dasturlash/JavaScript asoslarini bilishni tavsiya qiladi; sertifikat tilga olinmagan.',
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
    summary: l('Dasturlay oladiganlar uchun fast.ai’ning bepul chuqur o‘rganish kursi.', 'Бесплатный курс fast.ai по глубокому обучению для тех, кто уже умеет программировать.', 'fast.ai’s free deep learning course for people who can already code.'),
    description: l(
      'To‘qqizta amaliy dars: modellarni o‘qitish va joylashtirish, neyron tarmoq asoslari, NLP, tasodifiy o‘rmonlar, hamkorlikdagi filtrlash, konvolyutsiyalar va ma’lumotlar etikasi bo‘yicha qo‘shimcha dars. Sahifa kamida bir yillik dasturlash (yaxshisi Python) va maktab matematikasini talab qiladi; bu Part 1, 2022 nashri. Sertifikat tilga olinmagan.',
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
    summary: l('Harvardning CS50 jamoasidan zamonaviy sun’iy intellekt g‘oyalari bo‘yicha Python kursi.', 'Курс CS50 Гарварда на Python об идеях, лежащих в основе современного ИИ.', 'Harvard CS50’s Python course on the ideas behind modern AI.'),
    description: l(
      'Yetti hafta: qidiruv, bilim, noaniqlik, optimallashtirish, o‘rganish, neyron tarmoqlar va til. Oldindan CS50x yoki kamida bir yillik Python tajribasi kerak. CS50 saytida bepul. Har bir loyihadan kamida 70% ball olsangiz, bepul CS50 sertifikati beriladi; edX tasdiqlangan sertifikati alohida taklif etiladi.',
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
    durationText: l('10 soatlik o‘qish', '10 часов обучения', '10 hours of study'),
    summary: l('The Open University’dan ilovalar va veb-saytlar kabi interaktiv mahsulotlarni loyihalashga bepul 10 soatlik kirish.', 'Бесплатное 10-часовое введение в проектирование интерактивных продуктов от The Open University.', 'A free 10-hour introduction to designing interactive products, from The Open University.'),
    description: l(
      'To‘rt bo‘lim: interaksiya dizayni nima, foydalanuvchiga yo‘naltirilgan dizayn maqsadlari va tamoyillari, dizayn kontekstidagi “kim, qayerda va nima”, hamda interaksiya dizayni faoliyatlari va usullari. OU’ning TM356 moduli asosidagi moslashtirilgan parcha. Yakunlaganda bepul ishtirok to‘g‘risidagi bayonot beriladi.',
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
    summary: l('Figma’ning raqamli dizaynga bepul, o‘z tezligingizda o‘tiladigan kirishi.', 'Бесплатное введение Figma в цифровой дизайн в собственном темпе.', 'Figma’s free self-paced introduction to digital design.'),
    description: l(
      'Mavzular: UI dizayn, prototiplash, dizayn tizimlari va sxematik maketlar. Sahifa kursni hafta oxirida shoshilib o‘tmaslikni, dizayn mashqlarini bosqich sifatida ishlatishni maslahat beradi. Sertifikat tilga olinmagan.',
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
    durationText: l('taxminan 8 soat (kurs sarlavhasiga ko‘ra)', 'около 8 часов (по заголовку курса)', 'about 8 hours (per the course header)'),
    summary: l('CalArts’ning vizual kommunikatsiya asoslari bo‘yicha boshlovchilar uchun Coursera kursi.', 'Курс CalArts на Coursera для начинающих об основах визуальной коммуникации.', 'CalArts’ beginner course on the basics of visual communication, on Coursera.'),
    description: l(
      'To‘rt modul: tasvir yaratish va vizual kommunikatsiya, tipografiya va harf anatomiyasi, shakl va rang nazariyasi, kompozitsiya va vizual iyerarxiya. Dasturlar emas, tamoyillar o‘rgatiladi. Ro‘yxatdan o‘tish bepul; baholanadigan topshiriqlar va sertifikat Coursera’ning pullik sertifikat imkoniyatini talab qiladi.',
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
    summary: l('CalArts’ning tipografiya bo‘yicha boshlovchilar uchun Coursera kursi.', 'Курс CalArts на Coursera для начинающих по типографике.', 'CalArts’ beginner course on typography, on Coursera.'),
    description: l(
      'To‘rt haftalik blok: anatomiya va o‘lchamlar, tarixiy kontekst va tasnif, modul to‘ri tizimlari va iyerarxiya, ekspressiv tipografiya va plakat dizayni; sakkizta topshiriq bor. Ro‘yxatdan o‘tish bepul; topshiriqlar va sertifikat Coursera’ning pullik sertifikat imkoniyatini talab qiladi.',
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
    summary: l('The Open University’ning akademik o‘qish va yozish bo‘yicha bepul kirish kursi.', 'Бесплатный вводный курс The Open University по академическому чтению и письму.', 'The Open University’s free introductory course on academic reading and writing.'),
    description: l(
      'Taxminan sakkiz hafta, haftasiga uch soat: faol o‘qish, manbalardan yozuvda foydalanish, topshiriqlar va esse yozish, g‘oyalarni bog‘lash, akademik uslub, lug‘at va gap tuzilishi. Yakunlaganda bepul ishtirok to‘g‘risidagi bayonot va OU raqamli nishoni beriladi (nishon OU tomonidan akkreditatsiya qilinmagan).',
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
    durationText: l('48 soatlik o‘qish', '48 часов обучения', '48 hours of study'),
    summary: l('OU’ning kundalik ingliz tili bo‘yicha bepul kursi: gapirish, tinglash, o‘qish va yozish.', 'Бесплатный курс OU по практическому английскому: говорение, аудирование, чтение и письмо.', 'A free Open University course on practical everyday English: speaking, listening, reading and writing.'),
    description: l(
      'Uchta mashg‘ulotda 48 soatlik o‘qish. U Uelsda mavjud rasmiy English Essential Skills 1-daraja malakasiga yaxshi tayyorgarlik bo‘ladi, ammo Angliyada qo‘llanadigan English Functional Skills 1-daraja dasturini to‘liq qamramaydi. Bepul ishtirok to‘g‘risidagi bayonot mavjud; jarayonni kuzatish uchun ro‘yxatdan o‘tish kerak.',
      '48 часов обучения в трёх сессиях. Курс хорошо готовит к официальной квалификации English Essential Skills Level 1, доступной в Уэльсе, но не охватывает всю программу English Functional Skills Level 1, действующую в Англии. Доступно бесплатное заявление об участии; для отслеживания прогресса нужна регистрация.',
      '48 hours of study in three sessions. It is good preparation for the formal English Essential Skills Level 1 qualification available in Wales, but does not cover all of the English Functional Skills Level 1 curriculum used in England. A free statement of participation is available; signing up is needed to track progress.',
    ),
    curriculum: ['Session 1: Speaking and listening', 'Session 2: Reading', 'Session 3: Writing'],
    source: { verifiedOn: VERIFIED, note: 'OpenLearn page: free; 48 hours; Level 1 Introductory; free statement of participation; written by Bedford College Group with Middlesbrough College, West Herts College and the OU.' },
  },

  // ── Mathematics ─────────────────────────────────────────────────────────
  {
    id: 'c-online-mit-calculus', slug: 'mit-ocw-single-variable-calculus', category: 'math',
    title: 'Single Variable Calculus (MIT 18.01SC)', provider: 'MIT OpenCourseWare', instructor: 'David Jerison', url: 'https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/',
    level: 'intermediate', levelBasis: 'The page labels it Undergraduate.', certificate: 'NONE',
    durationText: null,
    summary: l('MIT OpenCourseWare’ning mustaqil o‘rganish uchun bir o‘zgaruvchili matematik tahlil kursi.', 'Курс MIT OpenCourseWare для самостоятельного изучения матанализа одной переменной.', 'MIT OpenCourseWare’s self-study single-variable calculus course.'),
    description: l(
      'Differensiallash va uning tatbiqlari, aniq integral, integrallash usullari va cheksiz qatorlarga kirish; ma’ruza va mashg‘ulot videolari, masalalar, imtihonlar va yechimlar bilan. MIT OpenCourseWare bepul va ochiq; kredit yoki sertifikat berilmaydi.',
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
    summary: l('MIT OpenCourseWare’ning Gilbert Strang o‘qiydigan chiziqli algebra kursi.', 'Курс линейной алгебры MIT OpenCourseWare, который ведёт Гилберт Стрэнг.', 'MIT OpenCourseWare’s linear algebra course, taught by Gilbert Strang.'),
    description: l(
      'Uch bo‘lim: Ax = b va to‘rtta qism fazo; eng kichik kvadratlar, determinantlar va xos qiymatlar; musbat aniq matritsalar va tatbiqlar — videolar, konspektlar, yechimli masalalar va imtihonlar bilan. Bepul va ochiq; kredit yoki sertifikat berilmaydi.',
      'Три раздела: Ax = b и четыре подпространства; метод наименьших квадратов, определители и собственные значения; положительно определённые матрицы и применения — с видео, конспектами, задачами с решениями и экзаменами. Бесплатно и открыто; кредиты и сертификаты не выдаются.',
      'Three units: Ax = b and the four subspaces; least squares, determinants and eigenvalues; positive definite matrices and applications, with videos, notes, problem sets with solutions and exams. Free and open; no credit or certificates.',
    ),
    curriculum: ['Unit I: Ax = b and the Four Subspaces', 'Unit II: Least Squares, Determinants and Eigenvalues', 'Unit III: Positive Definite Matrices and Applications', 'Final Course Review'],
    source: { verifiedOn: VERIFIED, note: 'Course page (units and level); price and “no credit or certificate” statements come from the OCW About page, which applies to the whole site.' },
  },
]
