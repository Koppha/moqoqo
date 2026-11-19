# Moqoqo Technical Specification

## EcoCash Super App platform

**Audience:** Product, engineering, security, operations and integration partners  
**Status:** Current-state specification and proposed production target  
**Date:** 17 November 2026

## 1. Purpose and scope

This document describes the Moqoqo repository as an EcoCash Super App platform: its current components, principal workflows, data and integration boundaries, and the work required to move from development/demo operation to a controlled production pilot. It is based on the checked-in source, configuration and project READMEs. Where a production behaviour is not demonstrated by those sources, it is identified as a dependency or proposal.

The system comprises customer and business mobile app variants, a staff portal, a backend API and real-time channel, a shared API contract, and supporting modules. The code is Lesotho-oriented and uses maloti-denominated wallet amounts. Production deployment, real wallet custody, partner certification and regulatory approval are outside the evidence established by the repository.

## 2. Architecture overview

```text
┌────────────────────────┐       REST / WebSocket       ┌────────────────────────────┐
│ Customer app           │ ───────────────────────────▶ │ Fastify API                 │
│ Expo Router / RN       │                               │ TypeScript, /v1 and /admin  │
└────────────────────────┘                               └──────────────┬─────────────┘
┌────────────────────────┐       REST / WebSocket                      │
│ Business app variant   │ ────────────────────────────────────────────┤
└────────────────────────┘                                             │
┌────────────────────────┐       HTTPS / REST                         │
│ Staff portal           │ ────────────────────────────────────────────┤
│ Vite / React           │                                             ▼
└────────────────────────┘                               ┌────────────────────────────┐
                                                         │ PostgreSQL or PGlite       │
                                                         │ migrations, ledger, users  │
                                                         └────────────────────────────┘
                                                                    │
                                           ┌────────────────────────┼──────────────────────┐
                                           ▼                        ▼                      ▼
                                    Wallet / billers          Identity / telecom    Push / AI / partners
                                    (mock by default)         (mock by default)     (configurable)
```

The mobile apps are implemented in Expo SDK 57, React Native 0.86 and Expo Router. `APP_VARIANT` selects the customer, business, EcoSure or Mekhatlo package configuration. The backend is TypeScript on Fastify 5 with REST routes, a WebSocket endpoint and PostgreSQL support through `pg`; without `DATABASE_URL`, development uses persistent PGlite. `shared/api.ts` is the source of the mobile/server/portal contract. The staff portal is a React 19 and Vite application that uses the admin API.

The server is authoritative for wallet state and transaction processing. Client screens request actions and display resulting state. Real-time events inform connected clients about messages, request changes, balance changes and configuration; after reconnect, clients reload state so that the socket is not the only record of an event.

## 3. Applications and responsibilities

| Component | Current responsibility | Main source areas |
|---|---|---|
| Customer mobile app | Wallet, chat, payments, requests, bills, services, account, notifications and support. | `src/app/`, `src/components/`, `src/state/`, `src/lib/` |
| Business mobile variant | Agent and merchant operations, float and sales views, payment acceptance and business profile. | `APP_VARIANT=business`, `src/app/biz/`, business routes and shared components |
| Standalone service variants | EcoSure and Mekhatlo can be packaged as standalone apps using the same project configuration. | `APP_VARIANT=ecosure` or `society`, respective routes and themes |
| API and real-time server | Authentication, business rules, financial transactions, partner gateways, support/admin operations and WebSocket events. | `server/src/`, `server/migrations/` |
| Staff portal | User and business operations, configuration, communications, service requests, risk and monitoring. | `portal/src/`, `/admin/v1` |
| Shared contract | Typed route, request, response, error and event definitions. | `shared/api.ts` |

## 4. Functional capabilities in the repository

### Customer

- Phone-based sign-in/onboarding, OTP flow, identity checks, SIM/network checks, PIN handling, device binding and session controls.
- Wallet balance, statements, transaction history, send/receive, QR/pay-code, payment requests, split bills and send-many flows.
- Bill payments and configurable services, including utility, airtime and other defined service types.
- Merchant/agent discovery and business interactions; cash-in, cash-out, merchant charges and cardless ATM code flows.
- Chat, groups, official service conversations, push notifications, saved billers, stop orders and profile/self-service screens.
- Remittance, bank/card flows, donations, societies, loans/application journeys, EcoSure cover and support.
- EcoCash Assistant for product/account explanations and prepared actions. The documented safety boundary is that the assistant does not move money and user confirmation/PIN remains required.

