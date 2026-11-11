# EcoCash Super App

A Lesotho super app on EcoCash: chat with money inside it (send, Mpho, Kopa requests, Ntefelle "pay for me"), LEC tokens, tap to pay, agents and merchants. This repo holds the whole system:

| Folder | What | Stack |
| --- | --- | --- |
| `src/` | **EcoCash Super App** (customers) and **EcoCash Business** (agents and merchants) | Expo SDK 57, React Native, Expo Router |
| `server/` | API, real-time chat, wallet ledger (mock EcoCash), admin API | Node 24, Fastify, WebSockets, PostgreSQL |
| `portal/` | Staff admin portal: maintenance, users, agents, merchants, transactions, audit | Vite, React |
| `shared/api.ts` | The API contract all three use (routes, bodies, errors, WebSocket events) | TypeScript types |

EcoCash is still a **mock ledger inside the server** (`server/src/ecocash/`). The apps never talk to EcoCash; swapping in the real EcoCash API is a server-side change.

## Run it all locally

```bash
# 1. Server (port 4000). No DATABASE_URL = embedded Postgres in server/.data, seeded on first start.
cd server && npm install && npm run dev

# 2. Portal (port 5173)
cd portal && npm install && npm run dev        # open http://localhost:5173

# 3. Apps on the Android emulator: let the emulator reach this machine's server
adb reverse tcp:4000 tcp:4000
```

Demo accounts (all PIN **1234**):

| Who | Number | App |
| --- | --- | --- |
| Lerato Mokhothu (customer) | 62000021 | EcoCash Super App |
| Mme (customer) | 62103401 | EcoCash Super App |
| Thabo (customer) | 62555010 | EcoCash Super App |
| Ha Abia Agent (AGENT-0101) | 62777001 | EcoCash Business |
| Ntate Mokoena, taxi (TAXI-0042) | 63550042 | EcoCash Business |
| Ha Abia Cafe (MRC-0001) | 62888001 | EcoCash Business |

Portal admin: `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `server/.env` (git-ignored). Without them the server creates `admin@moqoqo.local` and prints a random password once on first start. More staff: `npm run admin:create -- ops@etl.co.ls "Ops" support` in `server/`.

## The two apps

One Expo project, two apps chosen at build time:

| | EcoCash Super App | EcoCash Business |
| --- | --- | --- |
| `APP_VARIANT` | (unset) | `business` |
| Android package | `com.ecocashsuper.app` | `com.ecocashsuper.business` |
| Home | Wallet, requests, transactions | Agent: float, cash in/out today, commission. Merchant: sales today, unpaid charges |
| Logins | Any role | Agents and merchants only |

`EXPO_PUBLIC_API_URL` sets the server (default `http://localhost:4000`). Plain `http://` is only allowed in builds pointed at an `http://` server; production goes through ETL's proxy over HTTPS.

EAS profiles in `eas.json`: `development` / `preview` / `production` for EcoCash Super App, `business-*` for EcoCash Business (`preview` builds are APKs for the Famoco console).

### Building locally on this Windows machine

Native builds hit two local limits:

- **Java:** use JDK 17 (`$env:JAVA_HOME = "$HOME\.gradle\jdks\eclipse_adoptium-17-amd64-windows.2"`); Java 25 breaks the native build.
- **Windows 260-character paths:** the C++ object paths are too long from `C:\Users\…\StudioProjects\moqoqo-native`. Build from a short copy (`C:\m` for EcoCash Super App, `C:\b` for Business): copy `src shared assets plugins node_modules` and the root config files, then `npx expo prebuild --clean -p android` and `gradlew assembleRelease` (with `APP_VARIANT=business` set for **both** steps of the Business build).

EAS cloud builds (`npx eas-cli@latest build -p android --profile business-preview`) avoid both.

## Super app and mini apps

EcoCash Super App is the shell: sign-in, PIN and biometrics, the EcoCash wallet, chat and notifications. Mini apps are built into the app (no web views):

- `src/miniapps/registry.ts` lists every mini app once (section, icon, route, "New" badge, Home order). The Home services grid and the Services tab both read it.
- A mini app lives in `src/miniapps/<id>/` (its theme, UI kit, strings, API calls, shared data) with its screens under `src/app/<id>/`.
- Mini apps use the EcoCash Super App session as the customer's identity, `askPin` for money and confirmations, and pay from the wallet. Updates to the customer arrive in the mini app's official chat.

**EcoSure** (`src/miniapps/ecosure`, `src/app/ecosure`) is the first: funeral cover (buy, policy, dependants, beneficiary, change package, Family ↔ Single), premiums for your own or someone else's policy, funeral claims with documents, short-term quotes (motor, device, house contents, house owners, SME) and sponsorships. It is ported from the EcoSure app in `../EcoSure`. Until the real EcoSure API exists, the EcoCash Super App server holds policies, claims and quotes (`/v1/ecosure/*`), and staff work them in the portal's EcoSure page. Prices are EcoSure's BRS figures, still to be confirmed with SEFS / LNIG Hollard; dependant limits, waiting periods and cover amounts are TBC.

## EcoCash Assistant and notifications

- **EcoCash Assistant**: an official chat at the top of every person's Chats. It answers questions about EcoCash Super App,
  explains the user's own balance, payments, requests and EcoSure cover (read-only tools on the server), and prepares
  actions as cards. It never moves money: a card opens EcoCash Super App's usual screen, pre-filled, and the user confirms with
  their PIN. Claude is called only from the server (`server/src/assistant`); set `ANTHROPIC_API_KEY` in `server/.env`.
