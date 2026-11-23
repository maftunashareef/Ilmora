# Click — SHOP API (Prepare / Complete) and Merchant API reference

Scope: what ILMORA's NestJS backend must expose for Click's SHOP API callbacks, how to start a Click payment, and the Merchant API calls useful for invoices, status checks and reversals. Facts come from the official Click documentation (docs.click.uz) unless marked otherwise; anything not confirmed there is **UNVERIFIED**. No merchant credentials appear in this file.

## Sources

All pages read on 2026-10-18. docs.click.uz is a JavaScript single-page app: a plain HTTP fetch of any path returns only the overview shell, so every page below was read in a rendered browser (Russian edition; an `/en` edition exists but was not read).

- https://docs.click.uz/ (overview; "Prepare и Complete, описанных в разделе SHOP API")
- https://docs.click.uz/shop-api (SHOP API — Общее)
- https://docs.click.uz/shop-api/requests (SHOP API — Запросы: Prepare/Complete fields, sign_string formulas, notes)
- https://docs.click.uz/shop-api/errors (SHOP API — Ошибки)
- https://docs.click.uz/merchant-api (Merchant API — Общее)
- https://docs.click.uz/merchant-api/requests (Merchant API — auth header, all endpoints)
- https://docs.click.uz/merchant-api/errors (Merchant API — HTTP status codes)
- https://docs.click.uz/click-button (Платежная ссылка / payment button)
- https://docs.click.uz/click-pay-by-card (JS checkout widget)
- https://docs.click.uz/additional/example (links to Click's own PHP/Django examples)
- https://github.com/click-llc/click-integration-php (provider's own example; README contains no protocol details beyond method names)

Not found on any page read: a list of Click source IP addresses, a merchant response time limit, a retry count/schedule, enumerated `payment_status` / `invoice_status` values, enumerated Merchant API `error_code` values. See §9.

## 1. SHOP API transport

| Item | Official statement |
|---|---|
| Direction | Click → merchant ("Созданный платёж в системе CLICK передаётся … методом POST API-интерфейсу Поставщика услуг"). The merchant gives Click the URL(s) of its API ("Поставщик предоставляет системе CLICK URL-адреса"). |
| HTTP | `POST` over HTTP(S). |
| Request Content-Type | `application/x-www-form-urlencoded`; body is form-data (urlencoded). |
| Response | `application/json`. |
| Stages | Two: **Prepare** (`action=0`) then **Complete** (`action=1`). |
| Amount unit | `amount` is `float`, "Сумма оплаты (в сумах)" — so'm, not tiyin. Payment links use the format `N.NN`. |
| Currency | Only so'm (UZS) is implied; no currency parameter exists in SHOP API. ISO code: **UNVERIFIED** (not stated). |
| sign_time format | `YYYY-MM-DD HH:mm:ss`. |
| SECRET_KEY | "уникальная строка, выдаваемая Поставщику при подключении"; never sent on the wire, only hashed into `sign_string`. |

## 2. Prepare request (action = 0)

Request fields (form-urlencoded):

| # | Field | Type | Meaning |
|---|---|---|---|
| 1 | `click_trans_id` | bigint | Transaction (iteration) number in Click |
| 2 | `service_id` | int | Service ID |
| 3 | `click_paydoc_id` | bigint | Payment document number in Click |
| 4 | `merchant_trans_id` | varchar | Order ID / account / login in the merchant system |
| 5 | `amount` | float | Amount in so'm |
| 6 | `action` | int | `0` for Prepare |
| 7 | `error` | int | Status code; `0` = success |
| 8 | `error_note` | varchar | Status description |
| 9 | `sign_time` | varchar | `YYYY-MM-DD HH:mm:ss` |
| 10 | `sign_string` | varchar | `md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + amount + action + sign_time)` |

`+` is string concatenation, in exactly that order, with no separators. Use the raw string values as received in the form body (e.g. `amount` exactly as sent, `action` as `0`); any normalisation is **UNVERIFIED** and should be avoided.

Merchant response (JSON):

| # | Field | Type | Meaning |
|---|---|---|---|
| 1 | `click_trans_id` | bigint | Echo of the Click payment ID |
| 2 | `merchant_trans_id` | varchar | Echo of the order / account ID |
| 3 | `merchant_prepare_id` | int | Payment ID in the merchant's billing (your prepared-payment record id) |
| 4 | `error` | int | `0` = success, else a negative code from §4 |
| 5 | `error_note` | varchar | Status description |

