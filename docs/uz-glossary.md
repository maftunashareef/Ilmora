# ILMORA Uzbek alphabet and glossary

ILMORA writes its Uzbek interface with its own Latin alphabet. Use the same words everywhere (dictionary in
`packages/shared/src/translations.ts`, seeded content, and texts typed into the Admin Panel).

## Alphabet

| Traditional | ILMORA | Unicode | Example |
|---|---|---|---|
| G‘ g‘ | Ğ ğ | U+011E / U+011F | G‘alaba → Ğalaba |
| O‘ o‘ | Ö ö | U+00D6 / U+00F6 | O‘zbekiston → Özbekiston, O‘quvchi → Öquvçi |
| Sh sh | Ş ş | U+015E / U+015F | Shahar → Şahar |
| Ch ch | Ç ç | U+00C7 / U+00E7 | Chiroyli → Çiroyli |

Rules:

- Always the precomposed letters above (Unicode NFC), never a base letter plus a combining mark, never Ș/ș (comma below).
- Unchanged: the tutuq belgisi stays ’ (ta’lim, ma’lumot); Ng ng stays; every other letter stays.
- Not converted: English words and names inside Uzbek text (Michigan, Charles, English), original course titles,
  provider names (Coursera, MIT OpenCourseWare), official university names, URLs, e-mail addresses, IDs and code,
  people's names typed by users, and the legal documents and the operator's registered name and address (official spelling).
- One fixed exception: the name **Mening to’plamim** (course finder and the custom package, Build your own package) is always
  written exactly like this, with ’, and is never converted.
- Suffixes join names and acronyms directly: Clickning, APIga, DTMga.
- After a number the noun stays singular: 3 ta kurs, 0 ta guruh.
- Dates: 2026-yil 20-noyabr.

Search folds every spelling to one form (`foldForSearch`), so "öquvçi", "o‘quvchi", "o'quvchi" and "oquvchi" find
each other.

## Glossary

| English | ILMORA Uzbek |
|---|---|
| Subscription | Abonement |
| Course, courses | Kurs, kurslar |
| Group | Guruh |
| Student | Talaba |
| Teacher | Öqituvçi |
| Learning center | Öquv markazi |
| Category | Yönaliş |
| Discount | Çegirma |
| All discounts | Barça çegirmalar |
| Special offers | Maxsus takliflar |
| Sale (badge) | SALE |
| Price, monthly price | Narx, oylik narx |
| You save | Tejaysiz |
| Free | Bepul |
| Online, offline | Onlayn, oflayn |
| Package | Paket |
| Build your own package (RU «Собрать свой набор») | Mening to’plamim |
| Tashkent (contact location; RU «г. Ташкент») | Toşkent şahri |
| Course finder ("My set") | Mening to’plamim |
| Cart | Savat |
| Payment | Tölov |
| Sign in, sign out | Kiriş, çiqiş |
| Account | Hisob |
| Session expired | Kiriş muddati tugagan |
| Save, cancel, delete | Saqlaş, bekor qiliş, öçiriş |
| Edit, add, view | Tahrirlaş, qöşiş, köriş |
| Search, filter, sort | Qidiriş, filtr, saralaş |
| Schedule, timetable | Jadval |
| Attendance | Davomat |
| Certificate | Sertifikat |
| Provider | Provayder |
| Card (course card) | Karta |
| Limit | Çegara |
| Scroll | Aylantiriş |
| Student Cabinet | Talaba kabineti |
| Teacher Studio | Öqituvçi studiyasi |
| Center Admin | Markaz administratori |
| Super Admin | Super Admin |
| Currency | söm |
