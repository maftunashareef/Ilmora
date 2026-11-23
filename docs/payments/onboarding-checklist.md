# Enabling Payme and Click — onboarding checklist

Click was removed from the code on 10.11.2026 and brought back on 23.11.2026, when the Click contract was signed, with
security review 10.11 №5 and №6 closed (`docs/payments/click-shop-api.md` §10).

The integration is already in the code (adapters, hosted-checkout links, webhooks, reconciliation, the admin
Finance screen). Nothing needs to be programmed. What remains is a **business + configuration** task: sign a
merchant contract with each provider, put the issued credentials into the server environment, and register the
callback URLs. A provider appears on the checkout page automatically once its keys are set
(`GET /v1/payments/providers` reports each provider as available only when configured). Go live per provider: Payme can
be live while Click is still being tested, or the other way round.

Domain assumed below: `https://ilmoraa.uz` (the public site; Caddy forwards `/v1/*` and the provider callbacks under
`/payments/*` to the API). Replace it if the domain changes — and change it together with `PUBLIC_WEB_URL` /
`CORS_ORIGINS` in `infra/uzcloud/api.env`.

## What you provide
- A legal entity (ООО / ЮрЛицо or ИП) and its bank account (расчётный счёт).
- The usual KYC documents the providers ask for (certificate, director's details, etc.).

## URLs to register (give these to the providers)
| Provider | Setting in the cabinet | URL |
| --- | --- | --- |
| Payme (Paycom) | Merchant API endpoint (they call it) | `https://ilmoraa.uz/payments/payme` |
| Click (SHOP API) | Адрес проверки (Prepare) | `https://ilmoraa.uz/payments/click/prepare` |
| Click (SHOP API) | Адрес результата (Complete) | `https://ilmoraa.uz/payments/click/complete` |

The callbacks have **no `/v1` prefix**: the API serves them outside it (`apps/api/src/main.ts`), so
`https://ilmoraa.uz/v1/payments/…` answers 404 and every provider call would fail.

The customer's return page after payment is served by the site itself (`/<lang>/payments/<id>/return`); no cabinet
setting is needed for it.

## Credentials you receive → environment variable
Set these in `infra/uzcloud/api.env` on **both** machines (identical content), then restart the worker (ilmora-admin)
and the API (ilmora-web) — step 3.
Never commit the file, never paste the keys into a chat.

| Provider | Cabinet value | Variable |
| --- | --- | --- |
| Payme | Кассa ID | `PAYME_MERCHANT_ID` |
| Payme | Key (production) | `PAYME_KEY` |
| Payme | Test key (sandbox) | `PAYME_TEST_KEY` |
| Click | Service ID | `CLICK_SERVICE_ID` |
| Click | Merchant ID | `CLICK_MERCHANT_ID` |
| Click | Secret key | `CLICK_SECRET_KEY` |

Click takes part only with **all three** `CLICK_*` values: with a part of them the API refuses to start in production
(security review №5). Merchant User ID is not needed (the Merchant API is not connected). Optional: `CLICK_ALLOWED_IPS`
(Click does not publish its addresses; leave empty) and `CLICK_PENDING_MINUTES` (default 30 — how long an attempt that
passed Prepare blocks other attempts on the invoice).

Optional source-IP allow-list: `PAYME_ALLOWED_IPS` (comma-separated; leave empty to accept any).
Payme publishes its callers as 185.234.113.1 – 185.234.113.15; the full comma-separated line is in
`infra/uzcloud/api.env.example`.

Fiscal receipt (Payme): `PAYME_FISCAL_IKPU`, `PAYME_FISCAL_PACKAGE_CODE`, `PAYME_FISCAL_VAT_PERCENT` — see Payme step 4.

## Steps

### 1. Payme (Paycom)
1. Register as a merchant at merchant.payme.uz with the legal entity and bank account.
2. Create a cash register (касса) for ILMORA. Give Payme the Merchant API endpoint from the table above.
3. In the cash register settings, the payment account ("реквизит" / account field) must be exactly:
   - field name (key) **`payment_id`**, type text (string): ILMORA puts its payment id there (`ac.payment_id` in the
     checkout link) and reads it back from every call. Any other name (`order_id`, `phone`, …) makes every Payme call
     fail with -31050 "order not found";
   - account type **one-time** ("одноразовый"): one order, one payment.
4. Fiscal receipt: ILMORA sends one receipt line per payment in CheckPerformTransaction. Get the ИКПУ (MXIK) code of
   the service and its package code from tasnif.soliq.uz, and the VAT rate of your tax regime, from your accountant;
   put them into `PAYME_FISCAL_IKPU`, `PAYME_FISCAL_PACKAGE_CODE`, `PAYME_FISCAL_VAT_PERCENT`. The code ships defaults
   for all three — do not rely on them for live receipts.
5. Receive the Кассa ID, the production key and the test key.
6. Sandbox (test.paycom.uz): production ignores `PAYME_TEST_KEY` by default, because a sandbox payment settles like a
   real one and activates a real subscription. Without a staging machine, pass Payme's tests on `ilmoraa.uz` this way:
   1. Create two test students, put a package in the cart, choose Payme and leave the payment unfinished. Note both
      payment ids and their amounts. Scenario 1 (create + cancel) uses the first order, scenario 2 (create + perform +
      cancel) the second; once cancelled, an order cannot be reused, so a rerun needs new orders.
   2. Within the hour the seats are held: in `api.env` `PAYME_MERCHANT_ID`, `PAYME_TEST_KEY`,
      `PAYME_SANDBOX_PAYMENT_IDS=<id1>,<id2>`. Restart the API. Listed orders do not expire while listed. Do **not**
      raise `PAYMENT_EXPIRES_HOURS`: production ignores values over 1 hour (security review №82) — a long hold for
      everybody let one person keep seats for a week.
   3. In the sandbox form: the amount in **tiyin** (the order's sum in so'm × 100), `payment_id` = the order id for the
      valid account, any other text for the invalid one.
   4. The test key now reaches only those two orders and the sandbox transactions on them; any other order looks
      absent (-31050) and live transactions look absent (-31003). The API logs a warning at start while the list is set.
      `apps/api/test/payme-sandbox-acceptance.test.ts` replays the whole sandbox checklist against this setup.
   5. After the tests: clear `PAYME_SANDBOX_PAYMENT_IDS` and `PAYME_TEST_KEY`, restart, and cancel the test students'
      subscriptions. The test transactions stay out of the live GetStatement (reconciliation act).
7. Live: put `PAYME_MERCHANT_ID` and `PAYME_KEY` on the production server (section 3, "Apply the config").

### 2. Click (SHOP API)
Click's integration group sent the steps on 23.11.2026; in ILMORA's terms:
1. The merchant contract, the cabinet (merchant.click.uz) and the three values from the table above.
2. **Fiscalization.** ILMORA sells under one ИКПУ (`PAYME_FISCAL_IKPU`). Click asks for its fiscalization method only
   with more than one ИКПУ — confirm in the group which ИКПУ and package code the service is fiscalized under.
3. **Click's test program** (docs.click.uz/click-api-testing) sends Prepare/Complete to the addresses you give it. There
   is no test key: the program signs with the live secret, and a Complete it sends **settles a real ILMORA invoice**
   (the subscription starts, revenue is booked) without money. So run it against a **local** API (`npm run dev`, with
   `CLICK_*` in `apps/api/.env`) if the program runs on your computer, not against `ilmoraa.uz`. Orders for it: a test
   student puts a package in the cart, chooses Click and leaves the payment page — `merchant_trans_id` = the payment id,
   `amount` = its sum in so'm with two decimals. The hold is an hour; after it Prepare answers `-9`, make a new order.
   Expected answers: §4 of `docs/payments/click-shop-api.md`; a second attempt on one order is refused with `-9` (№6).
4. **Server addresses.** UzCloud machines are in Tashkent; if `ilmora-web`'s address is not in TAS-IX, tell Click
   **before the first real payment**: the domain `ilmoraa.uz`, the static public IP of `ilmora-web` and port 443, for
   their firewall allow-list. The IP must stay the same: warn Click before changing the address or the domain.
5. Put the three `CLICK_*` values into `api.env` on both machines and restart (section 3).
6. In the cabinet: «Сервисы» → the pencil in the «Действие» column → the Prepare and Complete addresses from the table
   above → tell the group, and Click switches the service on (it is off by default).
7. **First real payment:** a small order on `ilmoraa.uz` paid with Click, with the Click Up app on the phone. Click's own
   sample link with `transaction_param=test` gets `-5` (order not found) from ILMORA by design: the transaction parameter
   must be a real payment id. Errors: Admin → Finance (filter Click) and the callback log (`ProviderCallbackLog`, no
   personal data) — send Click the request and the answer of the failing call.

### 3. Apply the config
```bash
# after editing infra/uzcloud/api.env — on ilmora-admin (the worker):
sh /opt/ilmora/infra/uzcloud/compose.sh admin up -d worker
# then on ilmora-web (the API):
sh /opt/ilmora/infra/uzcloud/compose.sh web up -d api
```
Both machines must hold the same `api.env` (see the note at the top of that file for copying it across).

### 4. Verify
- `curl -s https://ilmoraa.uz/v1/payments/providers` → `{"PAYME":true,"CLICK":true}` for the connected providers.
- The connected providers appear on the subscription checkout (Click is not shown at all until it is connected).
- Make one small real payment end to end on `ilmoraa.uz` (pending → paid) and confirm the return page shows "paid"
  and the fiscal receipt arrives in the Payme app.
- Open admin → Finance: the provider transaction, the internal payment and the ledger postings line up with no
  discrepancy. Use "manual settle" only for genuine off-channel payments.

## Notes
- Money is handled in tiyin (integer smallest unit); never introduce floats.
- The webhook endpoints are public and unthrottled by design — the providers' servers call them directly; requests
  are authenticated by each provider's own scheme (Payme Basic auth, Click `sign_string`), not by our session.
- One invoice is paid once: while a Payme or Click attempt runs on it, the other provider is refused; money taken that
  bought nothing shows in Finance as `refund_required` / `double_payment` and is returned by hand in that provider's
  cabinet.
