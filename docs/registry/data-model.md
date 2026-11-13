# Реестр: модель базы данных

Модель для ТЗ «ILMORA — реестр учреждений, компании, студенты» (9 ноября 2026). Схема —
`apps/api/prisma/schema.prisma`, раздел «Registry», миграции `20261113000000_registry_institutions_companies_students`
`20261114000000_institution_names_region_slug` (названия техникумов на русском и прежние, район текстом, slug региона)
`20261115000000_student_contact_phone` (контактный телефон студента) и
`20261116000000_registry_pending_changes_block_contact_snapshot` (доработки по проверке безопасности 10.11: правка
после одобрения на проверке, блокировка, контакты на момент согласия, занятие записи, официальное название,
временный пароль).
Старая часть ILMORA (центры, курсы, подписки, оплата) не менялась.

> **Схему и миграции меняет только чат БД (дата-инженер).** Нужно поле или таблица — через него. Остальные чаты
> пишут код поверх этой модели и не трогают `schema.prisma` и `prisma/migrations`.

## Как устроено

- **Связь всего со всем — через направление** (`Direction`) с обязательной **отраслью** (`Industry`). Отрасль
  объявления, заявки, вакансии берётся у направления через join, а не копией: перенесли направление в другую
  отрасль — переехало всё, что на него ссылается.
- **Все таблицы с `tenantId`** — под той же обёрткой изоляции, что и старые (`TENANT_SCOPED_MODELS` в
  `src/infra/prisma/prisma-extensions.ts`). Обёртка подставляет `tenantId` только **на верхнем уровне** запроса:
  во вложенном `create` для модели с `tenantId` передавайте `tenantId` явно.
- **Дочерние таблицы без `tenantId`** (`CompanyIndustry`, `CompanyDirection`, `AnnouncementLine`,
  `AnnouncementExclusion`, `AnnouncementResponseLine`, `VacancyDirection`) читаются и пишутся только через родителя.
- **Обязательные поля анкет проверяет API при отправке на проверку**, а не база: черновик можно сохранять частями.
- **Деньги** — в тийинах (`BigInt`, как везде в ILMORA): `StudentProfile.contractAmountMinor`,
  `Vacancy.stipendMinor`. Через ILMORA деньги за контракт не идут, это справочные цифры.

## Защита от дублей — в базе

| Что | Индекс | Что делать в API |
|---|---|---|
| Направление: одно на нормализованное название | `Direction (tenantId, searchKey)` | при `P2002` вернуть существующее направление |
| Учреждение: одно на СТИР | `Institution (tenantId, stir)`; СТИР может быть пустым у записей от студентов | `P2002` → 409 «уже зарегистрировано» |
| Компания: одна на СТИР | `Company (tenantId, stir)` | то же |
| Один представитель на учреждение / компанию | `User.institutionId`, `User.companyId` — уникальны | то же |
| Одна открытая заявка студента на помощь с контрактом | `ContractHelpRequest.openKey` — уникален | `openKey = userId`, пока заявка `ACTIVE` или `INTERESTED`; при отзыве или договоре — `null` |
| Один отклик компании на объявление | `AnnouncementResponse (announcementId, companyId)` | |
| Один отклик учреждения на заявку | `TrainingOffer (requestId, institutionId)` | |
| Один запрос контакта на канал: именные карточки (объявление о выпуске и раздел «Студенты») — один на пару компания–студент, анонимная карточка — на пару компания–карточка | частичные индексы `ContactRequest_named_once (companyId, userId) WHERE source IN ('GRADUATE', 'STUDENTS')` (миграция `20261121000100`, заменил `ContactRequest_graduate_once`) и `ContactRequest_contract_help_once (companyId, contractHelpId) WHERE source = 'CONTRACT_HELP'` (`20261119000000`); только в SQL | Именные каналы общие: запросил в «Студентах» — в объявлении показать статус этого запроса, не новую кнопку, и наоборот. Анонимная карточка — отдельно: 409 на ней не выдаёт, что это тот же человек (проверка 11.11, №126). Запрос с карточки код всегда создаёт с `contractHelpId`: без него индекс карточки не сработает |
| Один отклик студента на вакансию | `VacancyApplication (vacancyId, userId)` | |
| Вакансия доходит до студента от учреждения один раз | `VacancyBroadcastRecipient (vacancyId, userId)` | рассылка пачками: `createMany({ skipDuplicates: true })` — повтор пачки и повторная рассылка той же вакансии никого не задевают |

