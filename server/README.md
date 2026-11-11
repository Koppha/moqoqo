# EcoCash Super App server

The backend for **EcoCash Super App**, the chat-and-payments app built on EcoCash (Econet Telecom Lesotho).
It serves the customer and business Expo apps (`/v1`, plus the WebSocket at `/v1/ws`) and the admin portal (`/admin/v1`).

`../shared/api.ts` is the API contract. Every route, body, response, error code and realtime event comes from that file.

- **Stack:** Node 22+ (developed on 24), TypeScript (ESM), Fastify 5, `@fastify/websocket`, zod.
- **Database:** PostgreSQL through `pg` when `DATABASE_URL` is set. Otherwise it uses embedded [PGlite](https://pglite.dev), persisted to `DATA_DIR` (default `server/.data/`), so it runs with no setup.
- **Money:** stored as integer cents and spoken as maloti in the API. Every movement runs in one DB transaction: the affected wallets are row-locked (`SELECT … FOR UPDATE`), a ledger row is written (reference `MP` + 10 digits), and a CHECK constraint forbids negative balances.
- **EcoCash:** `src/ecocash/` defines a small `Ledger` interface. `MockLedger` moves balances in the database for now. The real EcoCash API adapter will implement the same interface later, and the server stays authoritative for balances and the ledger.

## Run

```bash
cd server
npm install
npm run dev        # tsx watch on http://localhost:4000
npm run serve      # tsx without file watching (restart by hand)
npm test           # vitest: in-memory PGlite + fastify.inject + real ws clients
npm run typecheck  # tsc --noEmit
npm run build      # esbuild bundle → dist/ (includes shared/api.ts and migrations)
npm start          # node dist/index.js
```

> **Windows + embedded PGlite:** prefer `npm run serve` and restart it by hand after changes. `tsx watch` hard-kills
> the process on every file save, which can leave the embedded database in `server/.data` corrupted.

If `server/.env` exists, it is loaded on start (see `.env.example`). Real environment variables take precedence over it.

On start the server:

1. Applies `migrations/NNN_name.sql` in order. Applied files are tracked in `schema_migrations`, and each file runs in its own transaction.
2. Ensures the biller system wallets exist: LEC, WASCO, school fees, Econet airtime and the burial society.
3. Seeds the demo world, but only if there are no wallets yet.
4. Creates the first admin, but only if there are no admins yet.
5. Checks every 15 s whether a maintenance window has started or ended, and broadcasts `config` to all sockets.

`GET /health` returns `{ ok, db, sockets, time }`. It is meant for load balancers and is not part of the contract.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_URL` | unset | `postgres://…`. When unset, PGlite is used |
| `DATA_DIR` | `./.data` | PGlite data directory (ignored with `DATABASE_URL`) |
| `CORS_ORIGINS` | `http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:8081`, `http://localhost:19006` | Comma list of browser origins, or `*`. Native apps don't need CORS |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | unset | First admin. If unset on the first start, `admin@moqoqo.local` is created with a random password **printed once to the console** |
| `PUSH_ENABLED` | `false` | Send pushes through the Expo push service to registered phones (batches of 100, retries when Expo is busy, dead tokens removed from tickets and from receipts read every 5 minutes). Off: pushes reach only an app open in the background |
| `EXPO_ACCESS_TOKEN` | — | Needed once "enhanced security for push" is on for the Expo project |
| `LOG_LEVEL` | `info` | Pino level |
| `SEED` | `true` | Set to `false` to skip the demo seed (production) |

To add more portal accounts, run `npm run admin:create -- ops@etl.co.ls "Ops Desk" support` (or use `admin`). The password comes from `ADMIN_NEW_PASSWORD`, or a random one is printed. In a build, run `node dist/create-admin.js …` instead.

## Seed accounts (demo world from `src/data/seed.ts`)

Every wallet uses PIN **1234**.

| Wallet | Number | Role | Notes |
| --- | --- | --- | --- |
| Lerato Mokhothu | +26662000021 | customer | KYC 2, M1,240.50 |
| Mme | +26662103401 | customer | Has a pending LEC request to Lerato (meter 0412 7731 905) |
| Thabo | +26662555010 | customer | Sent M800 to the family group |
| Palesa Letsie | +26662300112 | customer | KYC 1, M85 |
| Ntate Mokoena | +26663550042 | merchant | `TAXI-0042`, "Taxi · Ntate Mokoena" |
| 'Mamello Ramone | +26662888001 | merchant | `MRC-0001`, "Ha Abia Cafe" |
| Ha Abia Agent | +26662777001 | agent | `AGENT-0101`, float M20,000 |
| LEC Electricity | (none) | official system account | Sends tokens; cannot log in |
| EcoSure | (none) | official system account (`biller = 'ecosure'`) | Receives EcoSure premiums; posts policy, claim, quote and sponsorship updates into its official chat |
| EcoCash Super App | (none) | official system account (`biller = 'fees'`) | Receives wallet fees (e.g. the bank transfer fee) |

Seeded chats:

- Lerato ↔ Mme: two texts and the pending LEC bill request.
- **Lelapa (Family)** (Lerato, Mme, Thabo): Thabo's M800, Mme's thanks, and school fees of M1,200 with M600 already paid.
- LEC official chat with an earlier token.
- Taxi receipt chat.
- A handful of ledger rows.

## Behaviour notes

- **Error statuses** (the body is always `ApiError`):
  - 400 `VALIDATION`
  - 401 `UNAUTHORIZED`
  - 403 `WRONG_PIN` / `SUSPENDED` / `WRONG_APP` / `FORBIDDEN`
  - 404 `NOT_FOUND` / `NOT_REGISTERED`
  - 409 `CONFLICT`
  - 422 `INSUFFICIENT_FUNDS` / `LIMIT_EXCEEDED` / `CARD_DECLINED`
  - 423 `PIN_LOCKED`
  - 503 `MAINTENANCE` (the body includes `maintenance`)
- **PINs:** 4 digits, hashed with scrypt and a per-user salt. After 5 wrong PINs in a row (at login, verify-pin or any payment), the wallet gets `PIN_LOCKED` for 15 minutes. A correct PIN resets the counter.
- **Sessions:** random tokens, stored only as SHA-256. Logout deletes the session. Suspended wallets get `SUSPENDED` on login and on every authenticated call, and their sockets are closed with code 4403. Resetting a PIN signs the wallet out everywhere.
- **WebSocket:** `GET /v1/ws?token=…` sends `hello`, answers `ping` with `pong`, and ignores anything else. A bad token closes the socket with 4401, and a suspended wallet closes it with 4403. Events are sent only after the DB transaction commits.
- **Requests:**
  - The payer must be a chat member and not the requester.
  - Partial payments are allowed only in groups.
  - Bill requests pay the biller's system wallet.
  - Paying an LEC request posts the token (5×4 digits, at M1 = 0.684 kWh) from LEC into the **requester's** official LEC chat.
- **Tap:** a PIN is required above `NO_PIN_TAP_LIMIT` (M200).
- **Limits:** the per-transaction limit is `MAX_TRANSACTION` (M10,000). Admin float top-ups are capped separately at M1,000,000.
- **Agent commission:** `AGENT_COMMISSION` in `src/routes/v1.ts` (cash-in 0.5%, cash-out 1%) holds **placeholder** rates until EcoCash supplies the real commission table. Commission is only reported in the summary; it is not paid out.
- **EcoSure (insurance mini app, `src/ecosure`, routes in `src/routes/ecosure.ts`):** a mock of the EcoSure back end until its real API exists. Catalogue, policies, claims, quotes and sponsorships live in `ecosure_*` tables (migration `006_ecosure.sql` seeds the catalogue; all products are `active` here, although EcoSure's short-term products are still drafts).
  - App (`/v1/ecosure`): `GET products`, `GET|POST policies`, `GET policies/lookup?ref=`, `PATCH policies/:id`, `POST policies/:id/migrate`, `POST policies/:id/members`, `DELETE policies/:id/members/:memberId`, `GET|POST payments`, `POST uploads` (base64, 10 MB, JPEG/PNG/PDF; body limit 15 MB), `GET|POST claims`, `GET|POST quotes`, `GET|POST sponsorships`, `POST sponsorships/:id/accept|decline|cancel`.
  - Back office (`/admin/v1/ecosure`): `GET policies`, `GET claims`, `GET claims/:id/documents/:index`, `POST claims/:id/decision`, `GET quotes`, `GET quotes/:reference/documents/:index`, `POST quotes/:reference/price`. Decisions and pricing are audited.
  - Money: premiums are ledger kind `ecosure` (payer → EcoSure wallet, label `EcoSure premium · ES-000101`); approved claims are kind `claim` from outside the system (`from` null, like float) into the holder's wallet. Buying, paying and claiming need the wallet PIN.
  - Policy status is derived from `paid_until` (Maseru date): active until it, `grace` for `ECOSURE_GRACE_DAYS` (30) after, then `lapsed`. Paying a lapsed policy restarts it from today; otherwise months are added to the paid-up date. Unused uploads are deleted after 24 hours.
- **Money in and out (`src/services/cards.ts`, `src/services/banking.ts`, routes in `src/routes/cardbank.ts`):** card → wallet top-ups and wallet → bank transfers, against mock gateways in `src/gateways/` (`CardGateway`, `BankGateway`) until the real integrations exist.
  - Cards (`GET|POST /v1/cards`, `DELETE /v1/cards/:id`): only the gateway token, brand, last 4 and expiry are stored, never the card number or CVV. Visa and Mastercard only, Luhn-checked. Mock test cards: `4000 0000 0000 0002` is declined when added (`CARD_DECLINED`), `4000 0000 0000 9995` is declined at charge time ("Insufficient funds on the card"); any other valid number works.
  - Top-ups (`POST /v1/topups`, `POST /v1/topups/:id/confirm`): PIN, then a 3-D Secure code (mock: `123456`, 3 tries, 10 minutes). The card is charged amount + fee; the wallet gets the amount (ledger kind `topup`, from outside the system). Idempotent per `clientId`.
  - Banks (`GET /v1/banks`, `GET /v1/banks/lookup`, `GET /v1/bank-accounts`, `DELETE /v1/bank-accounts/:id`, `POST /v1/bank-transfers`): the mock derives an account name from the number (numbers ending `0000` don't exist) and completes transfers at once. The wallet pays amount + fee in one DB transaction: ledger `withdraw` (out of the system) and `fee` (to the **EcoCash Super App** fees system wallet, `biller = 'fees'`).
  - Tariff (`GET /v1/tariff`, `GET|PUT /admin/v1/tariff`, audited `tariff.update`): **placeholder** fees and limits in `app_settings.tariff` until the real tariff is known: card top-up fee 2% (min M1), max M5,000 per top-up; bank transfer fee M10, max M10,000 per transfer; M20,000 a day each for top-ups and for bank transfers.
- **"Today":** summaries use the Africa/Maseru calendar day (UTC+2, no DST).
- **Logging:** Fastify/pino logs never include request bodies. `Authorization` and `?token=` are redacted, so PINs, passwords and tokens are not logged. The one exception is the generated first-admin password, which is printed once to the console on purpose.

## Real PostgreSQL

```bash
createdb moqoqo
DATABASE_URL=postgres://user:pass@localhost:5432/moqoqo npm start
```

The migrations are plain SQL that runs on both PostgreSQL 16–18 and PGlite. The server uses a pool of 10 connections. Moving existing PGlite data to Postgres is not automated; start fresh or `pg_dump` from a PGlite session.

## Deploying on ETL servers

- Build with `npm ci && npm run build`, then run `node dist/index.js` under systemd (or the container below) with `NODE_ENV=production`, `SEED=false`, `DATABASE_URL`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`. `dist/` still needs the production `node_modules`, so run `npm ci --omit=dev`.
- **Behind the etl.co.ls external proxy:**
  - Forward `/v1`, `/admin/v1` and `/health` to the server's port. `trustProxy` is on, so `X-Forwarded-*` headers are honoured.
  - **The proxy must allow the WebSocket upgrade on `/v1/ws`**: pass `Upgrade` and `Connection` headers, use HTTP/1.1 to the upstream, and raise idle/read timeouts (for example 1 hour). Clients ping, but a proxy that cuts idle connections after 60 s will still cause reconnect churn. For nginx:
    ```nginx
    location /v1/ws {
      proxy_pass http://moqoqo_upstream;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_read_timeout 3600s;
    }
    ```
  - Terminate TLS at the proxy so the apps use `wss://`.
- Set `CORS_ORIGINS` to the portal's public origin.
- Realtime state (sockets) is in-process. Run **one instance**, or add sticky sessions plus a pub/sub fan-out (for example Postgres `LISTEN/NOTIFY`) before scaling out.
- **Docker:** `docker build -f server/Dockerfile -t moqoqo-server .` from the repo root (multi-stage, `node:24-alpine`, PGlite data in the `/data` volume). **The Dockerfile is untested**, because Docker wasn't available when it was written.
