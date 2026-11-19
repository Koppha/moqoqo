# Moqoqo Project Proposal

## EcoCash Super App for Lesotho

**Prepared for:** Prospective sponsors, delivery partners and investors  
**Prepared by:** Moqoqo project team  
**Status:** Pitch draft for discussion  
**Date:** 17 November 2026

## Executive summary

Moqoqo is a mobile-first financial services platform built around the EcoCash wallet and customer relationship. It brings everyday payments, money conversations, merchant and agent tools, bill payment, insurance and community services into one Lesotho-focused experience. Customers can send money in a chat, request or split a payment, scan a QR code, pay participating billers, and reach services without installing a separate app for each provider. Agents and merchants have a role-specific business app, while staff manage operations through a web portal.

The project has a working Expo and React Native client, a TypeScript API and real-time server, a staff portal, a shared API contract, and a set of integrated service experiences. The repository documents demo accounts and local operating instructions, so the product can be demonstrated with seeded data. The current ledger, many external service adapters, several notification channels, NFC and parts of the community experience are simulated or unfinished. The project is therefore a strong prototype and integration foundation, not a production-ready financial service.

We propose a gated delivery programme that turns this foundation into a safe, measurable pilot. The first stage should validate the operating model and regulatory, commercial and technical dependencies with Econet Telecom Lesotho (ETL), EcoCash, billers, insurers, regulators and pilot merchants. The next stages should connect approved production services, complete security and operational readiness, and launch to a deliberately limited group. A broader rollout should follow only after the pilot demonstrates reliability, customer comprehension, merchant value and acceptable risk.

**Decision requested:** appoint an executive sponsor and product owner; confirm target users, business ownership and regulatory pathway; nominate integration counterparts; and approve a discovery and pilot-planning phase. Budget, commercial terms and numeric launch targets should be agreed after that discovery, when integration scope and partner responsibilities are confirmed.

## The opportunity

People and small businesses rely on mobile money for transfers, payments and cash access. The accompanying tasks are often fragmented across wallet menus, messages, agent visits and separate service apps. That fragmentation creates friction for customers and makes it harder for merchants and operators to build repeat use around the wallet.

Moqoqo addresses this with a single mobile experience that makes money understandable in context. A payment request can live in a conversation; a bill or merchant request can be reviewed and approved in the same app; and a service can reuse the wallet identity and approval flow. For ETL and its partners, this creates a platform for distributing services through a familiar customer relationship while retaining an operational control plane for service configuration, customer support, risk review and communications.

The commercial case depends on partner economics, customer adoption, payment volume, service margins and operating cost. These figures are not established by the codebase and should be built into the pilot business case rather than assumed in this proposal.

## Product concept

### Customer experience

The customer app combines an EcoCash wallet shell with conversation-based money flows and a catalogue of services. Implemented screens and routes cover onboarding and device management, wallet activity, sending and receiving, QR payment, payment requests, bill payment, airtime and other configured services, card and bank flows, remittance, ATM cash codes, merchant discovery, notifications, account self-service and support. The first embedded service experiences include EcoSure and community savings-group flows.

The EcoCash Assistant is designed to answer product questions and explain account activity. It can prepare a prefilled action for the customer, but the documented design requires the customer to complete the normal review and PIN confirmation. The assistant must remain advisory and must not independently move funds.

### Business experience

The separate EcoCash Business variant gives agents and merchants role-specific views and actions. The documented flows include agent float, cash-in, cash-out requests, customer registration, merchant charges, QR acceptance, sales and commission views, and soundbox announcements. This supports both distribution and acceptance without putting business operations into the consumer interface.

### Staff operations

The portal is an operations surface for maintenance windows, users, agents and merchants, transactions, services, requests, branding, communications, audit, risk, analytics and support. Service definitions can be configured centrally and presented in the app. Role enforcement is performed by the API as well as reflected in the portal interface.

## Why this approach

- **Wallet-centred journeys:** payments and requests use a shared wallet identity, balance and confirmation pattern.
- **Conversation-native payments:** money requests, split bills and merchant charges can be handled in the relevant chat.
- **One customer entry point:** services such as insurance, utilities, airtime and remittance can share onboarding, notifications and support.
- **Two-sided distribution:** customer and business apps support both use and acceptance, while staff tools support day-to-day operations.
- **Configurable service catalogue:** the server and portal can define supported service forms and destinations without a mobile release for every content change.
- **Existing delivery foundation:** the codebase contains mobile, API, portal, API contract, migrations and a substantial route and test structure. This reduces the amount of product scaffolding required before a controlled pilot.

## Proposed delivery programme

The sequence below is a proposal. Durations, staffing and launch dates should be set after partner discovery and technical due diligence.

| Stage | Focus | Exit evidence |
|---|---|---|
| 1. Validate and plan | Confirm product ownership, customer segments, service scope, regulatory route, partner responsibilities, current code health, infrastructure and economics. | Signed scope, dependency map, risk register, pilot hypothesis, budget and acceptance criteria. |
| 2. Production integrations | Implement and certify the real wallet/ledger integration, approved billers and other pilot services; configure identity, SIM, SMS, push and support channels. | Partner test evidence, reconciled transactions, security review, operational runbooks and release candidate. |
| 3. Controlled pilot | Enrol a limited cohort of customers, agents and merchants; support real transactions under agreed limits and monitoring. | Pilot scorecard covering reliability, completion, reconciliation, support, risk and user feedback. |
| 4. Expand and optimise | Address pilot findings, add approved services and cohorts, improve onboarding and merchant acceptance. | Agreed service-level performance, unit economics and expansion approval. |