`P2002` без перехвата уже превращается в 409 `conflict` (`app-exception.filter.ts`); для понятного текста
перехватывайте его в сервисе, как `login_taken` в `account.service.ts`.

**Поиск учреждений** — по `searchText contains registrySearchKey(запрос)`: в нём нормализованные официальное,
русское и прежнее названия (`registrySearchText(name, nameRu, formerName)` из `@ilmora/shared`). При создании и
переименовании учреждения в API ставьте `searchText` той же функцией. У записей, созданных до этого, `searchText`
пустой — ищите `OR: [{ searchText: { contains } }, { searchKey: { contains } }]`. `searchKey` — только для точного
совпадения (студент добавляет учреждение, которое уже есть).

**Нормализация названий** — `registrySearchKey()` из `@ilmora/shared` (направления, учреждения, компании):
нижний регистр; узбекская кириллица → латиница; буквы ILMORA (Ğ Ö Ş Ç) и все варианты апострофа складываются в одно;
знаки → пробел. «Dasturlash» = «Дастурлаш», «Oʻqituvchi» = «O’qituvchi» = «Öqituvçi» = «Ўқитувчи». Синонимы на разных
языках («Программирование» и «Dasturlash») не склеиваются — их сливает модератор.

**Слияние дублей** (Super Admin): у дубля ставится `mergedIntoId`, все ссылки переносятся на основное направление,
сам дубль остаётся как псевдоним со своим ключом. Поиск, нашедший псевдоним, отдаёт основное направление. То же для
учреждений, добавленных студентами (`Institution.mergedIntoId`).

## Таблицы

**Справочники**
- `Industry` — отрасль: `slug`, `name {uz,ru,en}`, `sortOrder`, `isActive`.
- `Region` — 14 регионов, `code` = СОАТО, `slug` — id региона на сайте (`UZ_REGIONS`: `andijan`, `tashkent-city`…).
  Сайт присылает slug — регион в базе ищите по `slug`. `District` — 206 районов и городов районного значения,
  `code` = СОАТО (7 цифр), `name {uz,ru,en}`; **только из официального списка** (открытые данные Агентства
  статистики), руками не вводятся. Районы региона: `GET /registry/districts?regionId=<id или slug>`.
- `Direction` — `name`, `searchKey`, `industryId`, `origin` (`OFFICIAL` / `USER` / `ADMIN`), `code` (классификатор),
  `mergedIntoId`, `createdById`.

**Учреждение** — `Institution`: `type` (`TECHNIKUM` `COLLEGE` `LYCEUM` `SCHOOL` `UNIVERSITY` `TRAINING_CENTER`),
`ownership` (`STATE` / `PRIVATE`), `name`, `nameRu`, `formerName` (название до переименования 2025 года),
`searchKey`, `searchText`, `stir`, `parentId` (головная организация филиала), `regionId`, `districtId`,
`districtName` (район текстом, как он записан в официальном списке техникумов; рядом с `districtId`), `address`, `phone`, `email`, `website`, `directorName`, `status`, `source`
(`IMPORT` / `SELF` / `STUDENT`), `submittedAt`, `approvedAt`, `reviewedAt`, `reviewedById`, `rejectReason`,
`centerId` (связь с учебным центром ILMORA), `mergedIntoId`. Представитель — `User` с `institutionId` и ролью
`INSTITUTION_ADMIN`; должность — `User.jobTitle`.
- `officialName` — название из официального списка министерства. Ставит импорт (`prisma/import-technikums.ts`), у
  занятых записей тоже; представитель его не меняет. Проверяющий видит его рядом с `name`.
- `claimedAt` — когда представитель занял запись. Черновик, не отправленный на проверку за N дней от этой даты,
  освобождается. У записей, занятых до 11.11, — дата релиза миграции. **У компании — то же поле** (`Company.claimedAt`,
  миграция `20261122000100`, №83): срок «брошенного» черновика — от самой поздней из дат создания, занятия, решения
  проверки и последней правки представителя по журналу (направления тоже, перепроверка 11.11 №110); при «Отвязать» —
  очистить вместе с блокировкой (№112). У компаний, занятых до миграции, — дата создания записи (так срок и считался).
