# EcoCash Super App staff portal

Internal web portal for Econet Telecom Lesotho staff to run EcoCash Super App: plan and end maintenance windows, onboard and manage
agents, merchants and customers, look up transactions, read the audit log, and set the app announcement and minimum
app versions.

It is a static single-page app (Vite + React 19 + TypeScript, react-router) that talks to the EcoCash Super App API's `/admin/v1`
routes (plus the public `GET /v1/app-config`). The API contract is `../shared/api.ts`; the portal imports its types only.

## Roles

- **admin**: full access.
- **support**: read-only. Every write control is shown but disabled, with an explanation (tooltip and page notice).
  The server enforces this too; the UI only mirrors it.

All times are shown and entered in **Africa/Maseru (UTC+2, no daylight saving)**; the API exchanges UTC ISO strings.

## Run

```bash
cd portal
npm install
cp .env.example .env      # then set VITE_API_URL if the API isn't on http://localhost:4000
npm run dev               # http://localhost:5173 (the server allows this origin for CORS by default)
```

| Script              | What it does                                          |
| ------------------- | ----------------------------------------------------- |
| `npm run dev`       | Vite dev server with hot reload                       |
| `npm run build`     | Type-check (`tsc -b`) and build static files to `dist/` |
| `npm run preview`   | Serve the built `dist/` locally                       |
| `npm test`          | Run the vitest suite once (jsdom, fetch mocked)        |
| `npm run typecheck` | Type-check only                                       |

### `VITE_API_URL`

Base URL of the EcoCash Super App API, without a trailing slash. It is baked in at **build time**.

- Unset: `http://localhost:4000` (local server).
- `VITE_API_URL=https://moqoqo.etl.co.ls`: call the API on another origin (needs CORS, see below).
- `VITE_API_URL=` (empty): call the API on the **same origin** as the portal (recommended in production).

## Deployment

`npm run build` produces a static site in `dist/` (HTML, one JS and one CSS bundle). Serve it behind ETL's reverse proxy
next to the API:

- **Same origin (recommended).** Build with `VITE_API_URL=` and route on one host, e.g. `/admin/v1/*` and `/v1/*` to the
  API, everything else to `dist/`. No CORS needed.
- **Separate origin.** Build with the API's URL. The API must allow the portal's origin for CORS (methods
  `GET, POST, PUT, PATCH`, headers `Authorization, Content-Type`).
- **SPA fallback.** The portal uses browser history routes (`/maintenance`, `/users`, ...). Unknown paths must serve
  `index.html`. Example nginx: `location / { try_files $uri /index.html; }`.
- Cache `assets/*` long-term (file names are content-hashed); serve `index.html` with `Cache-Control: no-cache`.
- Restrict access to the staff network/VPN at the proxy. The portal sets `noindex`.
- Source maps are generated but not referenced (`sourcemap: 'hidden'`); don't publish `*.map` files.

### Session handling

The admin token is kept in `sessionStorage` (cleared when the tab closes). Any `401` from the API clears it and returns
to the sign-in page. If the API can't be reached, pages show a "Can't reach the EcoCash Super App server" state with a retry button.

## Code layout

```
src/
  api.ts               typed API client (errors, token, 401, network failures)
  auth.tsx             signed-in admin, login/logout, read-only flag
  time.ts              Africa/Maseru conversion and display helpers
  format.ts            money (M1,234.50), +266 numbers, amounts
  components/          layout, dialogs, toasts, shared UI
  maintenance/         maintenance form, validation, phone preview
  users/               add-user dialog, user detail panel
  pages/               one file per route
  styles/global.css    design tokens and base components
```

## Notes

- The default Sesotho maintenance message, the Sesotho preview title ("Re ntse re lokisa") and the "back at" text are
  draft translations. The form flags the default text as needing review by a Sesotho speaker.
- The maintenance preview approximates the apps' maintenance screen; the apps own the real one.
