# ILMORA на UzCloud: установка, выкладка, копии

Две машины в Ташкенте (UzCloud, сеть `ilmora-prod`), домен `ilmoraa.uz`. Пароли, ключи и токены — только в файлах
на серверах и в GitHub Secrets: никогда в чат, в git или в заметки.

| Машина | Ресурсы | Частный IP | Внешний IP | Что работает |
|---|---|---|---|---|
| ilmora-web | 2 vCPU / 4 ГБ / 20 ГБ | 10.0.0.57 | 198.163.197.43 | Caddy (HTTPS), сайт, API (оплаты, QR) |
| ilmora-admin | 1 vCPU / 4 ГБ / 30 ГБ | 10.0.0.171 | — (вход через web) | админка, worker, PostgreSQL, Redis, копии в S3 |

```
интернет → 198.163.197.43 → ilmora-web: Caddy
              ilmoraa.uz, www   → сайт + /v1 (API); /v1/admin/* здесь всегда 404
              admin.ilmoraa.uz  → /v1 (API) + админка на ilmora-admin:3000 (частная сеть)
           ilmora-web api ──частная сеть──► ilmora-admin: PostgreSQL :5432, Redis :6379
           ilmora-admin backup ──► S3 UzCloud (бакет ilmora-backups, Cold), каждую ночь в 03:40 по Ташкенту
```

Файлы на серверах лежат в `/opt/ilmora/infra/uzcloud` (их копирует релиз):

| Файл | Где | Что внутри |
|---|---|---|
| `api.env` | **на обеих машинах, одинаковый** | пароли базы и Redis, JWT/OTP-ключи, SMS, Payme/Click, `SEED_CATALOG` |
| `web/.env` | ilmora-web | адреса, домены, почта для сертификатов, кто видит админку, образы |
| `admin/.env` | ilmora-admin | адреса, образы, ключи S3 для копий, ключ шифрования копий |

Команды docker compose на сервере — через обёртку, она читает оба файла:
`sh /opt/ilmora/infra/uzcloud/compose.sh web …` или `sh /opt/ilmora/infra/uzcloud/compose.sh admin …`.

---

## Первая установка

### 1. Вход по SSH (на своём компьютере, один раз)

`C:\Users\<вы>\.ssh\config` (без `.txt`):

```
Host ilmora-web
    HostName 198.163.197.43
    User root
    IdentityFile ~/.ssh/id_ed25519_ilmora

Host ilmora-admin
    HostName 10.0.0.171
    User root
    IdentityFile ~/.ssh/id_ed25519_ilmora
    ProxyJump ilmora-web
```

Дальше: `ssh ilmora-web`, `ssh ilmora-admin`. Добавить человека — в разделе «Доступ для команды» ниже.

### 2. Ключ для выкладки и настройки GitHub

1. Отдельный ключ только для GitHub Actions (на своём компьютере; на вопрос о passphrase — дважды Enter, без пароля):
   ```powershell
   ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\ilmora_deploy -C ilmora-deploy
   Get-Content $env:USERPROFILE\.ssh\ilmora_deploy.pub
   ```
2. Добавить эту строку (`ssh-ed25519 … ilmora-deploy`) на **обе** машины — на каждой:
   ```bash
   echo 'ssh-ed25519 AAAA… ilmora-deploy' >> /root/.ssh/authorized_keys
   ```
3. Отпечатки машин для GitHub — на ilmora-web:
   ```bash
   ssh-keyscan -t ed25519 localhost 2>/dev/null | sed 's/^localhost/198.163.197.43/'; ssh-keyscan -t ed25519 10.0.0.171 2>/dev/null
   ```
   Должны получиться две строки: `198.163.197.43 ssh-ed25519 …` и `10.0.0.171 ssh-ed25519 …`.