- `pendingChanges` (Json) — правка ключевых полей **после одобрения**: `{ name?, stir?, type?, ownership?, regionId?,
  districtId? }`. Основные поля до решения Super Admin не меняются; одобрение переносит правку в них, отказ —
  очищает. СТИР внутри `pendingChanges` уникальный индекс не держит: при одобрении API проверяет, что он свободен (иначе 409).
- `blockedAt`, `blockReason`, `blockedById` — блокировка Super Admin: кабинет закрыт, в цифрах и поиске записи нет.
  Это не статус проверки: `status` остаётся каким был.
- `InstitutionDirection` — направление учреждения: `directionId`, `department` (отделение), `studentsCount`.
  «Всего студентов» = сумма `studentsCount`.

Статусы учреждения:

```
UNCLAIMED (импорт или добавлено студентом) → DRAFT (представитель заполняет) → PENDING → APPROVED
                                                                               ↘ REJECTED → (исправил) PENDING
APPROVED → правка названия / СТИР / типа / собственности / региона → PENDING (approvedAt остаётся, кабинет работает)
```

Кабинет открыт, если `approvedAt` не пустой и `blockedAt` пустой. В официальные цифры министерства идут только
`APPROVED` без блокировки (`blockedAt IS NULL`), с основными полями — не с `pendingChanges`. Правка после одобрения
(схема выше) с 11.11 лежит в `pendingChanges`, а не меняет запись сразу.

**Компания** — `Company`: `stir`, `name`, `searchKey`, `regionId`, `districtId`, `address`, `website`, `about`,
`certificateFileKey` (свидетельство в закрытом бакете `ilmora-docs`), `status` (`DRAFT` → `PENDING` → `APPROVED` /
`REJECTED`), `submittedAt`, `approvedAt`, `reviewedAt`, `reviewedById`, `rejectReason`. Отрасли — `CompanyIndustry`,
направления — `CompanyDirection`. Представитель — `User.companyId`, роль `COMPANY_ADMIN`.
- `pendingChanges` (Json) — правка после одобрения: `{ name?, stir?, industryIds?, certificateFileKey? }`, смена
  отраслей тоже идёт на проверку. Новое свидетельство одобренной компании ждёт здесь же (перепроверка 11.11 №106):
  действующее остаётся, при одобрении заменяется (старый файл удаляется), при отказе удаляется новый. Наружу ключ файла
  не отдаётся — в ответе `pendingChanges.certificate: true`; ссылка у проверяющего — на новое. `blockedAt`, `blockReason`, `blockedById` — блокировка, как у учреждения.

**Студент**
- ФИО и email — в `User` (`displayName`, `email`). `User.phoneE164` — **номер для входа по SMS**, уникальный; анкета
  его не меняет: непроверенный номер там позволил бы занять чужой номер.
- **Телефон из анкеты** — `StudentProfile.contactPhone` (E.164, по SMS не проверяется, ко входу отношения не имеет).
  Его видят только компании, которым студент дал согласие на контакты. Если студент вошёл по SMS, анкета подставляет
  его `User.phoneE164` по умолчанию.
- `StudentProfile` — анкета: `mode` (`STUDYING` / `APPLYING`), `institutionType`, `institutionId` (пусто = «ещё не
  решил»), `course`, `enrollYear`, `graduationYear`, `directionId`, `studyForm` (`GRANT` / `CONTRACT` / `UNDECIDED`),
  `contractAmountMinor`, `birthDate`, `regionId`, `districtId`, `about`, `contactPhone`, `parentName`, `parentPhone`,
  `studyConfirmation` (`NONE` / `PENDING` / `CONFIRMED` / `REJECTED`), `studyConfirmedAt`, `studyConfirmedById`.
