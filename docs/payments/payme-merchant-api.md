# Payme (Paycom) Merchant API — protocol reference

Scope: what ILMORA's NestJS backend must implement so that Payme Business can call it, plus how to start a Payme checkout. Facts below are taken from the official Payme Business developer documentation unless a line says otherwise. Anything not confirmed from an official page is marked **UNVERIFIED**. No merchant credentials appear in this file.

## Sources

All pages read on 2026-10-18 (site language: Russian; quotes kept in Russian where wording matters).

Official documentation (developer.help.paycom.uz):

- https://developer.help.paycom.uz/ (section index)
- https://developer.help.paycom.uz/nastroyka-vzaimodeystviya/
- https://developer.help.paycom.uz/protokol-merchant-api/
- https://developer.help.paycom.uz/protokol-merchant-api/format-zaprosa/
- https://developer.help.paycom.uz/protokol-merchant-api/format-otveta/
- https://developer.help.paycom.uz/protokol-merchant-api/obschie-oshibki/
- https://developer.help.paycom.uz/protokol-merchant-api/skhema-vzaimodeystviya/ (authorization, IP list, server settings, retry behaviour)
- https://developer.help.paycom.uz/metody-merchant-api/
- https://developer.help.paycom.uz/metody-merchant-api/checktransaction/ — **note: on 2026-10-18 this slug serves the CheckPerformTransaction page** (the sidebar links are swapped)
- https://developer.help.paycom.uz/metody-merchant-api/checkperformtransaction/ — **serves the CheckTransaction page** (same swap)
- https://developer.help.paycom.uz/metody-merchant-api/createtransaction/
- https://developer.help.paycom.uz/metody-merchant-api/performtransaction/
- https://developer.help.paycom.uz/metody-merchant-api/canceltransaction/
- https://developer.help.paycom.uz/metody-merchant-api/getstatement/
- https://developer.help.paycom.uz/metody-merchant-api/setfiscaldata
- https://developer.help.paycom.uz/metody-merchant-api/oshibki-errors
- https://developer.help.paycom.uz/metody-merchant-api/tipy-dannykh
- https://developer.help.paycom.uz/initsializatsiya-platezhey/
- https://developer.help.paycom.uz/initsializatsiya-platezhey/otpravka-cheka-po-metodu-get/
- https://developer.help.paycom.uz/initsializatsiya-platezhey/otpravka-cheka-po-metodu-post/
- https://developer.help.paycom.uz/initsializatsiya-platezhey/oshibki-otpravki-cheka
- https://developer.help.paycom.uz/initsializatsiya-platezhey/generatsiya-knopki-oplaty-i-qr-koda
- https://developer.help.paycom.uz/pesochnitsa/ (sandbox; also the only page that states the idempotency rule explicitly)
- https://developer.help.paycom.uz/poisk-klyucha-i-id-kassy-v-lichnom-kabinete/ and .../poisk-klyucha-parolya-ot-kassy/
- https://developer.help.paycom.uz/primer-realizatsii-servera
- https://developer.help.paycom.uz/protokol-subscribe-api (read only to attribute the `checkout.test.paycom.uz/api` host correctly — it belongs to the Subscribe API, not to Merchant API)

Provider's own reference implementation (linked from the official "Пример реализации сервера" page; used only where the prose docs are silent, and labelled "PHP template" below):

- https://github.com/PaycomUZ/paycom-integration-php-template — files `Paycom/Application.php`, `Paycom/Merchant.php`, `Paycom/PaycomException.php`, `Paycom/Transaction.php`, `paycom.config.sample.php`
- https://github.com/PaycomUZ/paycom-integration-java-template (linked, not read)

Fetch notes: all pages were reachable. The site is a JS app; plain HTTP fetches of `/metody-merchant-api/checkperformtransaction/` returned inconsistent content, so method pages were re-read in a rendered browser. No page was blocked.

## 1. Transport and envelope