Checks required at Prepare ("Проверки на этапе Prepare"): the order / login / account exists and is current and the goods or service can be delivered; the order or payment amount is current (matches). "Для интернет-магазинов при получении запроса Prepare Поставщик должен зарезервировать товар для предотвращения повторной продажи."

## 3. Complete request (action = 1)

Request fields:

| # | Field | Type | Meaning |
|---|---|---|---|
| 1 | `click_trans_id` | bigint | Payment ID in Click |
| 2 | `service_id` | int | Service ID |
| 3 | `click_paydoc_id` | bigint | Payment document number in Click |
| 4 | `merchant_trans_id` | varchar | Order / account / login |
| 5 | `merchant_prepare_id` | int | The id the merchant returned from Prepare |
| 6 | `amount` | float | Amount in so'm |
| 7 | `action` | int | `1` for Complete |
| 8 | `error` | int | Status code (may be negative — see §5) |
| 9 | `error_note` | varchar | Status description |
| 10 | `sign_time` | varchar | Payment date, `YYYY-MM-DD HH:mm:ss` |
| 11 | `sign_string` | varchar | `md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + merchant_prepare_id + amount + action + sign_time)` |

Merchant response (JSON):

| # | Field | Type | Meaning |
|---|---|---|---|
| 1 | `click_trans_id` | bigint | Echo |
| 2 | `merchant_trans_id` | varchar | Echo |
| 3 | `merchant_confirm_id` | int | ID of the completion transaction in the merchant system |
| 4 | `error` | int | `0` = success, else negative code |
| 5 | `error_note` | varchar | Status description |

Official notes on Complete (verbatim-faithful):

- "При успешном ответе на запрос Prepare и успешном списании средств с карты, ответ на запрос Complete не может быть ошибочным, за исключением случаев, когда платёж уже был ранее подтверждён (error = -4) либо выполняется повторная попытка подтверждения ранее отменённого платежа (error = -9)."
- "При получении ошибочного ответа от Поставщика после нескольких попыток платёж может быть переведён в состояние ручного разбирательства со стороны Службы технической поддержки CLICK." — Click retries Complete on error responses; the number and timing of retries are **UNVERIFIED**.
- "В случае возникновения ошибки предоставления услуги или продажи товара после успешного списания средств во время выполнения запроса Complete, Биллинг Поставщика должен ответить на запрос Complete «успешно» и инициировать запрос на отмену платежа (см. … метод payment/reversal)." — i.e. once the card is debited, answer `error: 0` and refund through Merchant API `DELETE payment/reversal` (§8), rather than returning an error.

## 4. Error codes

Response shape (SHOP API — Ошибки): on success `error`, `error_note`, `click_trans_id`, `merchant_trans_id`, `merchant_prepare_id` **or** `merchant_confirm_id`; on failure at least `error`, `error_note`.

Codes sent **by Click** in the request's `error` field:

| error | error_note | Meaning |
|---|---|---|
| 0 | Success | Operation successful |
| < 0 | error description | "При получении отрицательного кода ошибки Поставщик должен аннулировать платёж в биллинговой системе и вернуть код ошибки -9" |

Codes returned **by the merchant**:

| error | error_note (official text) | Meaning | Use for |
|---|---|---|---|
| 0 | Success | Successful request | normal Prepare / Complete |
| -1 | SIGN CHECK FAILED! | Signature check failed | `sign_string` mismatch |
| -2 | Incorrect parameter amount | Wrong payment amount | amount ≠ order amount |
| -3 | Action not found | Requested action not found | `action` not 0/1 |
| -4 | Already paid | Transaction was confirmed earlier | order already paid / Complete repeated after success |
| -5 | User does not exist | User / order not found (`merchant_trans_id`) | unknown order |
| -6 | Transaction does not exist | Transaction not found (`merchant_prepare_id`) | Complete with unknown prepare id |
| -7 | Failed to update user | Error updating user data | internal failure when marking paid |
| -8 | Error in request from click | Error in the request from Click | malformed / missing fields |
| -9 | Transaction cancelled | Transaction was cancelled earlier | Complete with `error < 0`, or Complete on an already-cancelled payment |