### Business and staff

- Agent and merchant dashboards and actions through a separate app variant.
- Portal-managed service definitions, branding, home banners, announcements, maintenance windows and service requests.
- User, transaction, support, analytics, performance, audit and risk operations.
- Staff roles documented as administrator and read-only support; server-side authorization complements UI restrictions.

This list reflects source routes and README descriptions. A route or UI implementation does not by itself prove that its third-party service is connected or that the business process is approved for production.

## 5. Key workflows

### 5.1 Send money

1. The customer selects a recipient, enters an amount and optional note, and reviews the transfer.
2. The client sends a typed API request with the authenticated session and an idempotency/client identifier where supported.
3. The server validates user/session, amount, recipient, available balance, limits and risk rules.
4. The ledger implementation performs the balance movement and transaction record in a database transaction. Wallet rows are locked and database constraints prevent a negative balance in the current mock-ledger implementation.
5. The server creates the corresponding message/receipt and publishes updates to relevant connected clients. Notifications are dispatched according to configuration.
6. The client shows a result and can refresh from the authoritative API after reconnect.

For production, the partner wallet integration must define transaction initiation, status inquiry, idempotency, reversal/timeout handling, reconciliation, settlement and customer-visible reference semantics. The current mock ledger is not a production payment rail.

### 5.2 Chat payment request

1. A customer creates a request in a direct/group/official conversation.
2. The server stores the message and request state.
3. The recipient receives a real-time update and, if enabled, push notification.
4. Acceptance passes through normal server checks and user confirmation before a payment is completed.
5. The request, payment and receipt state are reflected in the conversation and transaction history.

### 5.3 Configurable service payment

1. The portal creates or edits a service definition, form fields, presentation, limits and enabled status.
2. The app fetches the service catalogue and renders the configured fields.
3. The server validates the submission against the service definition and dispatches to a fixed supported gateway type or back-office request flow.
4. The customer sees status and receipt; back-office work appears for staff review where configured.

Service metadata is configurable; the executable set of gateway behaviours is intentionally bounded by server code. Service definitions must not be treated as arbitrary executable code.

## 6. Data model and financial integrity

The database is managed by ordered SQL migrations. The initial schema includes users, sessions, chats, chat members, messages, payment requests, transactions, devices, maintenance windows, app settings, admins, admin sessions and audit log. Subsequent migrations add feature-specific models for services, onboarding/device binding, card/bank, EcoSure, ATM, KYC limits, usernames, support, risk, remittance, societies, donations, friends, saved bills, SIM swap, device profile and session rotation.

Money is represented as integer cents in `bigint` columns. The initial schema constrains wallet balances to be non-negative and indexes transaction directions, timestamps, chat membership and request state. The backend documentation states that money movements use a database transaction, lock affected wallets and write a ledger reference. The current `MockLedger` uses the internal database; production must implement the approved external ledger/gateway boundary and define safe reconciliation and reversals.

The transaction model should be extended or verified for production against the authoritative wallet design, including: immutable accounting entries, explicit pending/posted/failed/reversed states, correlation IDs, partner references, idempotency guarantees, audit retention, and reconciliation status. This is a production hardening recommendation, not a claim that all such fields exist today.

## 7. API and integration boundaries

### Internal interfaces

- Mobile and portal contracts are shared through TypeScript definitions in `shared/api.ts`.
- Customer and business APIs are under `/v1`; real-time events use `/v1/ws`.
- Portal APIs are under `/admin/v1`.
- `GET /health` exposes basic process/database/socket health for probes.
- The API supports JSON, typed application errors and CORS configuration. A maintenance hook gates most `/v1` actions with a 503 response during scheduled maintenance.

### External adapters and current maturity