- `StudentConsent` — **журнал согласий**, строки не перезаписываются. `kind`: `GRADUATE_CARD` (показ в объявлениях),
  `CONTRACT_HELP_CARD` (обезличенная карточка), `COMPANY_CONTACTS` (контакты конкретной компании, `companyId`),
  `PARENT_CONSENT` (согласие родителя несовершеннолетнего), `INDUSTRY_CARD` (показ карточки компаниям своей отрасли в
  их разделе «Студенты» — отдельная цель, из других согласий не следует). Поля: `textVersion`, `givenAt`, `revokedAt`, `ip`.
  Отзыв — поставить `revokedAt`; повторное согласие — новая строка. Действующее согласие — последняя строка без
  `revokedAt`. База держит два правила (миграция `20261120000000`):
  - **одно действующее согласие каждого вида** — частичный уникальный индекс
    `StudentConsent_one_active_per_kind (userId, kind) WHERE revokedAt IS NULL AND companyId IS NULL`; второе — P2002.
    `COMPANY_CONTACTS` сюда не входит: контакты одной компании открываются по каждому принятому запросу;
  - **журнал переживает аккаунт** — связь с `User` `ON DELETE RESTRICT`: аккаунты удаляются мягко (`deletedAt`), полное
    удаление пользователя с согласиями база не даст (ТЗ 8: историю согласий и отзывов хранить). Очистка демо-данных
    удаляет согласия демо-студентов сама.
- `StudentCertificate` — `title`, `issuer`, `issuedAt`, `fileKey` (бакет `ilmora-docs`), `contentType`, `sizeBytes`.

**Связи**
- `GraduationAnnouncement` (`year`, `status`: `DRAFT` → `PUBLISHED` → `CLOSED`) и строки `AnnouncementLine`
  (`directionId`, `count`). **Карточки студентов не хранятся**: это подтверждённые студенты учреждения с тем же
  направлением, `graduationYear = year` и действующим `GRADUATE_CARD`, минус `AnnouncementExclusion`. Отозвал
  согласие — карточка пропала сразу.
- `AnnouncementResponse` — отклик компании (`comment`, `status`) и его строки `AnnouncementResponseLine`
  (`lineId`, `wantedCount`).
- `TrainingRequest` — заявка «под обучение»: `directionId`, `count`, `byYear`, `regionId` (пусто = любой),
  `requirements`, `status` (`OPEN` / `CLOSED`). `TrainingOffer` — отклик учреждения: `count`, `byYear`, `comment`,
  `status`.
- `ContractHelpRequest` — помощь с контрактом: `motivation`, `yearsToWork`, `workRegionId` (пусто = любой),
  `status` (`ACTIVE` → `INTERESTED` → `SIGNED` / `WITHDRAWN`), `openKey`, `signedWithCompanyId`, `signedAt`,
  `withdrawnAt`.
- `ContactRequest` — запрос контакта: `companyId`, `userId`, `source` (`GRADUATE` / `CONTRACT_HELP` / `STUDENTS` —
  из раздела «Студенты» компании),
  `contractHelpId` или `announcementId`, `status`. При принятии — строка `COMPANY_CONTACTS` в `StudentConsent` и
  копия того, что студент открыл: `sharedName`, `sharedPhone`, `sharedEmail`. Компания видит эту копию, а не
  текущие контакты (сменил номер — новый компании не уходит). **Это персональные данные:** отозвал согласие или
  запрос — копию стереть. Пустые поля у старых записей — API показывает текущие контакты, как раньше.
- `Vacancy` — практика, стажировка или работа: `kind` (`PRACTICE` / `INTERNSHIP` / `JOB`), `title`, `regionId`,
  `districtId`, `address`, `format` (`ONSITE` / `REMOTE` / `HYBRID`), `paid`, `stipendMinor` (стипендия в месяц —
  практика и стажировка), `salaryFromMinor` / `salaryToMinor` (зарплата в месяц «от–до» — только `JOB`; одна сумма —
  только «от»), `duration`, `seats`, `requirements`, `deadline`, `status` (`OPEN` / `CLOSED`); направления —
  `VacancyDirection`. Проверки в базе: `JOB` всегда оплачивается (`Vacancy_job_paid_check`); зарплата только у `JOB`,
  стипендии у `JOB` нет (`Vacancy_pay_by_kind_check`); зарплата > 0, «до» не меньше «от» и без «от» не бывает
  (`Vacancy_salary_check`). У `JOB` ещё `schedule` — график (`FULL_TIME` / `PART_TIME` / `SHIFT` / `FLEXIBLE`; на месте
  или удалённо — это `format`) и `experience` — требуемый опыт (`NONE` / `UP_TO_1` / `ONE_TO_3` / `OVER_3`); у практики
  и стажировки их нет; у `JOB` оба обязательны (`Vacancy_job_terms_check`, миграции `20261122000000` и
  `20261124000000`). `VacancyApplication` — отклик: `note`, `status`
  (`NEW` → `VIEWED` → `INVITED` / `REJECTED`), копия контактов на момент отклика `sharedName`, `sharedPhone`,
  `sharedEmail` (те же правила, что у `ContactRequest`).