Signalling cheat-sheet: already paid → -4; wrong amount → -2; order not found → -5; sign check failed → -1; transaction cancelled → -9.

## 5. Complete with a non-zero `error` (payment cancelled by user/bank)

Per §4 (Click-side codes): when Complete arrives with `error < 0`, the merchant must void the prepared payment in its billing (release the reservation / mark cancelled) and respond with `error: -9` ("Transaction cancelled"). A later Complete retry for that payment also gets -9 (that case is explicitly allowed by the note in §3). Still validate `sign_string` first; a bad signature is -1 regardless of `error`.

## 6. Idempotency and ordering (derived from the official notes)

- Prepare for an order that is already paid → -4; Prepare while a previous prepare is still open: not specified (**UNVERIFIED**) — returning the same `merchant_prepare_id` is the conservative choice.
- Complete repeated after a successful Complete → -4 (official exception). Complete after cancellation → -9 (official exception).
- Click may retry Complete "после нескольких попыток" before escalating to manual review; make Complete safe to re-run.
- The `merchant_prepare_id` you return is echoed back in Complete and is part of the Complete signature — store it with the order.

## 7. Payment initiation (merchant → Click)

### 7.1 Payment link (page "Платежная ссылка")

`https://my.click.uz/services/pay/?service_id={service_id}&merchant_id={merchant_id}&amount={amount}&transaction_param={transaction_param}&return_url={return_url}&card_type={card_type}` (note the trailing slash in `/pay/`; the HTML-form variant uses `method="get"` to the same action).

| Param | Required | Meaning |
|---|---|---|
| `merchant_id` | mandatory | Merchant (supplier) ID |
| `merchant_user_id` | optional | User ID in the merchant system |
| `service_id` | mandatory | Service ID |
| `transaction_param` | mandatory | Order / account / login; "Соответствует merchant_trans_id из SHOP API" |
| `amount` | mandatory | "Сумма транзакции (формат N.NN)" — so'm with two decimals (official PHP sample: `number_format(1000, 2, '.', '')`) |
| `return_url` | optional | URL to return the user to after payment |
| `card_type` | optional | Payment system: `uzcard`, `humo` |

### 7.2 In-page card widget (page "Оплата по карте")

Script `https://my.click.uz/pay/checkout.js`; either a `<script class="uzcard_payment_button" data-service-id data-merchant-id data-transaction-param data-merchant-user-id data-amount data-card-type data-label>` inside a form (the form is auto-submitted afterwards with an extra `status` param) or `createPaymentRequest({service_id, merchant_id, amount, transaction_param, merchant_user_id, card_type}, callback)`. Widget `status`: `< 0` error, `0` created, `1` processing, `2` completed. Supports UZCARD and HUMO; card data never reaches the merchant. The SHOP API callbacks still happen server-side.

## 8. Merchant API (merchant → Click, `https://api.click.uz/v2/merchant/`)

Credentials issued at registration: `merchant_id`, `service_id`, `merchant_user_id`, `secret_key` ("secret_key является конфиденциальным параметром").

Authentication header on every call:

```
Auth: merchant_user_id:digest:timestamp
digest    = sha1(timestamp + secret_key)   // hex, string concatenation
timestamp = UNIX time in seconds, 10 digits
```

Required headers: `Accept`, `Content-Type` (both `application/json`; `application/xml` also supported), `Auth`.

| Endpoint | Method | Request | Response |
|---|---|---|---|
| `invoice/create` | POST | `{ service_id:int, amount:float, phone_number:string, merchant_trans_id:string }` | `{ error_code, error_note, invoice_id:bigint }` |
| `invoice/status/:service_id/:invoice_id` | GET | — | `{ error_code, error_note, invoice_status:bigint, invoice_status_note }` (example: `-99` = "Удалён"; other values **UNVERIFIED**) |
| `payment/status/:service_id/:payment_id` | GET | — | `{ error_code, error_note, payment_id, payment_status }` (example `1`; value set **UNVERIFIED**) |
| `payment/status_by_mti/:service_id/:merchant_trans_id/YYYY-MM-DD` | GET | — | `{ error_code, error_note, payment_id, merchant_trans_id }` — date is the payment date, `YYYY-MM-DD` |
| `payment/reversal/:service_id/:payment_id` | DELETE | — | `{ error_code, error_note, payment_id }` |
| `card_token/request` | POST | `{ service_id, card_number, expire_date:"MMYY", temporary:0|1 }` (no `Auth` shown in the official example) | `{ error_code, error_note, card_token, phone_number, temporary }` |
| `card_token/verify` | POST | `{ service_id, card_token, sms_code }` | `{ error_code, error_note, card_number }` |
| `card_token/payment` | POST | `{ service_id, card_token, amount, transaction_parameter }` | `{ error_code, error_note, payment_id, payment_status }` |
| `card_token/:service_id/:card_token` | DELETE | — | `{ error_code, error_note }` |