4. GitHub → репозиторий `maftunashareef/ilmora` → Settings → Secrets and variables → Actions.

   **Secrets** (вкладка Secrets → New repository secret):

   | Имя | Значение |
   |---|---|
   | `DEPLOY_SSH_KEY` | весь приватный ключ: `Get-Content $env:USERPROFILE\.ssh\ilmora_deploy -Raw \| Set-Clipboard`, затем вставить |
   | `DEPLOY_KNOWN_HOSTS` | две строки из шага 3 |
   | `WEB_HOST` | `198.163.197.43` |
   | `ADMIN_HOST` | `10.0.0.171` |

   **Variables** (вкладка Variables):

   | Имя | Значение |
   |---|---|
   | `RELEASE_ACTORS` | логины GitHub, кому можно жать релиз, через запятую: `maftunashareef,<ваш логин>` |
   | `PUBLIC_WEB_URL` | `https://ilmoraa.uz` |

   После этого файл `ilmora_deploy` (без `.pub`) с компьютера можно удалить: новый ключ делается за минуту.

Кнопка релиза (Actions → «Release (UzCloud)» → Run workflow) появляется, когда `.github/workflows/deploy.yml` есть в
основной ветке репозитория. Жать может только тот, кто в `RELEASE_ACTORS` и имеет право записи в репозиторий.

### 3. Файлы на серверы

Actions → «Release (UzCloud)» → Run workflow → отметить **files_only** → Run. Ничего не собирается и не
запускается: файлы `infra/uzcloud` и `infra/redis` копируются в `/opt/ilmora` на обе машины.

### 4. Настройка машин

```bash
ssh ilmora-web
sh /opt/ilmora/infra/uzcloud/bootstrap.sh web
```
```bash
ssh ilmora-admin
sh /opt/ilmora/infra/uzcloud/bootstrap.sh admin
```

Скрипт ставит Docker, Compose и файрвол (web: 22, 80, 443; admin: 22 только из частной сети), делает swap 2 ГБ.
Если после него есть файл `/var/run/reboot-required` — `reboot` и через минуту зайти снова.

### 5. Панель UzCloud и DNS

- **UzCloud**, правила файрвола / проброс портов публичного IP 198.163.197.43 → ilmora-web: TCP 22, 80, 443 и UDP 443.
  На ilmora-admin снаружи ничего не открывать.
- **ahost** (DNS домена `ilmoraa.uz`): три записи типа A, TTL 300:

  | Имя | Тип | Значение |
  |---|---|---|
  | `@` (сам `ilmoraa.uz`) | A | 198.163.197.43 |
  | `www` | A | 198.163.197.43 |
  | `admin` | A | 198.163.197.43 |

  Проверка с компьютера: `nslookup ilmoraa.uz` и `nslookup admin.ilmoraa.uz` отвечают `198.163.197.43`.
  DNS должен работать **до** первого релиза: Caddy получает сертификаты для этих имён.

### 6. Бакет для копий

UzCloud → Object Storage: бакет `ilmora-backups`, класс **Cold**, и ключ доступа (Access Key / Secret Key) — если
панель позволяет, только к этому бакету. Ключи пойдут в `admin/.env`.

### 7. Секреты и файлы настроек

На **ilmora-admin**:

```bash
cd /opt/ilmora/infra/uzcloud
cp api.env.example api.env && cp admin/.env.example admin/.env && chmod 600 api.env admin/.env
for i in 1 2 3 4 5; do openssl rand -hex 32; done
nano api.env
```

Пять сгенерированных строк — пять разных секретов. В `api.env` вставить четыре:
`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET`, `OTP_JOB_ENCRYPTION_KEY`. Остальное уже заполнено для
запуска: домен `ilmoraa.uz`, пустой каталог (`SEED_CATALOG=false`), SMS без Eskiz (только в журнал), Payme/Click пусто.
Сохранить: `Ctrl+O`, Enter, `Ctrl+X`.

```bash
nano admin/.env
```

Вписать `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` (из шага 6) и `BACKUP_PASSPHRASE` (пятая строка).
**`BACKUP_PASSPHRASE` сохранить ещё и в менеджере паролей**: без него копии не расшифровать. Строки `API_IMAGE…`
оставить пустыми — их заполняет релиз.

Скопировать `api.env` на ilmora-web (с компьютера, файл не показывается на экране):

```powershell
scp -3 ilmora-admin:/opt/ilmora/infra/uzcloud/api.env ilmora-web:/opt/ilmora/infra/uzcloud/api.env
```

Если `scp -3` не сработает — в два шага: `scp ilmora-admin:/opt/ilmora/infra/uzcloud/api.env .`, затем
`scp api.env ilmora-web:/opt/ilmora/infra/uzcloud/api.env` и удалить локальный `api.env`.