- **Notifications**: push, SMS and email. In Me › Notifications each person chooses, per channel, money in & out,
  requests & bills, EcoSure, chat messages (push only) and news & offers (off by default). Security alerts (new sign-in,
  locked PIN, changed email) always go out. Email needs a confirmed address (6-digit code).
- SMS and email are **mock providers** for now (`server/src/notify/gateways.ts`): everything is recorded in the portal
  under Notifications, where staff can also send news & offers. Real pushes need `PUSH_ENABLED=true` and an EAS project ID.

## Services built in the portal

Staff create services in the portal (Services): name, icon, where they appear (Send money, Services tab, or
Me › Self service), the fields customers fill in (text, number, phone with network rules, amount, list of choices with
optional prices, date, tick box, photo), validation, fees and limits, and on/off. Changes appear in the app without an
update. What the server does with a form is one of a fixed set: send out through the EcoCash API (C-Pay, Khetsi, M-Pesa,
My Wallet…), Econet airtime, Econet bundle, or a back-office request reviewed in the portal (e.g. Update KYC; approving
it raises the wallet to KYC tier 2). The EcoCash services API is mocked in `server/src/gateways/ecocash.ts`; the starter
services in migration 009 use placeholder fields, fees and limits. Me › Self service also has Account history, Change PIN
and Pending transactions.

## Sign-up, phones, KYC and safety

- **Sign-up on a phone**: number (read from the Econet SIM where Android allows) + EcoCash PIN, then the national ID is
  checked with Home Affairs (mock: `server/src/gateways/homeaffairs.ts`, demo ID for Lerato `9001010001`, born
  1990-01-01, female), the person confirms name, date of birth and gender, and gets an OTP by SMS. The wallet is then
  bound to that phone (one phone per app); setting up another phone signs the old one out. Setting up needs an Econet
  SIM on Econet mobile data (MCC 651 / MNC 02, to confirm with ETL); test builds can pretend (long-press the logo on
  sign-in). Phones are listed in Me › Phones and in the portal (user panel, with Unbind).
- **Usernames**: chosen in Me; sign in with @username, and find people by it (Send money, new chats).
- **KYC tiers**: tier 1 can't cash out (agents, ATM); other payments are capped by limits set in the portal (App
  settings). Me › Update KYC (ID + selfie) is approved in the portal (Services › Requests to review); the customer gets
  an in-app message (the "EcoCash Super App" chat) and an SMS.
- **ATM cash**: cardless withdrawal with an 8-digit code (30 minutes); the portal's ATM simulator stands in for the
  ATM switch.
- **Risk**: fraud and anomaly rules on every payment (too many payments, big cash-out from a new phone, many senders to
  one wallet, unusual amounts, night cash-outs): block or flag, reviewed in the portal (Risk). The rule engine is
  built in (free); an open-source (Marble, Jube) or enterprise (Featurespace, Feedzai) engine can feed the same alerts.

## Portal-controlled content

- **Home & offers**: banners for Home and News & offers (picture, button, target screen, audience, dates), the order
  of the Home sections, and in-app messages to many people (their "EcoCash Super App" chat, optionally SMS).
- **Branding**: in-app logo (live), home-screen icon (`npm run fetch-branding` before a build), service pictures.
- **QR print-outs**: branded posters for merchants and agents (portal user panel; Business app › My QR › Print).
- **Help & support**: the assistant hands over to a person (ticket + "EcoCash Support" chat); the portal has the inbox
  with the AI conversation, and assistant analytics. **Analytics**: people, money, services, sign-ups, KYC,
  notifications and risk per day.
- **Soundbox**: the phone says money in out loud (Me › Soundbox; on by default in EcoCash Business).

## How the pieces fit

- Apps call the REST API for every action and keep a WebSocket open (`/v1/ws`) for new messages, request updates, balance changes and maintenance. After every reconnect they reload, so nothing is lost offline.
- Money moves only on the server, in one database transaction per payment, with a ledger row and no negative balances.
- **Planned maintenance:** staff schedule a window in the portal (Maintenance page, English + Sesotho message). Apps show a banner before it and a full-screen page during it; the API answers 503 `MAINTENANCE` meanwhile, and "End now" lifts it for everyone at once.
- Agents: cash in (agent float → customer, agent's PIN), cash out (the customer approves a request in chat with their PIN, then the agent hands over cash), register customers. Merchants: charge a customer (a request in chat) or take taps.

## Not done yet

- Real EcoCash API adapter (server), Central Bank of Lesotho requirements, real commission table (placeholder rates in `server/src/routes/v1.ts`).
- Motšelo savings groups are still a local demo in the app (no money moves).
- Push notifications use the Expo push service. Android needs Firebase: add the apps to a Firebase project, put its `google-services.json` in the project root (EAS builds: the `GOOGLE_SERVICES_JSON` file variable), upload the FCM V1 service account key with `npx eas-cli@latest credentials`, rebuild, and set `PUSH_ENABLED=true` on the server. NFC tap and QR codes are simulated.
- The server's Dockerfile is untested (no Docker on this machine); only the embedded Postgres was tested, not a real PostgreSQL server.
- Sesotho text throughout needs review by a native speaker.