| Item | Official statement |
|---|---|
| Protocol | JSON-RPC 2.0 remote procedure calls; requests carry **named parameters only**. |
| HTTP | HTTP/1.1 `POST` to the merchant's endpoint URL (the "Endpoint URL" configured on the web cash register), wrapped in TLS (HTTPS). |
| TLS | Merchant server must support any of TLS v1, v1.1, v1.2. |
| HTTP status | Responses **must be HTTP 200**. "Статусы отличные от 200 воспринимаются как RPC-ошибка: -32400". Error responses are also HTTP 200. |
| Content-Type | Examples use `Content-Type: text/json; charset=UTF-8` in both directions. |
| Request body | JSON object with fields `method` (String), `params` (Object), `id` (Integer, "Идентификатор запроса"). The documented example has **no** `"jsonrpc":"2.0"` member. |
| Response body | JSON object with `result` **or** `error`, plus `id`. `id` (Integer): "Идентификатор ответа — соответствует идентификатору запроса" — i.e. echo the request `id`. `result` is absent on error; `error` is absent on success. |

Request example (official):

```json
POST https://merchant/pay/ HTTP/1.1
Content-Type: text/json; charset=UTF-8
Authorization: Basic TG9naW46UGFzcw==

{ "method": "PerformTransaction",
  "params": { "id": "53327b3fc92af52c0b72b695", "time": 1399114284039, "amount": 500000,
              "account": { "phone": "903595731" } },
  "id": 2032 }
```

## 2. Authentication

- Mechanism: "Базовая HTTP-аутентификация". Header: `Authorization: Basic base64(login:password)`. Official example `Basic TG9naW46UGFzcw==` decodes to `Login:Pass` (placeholder).
- `password` = the cash-register key, "строка длиной 36 символов", "выдаётся мерчанту после добавления веб-кассы".
- `login`: "Login - запросите у технического специалиста Payme Business." The docs do not print the login value. The provider's PHP template ships `'login' => 'Paycom'` and compares the decoded header with `login:key` — so `Paycom:<KEY>` is the de-facto value, but treat the literal "Paycom" as **UNVERIFIED by prose docs** (confirm with Payme support).
- Two keys per web cash register: `key` ("ключ для кабинета", "используется для приема платежей") and `TEST_KEY` ("ключ для песочницы", "используется для тестирования вашей кассы"). Location: Business → Payments → Кассы → cash register → Настройки → "Инструменты разработчика". Use `TEST_KEY` while testing in the sandbox and `key` in production; the merchant ID is the same web-cash-register ID.
- On failed auth return error **-32504** "Недостаточно привилегий для выполнения метода" (the sandbox test "Неверная авторизация" expects exactly this). Still HTTP 200, still echo `id`.

## 3. Error object and general error codes

Error structure (`error` field): `code` (Integer), `message` (Object — "Локализованный текст сообщения об ошибке. Сообщение выводится пользователю."; keys `ru`, `uz`, `en`), `data` (Object — "Дополнительные сведения об ошибке"). For account errors (-31050…-31099) the localized `message` is mandatory and `data` must contain the name of the offending `account` sub-field (e.g. `"data": "phone"`).

```json
{ "error": { "code": -31050,
             "message": { "ru": "Номер телефона не найден", "uz": "Raqam ro'yhatda yo'q", "en": "Phone number not found" },
             "data": "phone" },
  "id": 2032 }
```

General errors (page "Общие ошибки"):

| Code | Official meaning |
|---|---|
| -32300 | Request method is not POST ("если метод запроса не POST"). |
| -32700 | JSON parse error. |
| -32600 | Required fields missing from the RPC request, or field types do not match the specification. |
| -32601 | Requested method not found; the method name goes into `data`. |
| -32504 | Insufficient privileges to execute the method (auth failure). |
| -32400 | System / internal error (DB failure, filesystem failure, undefined behaviour). Also what Payme assumes for any non-200 HTTP status. |

Method-level errors (page "Ошибки (ERRORS)" + per-method pages):