### Pilot scope to consider

For a first live pilot, prioritise a tight set of journeys whose partner and support arrangements can be validated: customer onboarding and device binding; wallet balance and transaction history; person-to-person send and request; one biller and one merchant payment path; agent cash-in/cash-out if operationally approved; receipts, notifications and support; and staff reconciliation and audit tools. EcoSure, international remittance, ATM switching, card flows, savings-group lending, NFC and a broad service catalogue can be staged based on partner readiness and regulatory approval.

## Proposed measures of success

Numeric targets should be set during discovery, using a baseline and agreed pilot population. The pilot should measure:

- **Activation:** eligible users who complete onboarding and make a first successful transaction.
- **Reliability:** successful transaction rate, API availability, latency, crash-free sessions and recovery from interrupted requests.
- **Financial integrity:** ledger-to-partner reconciliation, duplicate prevention, reversal handling and unresolved breaks.
- **Customer value:** repeat active use, transaction completion, support contacts per active user, and comprehension of payment confirmation and fees.
- **Business value:** active merchants and agents, acceptance success, cash availability, settlement and merchant retention.
- **Risk and compliance:** fraud and dispute rates, account takeover signals, KYC exceptions, incident response and audit completeness.
- **Economics:** contribution per transaction/service, support and infrastructure cost, partner fees and cost to serve.

## Commercial and operating model

Potential revenue and value sources to validate with ETL and partners include payment and biller economics, merchant services, agent activity, distribution or servicing agreements for insurance, remittance and other services, and improved engagement with the EcoCash wallet. The exact revenue share, fee disclosure, settlement, liability, customer support and data-sharing arrangements require agreement with each partner. No pricing or revenue forecast is asserted here.

ETL or a designated operating entity should own product decisions, customer communications, risk policy, operational monitoring and incident coordination. Integration partners should own their service endpoints and settlement responsibilities under documented service-level and escalation agreements. Staff roles, separation of duties and approval limits should be defined before production access is granted.

## Key dependencies and risks

| Dependency or risk | Current evidence | Proposed response |
|---|---|---|
| Real EcoCash integration and reconciliation | The README says the server currently uses a mock ledger. | Agree an interface and certification plan with the wallet owner; reconcile every pilot transaction to the authoritative system. |
| Regulatory and scheme approval | The README identifies Central Bank of Lesotho requirements as not yet complete. | Obtain formal legal and compliance review before enabling live funds movement or new regulated services. |
| External service readiness | Several gateway implementations are mocks; EcoSure commercial and underwriting details are noted as needing confirmation. | Confirm partner APIs, service ownership, customer terms, operational hours and fallback behaviour per pilot service. |
| Identity and telecom checks | SIM/network and national ID paths use mock integrations in the development foundation. | Validate legal basis, provider contracts, consent and exception handling; test real devices and networks. |
| Security and resilience | The server includes rate limiting, session/device controls, encryption hooks, audit and risk services, but production configuration and independent assurance are not evidenced by the repo. | Commission architecture review, penetration test, key management review, backup/restore exercise and incident tabletop. |
| User trust and language | The README calls for Sesotho review. | Conduct native-speaker translation review and usability testing with customers, agents and merchants. |
| Delivery and local build constraints | Local Android native builds have documented Java and Windows path constraints. | Use controlled CI/EAS build pipelines, pin toolchains and document signed release handling. |

## Investment and sponsor ask

This proposal requests sponsorship for discovery and pilot planning, not an uncosted promise of nationwide launch. The sponsor should provide:

1. An executive decision-maker and accountable product owner.
2. Named technical and operational counterparts for wallet, identity, billers, insurance, telecom, compliance and support.
3. Access to the information required to validate APIs, settlement, limits, policies and customer service processes.
4. Agreement to fund a scoped discovery phase and to review a costed pilot plan with measurable exit criteria.

At the end of discovery, the project team should present a delivery budget, staffing plan, partner commitments, launch timeline, risk acceptance and pilot targets for approval.

## Recommendation

Advance Moqoqo to a time-boxed discovery and pilot-planning phase. The existing codebase provides a broad product prototype and an extensible platform foundation. Production investment should be released against validated integrations, regulatory approval, security assurance and pilot evidence, with expansion contingent on customer outcomes and sustainable operating economics.

## Appendix: current product evidence

The repository identifies the customer and business Expo apps, a Fastify API and WebSocket service, a PostgreSQL/PGlite data layer, an administrative portal, and a shared TypeScript API contract. It documents demo accounts and local startup instructions. The route catalogue and migrations cover wallet transactions, chat and requests, bills, services, onboarding and devices, notifications, remittance, EcoSure, societies, donations, merchants, support, analytics, risk and security. These are codebase capabilities and development evidence; they do not on their own establish production readiness, external certification, commercial agreement or regulatory approval.
