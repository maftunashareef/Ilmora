# Enabling Payme — onboarding checklist

Click was removed from the code on 10.11.2026 (decision: ILMORA takes payments through Payme only).

The integration is already in the code (adapters, hosted-checkout links, webhooks, reconciliation, the admin
Finance screen). Nothing needs to be programmed. What remains is a **business + configuration** task: sign a
merchant contract with Payme, put the issued credentials into the server environment, and register the
callback URLs. The "Pay" button appears on the site automatically once the keys are set
(`GET /v1/payments/providers` reports Payme as available only when configured).

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

Optional source-IP allow-list: `PAYME_ALLOWED_IPS` (comma-separated; leave empty to accept any).

## Steps

### 1. Payme (Paycom)
1. Register as a merchant at merchant.payme.uz with the legal entity and bank account.
2. Create a cash register (касса) for ILMORA. Give Payme the Merchant API endpoint from the table above.
3. Receive the Кассa ID, the production key and the test key.
4. Sandbox: production ignores `PAYME_TEST_KEY` by default, because a sandbox payment settles like a real one and
   activates a real subscription. Without a staging machine, pass Payme's tests on `ilmoraa.uz` this way:
   1. Create two test students, put a package in the cart, choose Payme and leave the payment unfinished. Note both
      payment ids.
   2. In `api.env`: `PAYME_MERCHANT_ID`, `PAYME_TEST_KEY`, `PAYME_SANDBOX_PAYMENT_IDS=<id1>,<id2>`, and a long enough
      `PAYMENT_EXPIRES_HOURS` for the orders to outlive the test window. Restart the API.
   3. The test key now reaches only those two orders and the sandbox transactions on them; any other order looks
      absent (-31050) and live transactions look absent (-31003). The API logs a warning at start while the list is set.
   4. After the tests: clear `PAYME_SANDBOX_PAYMENT_IDS` and `PAYME_TEST_KEY`, restart, and cancel the test students'
      subscriptions.
5. Live: put `PAYME_MERCHANT_ID` and `PAYME_KEY` on the production server (step 3).

### 2. Apply the config
```bash
# after editing infra/uzcloud/api.env — on ilmora-admin (the worker):
sh /opt/ilmora/infra/uzcloud/compose.sh admin up -d worker
# then on ilmora-web (the API):
sh /opt/ilmora/infra/uzcloud/compose.sh web up -d api
```
Both machines must hold the same `api.env` (see the note at the top of that file for copying it across).

### 3. Verify
- `curl -s https://ilmoraa.uz/v1/payments/providers` → `{"PAYME":true}`.
- The Payme "Pay" button appears on the subscription checkout.
- Make one payment end to end (pending → paid) and confirm the return page shows "paid": a sandbox payment on the
  staging instance, then one small real payment on `ilmoraa.uz`.
- Open admin → Finance: the provider transaction, the internal payment and the ledger postings line up with no
  discrepancy. Use "manual settle" only for genuine off-channel payments.

## Notes
- Money is handled in tiyin (integer smallest unit); never introduce floats.
- The webhook endpoints are public and unthrottled by design — the providers' servers call them directly; requests
  are authenticated by Payme's Basic auth, not by our session.