| Code | Official meaning | Returned by |
|---|---|---|
| -31001 | "Неверная сумма" — wrong amount | CheckPerformTransaction, CreateTransaction |
| -31003 | "Транзакция не найдена" — transaction not found | PerformTransaction, CancelTransaction, CheckTransaction |
| -31007 | "Заказ выполнен. Невозможно отменить транзакцию. Товар или услуга предоставлена покупателю в полном объеме." — cannot cancel | CancelTransaction |
| -31008 | "Невозможно выполнить операцию" — operation cannot be performed | CreateTransaction, PerformTransaction |
| -31050 … -31099 | Errors of wrong `account` input by the buyer (login/phone/order not found, etc.); any code in the range, chosen by the merchant | CheckPerformTransaction, CreateTransaction, PerformTransaction |

`-31099` is not a separately documented code; it is only the upper bound of the account-error range. `-31099` as a dedicated code: **UNVERIFIED**.

## 4. Data types (page "Типы данных")

| Type | Definition |
|---|---|
| `ID` | String, 24 characters, unique object identifier (Payme transaction id). |
| `Timestamp` | Positive 13-digit integer — milliseconds since 1970-01-01 UTC. |
| `Amount` | Positive integer > 0, **in tiyin** (1 so'm = 100 tiyin). |
| `Account` | JSON object; its fields are defined per cash register in the merchant cabinet (e.g. `order_id`, `phone`, `login`). |
| `Receiver` | `{ "id": ID (cash-register id), "amount": Amount }` — used for split payments; optional. |
| `State` | 1 = "Транзакция успешно создана, ожидание подтверждения (начальное состояние 0)"; 2 = "Транзакция успешно завершена (начальное состояние 1)"; -1 = "Транзакция отменена (начальное состояние 1)"; -2 = "Транзакция отменена после завершения (начальное состояние 2)". |
| `Reason` | 1 = one or more receivers not found/inactive in Payme Business; 2 = error executing the debit operation in the processing centre; 3 = transaction execution error; 4 = cancelled by timeout; 5 = refund ("Возврат денег"); 10 = unknown error. Codes 6–9 are **not documented**. |
| `Transaction` (GetStatement element) | `id, time, amount, account, create_time, perform_time, cancel_time, transaction, state, reason, receivers[]`. |

## 5. Methods the merchant must implement

The current official index lists exactly six methods (CheckPerformTransaction, CreateTransaction, PerformTransaction, CancelTransaction, CheckTransaction, GetStatement) plus the optional SetFiscalData. `SetFiatPrice` and `ChangePassword` do **not** appear in the current Merchant API method index — not required (**UNVERIFIED** whether they exist anywhere else).

### 5.1 CheckPerformTransaction

- Purpose: "Если оплата возможна — метод возвращает результат allow. Если оплата невозможна — метод возвращает ошибку." Recommended to verify every subsystem used by Create/Perform here and return -32400 if any is down.
- Params: `amount` (Amount, tiyin), `account` (Account).
- Result: `allow` (Boolean) — "Если флаг true, транзакция может быть проведена. В других случаях метод возвращает ошибки: -31001; -31050 — -31099." (Do not return `allow:false`; return an error instead.)
- Optional `additional` object (free-form extra info such as balance/order data) — if used, tell a Payme technical specialist.
- Optional `detail` object for fiscalization:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `receipt_type` | Number | yes | "Продажа/Возврат = 0" |
| `shipping` | Object `{title, price}` | no | delivery line, price in tiyin |
| `items` | Array | yes (for fiscalization) | goods/services lines |
| `items[].discount` | Number | no | discount for the whole line, tiyin |
| `items[].title` | String | yes | product name |
| `items[].price` | Number | yes | unit price, tiyin |
| `items[].count` | Number | yes | quantity |
| `items[].code` | String | yes | ИКПУ (product/service identification code) |
| `items[].units` | Number | no | unit-of-measure code |
| `items[].package_code` | String | yes | package code (from the ИКПУ catalogue) |
| `items[].vat_percent` | Number | yes | VAT percent |

- Errors: -31001, -31050…-31099.

### 5.2 CreateTransaction

- Params: `id` (ID — Payme transaction id), `time` (Timestamp — creation time in Payme Business), `amount` (Amount, tiyin), `account` (Account).
- Result: `create_time` (Timestamp — creation time in the merchant system), `transaction` (String — merchant's own transaction id, "формат строки определяется мерчантом"), `state` (State, = 1), `receivers` (Receiver[] — optional; omit or `null` when the app owner is the sole receiver).
- Implementation requirements (official list): store transactions in persistent storage; check that the payer account exists (else -31050…-31099); check the amount equals the invoice amount; reserve the order and all its items until payment or timeout cancellation; prevent the buyer from changing the order; set unpaid orders to "ожидание оплаты".
- Repeat rule: "Если транзакция уже создана, приложение мерчанта производит базовую проверку транзакции и возвращает результат проверки в Payme Business." The sandbox page adds: "При повторных вызовах методов CreateTransaction, PerformTransaction, CancelTransaction ответ должен совпадать с ответом из первого запроса" — a repeated CreateTransaction with the same `id` must return the same `create_time`, `transaction`, `state`.
- Second transaction for the same order: the sandbox expects "на запрос к методу CreateTransaction c новой транзакцией и состоянием счета «В ожидании оплаты» — ответ с ошибкой **-31008**: “Невозможно выполнить операцию”" (one-time account such as a shop order already has a pending transaction). PHP template note: the template instead returns -31050 (`ERROR_INVALID_ACCOUNT`, "There is other active/completed transaction for this order.") for a different-id active/completed transaction on the same order, and -31008 ("Transaction found, but is not active.") when the same id is found in a non-created state. Follow the official sandbox expectation (-31008); the divergence is recorded here so reviewers are not surprised.
- Timeout: "Отмена транзакции по таймауту производится через 12 часов — **43 200 000 миллисекунд** с момента создания транзакции в Payme Business. После отмены по таймауту транзакция переходит в состояние: “Транзакция отменена” (-1), с причиной: “Отмена по таймауту” (4)." The prose does not say which error CreateTransaction returns for an expired `time`; the PHP template cancels the stored transaction with reason 4 and returns -31008 "Transaction is expired." (exact official code: **UNVERIFIED**, -31008 per template).
- Errors: -31001, -31008, -31050…-31099.

### 5.3 PerformTransaction

- Purpose: "зачисляет средства на счет мерчанта и выставляет у заказа статус «оплачен»".
- Params: `id` (ID).
- Result: `transaction` (String), `perform_time` (Timestamp — time of performing in merchant billing), `state` (= 2).
- Repeat rule: Payme "повторяет запрос с теми же параметрами" when a response is lost; the sandbox sends PerformTransaction twice and requires identical answers — so an already-performed transaction must return the **stored** `perform_time` and `state: 2` again, not a new timestamp.
- Expired transaction: the page lists -31008 "Невозможно выполнить данную операцию. (см. диаграмму)" — the diagram is an image, so the textual rule is **UNVERIFIED**; the PHP template cancels with reason 4 (state -1) and returns -31008 "Transaction is expired." when `now - create_time >= 43 200 000 ms` and state is still 1.
- Errors: -31003, -31008, -31050…-31099.

### 5.4 CancelTransaction

- Purpose: "отменяет как созданную, так и проведенную транзакцию".
- Params: `id` (ID), `reason` (Reason — see §4; Payme supplies 1, 2, 3, 4, 5 or 10).
- Result: `transaction` (String), `cancel_time` (Timestamp), `state` (-1 if cancelled from state 1; -2 if cancelled after perform — official example shows -2).
- Rules: if the goods/service were fully delivered and cannot be reversed, return -31007. "Возврат денег покупателю возможен только если реализован метод CancelTransaction" — refunds from the merchant cabinet are executed through this method. Repeated CancelTransaction must return the same answer (sandbox rule) — return the stored `cancel_time`.
- Errors: -31003, -31007.

### 5.5 CheckTransaction

- Params: `id` (ID).
- Result: `create_time`, `perform_time`, `cancel_time` (Timestamps; the official example uses `0` for a time that has not happened), `transaction` (String), `state` (State), `reason` (Reason or `null`).
- Errors: -31003.

### 5.6 GetStatement

- "Реализация метода GetStatement обязательна!" Used for reconciliation acts.
- Params: `from` (Timestamp), `to` (Timestamp).
- Result: `transactions` (array of Transaction, see §4; the response table on the page spells the field `transaction` but both JSON examples use `"transactions"` — use `transactions`). Empty array when nothing matches.
- Rules: filter by the Payme creation time (`time` received in CreateTransaction), inclusive `from <= time <= to`; include only transactions whose CreateTransaction succeeded; sort ascending by creation time.

### 5.7 SetFiscalData (optional)

"Данный метод не обязателен к реализации." Payme calls it after a receipt is fiscalized. Params: `id` (String — receipt id in Payme), `type` (String — `"PERFORM"` or `"CANCEL"`), `fiscal_data` object with `receipt_id`, `status_code`, `message`, `terminal_id`, `fiscal_sign`, `qr_code_url`, `date` (types as summarised from the page). Result: `{ "result": { "success": true } }`. Errors: -32001 (receipt not found), -32700 (invalid JSON), -32602 (invalid params). PERFORM and CANCEL produce two distinct fiscal receipts — store both.

## 6. Lifecycle, timeout and idempotency summary

```
CheckPerformTransaction(amount, account) -> {allow:true} | error
CreateTransaction(id,time,amount,account) -> state 1   (repeat with same id -> same result)
PerformTransaction(id)                    -> state 2   (repeat -> same perform_time)
CancelTransaction(id, reason)             -> state -1 (from 1) | -2 (from 2)   (repeat -> same cancel_time)
CheckTransaction(id), GetStatement(from,to) are read-only
```

- Official flow (schema page): Payme creates the transaction → merchant checks amount and params, stores it, reserves the order ("ожидание оплаты"), returns receivers → Payme debits all receivers → processing centre confirms → Payme performs → merchant records payment and confirms. On a debit error Payme calls CancelTransaction.
- Retries: for CreateTransaction and PerformTransaction, "В случае потери ответа при вызове метода, Payme Business повторяет запрос с теми же параметрами." Sandbox: Create/Perform/Cancel "посылаются два раза… ответ должен совпадать с ответом из первого запроса."
- Timeout: 12 h = 43 200 000 ms from the Payme creation time → state -1, reason 4. Keep `time` from CreateTransaction to compute it.
- One active transaction per one-time account (order): second CreateTransaction with a different `id` → -31008 (sandbox). Accumulating accounts (e.g. a phone balance) may receive unlimited transactions.
- Response time: no numeric per-request limit is documented. "Если Payme Business в течении длительного времени не получает ответа от приложения, процесс оплаты приостанавливается и управление транзакцией производится в ручном режиме." A hard timeout value: **UNVERIFIED**.

## 7. Checkout initiation (merchant → Payme)

### 7.1 GET link

Format: `<checkout_url>/base64(params)`; parameters `key=value`, separated by `;`. Account fields are addressed as `ac.<field>` (e.g. `ac.order_id=197`).

| Param | Meaning |
|---|---|
| `m` | Merchant (web cash register) ID or alias |
| `ac` | Account object → `ac.<field>=<value>` |
| `a` | Amount **in tiyin** |
| `l` | Language: `ru`, `uz`, `en` |
| `c` | Return URL after payment or cancellation |
| `ct` | Delay in ms after a successful payment before redirecting back |
| `cr` | Currency code in ISO format |

Official example: `https://checkout.paycom.uz/base64(m=587f72c72cac0d162c722ae2;ac.order_id=197;a=500)` → `https://checkout.paycom.uz/bT01ODdmNzJjNzJjYWMwZDE2MmM3MjJhZTI7YWMub3JkZXJfaWQ9MTk3O2E9NTAw` (5 so'm).

Hosts: production checkout `https://checkout.paycom.uz`; sandbox "URL отправки чека в песочницу: `https://test.paycom.uz`" (sandbox page; the POST form example also posts to `https://test.paycom.uz`). The GET page itself only says `<checkout_url>`, so `https://test.paycom.uz/base64(...)` for test links is derived, not quoted verbatim. `checkout.test.paycom.uz/api` is the **Subscribe API** test endpoint, not the checkout page.

### 7.2 POST form

`<form method="POST" action="https://checkout.paycom.uz">` (test: `https://test.paycom.uz`). Fields: `merchant` (web cash register ID), `amount` (tiyin), `account[<field>]`; optional `lang` (ru|uz|en, default ru), `callback` (return URL; if omitted taken from `Referer`; placeholders `:transaction` — transaction id or `"null"` — and `:account.{field}`), `callback_timeout` (ms, default 15), `description` or `description[{lang}]`, `detail` (BASE64-encoded JSON with the same `receipt_type/shipping/items` structure as §5.1).

### 7.3 Button / QR script

Include `https://cdn.paycom.uz/integration/js/checkout.min.js`; `Paycom.Button(form_selector, button_container_selector)` and `Paycom.QR(form_selector, qr_container_selector)` read the same hidden form fields (`merchant`, `account[order_id]`, `amount`, `lang`) and send the user to `https://checkout.paycom.uz/`.

### 7.4 Receipt-sending errors (checkout side)

-31601 merchant not found/blocked; -31610 invalid field value; -31611 amount below minimum; -31612 amount above maximum; -31622 merchant service unavailable; -31623 merchant service misbehaving; -31630 card problem (insufficient funds, wrong number, expired, blocked, corporate card).

## 8. Network and operational requirements

- Source IPs: "Payme Business отправляет запросы в биллинг мерчанта только со следующих ip-адресов": 185.234.113.1, 185.234.113.2, 185.234.113.3, 185.234.113.4, 185.234.113.5, 185.234.113.6, 185.234.113.7, 185.234.113.8, 185.234.113.9, 185.234.113.10, 185.234.113.11, 185.234.113.12, 185.234.113.13, 185.234.113.14, 185.234.113.15 (i.e. 185.234.113.1–15). "Payme Business не использует другие ip-адреса для отправки запросов." (Use as an allow-list in addition to, not instead of, the Basic-auth check.)
- Recommended HTTP server settings: ssl session cache = 1 MB; ssl session timeout ≥ 10 min; keepalive timeout = 10 min.
- The endpoint URL is configured in the cash register settings ("Endpoint URL — веб-адрес биллинга").
- Testing against production "создает дополнительную нагрузку"; accounts tied to misbehaving apps get blocked — use the sandbox.

## 9. Sandbox (https://test.paycom.uz) — what the automated tests expect

Enter Merchant ID + `TEST_KEY`; account type "одноразовый" for orders. Scenario 1 (create + cancel unconfirmed) and scenario 2 (create + perform + cancel confirmed). Expected answers: wrong auth → -32504; wrong amount → -31001 from CheckPerformTransaction and CreateTransaction; non-existent account → -31050…-31099; CheckPerformTransaction → `allow:true`; CreateTransaction and its repeat → identical OK; CheckTransaction → OK; CreateTransaction with a new id while the account is "В ожидании оплаты" → -31008; CancelTransaction (state 1) → OK; PerformTransaction and its repeat → identical OK; CancelTransaction after perform → OK.

## 10. UNVERIFIED / not documented

- Literal Basic-auth login `Paycom` (official docs say "ask a Payme technical specialist"; only the PHP template hardcodes it).
- Exact error code CreateTransaction/PerformTransaction must return for an expired transaction (prose only references a diagram; template uses -31008).
- A numeric response-time limit for the merchant endpoint.
- Reason codes 6–9; a dedicated meaning for -31099.
- Existence of `SetFiatPrice` / `ChangePassword` in the current protocol (absent from the method index).
- The sandbox host for GET links (`https://test.paycom.uz/base64(...)`) is inferred from the sandbox page, not shown as a worked example.
