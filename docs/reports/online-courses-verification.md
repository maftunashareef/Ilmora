# Online courses: verification report

**Checked:** 31 October 2026 · **Scope:** the 16 free online courses in `packages/shared/src/online-courses.ts` (also in the local database).
**Result:** all 16 links work and every course exists on its provider's official page. No link needed replacing and no course was removed. Six records had details that did not match the provider page; they were corrected from the official pages (see "Corrections").

## How each course was checked

1. **Link:** requested the stored URL and recorded the HTTP status, redirects and page title. Three Open University pages answer automated requests with a Cloudflare check (HTTP 403, "Just a moment…"); they were opened in a normal browser instead, where they load without any challenge. No bot check was bypassed.
2. **Course and provider:** page title, provider and named instructor compared with the record.
3. **Curriculum:** every stored curriculum item searched for on the provider page (or its lessons/contents tab).
4. **Length and level:** stored length compared with the provider's own wording; levels follow the provider label where one exists (see `levelBasis`).
5. **Certificate:** the claim compared with what the provider page (and, for CS50, the course's own certificate page) says.
6. **New tab:** every external course link opens with `target="_blank"` and `rel="noopener noreferrer"` (see "Links in the app").

## Results

| # | Course | Provider | Link | Title, provider, instructor | Curriculum | Length | Certificate (stored → result) | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | CS50’s Introduction to Programming with Python | Harvard CS50 (OpenCourseWare) | 200, no redirect | Match (David J. Malan) | 10/10 | “10 weeks of material” ✓ | AVAILABLE → **FREE** | Verified, corrected |
| 2 | Python for Everybody (PY4E) | PY4E · University of Michigan | 200 | Match (Charles R. Severance) | all 17 lessons listed by their titles on /lessons ✓ | not stated (none stored) ✓ | NONE ✓ (see note) | Verified, description corrected |
| 3 | Learn web development | MDN Web Docs (Mozilla) | 200 | Match (no single instructor named) | 9/9 | not stated ✓ | NONE ✓ | Verified |
| 4 | Foundations (The Odin Project) | The Odin Project | 200 | Match (no single instructor named) | 8/8 | not stated ✓ | NONE ✓ | Verified |
| 5 | CS50’s Web Programming with Python and JavaScript | Harvard CS50 (OpenCourseWare) | 200 | Match (Brian Yu, David J. Malan) | 9/9 | “9 weeks + final project” ✓ | AVAILABLE → **FREE** | Verified, corrected |
| 6 | Express web framework (Node.js/JavaScript) | MDN Web Docs (Mozilla) | 200 | Match (no single instructor named) | 9/9 | not stated ✓ | NONE ✓ | Verified |
| 7 | Practical Deep Learning for Coders | fast.ai | 200 | Match (Jeremy Howard) | 9/9 | “9 lessons, each around 90 minutes” ✓ | NONE ✓ | Verified |
| 8 | CS50’s Introduction to Artificial Intelligence with Python | Harvard CS50 (OpenCourseWare) | 200 | Match (Brian Yu, David J. Malan) | 7/7 | “seven weeks of material” ✓ | PAID → **FREE** | Verified, corrected |
| 9 | An introduction to interaction design | The Open University (OpenLearn) | 403 to scripts, loads in a browser | Match | 4/4 | “10 hours study” ✓, Level 2 ✓ | FREE ✓ (statement of participation) | Verified, wording corrected |
| 10 | Getting started in design | Figma | 200 | Match (no instructor named) | 4/4 | not stated ✓ | NONE ✓ | Verified |
| 11 | Fundamentals of Graphic Design | CalArts on Coursera | 200 | Match (Michael Worthington) | 4/4 | “8 hours to complete” ✓ | PAID ✓ (“Shareable certificate” via paid option) | Verified |
| 12 | Introduction to Typography | CalArts on Coursera | 200 | Match (Anther Kiley) | 4/4 | none stored (see note) | PAID ✓ | Verified |
| 13 | English: skills for learning | The Open University (OpenLearn) | 403 to scripts, loads in a browser | Match (author Anna Calvi) | 8/8 | “about 8 weeks, approximately 3 hours each week” ✓, Level 1 ✓ | FREE ✓ (statement + unaccredited badge) | Verified |
| 14 | Everyday English 1 | The Open University (OpenLearn) | 403 to scripts, loads in a browser | Match (Bedford College Group and partners) | 3/3 | “48 hours study” ✓, Level 1 ✓ | FREE ✓ (statement of participation) | Verified, description corrected |
| 15 | Single Variable Calculus (MIT 18.01SC) | MIT OpenCourseWare | 200 | Match (David Jerison) | 6/6 | not stated ✓ | NONE ✓ | Verified |
| 16 | Linear Algebra (MIT 18.06SC) | MIT OpenCourseWare | 200 | Match (Gilbert Strang) | 4/4 | not stated ✓ | NONE ✓ | Verified |

## Corrections (all from the official pages, 31 October 2026)

1. **CS50 Python, CS50 Web, CS50 AI — certificate.** Each course's own certificate page (`/python/certificate/`, `/web/certificate/`, `/ai/certificate/`) offers a **free CS50 Certificate** for scoring at least 70% on each problem/project (Python and Web: including the final project). An edX verified certificate is offered separately; the pages state no price for it.
   - Stored before: Python and Web “available, terms at the provider”; AI “paid”, and its description said certificates “cost extra”, which the pages do not say.
   - Now: certificate **FREE** for all three; the descriptions (uz/ru/en) state the free CS50 Certificate rule and the separate edX option, without a price.
2. **PY4E — description.** It said the 17 lessons run “from installing Python to lists and dictionaries”. The lessons page shows they continue through tuples, regular expressions, networking, web services, objects and databases to data visualisation. The description now says so.
3. **Everyday English 1 — description.** It said the course prepares for “Level 1 English qualifications (mainly Essential Skills Wales)”. The page says it is good preparation for the formal **English Essential Skills Level 1** qualification available in Wales and does not cover all of the English Functional Skills Level 1 curriculum used in England. The description now matches.
4. **An introduction to interaction design — curriculum.** Section 3 is written ‘who, where and what’ on the page (single quotes); the stored item used double quotes. Aligned with the provider’s wording.

All 16 records now carry `verifiedOn: 2026-10-31`.

## Notes (no change made)

- **PY4E certificate.** ILMORA shows “No certificate” for py4e.com. The site mentions free certificates only for University of Michigan students and staff and points to Coursera and edX versions of the course; the description already says this.
- **OpenLearn “certificates”.** The Open University issues a free *statement of participation* (and, for English: skills for learning, a digital badge it does not accredit). ILMORA’s “free certificate” label refers to that; the descriptions use the provider’s term.
- **Introduction to Typography length.** The header now reads “2 weeks at 10 hours a week” while the module times add up differently, so no length is shown (unchanged).
- **Instructors for MDN and The Odin Project** are descriptive (“MDN Web Docs contributors”, “The Odin Project community”); neither page names a single instructor.

## Links in the app

External course links open in a new tab with `rel="noopener noreferrer"` (previously `rel="noreferrer"`, which browsers already treat as no-opener). The change is in the shared `LinkButton` and the other `target="_blank"` links; a test (`apps/web/src/lib/external-links.test.ts`) fails if a new-tab link without it is added.

## For production

The corrected texts are in the data file. In production the Super Admin applies them in **Admin → Courses** for the six courses above (certificate type and descriptions); no script is run on deployment.

## Courses added on 19 November 2026

**Scope:** twelve more free courses, asked for by the owner: English, school and university mathematics, natural sciences, computer science and economics. The catalog now holds 28 courses.
**Result:** every page was opened that day and each stored fact was found on it. No IELTS course was added: each one found is paid, time-limited or tied to booking a test (FutureLearn/British Council "Understanding IELTS" is now a paid track with a two-day trial; the edX UQx audit track expires; IDP's course is free only with a test booking).

How they were checked: MIT OpenCourseWare, CS50 and Saylor pages answer plain requests, so the title, instructors, units and the wording about cost were searched for in the page text. Khan Academy and OpenLearn answer scripts with a challenge page (Khan: a JavaScript check; OpenLearn: Cloudflare, HTTP 403), so those were opened in a browser and read there.

| # | Course | Provider | Category | Level (basis) | Length | Certificate |
|---|---|---|---|---|---|---|
| 17 | Essay and report writing skills | The Open University (OpenLearn) | english | beginner (“Level 1: Introductory”) | “15 hours study” | FREE (free statement of participation) |
| 18 | ESL003: Upper-Intermediate English as a Second Language | Saylor University | english | intermediate (“CEFR Level B2”) | “Time: 14 hours” | FREE (“Free Certificate”, final exam at 70%) |
| 19 | Algebra 1 | Khan Academy | math | beginner (first algebra course) | not stated | NONE (none mentioned) |
| 20 | Precalculus | Khan Academy | math | intermediate (offers “Get ready for Precalculus”) | not stated | NONE |
| 21 | Mathematics for science and technology | The Open University (OpenLearn) | math | beginner (“Level 1: Introductory”) | “24 hours study” | FREE (free statement of participation, badge) |
| 22 | Classical Mechanics (MIT 8.01SC) | MIT OpenCourseWare | sciences | intermediate (Undergraduate) | twelve weeks (syllabus) | NONE |
| 23 | AP®/College Physics 1 | Khan Academy | sciences | intermediate (AP and college level) | not stated | NONE |
| 24 | Principles of Chemical Science (MIT 5.111SC) | MIT OpenCourseWare | sciences | intermediate (Undergraduate) | about 150 hours (syllabus) | NONE |
| 25 | Fundamentals of Biology (MIT 7.01SC) | MIT OpenCourseWare | sciences | intermediate (Undergraduate) | about 150 hours (syllabus) | NONE |
| 26 | CS50’s Introduction to Computer Science | Harvard CS50 (OpenCourseWare) | it | beginner (with or without prior experience) | “eleven weeks of material” | FREE (free CS50 Certificate at 70%) |
| 27 | Principles of Microeconomics (MIT 14.01SC) | MIT OpenCourseWare | economics | intermediate (Undergraduate) | not stated | NONE |
| 28 | Microeconomics | Khan Academy | economics | beginner (no prerequisites named) | not stated | NONE |

Notes:

- **MIT OpenCourseWare:** the About page says the collection is free and open and that MIT does not offer credit or certification to users of OCW.
- **Khan Academy:** the page footer states the mission of free education for anyone; no page mentions a certificate. Uzbek-language versions of Algebra 1 (“Algebra I”, 17 units) and Precalculus (“Matematik analiz asoslari”, 7 units) opened on uz.khanacademy.org and are mentioned in those two descriptions only.
- **CS50x:** the address stays the same while the edition changes each year (“CS50x 2026” that day).
- **New category:** `economics` (`cat-economics`). Natural sciences and computer science reuse the existing `sciences` and `it` categories.
- **Import:** `npm run db:seed:online` on a copy of the database added the 12 courses and refreshed the 16 existing ones; a second run added nothing.