- `VacancyBroadcast` — рассылка вакансии учреждением своим подтверждённым студентам (ТЗ «Студенты у компании»,
  3.2), строка журнала: `vacancyId`, `institutionId`, `courses` (1–11, хотя бы один — CHECK
  `VacancyBroadcast_courses_check`), `createdById`, `recipientsCount` (≥ 0), `finishedAt` (ставит очередь после
  последней пачки), `createdAt`; направления — `VacancyBroadcastDirection`. Лимит в день считать по
  `(tenantId, institutionId, createdAt)` — индекс есть. `VacancyBroadcastRecipient` — кому дошла: `broadcastId`,
  `vacancyId`, `userId`; связь `(broadcastId, vacancyId)` → рассылка, так что вакансия у получателя всегда та же,
  что у рассылки. Уведомление студенту — обычное `Notification`.
- `CompanyStudentCardView` — журнал показов раздела «Студенты» для суточного лимита (миграция `20261125000000`):
  одна строка на показанную компании страницу — `companyId`, `cards` (сколько карточек на странице, > 0 — CHECK
  `CompanyStudentCardView_cards_check`), `createdAt`; без `tenantId`, достижима только через компанию. Лимит
  (`STUDENT_CARDS_PER_DAY`, 1000 карточек за 24 часа на компанию, а не на аккаунт) — сумма `cards` по
  `(companyId, createdAt)`, индекс есть; считать и писать под `pg_advisory_xact_lock('student-cards:<companyId>')` в
  одной транзакции с записями аудита `student.card.view` (по одной на карточку: `entityType = 'User'`, `entityId` —
  аккаунт студента, `after = { companyId, institutionId, page }`). Кто кого видел — только в аудите; эта таблица
  только считает, строки старше суток ни на что не влияют.
- Подбор студентов для раздела «Студенты» новых индексов не требует: на нагрузочной копии (200 000 студентов,
  96 000 подтверждённых) блоки учреждений компании — 0,16 с, страница студентов одного учреждения — 1,4 мс,
  предпросмотр рассылки — 0,5 мс на существующих индексах.
- Ответы на отклики и запросы (`MatchStatus`): `PENDING`, `ACCEPTED`, `DECLINED`, `WITHDRAWN`.

**Роли и вход**
- Новые роли: `INSTITUTION_ADMIN`, `COMPANY_ADMIN`, `MINISTRY`. `MINISTRY` выдаёт только Super Admin.
- Второй фактор (TOTP) для министерства и модераторов: `User.totpSecretEnc` (секрет, зашифрованный API — в открытом
  виде не хранить), `User.totpEnabledAt`; резервные коды — `TotpRecoveryCode` (`codeHash`, `usedAt`), 10 штук,
  каждый одноразовый.
- `User.passwordIssuedAt` — пароль выдал Super Admin (аккаунт министерства, сброс), владелец его ещё не сменил:
  при входе — смена пароля. Сменил — поле пустое. У старых аккаунтов пусто (на переходное время API смотрит журнал).

## Справочники и тестовые данные

- **Отрасли, регионы и районы** — `REGISTRY_INDUSTRIES`, `REGISTRY_REGIONS`, `REGISTRY_DISTRICTS` в
  `packages/shared/src/registry.ts`. В базу их кладёт `prisma/seed.ts` (в любом режиме) и отдельная команда,
  безопасная для боевого сервера:
  ```bash
  npm run prisma:seed:registry -w apps/api
  # на сервере, один раз после релиза с этой миграцией:
  sh /opt/ilmora/infra/uzcloud/compose.sh admin --profile migrate run --rm migrate npx tsx prisma/seed-registry.ts
  ```
  Существующие строки не перезаписываются (правки Super Admin сохраняются).
- **Районы — коды СОАТО**: открытые данные Агентства статистики (SIAT, `api.siat.stat.uz`, набор 1252, обновлён
  30.06.2026; те же 206 кодов и названий — в наборах 1346, 2853, 2161, 3197, 2152), файл
  `packages/shared/src/districts.data.ts`, создан из файла агентства, а не набран руками. Коды 14 регионов
  сверены с теми же данными. Узбекские названия — в алфавите ILMORA (Ö Ğ Ş Ç ’), русские и английские — как
  опубликованы. Когда у региона есть районы, анкета учреждения требует район (`districtId`; у записи из списка
  техникумов хватает `districtName`) — сайту нужен выбор района из `GET /registry/districts`.