| Integration | Current repository evidence | Production work |
|---|---|---|
| EcoCash wallet | `MockLedger` is the default; README states apps do not call EcoCash directly. | Implement and certify server-side adapter; agree balance authority, status inquiry, reversal, timeout, settlement and reconciliation. |
| Billers and EcoCash services | Gateway abstraction exists; EcoCash services are mocked. | Confirm each biller contract, credentials, limits, fees, receipt fields, uptime and support path. |
| National identity | Home Affairs gateway is mocked for development. | Obtain authorised endpoint, data-sharing basis, consent and exception/fallback rules. |
| SIM/network and number checks | Gateway implementations are mocks or require external webhook/provider setup. | Validate telecom interfaces, real SIM/device testing, webhook authentication and operational escalation. |
| SMS and email | README identifies mock SMS/email providers. | Select contracted providers, templates, delivery status, retries, privacy and operational monitoring. |
| Push | Expo push path is implemented/configurable; server defaults `PUSH_ENABLED=false`; Android Firebase credentials are required. | Set up FCM/EAS credentials, secure secrets, delivery monitoring and rebuild/release. |
| AI assistant | Server-side Claude integration is configured through `ANTHROPIC_API_KEY`; without a model the assistant is unavailable. | Approve data policy, prompt/tool controls, model availability, cost limits, retention and fallback. Keep financial actions user-confirmed. |
| Card, banks, remittance, ATM, NFC | Gateway/simulator abstractions and product flows exist; several flows are explicitly described as simulated or partner-dependent. | Confirm scheme/acquirer/provider onboarding, certifications, operating model, risk allocation and test environments. |
| EcoSure | Embedded service and server-side policy/quote flows exist; README says real EcoSure API is not yet available and terms/limits need confirmation. | Confirm insurer/underwriter, legal wording, pricing, product limits, claims workflow and production API. |

## 8. Security, privacy and risk controls

### Existing controls evidenced in source/configuration

- PIN-based authentication and PIN confirmation flows; failed PIN lockout is handled by the server.
- Device binding and session management, with per-app identity context and session rotation migrations.
- Rate limiting is enabled by default in server configuration.
- TLS can be required by configuration; the backend is designed to sit behind a trusted proxy.
- Sensitive field encryption hooks exist; the configuration supports data keys and the app startup configures a vault.
- Authentication headers, query tokens and WebSocket protocol tokens are redacted from logs.
- Admin actions are audited; support role is read-only and server authorization is enforced.
- Risk/anomaly services and cases are present; account actions can be reviewed through portal workflows.
- Device/application permissions are configured in Expo, with microphone permission blocked for camera usage.

### Production requirements

Before a live-money pilot, establish a control matrix and obtain independent security and compliance review covering threat model, authentication/session lifecycle, key creation/rotation/storage, secrets management, encryption coverage, least privilege, staff MFA, API abuse, mobile integrity, privacy notices/consent, retention/deletion, data residency, incident response, vulnerability handling, penetration testing and disaster recovery. Verify TLS termination and proxy trust configuration in the actual deployment. Define fraud rules and human review paths with measurable alert handling times.

The project README identifies Central Bank of Lesotho requirements as outstanding. Legal and compliance owners must determine licensing, safeguarding, KYC/AML, consumer disclosures, data protection, outsourcing and payment-scheme obligations before live operation. This specification is not legal advice and does not assert approval.

## 9. Reliability, performance and operations

### Current operating modes

- Local development: Node server on port 4000, PGlite persisted under `server/.data`, seeded demo accounts and optional portal/app processes.
- Deployed backend: PostgreSQL through `DATABASE_URL`; Docker deployment is documented but the README states it has not been tested on this machine.
- Mobile builds: EAS profiles exist for development, preview and production, plus app variants. README documents local Windows/JDK build limitations.
- Observability features include health endpoint, structured Fastify logging with redaction, API metrics, risk/admin views, maintenance controls and audit data.

### Production operating requirements

Adopt a managed PostgreSQL deployment with automated backups, tested restore, migration review, connection limits and monitoring. Deploy behind HTTPS with a documented proxy and firewall configuration. Define service-level objectives for availability, latency, crash-free usage, payment completion and reconciliation, and map each to dashboards and paging thresholds. Establish structured logs, trace/correlation IDs, metrics, alert ownership, incident severity, on-call coverage and partner escalation runbooks. Test mobile upgrade paths and staged rollouts. Treat PGlite and seeded accounts as development-only.

Since financial actions should not rely on socket delivery, maintain API-based state refresh and explicit pending/unknown transaction handling. Implement retry behaviour only where idempotency is guaranteed. Ensure scheduled maintenance does not conceal unresolved transactions and can expose a read-only status path as appropriate.

## 10. Non-functional requirements to agree for pilot

Numeric service levels are intentionally left for discovery; they must be agreed with operating and partner teams.

