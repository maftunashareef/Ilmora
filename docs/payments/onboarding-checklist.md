# Enabling Payme and Click — onboarding checklist

The integration is already in the code (adapters, hosted-checkout links, webhooks, reconciliation, the admin
Finance screen). Nothing needs to be programmed. What remains is a **business + configuration** task: sign a
merchant contract with each provider, put the issued credentials into the server environment, and register the
callback URLs. A provider's "Pay" button appears on the site automatically once its keys are set
(`GET /v1/payments/providers` reports each provider as available only when configured).

Domain assumed below: `https://ilmoraa.uz` (the public site; `/v1/*` is forwarded to the API). Replace it if the
domain changes — and change it together with `PUBLIC_WEB_URL` / `CORS_ORIGINS` in `infra/uzcloud/api.env`.

## What you provide
- A legal entity (ООО / ЮрЛицо or ИП) and its bank account (расчётный счёт).
- The usual KYC documents the providers ask for (certificate, director's details, etc.).

## URLs to register (give these to the providers)
| Provider | Setting in the cabinet | URL |
| --- | --- | --- |
| Payme (Paycom) | Merchant API endpoint (they call it) | `https://ilmoraa.uz/v1/payments/payme` |
| Click (SHOP-API) | Prepare URL | `https://ilmoraa.uz/v1/payments/click/prepare` |
| Click (SHOP-API) | Complete URL | `https://ilmoraa.uz/v1/payments/click/complete` |

The customer's return page after payment is served by the site itself (`/<lang>/payments/<id>/return`); no cabinet
setting is needed for it.

## Credentials you receive → environment variable
Set these in `infra/uzcloud/api.env` on **both** machines (identical content), then restart the API/worker.
Never commit the file, never paste the keys into a chat.

| Provider | Cabinet value | Variable |
| --- | --- | --- |
| Payme | Кассa ID | `PAYME_MERCHANT_ID` |
| Payme | Key (production) | `PAYME_KEY` |
| Payme | Test key (sandbox) | `PAYME_TEST_KEY` |
| Click | Service ID | `CLICK_SERVICE_ID` |
| Click | Merchant ID | `CLICK_MERCHANT_ID` |
| Click | Merchant User ID | `CLICK_MERCHANT_USER_ID` |
| Click | Secret key | `CLICK_SECRET_KEY` |

Optional source-IP allow-lists: `PAYME_ALLOWED_IPS`, `CLICK_ALLOWED_IPS` (comma-separated; leave empty to accept any).

## Steps

### 1. Payme (Paycom)
1. Register as a merchant at merchant.payme.uz with the legal entity and bank account.
2. Create a cash register (касса) for ILMORA. Give Payme the Merchant API endpoint from the table above.
3. Receive the Кассa ID, the production key and the test key.
4. Put `PAYME_MERCHANT_ID` and `PAYME_TEST_KEY` on the server first (sandbox). Test (below). Then add `PAYME_KEY`
   and remove `PAYME_TEST_KEY` to go live.

### 2. Click (SHOP-API)
1. Apply for a Click merchant / SHOP-API with the same legal entity and bank account.
2. In the Click cabinet set the Prepare and Complete URLs from the table above.
3. Receive Service ID, Merchant ID, Merchant User ID and Secret key; set the four `CLICK_*` variables on the server.

### 3. Apply the config
```bash
# on each machine (ilmora-admin, then ilmora-web), after editing infra/uzcloud/api.env:
sh /opt/ilmora/infra/uzcloud/compose.sh <admin|web> up -d api worker
```
Both machines must hold the same `api.env` (see the note at the top of that file for copying it across).

### 4. Verify
- `curl -s https://ilmoraa.uz/v1/payments/providers` → the configured provider(s) report `true`.
- The "Pay" button for that provider appears on the subscription checkout.
- Make a real sandbox payment end to end (pending → paid), confirm the return page shows "paid".
- Open admin → Finance: the provider transaction, the internal payment and the ledger postings line up with no
  discrepancy. Use "manual settle" only for genuine off-channel payments.

## Notes
- Money is handled in tiyin (integer smallest unit); never introduce floats.
- The webhook endpoints are public and unthrottled by design — the providers' servers call them directly; requests
  are authenticated by each provider's own scheme (Payme Basic auth, Click signature), not by our session.
- Go live per provider independently: Payme can be live while Click is still being onboarded, or vice versa.