Reversal conditions ("Условия отмены платежа"): payment must be successfully completed; refunds only for payments of the current reporting month; last month's payments only on the first day of the current month; payment must have been made with an online card; UZCARD may decline the reversal.

Merchant API errors (page "Ошибки"): signalled with HTTP status codes — 200 OK, 201 OK, 400 Bad Request, 401 Not Authorized, 403 Forbidden, 404 Not Found, 406 Not Acceptable, 410 Gone, 500 Internal Server Error, 502 Service Unavailable. Body `error_code` values other than `0` are not enumerated (**UNVERIFIED**).

## 9. UNVERIFIED / not documented (as of 2026-10-18)

- Click source IP addresses for Prepare/Complete — no list on any docs page read; use `sign_string` verification as the primary control.
- Maximum merchant response time for Prepare/Complete.
- Retry count and intervals for Complete ("после нескольких попыток" only).
- Whether Prepare is retried, and what to return for a repeated Prepare on an open (unpaid) order.
- Exact string form of `amount` inside `sign_string` (docs give the formula only; concatenate the received value unchanged).
- Currency code; enumerated `payment_status` and `invoice_status` values; Merchant API body `error_code` catalogue.
- Whether Prepare and Complete must be two distinct URLs or may share one (docs say "URL-адреса", plural).

## 10. How ILMORA answers (restored 23.11.2026)

Click was removed on 10.11.2026 (security review 10.11 №5, №6) and brought back on 23.11.2026 once a contract was signed.
Code: `apps/api/src/modules/payments/click/`; tests: `apps/api/test/click.test.ts`.

- **Only with the full settings (№5).** `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID` and `CLICK_SECRET_KEY` together; with a part
  of them production refuses to start, elsewhere Click stays off and every callback gets `-8` without touching the
  database. A signature is never computed without the secret.
- **One invoice, one payment (№6).** Prepare is refused (`-9`) while another attempt runs on the invoice — a second Click
  tab or a Payme transaction; Payme's CreateTransaction is refused (`-31008`) while a Click attempt runs. An attempt that
  passed Prepare and got no Complete for `CLICK_PENDING_MINUTES` (default 30) is abandoned: it is cancelled
  (`cancelReason` 4) and stops blocking — the next Prepare, or the seat-hold expiry, closes it.
- **Complete.** Repeated after success → `-4` (no second booking). `error < 0` from Click → this attempt is cancelled,
  `-9`; the invoice stays open inside its hold. Complete for an attempt closed here → `-9`; if Click says it debited the
  card, the row is marked (`providerState` 1) and the reconciliation shows `check_with_provider`.
- **Money that bought nothing.** Click debits before Complete, so for an invoice that can no longer be fulfilled
  (cancelled meanwhile, the month paid by another invoice) the answer is success per §3, and the money goes back by hand
  in the Click cabinet: the reconciliation shows `refund_required` (or `double_payment` for a second performed
  transaction on one invoice), and an outbox event `payment.refund_required` lands in the audit log.
- **Not connected:** Merchant API (status, reversal, invoices) — no `merchant_user_id`; reconcile against the statement in
  the Click cabinet. Fiscalization: ILMORA sells under one ИКПУ (`PAYME_FISCAL_IKPU`); Click's letter of 23.11 asks for
  its fiscalization method only with more than one ИКПУ. **UNVERIFIED:** how Click learns that one code — confirm in the
  integration group which ИКПУ and package code the service fiscalizes under.
- **Payment page.** `https://my.click.uz/services/pay/?service_id=…&merchant_id=…&amount=N.NN&transaction_param=<payment id>&return_url=…`:
  a Click user pays from the app, anybody else by card on the same page («оплата без регистрации»).