| Area | Proposed acceptance criterion |
|---|---|
| Availability | Agree API and critical transaction availability targets and measurement windows. |
| Latency | Set percentiles for balance/history, payment initiation and status inquiry under pilot load. |
| Integrity | Every initiated transaction has a terminal or explicitly pending state; duplicates are prevented; every posted amount is reconcilable. |
| Security | Complete threat model, independent test, high-risk remediation and key/secret operational review before live funds. |
| Accessibility and usability | Test on target Android devices and constrained networks; provide readable, localised fee and confirmation screens. |
| Localisation | Native Sesotho review; consistent English/Sesotho terminology for payment, status, error and support. |
| Recovery | Define RPO/RTO, backup restoration, partner outage handling and queued-notification behaviour. |
| Compatibility | Maintain supported OS/device matrix and signed, reproducible build/release process. |

## 11. Environments and release management

Use separated development, partner test/UAT, pilot and production environments, each with distinct credentials, keys, databases, push configuration and partner endpoints. Seed/demo users and simulated external responses must not be enabled in production. Keep secrets out of source control and build artifacts; use managed secret storage with rotation and access auditing.

Build the Expo variants using controlled EAS profiles or an equivalent CI pipeline. Pin Node, Java, Android tooling and package lockfiles. Store signing credentials under restricted access. Promote immutable server and portal artifacts between environments. Apply reviewed database migrations as a release step with rollback/forward-fix plans. Use staged mobile deployment and app minimum-version controls where appropriate. A production release checklist should include partner certification, reconciliation, security approvals, support readiness, customer terms and rollback decision owners.

## 12. Delivery plan and definition of done

### Stage A: technical and product discovery

- Inventory executable features, technical debt, test coverage and known defects.
- Confirm legal/regulatory pathway and service-owner responsibilities.
- Obtain partner interface specifications and sandbox access.
- Specify pilot cohort, transactions, fees, limits, customer support, reconciliation and target metrics.
- Produce threat model, deployment architecture, data map, cost model and delivery estimate.

**Exit:** approved pilot scope, dependency owners, architecture decisions, budget and acceptance criteria.

### Stage B: integration and hardening

- Implement wallet and priority service adapters with idempotency, status inquiry, error mapping and reconciliation.
- Complete identity/telecom integration and notification setup for chosen pilot cohort.
- Harden database, secrets, TLS, access controls, logs, dashboards, alerting, backups and restore.
- Complete accessibility/localisation review, partner tests, security review and operational exercises.

**Exit:** no unresolved critical/high security findings; partner UAT signed; transaction and recovery scenarios pass agreed acceptance criteria; runbooks and support roster ready.

### Stage C: controlled live pilot

- Release to the approved limited cohort with capped transaction/operational limits.
- Monitor daily reliability, reconciliation, fraud, support and user feedback.
- Run explicit pause, incident, reversal and customer communication procedures.

**Exit:** sponsor and control owners accept the pilot scorecard and authorize expansion, remediation, or pause.

### Stage D: expansion

- Address pilot findings and expand services, locations and cohorts in partner-approved increments.
- Revalidate costs, support load, fraud trends and service-level performance at each expansion gate.

## 13. Open decisions

1. Which legal entity owns the customer product, wallet experience, data controller obligations and operational risk?
2. Which feature and partner set is in the first live pilot? Which flows stay simulator-only?
3. What is the authoritative financial ledger, and who owns settlement, reversals, reconciliation and customer claims?
4. Which KYC/AML, transaction limits, fee disclosures and consumer protections apply to each use case?
5. Which database hosting, region, proxy, secret manager, monitoring and recovery services are approved?
6. What is the approved support model, escalation route and customer communications policy?
7. What pilot targets, budget, timeline and release gates should the sponsor approve?

## 14. Repository references

- Root `README.md`: product summary, local setup, demo accounts, variants, implemented/mock boundaries and known gaps.
- `server/README.md`: backend architecture, data mode, scripts and environment variables.
- `portal/README.md`: staff portal roles, deployment and session behaviour.
- `package.json`, `app.config.ts`, `eas.json`: mobile SDK, app variants, native plugins and build profiles.
- `shared/api.ts`: shared API contract.
- `server/src/app.ts`, `server/src/config.ts`, `server/src/routes/`: backend setup, controls and route registration.
- `server/src/ecocash/`, `server/src/gateways/`: wallet and partner adapter boundaries.
- `server/migrations/`: ordered schema evolution.
- `src/miniapps/registry.ts`, `src/app/`: service catalogue and app routes.