На **ilmora-web**:

```bash
cd /opt/ilmora/infra/uzcloud
chmod 600 api.env
cp web/.env.example web/.env && chmod 600 web/.env
nano web/.env
```

Вписать `ACME_EMAIL` (почта для писем Let's Encrypt о сертификатах). `ADMIN_ALLOW_IPS` — кто может открыть
`admin.ilmoraa.uz`: по умолчанию все (вход всё равно по логину и паролю); можно указать IP офиса через пробел.

### 8. Первый релиз

Actions → «Release (UzCloud)» → Run workflow (без галочки). Порядок:

1. сборка образов (10–15 минут);
2. ilmora-admin: база, Redis, миграции, **начальные данные** (только в первый раз: пакеты Duo/Trio, категории,
   шаблон сайта; каталог пустой), worker, админка, копии;
3. ilmora-web: API, сайт, Caddy;
4. проверка снаружи: `https://ilmoraa.uz` открывается, `/v1/admin` с основного домена отвечает 404.

### 9. Владельцы (Super Admin)

На **ilmora-admin**, для каждого из двух владельцев (пароль вводит сам владелец, на экране он не виден, минимум 12 символов):

```bash
sh /opt/ilmora/infra/uzcloud/compose.sh admin --profile migrate run --rm migrate node dist/cli/owner-setup.js --login <логин-1>
sh /opt/ilmora/infra/uzcloud/compose.sh admin --profile migrate run --rm migrate node dist/cli/owner-setup.js --login <логин-2> --add
```

Если такой логин уже зарегистрирован на сайте, пароль не спрашивается — аккаунт просто становится владельцем.
Вход в админку: `https://admin.ilmoraa.uz`. Другие команды: `--remove` (снять права, но не у последнего владельца),
`--replace` (оставить единственного), `--set-password` (сменить пароль).

### 10. Проверка перед открытием

- [ ] `https://ilmoraa.uz` — сайт на трёх языках; `https://www.ilmoraa.uz` переводит на `ilmoraa.uz`
- [ ] регистрация ученика и учителя, вход
- [ ] `https://admin.ilmoraa.uz` — вход владельца, админка работает
- [ ] копия: `sh /opt/ilmora/infra/uzcloud/compose.sh admin exec backup backup.sh --now`, затем `… backup.sh --list`
- [ ] восстановление на пробу: `… backup.sh --restore <имя из списка>` — появится отдельная база `ilmora_restore`;
      убрать её: `sh /opt/ilmora/infra/uzcloud/compose.sh admin exec postgres psql -U ilmora -d postgres -c 'DROP DATABASE ilmora_restore;'`
- [ ] `reboot` обеих машин — через пару минут всё поднялось само (`… compose.sh web ps`, `… compose.sh admin ps`)

---

## Обычная работа

- **Релиз:** Actions → «Release (UzCloud)» → Run workflow. Сначала admin (миграции), потом web.
- **Состояние и журналы:**
  ```bash
  sh /opt/ilmora/infra/uzcloud/compose.sh web ps
  sh /opt/ilmora/infra/uzcloud/compose.sh web logs --tail=100 api
  sh /opt/ilmora/infra/uzcloud/compose.sh admin logs --tail=100 worker
  ```
- **Поменять `api.env`** (ключи Payme, Click, Eskiz): правка на ilmora-admin, копия на ilmora-web (`scp -3`, как в
  шаге 7), затем на admin `… compose.sh admin up -d worker`, на web `… compose.sh web up -d api`.
  Адреса для кабинетов Payme / Click: `https://ilmoraa.uz/payments/payme`,
  `https://ilmoraa.uz/payments/click/prepare` и `https://ilmoraa.uz/payments/click/complete`.
- **Закрыть админку по IP:** `ADMIN_ALLOW_IPS` в `web/.env`, затем `… compose.sh web up -d caddy`.

## Удаление демо-данных перед запуском

Сид оставляет в базе образцы: центры, учителей и учеников с пометкой «(demo)» и всё, что к ним привязано (курсы, группы,
занятия, посещаемость, подписки, платежи, уведомления). Перед открытием для реальных пользователей их убирает команда
`purge-demo` в контейнере мигратора. Настоящие аккаунты, владельцев и реальные центры она не трогает: строки выбираются
только по пометке «(demo)» и по связям с ними, никогда по префиксу id. Без `--yes` команда лишь показывает таблицу того,
что будет удалено. На **ilmora-admin**:

```bash
C="sh /opt/ilmora/infra/uzcloud/compose.sh"
$C admin exec backup backup.sh --now                                                                  # 1. копия базы
$C admin --profile migrate run --rm migrate node dist/cli/purge-demo.js --tenant ilmora --dry-run     # 2. посмотреть, что удалится
$C admin --profile migrate run --rm -e ALLOW_DATA_PURGE=1 migrate node dist/cli/purge-demo.js --tenant ilmora --yes   # 3. удалить
```

Удаление идёт одной транзакцией; повторный запуск сообщает, что удалять нечего. Если реальные строки ссылались на
демо-данные (сотрудник демо-центра, видео на демо-курсе), команда перечисляет их и только снимает ссылку. Пакеты
вузов, чьи предметы были привязаны к демо-курсам, пропадают с сайта, пока админ не привяжет их к реальным курсам
(админка → вузы) или не выполнит `npx tsx prisma/seed-university-packages.ts --refresh` в том же контейнере.

## Откат

Релиз сохраняет прежние образы в `.env.previous`. Сначала web, потом admin:

```bash
# на ilmora-web
cd /opt/ilmora/infra/uzcloud/web && cp .env.previous .env && sh ../deploy.sh web
# затем на ilmora-admin
cd /opt/ilmora/infra/uzcloud/admin && cp .env.previous .env && sh ../deploy.sh admin
```

Миграции совместимы с предыдущей версией (ничего не удаляется в том же релизе), поэтому прежние образы работают с
новой схемой. Образы хранятся на машинах две недели — откат на более старый релиз требует входа в GHCR, проще выпустить
исправление новым релизом.

## Восстановление

Заменить боевую базу копией — **только по явному решению владельца**. На ilmora-admin (`C=` — сокращение):

```bash
C="sh /opt/ilmora/infra/uzcloud/compose.sh"
$C admin exec backup backup.sh --list                    # выбрать копию
$C admin exec backup backup.sh --restore <имя>           # → база ilmora_restore, боевая не тронута
$C admin exec postgres psql -U ilmora -d ilmora_restore -c 'SELECT count(*) FROM "User";'   # данные на месте?
```

Подмена (сайт на эти минуты недоступен):

```bash
ssh ilmora-web 'sh /opt/ilmora/infra/uzcloud/compose.sh web stop api'     # эту строку — с компьютера
$C admin stop worker admin
$C admin exec postgres psql -U ilmora -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'ilmora' AND pid <> pg_backend_pid();" \
  -c "ALTER DATABASE ilmora RENAME TO ilmora_old_$(date +%Y%m%d);" \
  -c "ALTER DATABASE ilmora_restore RENAME TO ilmora;"
$C admin start worker admin
ssh ilmora-web 'sh /opt/ilmora/infra/uzcloud/compose.sh web start api'    # и эту — с компьютера
```

Прежняя база остаётся как `ilmora_old_<дата>`; удалить её через несколько дней, когда всё проверено:
`$C admin exec postgres psql -U ilmora -d postgres -c 'DROP DATABASE ilmora_old_<дата>;'`.
(`-U ilmora` и имя `ilmora` — значения `POSTGRES_USER` / `POSTGRES_DB` из `api.env`.)

## Доступ для команды

У каждого свой ключ; приватная часть никогда не пересылается. Человек присылает строку из своего `.pub`
(`ssh-ed25519 AAAA… имя`), и на **обеих** машинах:

```bash
echo 'ssh-ed25519 AAAA… maftuna' >> /root/.ssh/authorized_keys
```

Убрать доступ — удалить эту строку (`nano /root/.ssh/authorized_keys`) на обеих машинах.

## Позже

- Загрузка видео и файлов в S3 (отдельный бакет класса Standard) — код ещё не написан.
- Мониторинг: UptimeRobot для `https://ilmoraa.uz/health/ready`; Healthchecks.io для ночных копий (`BACKUP_PING_URL`).
- Тестовая машина (staging).
- Удалить устаревший столбец `Tenant.ownerUserId` отдельной миграцией (через релиз после перехода на `User.isOwner`).