- **Техникумы — официальный список** (738: 686 государственных, 52 частных; stat.edu.uz, выгрузка 9 ноября 2026) —
  `TECHNIKUMS` в `packages/shared/src/technikums.data.ts`. В базу их кладёт импорт с **теми же id, что на сайте**
  (`pe-<id в prof.edu.uz>`), так что выбор техникума на сайте = запись в базе:
  ```bash
  npm run prisma:import:technikums -w apps/api              # только отчёт, ничего не пишет
  npm run prisma:import:technikums -w apps/api -- --apply   # записать
  # на сервере (сначала отчёт, потом --apply):
  sh /opt/ilmora/infra/uzcloud/compose.sh admin --profile migrate run --rm migrate npx tsx prisma/import-technikums.ts
  ```
  Новые — `UNCLAIMED`, `source = IMPORT`, тип `TECHNIKUM`, СТИР = ИНН из списка (есть у 634). Повторный запуск
  безопасен: незанятые записи догоняют список (пустое в списке не стирает заполненное), у занятых (представитель уже
  заполняет) меняются только пустые `nameRu`, `formerName`, `districtName`, `districtId`. С `--apply` импорт сначала
  кладёт справочники, в том числе районы. Район из списка (текст) связывается с районом СОАТО того же региона
  (`matchDistrict`: то же название на любом языке; x/h, q/k; инициал — «Sh.Rashidov», «M.Ulugbek», «Q-bozor»;
  другая гласная — «Toyloq» = «Tayloq»); город и район с одним именем не путаются, неуверенное совпадение не
  связывается, а выводится в отчёте. Из 634 записей с районом связаны 632; «Uchquduq shahri» (2) — город внутри
  Uchquduq tumani, не отдельный район СОАТО, остаётся текстом. СТИР, который уже есть у другой записи
  (учреждение зарегистрировалось само), не пишется — импорт выводит такие пары, их сливают руками. Запись с тем же
  названием в том же регионе (добавил студент) импорт тоже выводит — её Super Admin сливает в официальную.
- **Тестовые данные** — 600 учреждений, 10 000 студентов, 80 компаний, объявления, заявки, вакансии. Только
  разработка и тестовая машина; при `NODE_ENV=production` команда отказывается работать:
  ```bash
  npm run prisma:seed:registry-demo -w apps/api              # REGISTRY_DEMO_RESET=true — пересоздать
  ```
  У тестовых строк `id` начинается с `demo-`, названия заканчиваются на «(demo)», СТИР начинается с 0. Входов у
  тестовых аккаунтов нет (без пароля).
- **Скорость**: на этих данных типовые запросы министерства (учреждения по регионам и типам, студенты по отраслям,
  выпуск против спроса, карточки строки объявления) выполняются за 1–4 мс.
- **Прогон цифр министерства** (ТЗ: «600+ учреждений и 10 000 студентов: дашборд меньше 2 секунд») — команда, только
  читает, на боевом — не в рабочее время:
  ```bash
  DATABASE_URL=… npm run bench:ministry -w apps/api        # BENCH_RUNS=20 — больше прогонов
  ```
  10 ноября 2026: 600 тестовых учреждений + 738 техникумов, 10 000 студентов — весь дашборд (12 таблиц) **57 мс**;
  2000 + 738 учреждений, 200 000 студентов — **87 мс**, самая медленная таблица — 35 мс. Новые индексы не нужны: таблицы
  считаются группировкой в базе по уже существующим индексам (регион, тип и собственность, статус, режим и год
  студента). Не грузить в приложение строки студентов, чтобы посчитать их там: на всю страну это растёт линейно
  («Абитуриенты» так и считались — 103 мс на 200 000, после `groupBy` — 27 мс).

## Проверки

`apps/api/test/registry-model.test.ts`: уникальность направлений, СТИР, представителя и открытой заявки на контракт,
изоляция реестра по tenant. `apps/api/test/registry-import.test.ts`: импорт техникумов — id, повторный запуск, занятые
записи, конфликт СТИР, весь список. `packages/shared/src/registry.test.ts`: нормализация названий и справочники.
