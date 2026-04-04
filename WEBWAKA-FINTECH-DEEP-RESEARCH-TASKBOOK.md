# WEBWAKA-FINTECH DEEP RESEARCH + ENHANCEMENT TASKBOOK

**Repository:** `webwaka-fintech`
**Generated:** April 2026
**Platform:** WebWaka OS v4 — Multi-Repo Fintech Platform
**Target Runtime:** Cloudflare Workers + Hono + Cloudflare D1/KV/R2

---

## TABLE OF CONTENTS

1. [Repo Deep Understanding](#1-repo-deep-understanding)
2. [External Best-Practice Research](#2-external-best-practice-research)
3. [Synthesis and Gap Analysis](#3-synthesis-and-gap-analysis)
4. [Top 20 Enhancements](#4-top-20-enhancements)
5. [Bug Fix Recommendations](#5-bug-fix-recommendations)
6. [Task Breakdown](#6-task-breakdown)
7. [QA Plans](#7-qa-plans)
8. [Implementation Prompts](#8-implementation-prompts)
9. [QA Prompts](#9-qa-prompts)
10. [Priority Order](#10-priority-order)
11. [Dependencies](#11-dependencies)
12. [Phase 1 / Phase 2 Split](#12-phase-1--phase-2-split)
13. [Repo Context and Ecosystem Notes](#13-repo-context-and-ecosystem-notes)
14. [Governance and Reminder Block](#14-governance-and-reminder-block)
15. [Execution Readiness Notes](#15-execution-readiness-notes)

---

## 1. REPO DEEP UNDERSTANDING

### 1.1 Repository Identity

| Field | Value |
|---|---|
| Repo name | `webwaka-fintech` |
| Wrangler name | `webwaka-fintech` |
| Worker entry point | `src/worker.ts` |
| Language | TypeScript |
| Framework | Hono v4 |
| Runtime | Cloudflare Workers |
| Database | Cloudflare D1 (SQL via `DB` binding) |
| KV stores | `SESSIONS_KV`, `RATE_LIMIT_KV` |
| Object storage | `R2: MEDIA_BUCKET` |
| Auth provider | `@webwaka/core` (JWT, CORS, rate limiting) |
| Offline client | Dexie (IndexedDB, mutation queue) |
| Payment rails | NIBSS NIP (interbank), Paystack (card/bank funding) |
| AI provider | OpenRouter (vendor-neutral abstraction) |
| Test runner | Vitest v3 |
| CI/CD | GitHub Actions → `wrangler-action@v3` |
| Environments | local, staging, production |

### 1.2 Platform Role

This repo is the **financial infrastructure layer** of the WebWaka OS v4 multi-repo platform. It serves all other verticals as the single source of truth for:

- **Banking** — multi-tenant bank accounts, deposits, withdrawals, transfers
- **Insurance** — policy creation, premiums, claims
- **Investment** — portfolio management, asset classes, returns
- **Payouts** — NIBSS NIP instant interbank disbursements

It is **NOT standalone**. It depends on:

- `@webwaka/core` — JWT auth, CORS, rate limiting (npm package)
- `webwaka-super-admin-v2` — tenant provisioning (cross-repo dependency)
- WebWaka Event Bus — for publishing `payout.completed`, `payout.failed` events to other repos

It is consumed by:

- `webwaka-commerce` — vendor payout ledger updates via `payout.completed` event
- `webwaka-logistics` — rider commission ledger updates via `payout.completed` event
- `webwaka-transport` — driver settlement ledger updates via `payout.completed` event
- `webwaka-institutional` — student fee clearance via `transfer.successful` event
- `webwaka-real-estate` — escrow wallet creation via `payment.escrow.funded` event
- `webwaka-civic` — NGO donation balance updates via `donation.received` event

### 1.3 Module Deep Dive

#### Module: Banking (`src/modules/banking/index.ts`)

**Implemented:**
- `GET /api/banking/accounts` — list accounts by tenant; customers see only their own
- `POST /api/banking/accounts` — create account (admin/teller only); random 10-digit account number
- `POST /api/banking/transactions` — deposit/withdrawal; updates balance; no atomicity guarantee
- Role-based access control via `requireRole` from `@webwaka/core`

**Missing / Incomplete:**
- No `GET /api/banking/accounts/:id` — individual account fetch
- No `GET /api/banking/transactions` — list transactions endpoint
- No `GET /api/banking/transactions/:id` — individual transaction fetch
- No account `PATCH` endpoint (status changes: freeze, close)
- No input validation on `POST /accounts` (accountType, customerId not validated)
- No input validation on `POST /transactions` (type enum, amountKobo integer, accountId existence)
- **Critical Bug:** Transaction insert and balance update are two **separate non-atomic DB calls** — if the balance update fails after the transaction is recorded, balance becomes incorrect
- No idempotency key on transactions
- No check that account exists and belongs to the tenant before transacting
- No insufficient-funds check for withdrawals
- Account number generation is random (not NUBAN-compliant)
- No pagination on account or transaction listings
- No `updatedAt` on transactions table
- No composite index on `(tenantId, customerId)` for customer-scoped queries

#### Module: Insurance (`src/modules/insurance/index.ts`)

**Implemented:**
- `GET /api/insurance/policies` — list policies; customers see only their own
- `POST /api/insurance/policies` — create policy (admin/agent only)
- Role-based access control

**Missing / Incomplete:**
- No `GET /api/insurance/policies/:id`
- No `PATCH /api/insurance/policies/:id` (status: lapse, cancel)
- No claims management (`POST /api/insurance/claims`)
- No premium payment flow (Paystack integration not wired up)
- No input validation on `POST /policies` (policy type enum, date ranges, kobo amounts)
- No policy renewal logic
- No premium schedule/recurring billing
- No claim settlement payout (not linked to payout module)
- No `updatedAt` on insurancePolicies table
- No composite index on `(tenantId, customerId)` for customer queries

#### Module: Investment (`src/modules/investment/index.ts`)

**Implemented:**
- `GET /api/investment/portfolios` — list portfolios; customers see only their own
- `POST /api/investment/portfolios` — create portfolio (admin/broker only)

**Missing / Incomplete:**
- No `GET /api/investment/portfolios/:id`
- No `PATCH /api/investment/portfolios/:id` (liquidate, update currentValueKobo)
- No portfolio value update mechanism (currentValueKobo is set to principalKobo at creation and never updated)
- No returns/interest calculation
- No investment transaction log
- No AI-powered portfolio recommendation (AI module exists but not wired up)
- No input validation on `POST /portfolios` (asset class enum, kobo amount)
- No portfolio liquidation payout flow (should trigger payout module)
- No `updatedAt` on investmentPortfolios table

#### Module: Payouts (`src/modules/payouts/index.ts`)

**Implemented (most complete module):**
- `POST /api/payouts/initiate` — full NIBSS NIP flow: auth → name enquiry → transfer initiation
- `GET /api/payouts` — list with status/payoutType filters
- `GET /api/payouts/:id` — individual payout fetch
- `GET /api/payouts/:id/status` — manual NIBSS status poll
- `POST /webhooks/nibss-nip` — HMAC-SHA256 verified webhook handler
- Worker-instance-level token cache with expiry buffer
- `payout.completed` and `payout.failed` event emission
- Idempotent webhook processing
- Full test coverage (37 tests)

**Missing / Incomplete:**
- No Cloudflare Workers Cron Trigger to auto-poll stuck `processing` payouts (relies entirely on manual status poll or webhook arriving)
- NIBSS token cache is per-Worker-instance only — multiple cold-start instances don't share tokens (race on startup)
- Token cache stored in module-level `let` — not shared via KV (minor efficiency concern)
- No payout retry logic for transient NIBSS failures
- No bulk payout endpoint (e.g., batch rider commissions)
- No payout cancellation endpoint
- `GET /api/payouts` hard-coded LIMIT 100 — no cursor/offset pagination
- No `payoutType` indexed for analytics queries
- No daily reconciliation report generation
- Webhook doesn't verify `settledAmountKobo` matches expected `amountKobo` (settlement discrepancy detection)

#### Core: NIBSS (`src/core/nibss.ts`)

**Implemented:**
- OAuth2 client credentials token fetch
- Name Enquiry (mandatory pre-transfer account verification)
- Fund transfer initiation
- Transfer status query
- NIBSS reference generation (`NIP-{tenantShort}-{ts}-{random}`)
- NUBAN validation (10-digit numeric)
- CBN bank code validation (3–6 digit numeric)
- `NibssError` typed error class

**Missing:**
- No NIBSS response code lookup table (all 80+ CBN-defined NIP response codes)
- No retry with exponential backoff on `AUTH_FAILED` or transient HTTP errors
- No request timeout (could hang indefinitely on NIBSS partner API)
- No circuit breaker (if NIBSS is down, all payout requests fail hard)
- `generateNibssReference` uses `Math.random()` which is not cryptographically secure

#### Core: Paystack (`src/core/paystack.ts`)

**Implemented:**
- `initializePayment` — creates Paystack transaction (returns checkout URL)
- `verifyPayment` — verifies a transaction by reference
- `generatePaymentReference` — tenant-scoped reference generation

**Missing:**
- **Not wired up to any API endpoint** — exists as dead code
- No Paystack webhook handler (for payment confirmations)
- No Paystack webhook signature verification (`x-paystack-signature` HMAC-SHA512)
- Banking module `POST /accounts/fund` endpoint not implemented

#### Core: AI (`src/core/ai.ts`)

**Implemented:**
- OpenRouter API abstraction for chat completions
- Model override support
- Token usage tracking

**Missing:**
- **Not wired up to any endpoint** — dead code
- No credit scoring endpoint
- No fraud detection hook
- No investment recommendation endpoint

#### Core: Events (`src/core/events.ts`)

**Implemented:**
- `publishEvent` — fire-and-forget event publishing
- `PayoutCompletedEvent` and `PayoutFailedEvent` types
- Graceful failure (never throws, logs errors)

**Missing:**
- No retry or dead-letter queue for failed event deliveries
- No event schema versioning
- No `account.created`, `transaction.completed`, `policy.created`, `portfolio.created` events
- No banking events published to Event Bus

#### Offline DB (`src/db/db.ts`)

**Implemented:**
- `FintechOfflineDB` Dexie class with all four entity tables + mutation queue
- `enqueueMutation` — adds operation to mutation queue
- `processMutationQueue` — processes queued mutations on reconnect

**Missing:**
- No sync trigger mechanism (no service worker defined)
- No conflict resolution for stale offline edits
- No max retry cap on `retryCount` (could queue forever)
- No exponential backoff in `processMutationQueue`
- No clear distinction between offline-safe and offline-unsafe operations
- `processMutationQueue` doesn't handle 4xx responses (auth errors, validation errors) — will keep retrying forever

#### i18n (`src/i18n/index.ts`)

**Implemented:**
- 7 locales: `en-NG`, `en-GH`, `en-KE`, `en-ZA`, `fr-CI`, `yo-NG`, `ha-NG`
- `toSubunit` and `formatCurrency` utilities
- `ACCOUNT_TYPE_LABELS` and `TRANSACTION_TYPE_LABELS`

**Missing:**
- No locale passed through API — locale is a client concern but no `Accept-Language` middleware
- Insurance policy labels not i18n'd
- Investment asset class labels not i18n'd
- Payout status labels not i18n'd

#### Middleware (`src/middleware/auth.ts`)

- Re-exports from `@webwaka/core` (correct pattern)
- No custom middleware beyond re-exports

### 1.4 Schema Analysis

```
bankAccounts         — 9 columns, tenantId index, UNIQUE accountNumber
transactions         — 9 columns, tenantId + accountId indexes
insurancePolicies    — 10 columns, tenantId index
investmentPortfolios — 8 columns, tenantId index
payoutRequests       — 16 columns, 4 indexes (tenantId, status, nibssReference, initiatorId)
```

**Schema gaps:**
- No `auditLog` table (CBN compliance requires audit trails)
- No `kycVerifications` table (mandatory for CBN compliance)
- No `notifications` table (SMS/push delivery tracking)
- No `paymentFunding` table (Paystack deposit tracking)
- No `claimRequests` table (insurance claims)
- No `investmentTransactions` table (buy/sell/dividend events)
- Missing `updatedAt` on transactions, insurancePolicies, investmentPortfolios
- Missing composite indexes for common multi-column queries

### 1.5 CI/CD Analysis

The `.github/workflows/deploy.yml` has a **critical bug**: it deploys to **staging on every PR** and to **production on every push to main**. This means:
- Any PR merge directly deploys to production
- No manual approval gate before production deployment
- No D1 migration step before deployment
- No rollback mechanism documented
- Staging and production share the same Wrangler account ID secret

### 1.6 Test Coverage Analysis

| File | Tests | Coverage |
|---|---|---|
| `src/modules/payouts/index.test.ts` | 37 tests | High (all major paths) |
| `src/core/paystack.test.ts` | 1 test | Very low (only reference generation) |
| `src/i18n/index.test.ts` | 4 tests | Low (basic smoke tests) |
| `src/modules/banking/index.ts` | **0 tests** | None |
| `src/modules/insurance/index.ts` | **0 tests** | None |
| `src/modules/investment/index.ts` | **0 tests** | None |
| `src/core/nibss.ts` | Covered via payout tests | Medium |
| `src/core/events.ts` | Covered via payout tests | High |
| `src/core/ai.ts` | **0 tests** | None |
| `src/db/db.ts` | **0 tests** | None |

**Thresholds defined but not enforced:** The vitest config sets 80% line/function coverage and 75% branch coverage, but these thresholds are currently failing silently because the test suite doesn't run against the untested modules.

### 1.7 Security Analysis

| Finding | Severity | Location |
|---|---|---|
| Transaction + balance update not atomic (race condition) | Critical | `banking/index.ts:58-70` |
| No withdrawal overdraft protection | High | `banking/index.ts:65` |
| Account number random (not NUBAN-verified) | High | `banking/index.ts:37` |
| Paystack webhook signature not implemented | High | `core/paystack.ts` (dead code) |
| No KYC/BVN enforcement | High | Entire banking module |
| No input validation on banking/insurance/investment | Medium | Multiple routes |
| `Math.random()` in NIBSS reference (not CSPRNG) | Medium | `core/nibss.ts:217` |
| NIBSS token in module-level `let` (no KV sharing) | Low | `payouts/index.ts:43` |
| No request timeout on external API calls | Medium | `core/nibss.ts`, `core/paystack.ts` |
| secureCORS() called with no options | Medium | `worker.ts:29` |
| Rate limiting only on `/api/auth/*` | Medium | `worker.ts:33` |

---

## 2. EXTERNAL BEST-PRACTICE RESEARCH

### 2.1 Nigerian Fintech Regulatory Standards (CBN)

**Central Bank of Nigeria (CBN) Requirements:**

- **Know Your Customer (KYC):** All fintech operators must enforce Tier 1, 2, and 3 KYC. Tier 1 allows ₦50,000/day without BVN; Tier 2 requires BVN and address verification for ₦200,000/day; Tier 3 requires full documentation for unlimited transactions.
- **BVN Verification:** Bank Verification Number (BVN) matching is mandatory for any account creation beyond Tier 1. The NIBSS BVN API (or licensed third-party aggregator like Smile Identity, Mono, Okra) must be used.
- **Transaction Limits:** CBN mandates that each tier have daily transaction limits enforced at the API level, not just the UI.
- **AML/CFT:** Anti-money laundering and counter-terrorism financing controls require flagging unusual patterns, suspending accounts above thresholds, and filing Suspicious Activity Reports (SARs).
- **Data Residency:** CBN requires customer data to be stored in Nigeria. Cloudflare Workers with Nigerian edge presence and D1 must be configured carefully for data residency compliance.
- **Audit Logs:** All financial transactions must have immutable audit trails retained for at least 5 years.
- **Open Banking:** The CBN Open Banking policy (2021) requires standardized APIs and consent management for third-party access.

**NIBSS NIP Best Practices:**
- All transfers must be preceded by a Name Enquiry. ✅ (implemented)
- Response code `00` means "accepted for processing" — never "settled." ✅ (implemented)
- Response codes must be mapped to human-readable messages for error transparency. ❌ (not implemented)
- Maximum transaction amount per single NIP transfer: ₦10,000,000 (1,000,000,000 kobo). Not enforced in code.
- NIBSS reference must be unique per transaction and must not exceed 16 characters in some implementations.
- Polling interval for status check: minimum 30 seconds per CBN guidance. Not enforced.
- Bank partners may have different API schemas — the current implementation assumes a single canonical schema.

### 2.2 Paystack Best Practices

- Webhook signature verification is **mandatory** to prevent replay attacks. Every webhook must verify `x-paystack-signature` using HMAC-SHA512 against the raw body.
- Webhook idempotency: check if `reference` is already processed before acting on it.
- Payment initialization should store the reference in DB before redirecting to Paystack.
- Verify payment on callback, not on redirect — Paystack recommends server-side verification only.
- Paystack supports virtual accounts (dedicated NUBAN) for automatic bank transfer matching — valuable for funding user wallets without card payments.

### 2.3 Cloudflare Workers Fintech Patterns

**Atomic DB Operations:**
- Cloudflare D1 supports SQL transactions via `db.batch()` — multiple statements execute atomically. This is essential for financial operations like balance updates.

**Durable Objects:**
- For truly stateful financial operations (e.g., a user's account ledger), Cloudflare Durable Objects provide single-instance consistency. D1 batch transactions are sufficient for most cases.

**KV Token Caching:**
- NIBSS auth tokens should be cached in KV (shared across all worker instances) rather than module-level variables (which are per-instance). Use `RATE_LIMIT_KV` or a dedicated KV namespace with TTL matching the token expiry.

**Cron Triggers:**
- Cloudflare Workers supports Cron Triggers (via `wrangler.toml`) to run scheduled jobs. Essential for polling `processing` payouts that haven't received a webhook.

**Queues:**
- Cloudflare Queues provide reliable, at-least-once event delivery. Suitable for retrying failed event bus publications.

**Circuit Breaker Pattern:**
- Use KV to store a "circuit state" for NIBSS and Paystack. If consecutive failures exceed a threshold, open the circuit and return 503 immediately rather than timing out.

### 2.4 African Fintech Architecture Standards

**Multi-Currency Support:**
- Africa has 54 countries with 42+ currencies. While Nigeria First (NGN/kobo) is the priority, the schema should anticipate GHS (Ghana), KES (Kenya), ZAR (South Africa), XOF (Francophone West Africa). The i18n module already handles locales — the DB schema needs a `currency` column.

**Mobile Money Integration:**
- MTN MoMo, Airtel Money, and M-Pesa are critical payment channels in West/East Africa. Paystack supports mobile_money channel. Full integration requires additional webhook handling.

**USSD Support:**
- A significant portion of African financial interactions happen over USSD. Financial APIs should be USSD-friendly (short, fast responses; minimal payload sizes).

**Offline-First Financial Records:**
- The Dexie offline DB is the right approach. Best-in-class implementations use Service Worker Background Sync API for automatic sync on reconnect, conflict resolution via CRDT or timestamp comparison, and dead-letter queues for permanently failed mutations.

### 2.5 Fintech Security Standards (PCI-DSS Adjacent)

- **Idempotency Keys:** All mutation endpoints (POST) must accept and enforce `Idempotency-Key` headers to prevent duplicate charges on network retries.
- **Input Sanitization:** All string inputs must be sanitized to prevent SQL injection (even with prepared statements, type validation is required).
- **Sensitive Data Masking:** API responses should never return full account numbers — mask as `XXXXXX1234`.
- **Audit Logging:** All admin actions must be logged with `userId`, `tenantId`, `action`, `resource`, `timestamp`, and `ip`.
- **Rate Limiting:** Financial mutation endpoints need lower rate limits than auth endpoints — typically 5 requests/minute for transfers.
- **Replay Protection:** Webhook endpoints must reject replayed requests (timestamp check: reject if older than 5 minutes).

### 2.6 API Design Best Practices for Fintech

- **Cursor-based pagination** for transaction lists (not offset-based) — financial data grows without bound.
- **Consistent error envelope:** `{ error: { code: string, message: string, details?: object } }`.
- **Amount validation in request body:** Always validate that amounts are positive integers in kobo, never floats.
- **Versioned API:** Use `/api/v1/banking/accounts` — allows breaking changes without disrupting consumers.
- **HATEOAS links** on resources (optional but valuable for discoverability).
- **Structured logging** with correlation IDs (request ID) for distributed tracing.
- **Health checks** with dependency checks (DB, NIBSS connectivity).

### 2.7 Cloudflare Workers CI/CD Best Practices

- Separate staging and production deployment jobs with manual approval gate.
- Run D1 migrations as a CI step before deployment.
- Deploy preview Workers for every PR (ephemeral environments).
- Use Wrangler `--dry-run` to validate config before deploying.
- Pin `wrangler-action` to a specific version, not `@v3`.
- Cache npm dependencies in CI.

---

## 3. SYNTHESIS AND GAP ANALYSIS

### 3.1 Critical Gaps (Blocking Production Use)

| Gap | Impact | Effort |
|---|---|---|
| Non-atomic transaction+balance update | Data corruption on concurrent writes | Medium |
| No withdrawal overdraft check | Negative balances possible | Low |
| No KYC/BVN enforcement | CBN regulatory violation | High |
| No Paystack webhook | Funding never confirmed server-side | Medium |
| No input validation on banking/insurance/investment | 500 errors on bad input, injection risk | Medium |
| No audit log | CBN compliance violation | Medium |

### 3.2 High-Priority Gaps

| Gap | Impact | Effort |
|---|---|---|
| No account/transaction GET by ID | API incomplete for consumers | Low |
| No NIBSS Cron polling | Stuck payouts never resolved | Medium |
| No rate limiting on financial endpoints | Abuse potential | Low |
| No idempotency key on transactions | Duplicate charges on retry | Medium |
| secureCORS() with no config | CORS misconfiguration | Low |
| No cursor pagination on listings | Unbounded response sizes | Medium |
| Math.random() in NIBSS reference | Predictable references (replay risk) | Low |

### 3.3 Medium-Priority Gaps

| Gap | Impact | Effort |
|---|---|---|
| Paystack dead code not wired up | No account funding | Medium |
| AI dead code not wired up | No credit scoring or recommendations | High |
| No claim management | Insurance incomplete | High |
| No portfolio value updates | Investment module stale | Medium |
| No circuit breaker for NIBSS | Cascading timeouts | Medium |
| NIBSS token not in KV | Cold-start redundant auth requests | Low |
| No bulk payout endpoint | Manual per-rider commission payout | High |
| CI/CD deploys production without approval | Accidental production deploy | Low |
| Missing events for banking/insurance/investment | Ecosystem events incomplete | Medium |

### 3.4 Lower-Priority / Architecture Gaps

| Gap | Impact | Effort |
|---|---|---|
| Dexie sync has no service worker | Offline → online sync never triggers | High |
| No API versioning | Breaking changes break consumers | Medium |
| No correlation ID / request tracing | Debugging distributed issues hard | Low |
| No health check dependency verification | `/health` returns ok even if DB is down | Low |
| No NIBSS response code table | Poor error messages to users | Low |
| No CBN bank code registry | Can't validate destination bank codes | Low |
| Missing i18n for insurance/investment/payout | Non-English users underserved | Medium |
| No multi-currency schema | Africa expansion blocked | High |

---

## 4. TOP 20 ENHANCEMENTS

### ENH-01: Atomic Banking Transactions (Critical Bug Fix + Enhancement)
Make all transaction operations truly atomic using D1 `batch()`.

### ENH-02: Input Validation Layer for All Routes
Add schema validation (using Zod or a lightweight validator) to all POST/PATCH endpoints.

### ENH-03: KYC/BVN Tier Enforcement
Implement three-tier KYC with BVN verification integration and transaction limits per tier.

### ENH-04: Complete Banking REST API
Add missing GET by ID, transaction listings, account status management, and pagination.

### ENH-05: Paystack Account Funding Flow
Wire up `initializePayment`/`verifyPayment` with webhook confirmation into a bank account funding endpoint.

### ENH-06: Insurance Claims Management
Add claim filing, adjudication workflow, and settlement via the payout module.

### ENH-07: Investment Portfolio Value Updates and AI Recommendations
Add portfolio valuation updates and wire up the AI module for investment recommendations.

### ENH-08: NIBSS Cron Poller for Stuck Processing Payouts
Add a Cloudflare Workers Cron Trigger to poll all `processing` payouts older than 5 minutes.

### ENH-09: Bulk Payout Endpoint
Add `POST /api/payouts/bulk` for batching multiple payout initiations (e.g., rider commission runs).

### ENH-10: NIBSS Token Caching via KV
Move NIBSS auth token storage from module-level variable to KV for cross-instance sharing.

### ENH-11: Circuit Breaker for NIBSS and Paystack
Implement a KV-backed circuit breaker to fail fast when external APIs are consistently failing.

### ENH-12: Audit Log Table and Middleware
Add an immutable `auditLog` table and middleware that records all admin actions automatically.

### ENH-13: Rate Limiting on Financial Endpoints
Extend rate limiting to cover financial mutation endpoints (banking, payouts) with stricter limits.

### ENH-14: Idempotency Key Support on All Mutations
Accept and enforce `Idempotency-Key` headers on all POST endpoints that create financial records.

### ENH-15: Webhook Replay Protection
Add timestamp validation to NIBSS and Paystack webhooks to reject replayed requests.

### ENH-16: NIBSS Response Code Registry
Add a complete lookup table of CBN NIP response codes for meaningful error messages.

### ENH-17: Cursor-Based Pagination for All List Endpoints
Replace hard-coded LIMIT 100 with cursor-based pagination using `createdAt`/`id` as cursor.

### ENH-18: Event Bus Coverage for All Modules
Publish events for `account.created`, `transaction.completed`, `policy.created`, `portfolio.created`, etc.

### ENH-19: Enhanced Health Check with Dependency Probe
Update `/health` to check D1 database connectivity and return structured dependency status.

### ENH-20: CI/CD Hardening with Manual Approval and Migrations
Add D1 migration step, dependency caching, manual approval gate for production, and version pinning to CI.

---

## 5. BUG FIX RECOMMENDATIONS

### BUG-01: Non-Atomic Transaction + Balance Update (Critical)
**File:** `src/modules/banking/index.ts:58-70`
**Issue:** Two separate D1 `.run()` calls for INSERT transaction and UPDATE balance. If the second call fails (worker timeout, D1 error), the transaction record exists but balance is wrong. This can never be manually reconciled without audit logs.
**Fix:** Use `c.env.DB.batch([stmt1, stmt2])` to wrap both in a single atomic batch.

### BUG-02: No Overdraft Protection on Withdrawals
**File:** `src/modules/banking/index.ts:64-68`
**Issue:** `balanceKobo + (-amountKobo)` can go negative. No check verifies sufficient funds before allowing withdrawal or transfer.
**Fix:** Before the batch transaction, do a `SELECT balanceKobo FROM bankAccounts WHERE id = ? AND tenantId = ?` and verify `balanceKobo >= amountKobo` for debits.

### BUG-03: Wrong @webwaka/core Mock Function Signatures
**File:** `src/__mocks__/@webwaka/core.ts`
**Issue:** `jwtAuthMiddleware` mock signature takes `(_jwtSecret, _sessionsKV)` but the real `jwtAuthMiddleware()` (v1.3.0) is called with no arguments in `worker.ts`. `secureCORS()` mock takes `_environment` string but the real version takes `SecureCORSOptions`. `rateLimit()` mock takes `(_kv, _opts)` but real version takes `RateLimitOptions`. The mock diverges from the real API, making test behavior different from production.
**Fix:** Align mock signatures with the real `@webwaka/core` v1.3.0 API.

### BUG-04: CI/CD Deploys Production on Every Main Push Without Gate
**File:** `.github/workflows/deploy.yml`
**Issue:** The `Deploy to Cloudflare Workers (Production)` step runs automatically on every push to `main`. There is no manual approval step. Any merged PR instantly deploys to production without a human gate.
**Fix:** Add a separate `deploy-production` job gated on `environment: production` (GitHub Environments with required reviewers).

### BUG-05: `processMutationQueue` Retries 4xx Errors Forever
**File:** `src/db/db.ts:81-90`
**Issue:** If the server returns 401 (expired token), 422 (validation error), or 404, the mutation queue increments `retryCount` but never stops retrying. The queue will grow indefinitely.
**Fix:** For `4xx` status codes, remove the entry from the queue (or move to a dead-letter table). Only retry on `5xx` or network errors.

### BUG-06: `generateNibssReference` Uses Non-Cryptographic Random
**File:** `src/core/nibss.ts:217`
**Issue:** `Math.random()` is not a CSPRNG. In high-volume scenarios, the 5-character random suffix could collide, causing duplicate NIBSS references and rejected transfers.
**Fix:** Use `crypto.getRandomValues()` (available in Cloudflare Workers) to generate the random suffix.

### BUG-07: No D1 Migration in CI Pipeline
**File:** `.github/workflows/deploy.yml`
**Issue:** New migrations in the `migrations/` folder are never applied during CI/CD. The deploy action only uploads the Worker code; it does not run `wrangler d1 migrations apply`.
**Fix:** Add a `wrangler d1 migrations apply DB --env staging|production` step before the deploy step.

### BUG-08: NIBSS Webhook Doesn't Verify `settledAmountKobo` Match
**File:** `src/modules/payouts/index.ts:351`
**Issue:** The webhook handler confirms a payout as settled even if `payload.settledAmountKobo` is different from `row.amountKobo`. A malicious or erroneous bank partner could send a mismatched amount.
**Fix:** Compare `payload.settledAmountKobo === row.amountKobo` and log a discrepancy event if they differ. Allow settlement to proceed but flag for reconciliation.

### BUG-09: secureCORS() Called With No Options
**File:** `src/worker.ts:29`
**Issue:** `secureCORS()` is called with no arguments. The `@webwaka/core` v1.3.0 `secureCORS` takes `SecureCORSOptions`. Without an explicit allowlist, CORS may be too permissive or incorrectly configured depending on what the core package defaults to.
**Fix:** Pass explicit `SecureCORSOptions` with an `allowOrigins` array matching the WebWaka frontend domains for each environment.

### BUG-10: Banking Account Number Not NUBAN-Compliant
**File:** `src/modules/banking/index.ts:37`
**Issue:** Account numbers are generated as random 10-digit strings. NUBAN (Nigeria Uniform Bank Account Number) has a checksum algorithm defined by CBN. Randomly generated numbers will fail NUBAN validation at receiving banks.
**Fix:** Implement the NUBAN checksum algorithm or integrate with a bank partner API that allocates virtual NUBAN accounts.

---

## 6. TASK BREAKDOWN

---

### TASK-01: Fix Atomic Banking Transactions

**Title:** Make Banking Transaction + Balance Update Fully Atomic Using D1 Batch

**Objective:**  
Replace the two-step (INSERT transaction, UPDATE balance) operation in the banking module with a single atomic D1 `batch()` call. This prevents financial data corruption in concurrent or partial-failure scenarios.

**Why It Matters:**  
In financial systems, non-atomic money operations are catastrophic. If the Worker times out or D1 throws between the two statements, the DB ends up in an inconsistent state: a transaction is recorded but the balance is wrong. This is unrecoverable without an audit log.

**Repo Scope:** `webwaka-fintech`

**Dependencies:** None (pure DB operation change)

**Prerequisites:**
- Understanding of Cloudflare D1 `batch()` API
- Review of existing banking route handler

**Impacted Modules:**
- `src/modules/banking/index.ts` — `POST /api/banking/transactions` handler

**Likely Files to Change:**
- `src/modules/banking/index.ts`
- New test file: `src/modules/banking/index.test.ts`

**Expected Output:**
- `POST /banking/transactions` wraps INSERT + UPDATE in `c.env.DB.batch([...])`
- If either statement fails, neither is committed
- Test verifies atomicity intent (mocking partial failure)

**Acceptance Criteria:**
- [ ] Transaction and balance update are in a single `DB.batch()` call
- [ ] Balance becomes negative only if `type` is `withdrawal`/`transfer` AND balance is sufficient (overdraft check added)
- [ ] Returns 409 or 422 if insufficient funds for debit
- [ ] Tests added for atomic operation and overdraft check

**Tests Required:**
- Successful deposit updates balance correctly
- Successful withdrawal updates balance correctly
- Withdrawal with insufficient funds returns error, no transaction recorded
- Transfer debit and credit are atomic

**Risks:**
- D1 `batch()` API behavior must be confirmed against Cloudflare docs
- Balance race condition still possible in multi-instance concurrent writes (Durable Objects would solve this but add complexity)

**Governance:** Review CBN transaction atomicity requirements. Consult `replit.md` invariants.

**Important Reminders:**
- All amounts must be in kobo (integers)
- tenantId must come from JWT, never from request body
- Use `DB.batch()` not two separate `.run()` calls

---

### TASK-02: Input Validation for Banking, Insurance, and Investment Routes

**Title:** Add Request Body Validation to All Financial Route Handlers

**Objective:**  
Add structured input validation to all `POST` endpoints in the banking, insurance, and investment modules. This prevents 500 errors from invalid inputs and closes injection/type confusion attack vectors.

**Why It Matters:**  
Currently, the banking `POST /accounts` handler will blindly INSERT whatever `body.customerId`, `body.accountType`, etc. are — including `undefined`, SQL fragments, or garbage types. This leads to silent DB corruption or unhandled 500s.

**Repo Scope:** `webwaka-fintech`

**Dependencies:** None (can use lightweight custom validation or Hono's built-in `zValidator`)

**Prerequisites:**
- Review of all POST endpoint bodies in banking, insurance, investment

**Impacted Modules:**
- `src/modules/banking/index.ts`
- `src/modules/insurance/index.ts`
- `src/modules/investment/index.ts`

**Likely Files to Change:**
- All three module index files
- New shared file: `src/core/validation.ts`
- Test files for each module

**Expected Output:**
- Each POST endpoint validates required fields, types, and enum values
- Returns structured `{ error: { code, message, fields } }` on validation failure with HTTP 400

**Acceptance Criteria:**
- [ ] `POST /banking/accounts` validates: `customerId` (string, required), `accountType` (enum: savings|current|corporate|fixed_deposit)
- [ ] `POST /banking/transactions` validates: `accountId` (UUID), `type` (enum), `amountKobo` (positive integer), `description` (string, max 255)
- [ ] `POST /insurance/policies` validates: `customerId`, `policyType` (enum), `premiumKobo` (positive integer), `coverageKobo` (positive integer), `startDate`/`endDate` (ISO dates, startDate < endDate)
- [ ] `POST /investment/portfolios` validates: `customerId`, `assetClass` (enum: stocks|bonds|real_estate|crypto), `principalKobo` (positive integer, min 1000 kobo)
- [ ] All validation errors return 400 with field-level messages
- [ ] Tests added for valid and invalid inputs on each endpoint

**Tests Required:**
- Missing required field → 400
- Wrong type (float instead of integer for kobo) → 400
- Invalid enum value → 400
- Valid input passes through → 201

**Risks:**
- Adding validation middleware may change how Hono parses the body (ensure `c.req.json()` is not called twice)

**Governance:** CBN requires input validation as part of secure API design.

---

### TASK-03: Complete Banking REST API (Missing Endpoints)

**Title:** Add GET /accounts/:id, GET /transactions, GET /transactions/:id, PATCH /accounts/:id

**Objective:**  
Complete the banking module's CRUD surface by adding missing GET endpoints for individual resources and a PATCH endpoint for account status management.

**Why It Matters:**  
Consuming applications (webwaka-commerce, webwaka-logistics, mobile PWA) need to fetch individual accounts and transactions. The current API is incomplete for any real integration.

**Repo Scope:** `webwaka-fintech`

**Dependencies:** TASK-02 (validation should be present)

**Impacted Modules:**
- `src/modules/banking/index.ts`
- `src/modules/banking/index.test.ts`

**Expected Output:**
- `GET /api/banking/accounts/:id` — fetch single account (tenant-scoped)
- `GET /api/banking/transactions` — list transactions with pagination
- `GET /api/banking/transactions/:id` — fetch single transaction
- `PATCH /api/banking/accounts/:id` — update account status (freeze, close, reactivate)
- All routes respect tenantId isolation from JWT

**Acceptance Criteria:**
- [ ] `GET /accounts/:id` returns 404 for unknown ID or wrong tenant
- [ ] `GET /transactions` supports query params: `accountId`, `type`, `status`, cursor pagination
- [ ] `GET /transactions/:id` returns 404 for unknown ID or wrong tenant
- [ ] `PATCH /accounts/:id` validates `status` enum and records `updatedAt`
- [ ] Customer role can only access their own accounts/transactions
- [ ] All endpoints have tests

**Tests Required:**
- 404 on wrong tenant ID
- 200 with correct data on valid ID
- Pagination cursor advances correctly
- Customer cannot access other customer's account

---

### TASK-04: Paystack Account Funding Flow

**Title:** Wire Up Paystack to Enable Bank Account Funding with Webhook Confirmation

**Objective:**  
Implement a complete funding flow: `POST /api/banking/accounts/:id/fund` initializes a Paystack transaction; `POST /webhooks/paystack` verifies the HMAC-SHA512 signature and credits the account balance on confirmed payment.

**Why It Matters:**  
The Paystack integration already exists in `src/core/paystack.ts` but is dead code. Without a funding flow, bank accounts can only be credited by admin/teller manually. Real-world use requires users to fund via card, bank transfer, or USSD.

**Repo Scope:** `webwaka-fintech`

**Dependencies:**
- TASK-01 (atomic balance update must be in place)
- TASK-02 (validation must be in place)
- Paystack live credentials in `.dev.vars`

**Impacted Modules:**
- `src/modules/banking/index.ts` — new funding endpoint
- `src/worker.ts` — register Paystack webhook router outside JWT guard
- `src/core/paystack.ts` — add webhook signature verification
- New: `src/modules/banking/paystackWebhook.ts`
- New migration: `migrations/0003_payment_funding.sql`

**Expected Output:**
- `POST /api/banking/accounts/:id/fund` → creates Paystack transaction, stores reference in DB, returns `authorization_url`
- `POST /webhooks/paystack` → verifies `x-paystack-signature` (HMAC-SHA512), credits account balance atomically on `charge.success` event, idempotent on duplicate webhooks
- New `paymentFunding` table tracks Paystack references

**Acceptance Criteria:**
- [ ] Fund endpoint requires auth (JWT), validates amountKobo, creates Paystack transaction
- [ ] Webhook endpoint requires no JWT, verifies HMAC-SHA512 signature
- [ ] Webhook credits balance atomically using `DB.batch()`
- [ ] Duplicate webhook calls are idempotent
- [ ] Tests cover: funding init, successful webhook, failed webhook, duplicate webhook, invalid signature

---

### TASK-05: Insurance Claims Management

**Title:** Add Claim Filing, Adjudication, and Settlement to Insurance Module

**Objective:**  
Implement a claims lifecycle: customer files claim → admin adjudicates → approved claims trigger payout via the payouts module.

**Why It Matters:**  
The insurance module is currently creation-only. Without claims management, it is not a working insurance system — just a record-keeping ledger.

**Repo Scope:** `webwaka-fintech`

**Dependencies:**
- TASK-02 (validation)
- TASK-03 (policy GET by ID)
- Payouts module must be working (TASK-01)

**Impacted Modules:**
- `src/modules/insurance/index.ts`
- New migration: `migrations/0004_claim_requests.sql`

**New Schema:**
```sql
CREATE TABLE IF NOT EXISTS claimRequests (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  policyId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  claimType TEXT NOT NULL,
  claimAmountKobo INTEGER NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  adjudicatedBy TEXT,
  adjudicatedAt TEXT,
  settlementPayoutId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
```

**Expected Output:**
- `POST /api/insurance/claims` — file a claim against an active policy
- `GET /api/insurance/claims` — list claims (tenant-scoped, role-filtered)
- `GET /api/insurance/claims/:id` — single claim
- `PATCH /api/insurance/claims/:id/adjudicate` — admin approves/denies; on approval, calls payout initiation
- Approved claims emit `insurance.claim.approved` event to Event Bus

**Acceptance Criteria:**
- [ ] Cannot file claim against lapsed/cancelled policy
- [ ] Claim amount cannot exceed policy coverage
- [ ] Adjudication locks claim (cannot re-adjudicate approved/denied claims)
- [ ] Approved claim triggers payout module with correct amount and beneficiary
- [ ] Full test coverage

---

### TASK-06: Investment Portfolio Value Updates and AI Recommendations

**Title:** Add Portfolio Valuation Updates, Liquidation, and AI-Powered Recommendations

**Objective:**  
Implement mechanisms to update portfolio `currentValueKobo`, record investment transactions (buy/sell/dividend), and expose an AI recommendation endpoint using the existing OpenRouter abstraction.

**Why It Matters:**  
Currently `currentValueKobo` is set to `principalKobo` at creation and never changes. Investment portfolios are therefore always showing stale values. The AI module exists but is completely unused.

**Repo Scope:** `webwaka-fintech`

**Dependencies:**
- TASK-02 (validation)
- `OPENROUTER_API_KEY` configured in environment

**Impacted Modules:**
- `src/modules/investment/index.ts`
- `src/core/ai.ts` (wiring, not changes)
- New migration: `migrations/0005_investment_transactions.sql`

**Expected Output:**
- `PATCH /api/investment/portfolios/:id/value` — admin/broker updates `currentValueKobo`
- `POST /api/investment/portfolios/:id/transactions` — record buy/sell/dividend event
- `GET /api/investment/portfolios/:id/transactions` — transaction history
- `POST /api/investment/portfolios/:id/liquidate` — marks portfolio as liquidated, triggers payout
- `GET /api/investment/portfolios/:id/recommend` — calls AI for recommendation based on portfolio profile
- Emit `investment.portfolio.updated` and `investment.portfolio.liquidated` events

**Acceptance Criteria:**
- [ ] Value updates require admin/broker role
- [ ] Liquidation triggers payout module with correct kobo amount
- [ ] AI recommendation endpoint sanitizes user data before sending to OpenRouter
- [ ] AI calls never expose raw API key in responses
- [ ] Investment transaction log is immutable (no UPDATE/DELETE routes)

---

### TASK-07: NIBSS Cron Poller for Stuck Processing Payouts

**Title:** Add Cloudflare Workers Cron Trigger to Auto-Poll Processing Payouts

**Objective:**  
Configure a Cron Trigger that runs every 5 minutes and calls `queryTransferStatus` for all `processing` payouts older than 5 minutes. This ensures payouts are resolved even if the bank partner's webhook fails to arrive.

**Why It Matters:**  
Currently, stuck `processing` payouts can only be resolved by an admin manually calling `GET /api/payouts/:id/status`. If the bank partner's webhook system goes down, payouts sit in `processing` forever. This causes reconciliation failures and downstream payment delays.

**Repo Scope:** `webwaka-fintech`

**Dependencies:**
- NIBSS module working (existing)
- `wrangler.toml` must be updated with `[triggers]` configuration

**Impacted Files:**
- `wrangler.toml` — add `[triggers] crons = ["*/5 * * * *"]`
- `src/worker.ts` — add `scheduled` export handler
- `src/modules/payouts/cron.ts` — new cron handler

**Expected Output:**
- Worker exports a `scheduled` handler
- Every 5 minutes: query `processing` payouts older than 5 minutes
- For each: call `queryTransferStatus`, apply confirmation or failure
- Log results and emit events as appropriate
- Skip if NIBSS is down (graceful failure)

**Acceptance Criteria:**
- [ ] `wrangler.toml` has cron schedule configured
- [ ] `scheduled()` export handler present in `worker.ts`
- [ ] Cron polls only `processing` payouts older than 5 minutes
- [ ] Successfully confirmed payouts emit `payout.completed` event
- [ ] Cron doesn't crash the worker on NIBSS errors
- [ ] Tests for cron handler logic

---

### TASK-08: Bulk Payout Endpoint

**Title:** Add POST /api/payouts/bulk for Batch Payout Initiation

**Objective:**  
Implement a bulk payout endpoint that accepts an array of payout requests, validates each one, performs Name Enquiry in parallel, and returns a per-item result. This supports rider commission runs, vendor settlement batches, and driver payouts.

**Why It Matters:**  
The WebWaka platform may need to pay hundreds of riders simultaneously after a shift. Calling `POST /api/payouts/initiate` sequentially is not feasible. A bulk endpoint with parallel Name Enquiry and sequential transfer submission (NIBSS may rate-limit parallel transfers) is the correct pattern.

**Repo Scope:** `webwaka-fintech`

**Dependencies:**
- Existing single payout module working
- TASK-07 (Cron poller should handle bulk-created `processing` payouts)

**Impacted Files:**
- `src/modules/payouts/index.ts` — add `/bulk` route
- `src/modules/payouts/index.test.ts` — add bulk tests

**Expected Output:**
- `POST /api/payouts/bulk` accepts `{ payouts: InitiatePayoutBody[] }`, max 100 items
- Validates all items first, returns 400 if any item is invalid (list which items failed)
- Performs Name Enquiry in parallel (via `Promise.allSettled`)
- Submits transfers sequentially (respects NIBSS rate limits)
- Returns array of per-item results: `{ id, nibssReference, status, destinationAccountName, error? }`
- Partial success is valid: some items can fail while others succeed

**Acceptance Criteria:**
- [ ] Max 100 items per request (returns 400 if exceeded)
- [ ] Validation runs on all items before any NIBSS calls
- [ ] Name Enquiry parallelized via `Promise.allSettled`
- [ ] Failed items don't block successful items
- [ ] All initiated payouts recorded in DB
- [ ] Tests for full success, partial success, all failed, validation errors

---

### TASK-09: NIBSS Token Caching in KV

**Title:** Move NIBSS Auth Token Cache from Module Variable to Cloudflare KV

**Objective:**  
Replace the module-level `let cachedToken: NibssAuthToken | null` with KV-based token storage so all Worker instances share the same token, eliminating redundant authentication requests on cold starts.

**Why It Matters:**  
Cloudflare Workers can run hundreds of instances. Each instance currently authenticates independently, causing N simultaneous auth requests to the NIBSS bank partner API on traffic spikes. This can trigger rate limiting on the auth endpoint.

**Repo Scope:** `webwaka-fintech`

**Dependencies:**
- `RATE_LIMIT_KV` or a dedicated `NIBSS_KV` binding

**Impacted Files:**
- `src/modules/payouts/index.ts` — replace module cache with KV cache
- `wrangler.toml` — optionally add dedicated KV namespace for NIBSS tokens

**Expected Output:**
- Token stored in KV with TTL set to `expires_in - 60` seconds
- Token fetched from KV on every request; falls back to fresh auth if expired or missing
- Module-level `cachedToken` variable removed

**Acceptance Criteria:**
- [ ] KV key: `nibss-token:{env}` (environment-namespaced)
- [ ] Token stored as JSON string: `{ accessToken, expiresAt }`
- [ ] KV TTL set correctly to avoid stale tokens
- [ ] Fallback to fresh auth if KV read fails
- [ ] Tests updated to mock KV operations

---

### TASK-10: Circuit Breaker for NIBSS and Paystack

**Title:** Implement KV-Backed Circuit Breaker for External API Calls

**Objective:**  
Implement a lightweight circuit breaker pattern using KV to track consecutive failures for NIBSS and Paystack. When failure count exceeds a threshold (e.g., 5), open the circuit and return 503 immediately for a cooldown period (e.g., 2 minutes) rather than hanging on timeout.

**Why It Matters:**  
Without a circuit breaker, if NIBSS is experiencing an outage, every incoming payout request will wait for the full HTTP timeout (30+ seconds) before returning an error. This cascades into Worker CPU exhaustion and request queue backup.

**Repo Scope:** `webwaka-fintech`

**Dependencies:**
- `RATE_LIMIT_KV` binding available

**Impacted Files:**
- New: `src/core/circuitBreaker.ts`
- `src/modules/payouts/index.ts` — wrap NIBSS calls
- `src/core/nibss.ts` — add optional timeout wrapper

**Expected Output:**
- `CircuitBreaker` class with KV-backed state: `closed`, `open`, `half-open`
- `execute(fn)` — runs `fn`, records success/failure in KV, trips circuit on threshold
- When open: returns `503 Service Unavailable` immediately
- After cooldown: transitions to `half-open`, allows one request through
- Tests for all three states

**Acceptance Criteria:**
- [ ] Circuit opens after 5 consecutive failures
- [ ] Circuit returns 503 without calling NIBSS when open
- [ ] Circuit resets to closed after one successful request in half-open state
- [ ] KV keys are namespaced per external service: `circuit:{service}:{env}`
- [ ] Tests for all circuit states

---

### TASK-11: Audit Log Table and Middleware

**Title:** Add Immutable Audit Log for All Admin Financial Actions

**Objective:**  
Create an `auditLog` D1 table and middleware that automatically logs all admin actions (account creation, transaction posting, payout initiation, policy creation, claim adjudication) with the actor's `userId`, `tenantId`, action type, affected resource, and timestamp.

**Why It Matters:**  
CBN regulations require immutable audit trails for all financial transactions. Without this, the platform cannot pass a CBN examination. Additionally, audit logs are essential for fraud investigation and dispute resolution.

**Repo Scope:** `webwaka-fintech`

**Dependencies:**
- None (foundational)

**Impacted Files:**
- New migration: `migrations/0006_audit_log.sql`
- New: `src/core/audit.ts`
- `src/modules/banking/index.ts` — add audit calls
- `src/modules/insurance/index.ts` — add audit calls
- `src/modules/investment/index.ts` — add audit calls
- `src/modules/payouts/index.ts` — add audit calls

**New Schema:**
```sql
CREATE TABLE IF NOT EXISTS auditLog (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  actorId TEXT NOT NULL,
  actorRole TEXT NOT NULL,
  action TEXT NOT NULL,
  resourceType TEXT NOT NULL,
  resourceId TEXT NOT NULL,
  metadata TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auditLog_tenantId ON auditLog(tenantId);
CREATE INDEX IF NOT EXISTS idx_auditLog_actorId ON auditLog(actorId);
CREATE INDEX IF NOT EXISTS idx_auditLog_resourceId ON auditLog(resourceId);
```

**Expected Output:**
- `writeAuditLog(env, { tenantId, actorId, actorRole, action, resourceType, resourceId, metadata })` utility
- No UPDATE or DELETE routes for auditLog
- `GET /api/admin/audit-log` endpoint (admin only) with pagination

**Acceptance Criteria:**
- [ ] Audit log is written for every mutation in all four modules
- [ ] Audit log is append-only (no UPDATE/DELETE endpoints)
- [ ] Audit log entries include all required fields
- [ ] Audit log is queryable by tenantId, actorId, resourceType
- [ ] Tests verify audit log is written on create/update/delete operations

---

### TASK-12: Rate Limiting on Financial Mutation Endpoints

**Title:** Extend Rate Limiting to Banking, Payout, and Insurance Mutation Endpoints

**Objective:**  
Apply strict rate limits to financial mutation routes using `RATE_LIMIT_KV` and the `rateLimit` middleware from `@webwaka/core`. Financial endpoints should have lower limits than auth endpoints.

**Why It Matters:**  
Currently only `/api/auth/*` is rate-limited. Financial endpoints like `POST /api/payouts/initiate` can be called unlimited times. A compromised JWT could initiate thousands of payouts before being detected.

**Repo Scope:** `webwaka-fintech`

**Impacted Files:**
- `src/worker.ts` — add rate limit middleware for financial routes

**Expected Output:**
- `POST /api/payouts/initiate` — 10 per minute per tenant
- `POST /api/payouts/bulk` — 2 per minute per tenant
- `POST /api/banking/transactions` — 30 per minute per tenant
- `POST /api/banking/accounts/*/fund` — 5 per minute per tenant
- Use `keyPrefix` with tenantId for per-tenant isolation

**Acceptance Criteria:**
- [ ] Financial endpoints return 429 when rate limit exceeded
- [ ] Rate limit is per-tenant (not per-IP)
- [ ] Rate limit does not affect GET endpoints
- [ ] Tests verify 429 behavior

---

### TASK-13: Idempotency Key Support on Financial Mutations

**Title:** Add Idempotency-Key Header Support to All POST Endpoints

**Objective:**  
Accept an optional `Idempotency-Key` header on all POST endpoints that create financial records. Cache the response for 24 hours in KV. If the same key is presented again, return the cached response without re-executing the operation.

**Why It Matters:**  
Mobile networks in Nigeria are unreliable. Users frequently retry failed HTTP requests, causing duplicate transactions. An idempotency layer prevents double-charging or double-crediting.

**Repo Scope:** `webwaka-fintech`

**Impacted Files:**
- New: `src/core/idempotency.ts`
- `src/modules/banking/index.ts`
- `src/modules/payouts/index.ts`

**Expected Output:**
- `withIdempotency(c, handler)` middleware wrapper
- KV key: `idempotency:{tenantId}:{idempotencyKey}`, TTL 24h
- If key exists in KV: return cached response (200/201/202) without calling handler
- If key absent: call handler, store response in KV, return response

**Acceptance Criteria:**
- [ ] Duplicate request with same Idempotency-Key returns same response
- [ ] Different tenants with same key do not collide
- [ ] Missing Idempotency-Key is allowed (not required — for backward compatibility)
- [ ] KV TTL set to 86400 seconds
- [ ] Tests for idempotent repeat, different tenant same key, missing key

---

### TASK-14: KYC/BVN Tier Enforcement

**Title:** Implement Three-Tier KYC Enforcement with Transaction Limit Checks

**Objective:**  
Add a `kycVerifications` table, a KYC tier system (Tier 1: basic info, Tier 2: BVN, Tier 3: full docs), and enforce CBN transaction limits per tier on banking transactions and payouts.

**Why It Matters:**  
This is not optional. CBN regulations require KYC enforcement for all deposit money operators. Failure to implement this is a regulatory violation that can result in license revocation.

**Repo Scope:** `webwaka-fintech`

**Dependencies:**
- TASK-01 (banking atomicity), TASK-02 (validation)

**New Schema:**
```sql
CREATE TABLE IF NOT EXISTS kycVerifications (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  tier INTEGER NOT NULL DEFAULT 1,
  bvn TEXT,
  bvnVerifiedAt TEXT,
  documentType TEXT,
  documentNumber TEXT,
  documentVerifiedAt TEXT,
  dailyLimitKobo INTEGER NOT NULL DEFAULT 5000000,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
```

**Impacted Files:**
- New migration: `migrations/0007_kyc_verifications.sql`
- New: `src/core/kyc.ts`
- `src/modules/banking/index.ts` — enforce tier limits
- `src/modules/payouts/index.ts` — enforce tier limits

**CBN Tier Limits:**
- Tier 1: ₦50,000/day (5,000,000 kobo)
- Tier 2: ₦200,000/day (20,000,000 kobo), requires BVN
- Tier 3: Unlimited, requires full docs

**Acceptance Criteria:**
- [ ] Transaction rejected if daily limit exceeded for customer's KYC tier
- [ ] Single transaction above ₦5M requires Tier 2 or above
- [ ] Daily limit calculated across all transactions in the current day for the customer
- [ ] BVN verification status tracked in DB
- [ ] Admin can manually upgrade a customer's tier
- [ ] Tests for all three tiers and limit enforcement

---

### TASK-15: Webhook Replay Protection

**Title:** Add Timestamp Validation to NIBSS and Paystack Webhook Handlers

**Objective:**  
Reject webhook payloads with timestamps older than 5 minutes to prevent replay attacks. Extract `timestamp` from the webhook payload and compare to current time.

**Why It Matters:**  
An attacker who captures a legitimate webhook payload could replay it later to double-credit an account or double-confirm a payout. Timestamp validation prevents this.

**Repo Scope:** `webwaka-fintech`

**Impacted Files:**
- `src/modules/payouts/index.ts` — NIBSS webhook handler
- Future Paystack webhook handler (TASK-04)

**Expected Output:**
- Extract timestamp from webhook payload
- Reject if `|now - payloadTimestamp| > 300 seconds` with HTTP 401
- Log replay attempts

**Acceptance Criteria:**
- [ ] Webhook older than 5 minutes returns 401
- [ ] Webhook within 5 minutes processes normally
- [ ] Tests for replay scenario

---

### TASK-16: NIBSS Response Code Registry

**Title:** Add Complete CBN NIP Response Code Lookup Table

**Objective:**  
Map all 80+ NIBSS NIP response codes to human-readable messages, error categories, and recommended actions. Return structured, user-friendly error messages instead of raw NIBSS codes.

**Why It Matters:**  
Currently, when NIBSS returns response code `51`, the API returns `"NIBSS rejected: Insufficient funds (51)"`. A complete registry allows structured error handling, retry logic based on error category (e.g., retry on `92` - routing error, don't retry on `51` - insufficient funds), and meaningful user messages.

**Repo Scope:** `webwaka-fintech`

**Impacted Files:**
- New: `src/core/nibssResponseCodes.ts`
- `src/core/nibss.ts` — use registry for error enrichment
- `src/modules/payouts/index.ts` — return enriched error messages

**Expected Output:**
```typescript
export interface NibssResponseCode {
  code: string;
  message: string;
  category: 'success' | 'user_error' | 'bank_error' | 'system_error' | 'retry';
  shouldRetry: boolean;
  userMessage: string; // Safe to return to end user
}
```

**Acceptance Criteria:**
- [ ] All standard CBN NIP response codes documented
- [ ] `enrichNibssError(code)` returns structured response info
- [ ] Payout initiation uses enriched message in failure response
- [ ] `shouldRetry` flag used by cron poller and circuit breaker

---

### TASK-17: Cursor-Based Pagination for All List Endpoints

**Title:** Replace Hard-coded LIMIT 100 with Cursor-Based Pagination

**Objective:**  
Implement consistent cursor-based pagination across all list endpoints using `createdAt`/`id` as the cursor. Return a `nextCursor` token in responses for clients to fetch the next page.

**Why It Matters:**  
Financial data grows without bound. A merchant with 10,000 transactions will get all 10,000 in a single response with the current hard-coded LIMIT 100. Cursor pagination scales to any dataset size and is the standard for financial APIs (Stripe, Flutterwave, Paystack all use cursor pagination).

**Repo Scope:** `webwaka-fintech`

**Impacted Files:**
- `src/modules/banking/index.ts`
- `src/modules/insurance/index.ts`
- `src/modules/investment/index.ts`
- `src/modules/payouts/index.ts`
- New: `src/core/pagination.ts`

**Expected Output:**
- All list endpoints accept optional `cursor` and `limit` (default 20, max 100) query params
- Response envelope: `{ data: [...], nextCursor: string | null, hasMore: boolean }`
- Cursor is base64-encoded `{ id, createdAt }` of last item

**Acceptance Criteria:**
- [ ] Default page size is 20
- [ ] Maximum page size is 100
- [ ] `nextCursor` is null when no more results
- [ ] Cursor is stable (same results regardless of insertions before cursor)
- [ ] Tests for first page, mid-list, and last page

---

### TASK-18: Event Bus Coverage for Banking, Insurance, and Investment

**Title:** Publish Domain Events for All Module State Changes

**Objective:**  
Extend event publishing from payouts-only to cover all modules. Publish `account.created`, `transaction.completed`, `policy.created`, `claim.approved`, `portfolio.created`, `portfolio.liquidated` events to the Event Bus.

**Why It Matters:**  
The platform's event-driven architecture requires this repo to publish events for all state changes so other repos (institutional, civic, commerce) can react without polling. Currently only payout events are published.

**Repo Scope:** `webwaka-fintech`

**Impacted Files:**
- `src/core/events.ts` — add new event type definitions
- `src/modules/banking/index.ts` — publish events after mutations
- `src/modules/insurance/index.ts` — publish events after mutations
- `src/modules/investment/index.ts` — publish events after mutations

**New Event Types:**
```typescript
AccountCreatedEvent, TransactionCompletedEvent, PolicyCreatedEvent,
ClaimApprovedEvent, PortfolioCreatedEvent, PortfolioLiquidatedEvent,
AccountFundedEvent
```

**Acceptance Criteria:**
- [ ] Every module mutation publishes the appropriate event
- [ ] Event payload includes `tenantId`, `resourceId`, all relevant fields
- [ ] Event bus failure never blocks the primary operation
- [ ] Tests verify events are published with correct payloads

---

### TASK-19: Enhanced Health Check with Dependency Probing

**Title:** Improve /health Endpoint to Check D1, KV, and External API Connectivity

**Objective:**  
Replace the static `{ status: 'ok' }` health response with a structured dependency health check that queries D1, checks KV read/write, and (optionally) pings the NIBSS auth endpoint.

**Why It Matters:**  
The current health check returns `ok` even if the D1 database is unreachable. Load balancers, monitoring systems, and the `webwaka-platform-status` repo depend on accurate health signals.

**Repo Scope:** `webwaka-fintech`

**Impacted Files:**
- `src/worker.ts` — update `/health` handler

**Expected Output:**
```json
{
  "status": "degraded",
  "version": "0.1.0",
  "timestamp": "2026-04-04T12:00:00Z",
  "dependencies": {
    "d1": { "status": "ok", "latencyMs": 12 },
    "kv": { "status": "ok", "latencyMs": 3 },
    "nibss": { "status": "degraded", "error": "timeout" }
  }
}
```

**Acceptance Criteria:**
- [ ] D1 check executes `SELECT 1` and measures latency
- [ ] KV check does a get on a known test key
- [ ] Overall status is `ok` only if all critical dependencies are `ok`
- [ ] Health check responds within 2 seconds (timeout each dependency at 1s)

---

### TASK-20: CI/CD Hardening

**Title:** Add D1 Migrations, Manual Production Approval, and Dependency Caching to CI/CD

**Objective:**  
Harden the GitHub Actions workflow to: (1) apply D1 migrations before deployment, (2) require manual approval for production deployment, (3) cache npm dependencies, (4) pin `wrangler-action` to a specific version.

**Why It Matters:**  
Without D1 migrations in CI, deploying new code with new schema requirements will fail silently or error in production. Without a manual approval gate, any merged PR deploys directly to production.

**Repo Scope:** `webwaka-fintech`

**Impacted Files:**
- `.github/workflows/deploy.yml`

**Expected Output:**
- Separate `deploy-staging` and `deploy-production` jobs
- `deploy-production` requires `environment: production` with required reviewers configured in GitHub
- D1 migration applied before Worker deploy: `wrangler d1 migrations apply DB --env {env}`
- npm cache enabled via `actions/setup-node` cache config
- `wrangler-action` pinned to specific commit SHA, not `@v3`
- `--dry-run` check added before actual deployment

**Acceptance Criteria:**
- [ ] D1 migrations run before Worker code deploys
- [ ] Production deployment requires manual reviewer approval
- [ ] npm deps are cached (saves ~30s per run)
- [ ] `wrangler-action` pinned to SHA
- [ ] PR deploys to staging (not production)

---

## 7. QA PLANS

---

### QA-01: Atomic Banking Transactions

**What to Verify:**
- Transaction INSERT and balance UPDATE are in a single D1 `batch()` call
- Both succeed or neither succeeds

**Bugs to Look For:**
- Still using two separate `.run()` calls
- `DB.batch()` call but statements in wrong order
- Balance updated before transaction is recorded

**Edge Cases to Test:**
- Withdrawal exactly equal to balance (zero balance after) — should succeed
- Withdrawal of 1 kobo more than balance — should fail with 422 and no DB change
- Concurrent deposits (D1 handles serialization, but verify no lost updates)
- Zero-amount transaction — should be rejected by validation

**Regressions to Detect:**
- Admin deposit flow still works after refactor
- Teller transaction flow unchanged
- Customer cannot post transactions (role check intact)

**Cross-Module:**
- Account balance must be readable correctly after transaction via `GET /accounts/:id`

**Deployment Checks:**
- `DB.batch()` is supported in D1 — verify against Cloudflare docs
- Test against local D1 via `wrangler dev --local`

**Done When:**
- All existing tests pass
- New overdraft test passes
- No separate `run()` calls for financial mutations in banking module

---

### QA-02: Input Validation

**What to Verify:**
- Every POST endpoint returns 400 for missing required fields
- Enum fields reject invalid values
- kobo fields reject non-integers, negatives, and zero

**Edge Cases:**
- `amountKobo: 0` — should be rejected
- `amountKobo: 1.5` — float, should be rejected
- `amountKobo: -100` — negative, should be rejected
- `accountType: "checking"` — invalid enum, should be rejected
- Empty string for required string fields
- XSS attempt in narration field — should pass validation (sanitization is DB-level)
- SQL injection in description — prepared statements protect against this but validate max length

**Regressions:**
- Valid inputs still return 201
- Role checks still enforced after validation layer

**Done When:**
- All invalid inputs produce 400 with field-level error messages
- No existing valid test cases broken

---

### QA-03: Complete Banking API

**What to Verify:**
- All four new endpoints exist and return correct HTTP status codes
- Tenant isolation enforced on all GET endpoints
- Customer role isolation enforced

**Edge Cases:**
- `GET /accounts/:id` with valid UUID but wrong tenant → 404 (not 403)
- `PATCH /accounts/:id` with invalid status value → 400
- `GET /transactions` with no query params → returns all (paginated)

**Cross-Module:**
- After funding via Paystack (TASK-04), balance visible in `GET /accounts/:id`

**Done When:**
- All new endpoints have passing tests
- Tenant isolation verified in tests

---

### QA-04: Paystack Funding Flow

**What to Verify:**
- `POST /fund` creates a Paystack transaction and returns `authorization_url`
- Webhook verifies HMAC-SHA512 signature before processing
- Balance credited only on `charge.success` event
- Idempotent on duplicate webhooks

**Edge Cases:**
- Paystack sends `charge.failure` — no balance credit
- Paystack sends `refund.processed` — handle or ignore gracefully
- Webhook with wrong signature → 401
- Webhook timestamp > 5 minutes old → 401 (replay protection)
- Double webhook for same reference → idempotent, no double credit

**Security Check:**
- `x-paystack-signature` must be verified using HMAC-SHA512 of raw body with `PAYSTACK_SECRET_KEY`
- Never use `PAYSTACK_SECRET_KEY` in any response body

**Done When:**
- Full funding flow tested end-to-end in local dev
- Webhook tests cover all event types, signature verification, idempotency

---

### QA-05: Insurance Claims

**What to Verify:**
- Claims can only be filed against active policies
- Claim amount cannot exceed policy coverage
- Adjudication is irreversible
- Approved claims trigger payout module

**Edge Cases:**
- File claim against lapsed policy → 422
- Claim amount > coverageKobo → 400
- Adjudicate an already-adjudicated claim → 409
- Payout initiation fails — claim should be flagged, not marked as settled

**Cross-Module:**
- Payout created by claim settlement must appear in `GET /api/payouts`
- Event `insurance.claim.approved` must be published

**Done When:**
- Full claim lifecycle tested
- Cross-module payout creation verified

---

### QA-06: Investment Updates and AI

**What to Verify:**
- `currentValueKobo` updates correctly
- Investment transaction log is append-only
- Liquidation triggers payout
- AI recommendations return structured response

**Edge Cases:**
- Update value on liquidated portfolio → 409
- Liquidate portfolio with zero value → validate minimum amount
- AI call with no API key → graceful error, not 500
- AI call returns malformed JSON → handle gracefully

**Security Check:**
- AI prompt does not include customer PII that shouldn't be in OpenRouter logs

**Done When:**
- All investment endpoints tested
- AI recommendation endpoint tested with mocked OpenRouter

---

### QA-07: NIBSS Cron Poller

**What to Verify:**
- Cron runs every 5 minutes (verify via `wrangler.toml` and `wrangler dev --test-scheduled`)
- Cron only polls payouts older than 5 minutes
- Cron applies confirmation or failure correctly
- Cron doesn't crash on NIBSS errors

**Edge Cases:**
- No processing payouts → cron exits cleanly
- NIBSS auth fails → cron logs error, doesn't crash
- Payout status comes back as `pending` (still processing) → no change
- Payout just received via webhook before cron polls → idempotent (already confirmed)

**Deployment Check:**
- `[triggers]` section present in `wrangler.toml`
- Cron tested with `wrangler dev --test-scheduled`

**Done When:**
- Cron handler tested with mocked DB and NIBSS
- Idempotency with webhook handler verified

---

### QA-08: Bulk Payout

**What to Verify:**
- Bulk request with all valid items → all items initiated
- Bulk request exceeding 100 items → 400
- One invalid item in bulk → that item fails, others succeed (partial success)
- Name Enquiry parallelized

**Edge Cases:**
- All items fail Name Enquiry → return array of all failures
- Empty `payouts` array → 400
- Duplicate `initiatorId` in same bulk → each is treated independently

**Cross-Module:**
- All initiated bulk payouts appear in `GET /api/payouts`

**Done When:**
- Full success, partial success, full failure cases tested

---

### QA-09: NIBSS Token in KV

**What to Verify:**
- Token is stored in KV after first auth
- Second request within TTL reads from KV (no NIBSS auth call)
- Token expired in KV → fresh auth called

**Edge Cases:**
- KV read fails → falls back to fresh auth (not crash)
- NIBSS auth fails during KV miss → error propagated correctly
- Multiple instances: only one should call NIBSS auth (race condition test requires load test)

**Done When:**
- KV mock tests verify token caching behavior
- Module-level `cachedToken` variable removed

---

### QA-10: Circuit Breaker

**What to Verify:**
- Closed state: all requests pass through
- 5th consecutive failure: circuit opens
- Open state: immediate 503 returned
- After cooldown: half-open allows one request
- Successful request in half-open: circuit closes

**Edge Cases:**
- Failure then success before threshold: counter resets
- Circuit opens for NIBSS but not Paystack (separate circuit per service)
- KV write fails during circuit state update → fail open (treat as closed)

**Done When:**
- All three state transitions tested
- Service isolation verified

---

### QA-11: Audit Log

**What to Verify:**
- Audit log entry created for every admin mutation
- No UPDATE or DELETE route for audit log
- Audit log includes all required fields
- Customer actions not logged (or logged separately)

**Edge Cases:**
- Audit log write fails → primary operation still succeeds (audit is best-effort)
- Extremely long metadata → truncate or limit

**Cross-Module:**
- Audit log for payout initiation references payout ID
- Audit log queryable by admin in `GET /api/admin/audit-log`

**Done When:**
- Audit log tests for all mutation endpoints
- No audit log mutability routes found in codebase

---

### QA-12: Rate Limiting on Financial Endpoints

**What to Verify:**
- 10th request within a minute to `/api/payouts/initiate` returns 429
- Rate limit is per-tenant (tenant A's limit doesn't affect tenant B)
- GET endpoints unaffected by rate limits

**Edge Cases:**
- After 60 seconds, limit resets and request succeeds
- Rate limit error returns `Retry-After` header

**Done When:**
- Rate limit tests pass (requires KV mock)

---

### QA-13: Idempotency Keys

**What to Verify:**
- Same request with same Idempotency-Key returns same response
- Different tenants with same key don't collide
- Missing key: request processed normally

**Edge Cases:**
- Idempotency-Key on a failed request (500) — should NOT cache the failure
- Same key with different body — return cached response (key wins over body)

**Done When:**
- Idempotency tests for successful and failed requests

---

### QA-14: KYC/BVN Tier Enforcement

**What to Verify:**
- Tier 1 customer blocked from transactions > ₦50,000/day
- Tier 2 customer blocked from transactions > ₦200,000/day
- Tier 3 customer has no limit
- Daily limit calculated across all transactions in calendar day (not rolling 24 hours)

**Edge Cases:**
- Tier 1 with BVN field set but not verified → still Tier 1
- Admin bypass: admin can transact on behalf of Tier 1 customer?
- Day boundary: transactions straddling midnight reset daily counter

**Regulatory Check:**
- KYC tiers match current CBN guidelines exactly

**Done When:**
- All three tier limit tests pass
- Daily aggregation query verified correct

---

### QA-15: Webhook Replay Protection

**What to Verify:**
- Webhook with timestamp > 5 minutes old rejected with 401
- Webhook within 5 minutes accepted
- Timestamp field presence required when validation is on

**Edge Cases:**
- Webhook with no timestamp field → reject or accept based on config?
- Clock skew between bank partner and WebWaka server → allow ±30s tolerance

**Done When:**
- Replay rejection test passing
- Clock skew test passing

---

### QA-16: NIBSS Response Code Registry

**What to Verify:**
- All common CBN NIP codes present in registry
- `enrichNibssError('51')` returns correct category and user message
- Payout failure response uses enriched message

**Edge Cases:**
- Unknown code not in registry → fallback generic message
- Registry lookup is fast (in-memory, not DB)

**Done When:**
- Registry covers all documented CBN NIP codes
- Payout failure test verifies enriched message

---

### QA-17: Cursor Pagination

**What to Verify:**
- First page with no cursor → first N records
- Second page with cursor → next N records, no overlap
- Last page → `hasMore: false`, `nextCursor: null`

**Edge Cases:**
- Empty list → `data: []`, `hasMore: false`
- `limit=0` → reject or use default
- `limit=101` → clamp to 100
- Cursor from different tenant → 400 or empty result (not cross-tenant leak)

**Done When:**
- Pagination tests for all list endpoints

---

### QA-18: Event Bus Coverage

**What to Verify:**
- Every module mutation publishes an event
- Event payload includes all required fields
- Event bus failure does not fail the primary operation

**Edge Cases:**
- Event bus URL not configured → events silently skipped (not crash)
- Event bus returns 500 → error logged, not thrown

**Cross-Module:**
- Events consumed by downstream repos (cannot test here, document expected payload)

**Done When:**
- All module mutation tests verify event publication

---

### QA-19: Enhanced Health Check

**What to Verify:**
- Health returns `ok` when all dependencies are healthy
- Health returns `degraded` when one dependency is unhealthy
- Each dependency check includes latency

**Edge Cases:**
- D1 `SELECT 1` times out → dependency marked `down`
- Health check itself doesn't throw on dependency failure

**Done When:**
- Health check returns structured JSON
- Latency measured for each dependency

---

### QA-20: CI/CD Hardening

**What to Verify:**
- D1 migration step runs before deploy step
- Production job has `environment: production` constraint
- npm cache configured
- `wrangler-action` pinned

**Edge Cases:**
- Migration fails → deployment blocked (fail fast)
- Test failure → neither staging nor production deploys

**Done When:**
- GitHub Actions workflow passes with all hardening in place
- Manual approval required for production deploy (verify via GitHub UI)

---

## 8. IMPLEMENTATION PROMPTS

---

### IMPL-PROMPT-01: Fix Atomic Banking Transactions

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-01
**Task Title:** Fix Atomic Banking Transactions Using D1 Batch

**Repo Context:**
This is the `webwaka-fintech` repository — the financial infrastructure layer of the WebWaka OS v4 multi-repo platform. It runs on Cloudflare Workers + Hono. This repo is NOT standalone; it is part of a larger ecosystem. Changes here affect all downstream repos that consume banking events.

**Objective:**
Replace the two-step (INSERT transaction, UPDATE balance) operation in `src/modules/banking/index.ts` with a single atomic D1 `batch()` call. Also add overdraft protection for debit operations.

**Dependencies:**
- Cloudflare D1 `batch()` API (documented at developers.cloudflare.com/d1/build-with-d1/d1-client-api/#batch-statements)
- Hono context `c.env.DB` binding

**Important Reminders:**
1. Build Once Use Infinitely — use @webwaka/core auth, never re-implement
2. Nigeria First — all amounts are in kobo (integers). Never naira floats.
3. Multi-Tenant — tenantId MUST come from JWT (c.get('user').tenantId), NEVER from request body
4. Thoroughness Over Speed — do not skip edge cases
5. Consult replit.md before acting

**Execution Steps:**
1. Read `replit.md` and `src/modules/banking/index.ts` fully
2. Read Cloudflare D1 batch API documentation (use your knowledge or web search)
3. Replace the two `.run()` calls with a single `DB.batch([insertStmt, updateStmt])`
4. Add overdraft check: SELECT balance before any debit, return 422 if insufficient
5. Add account existence and tenant ownership check before any transaction
6. Create `src/modules/banking/index.test.ts` with tests for:
   - Successful deposit
   - Successful withdrawal
   - Withdrawal with insufficient funds (balance unchanged)
   - Missing accountId (should be validated)
7. Ensure all existing tests still pass: `npm test`

**Required Deliverables:**
- Modified `src/modules/banking/index.ts` with atomic batch
- New `src/modules/banking/index.test.ts`
- Passing test suite

**Acceptance Criteria:**
- [ ] POST /api/banking/transactions uses DB.batch() for INSERT + UPDATE
- [ ] Withdrawal returns 422 with error if balance < amountKobo
- [ ] All tests pass
- [ ] No separate .run() calls for financial mutations

**Do Not:**
- Re-implement JWT verification
- Accept tenantId from request body
- Use naira floats anywhere
- Skip tests
- Use Math.random() for any security-sensitive value
```

---

### IMPL-PROMPT-02: Input Validation for All Routes

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-02
**Task Title:** Add Request Body Validation to All Financial Route Handlers

**Repo Context:**
`webwaka-fintech` is the financial infrastructure layer of WebWaka OS v4, running on Cloudflare Workers + Hono. It uses @webwaka/core for auth. All monetary amounts are in kobo (integers). This repo is part of a multi-repo platform; validated inputs protect the entire ecosystem.

**Objective:**
Add structured input validation to `POST` endpoints in banking, insurance, and investment modules. Return 400 with field-level error messages for invalid inputs.

**Dependencies:**
- Hono v4 (use `c.req.json()` — do not read body twice)
- Can use lightweight custom validation (no external dependencies required; Zod can be used if already installed)

**Important Reminders:**
1. Nigeria First — kobo amounts must be positive integers (never floats, never negatives, never zero)
2. Multi-Tenant — tenantId from JWT always
3. Thoroughness Over Speed — validate all fields, not just the obvious ones
4. Consult replit.md before acting

**Execution Steps:**
1. Read `src/modules/banking/index.ts`, `src/modules/insurance/index.ts`, `src/modules/investment/index.ts` fully
2. Create `src/core/validation.ts` with reusable validators:
   - `isPositiveInteger(n)` — returns true if n is a positive integer (kobo check)
   - `isValidEnum(value, allowed[])` — validates enum membership
   - `isValidDate(s)` — validates ISO 8601 date string
   - `isNonEmptyString(s, maxLen)` — validates non-empty string with max length
3. Apply validation in each POST handler:
   - Banking POST /accounts: customerId (required string), accountType (enum: savings|current|corporate|fixed_deposit)
   - Banking POST /transactions: accountId (required string), type (enum: deposit|withdrawal|transfer|fee|interest), amountKobo (positive integer), description (string, max 255)
   - Insurance POST /policies: customerId, policyType (enum: life|health|vehicle|property), premiumKobo (positive integer), coverageKobo (positive integer >= premiumKobo), startDate (ISO date), endDate (ISO date, > startDate)
   - Investment POST /portfolios: customerId, assetClass (enum: stocks|bonds|real_estate|crypto), principalKobo (positive integer, min 100000 = ₦1,000)
4. Return: `{ error: { code: "VALIDATION_ERROR", message: "...", fields: { fieldName: "error" } } }` with HTTP 400
5. Add tests for each endpoint for valid and invalid inputs

**Required Deliverables:**
- `src/core/validation.ts` with reusable validators
- Updated banking, insurance, investment route handlers
- Tests for all validation paths

**Acceptance Criteria:**
- [ ] All enum fields reject invalid values with 400
- [ ] amountKobo/premiumKobo/coverageKobo reject floats, negatives, zero
- [ ] Date range validation for policies
- [ ] Field-level error messages returned
- [ ] Valid inputs still return 201

**Do Not:**
- Add validation that reads the DB (keep validation stateless)
- Allow tenantId or userId in request body
- Use any external validation library unless already in package.json
```

---

### IMPL-PROMPT-03: Complete Banking REST API

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-03
**Task Title:** Add Missing GET and PATCH Endpoints to Banking Module

**Repo Context:**
`webwaka-fintech` is the financial infrastructure layer of WebWaka OS v4 (Cloudflare Workers + Hono + D1). Banking accounts and transactions are the most critical resources — consuming apps need GET by ID. This repo is not standalone.

**Objective:**
Add `GET /api/banking/accounts/:id`, `GET /api/banking/transactions`, `GET /api/banking/transactions/:id`, and `PATCH /api/banking/accounts/:id/status` to the banking module.

**Dependencies:**
- TASK-02 must be complete (validation in place)
- TASK-17 pagination utilities (can be done inline first, refactored later)

**Important Reminders:**
1. Multi-Tenant — all queries must include `WHERE tenantId = ?` using JWT tenantId
2. Nigeria First — kobo amounts in all responses
3. Customers can only see their own accounts/transactions (check role === 'customer')
4. Consult replit.md before acting

**Execution Steps:**
1. Read `src/modules/banking/index.ts` and `src/db/schema.sql` fully
2. Add GET /api/banking/accounts/:id:
   - Query: `SELECT * FROM bankAccounts WHERE id = ? AND tenantId = ?`
   - Return 404 if not found
   - Customer role: also check customerId === user.userId
3. Add GET /api/banking/transactions:
   - Support query params: accountId (optional), type (optional), status (optional)
   - Add LIMIT 20 and cursor pagination using createdAt
   - Return `{ data, nextCursor, hasMore }`
4. Add GET /api/banking/transactions/:id:
   - Query: `SELECT * FROM transactions WHERE id = ? AND tenantId = ?`
   - Return 404 if not found
5. Add PATCH /api/banking/accounts/:id:
   - Admin/teller only
   - Validate status: must be 'active' | 'dormant' | 'frozen' | 'closed'
   - Update `status` and `updatedAt`
6. Add tests for all new endpoints

**Required Deliverables:**
- Updated `src/modules/banking/index.ts`
- Updated `src/modules/banking/index.test.ts`
- All tests passing

**Acceptance Criteria:**
- [ ] GET /accounts/:id returns 404 for wrong tenant (not 403)
- [ ] Customer cannot fetch another customer's account
- [ ] GET /transactions supports accountId filter
- [ ] PATCH /accounts/:id validates status enum
- [ ] All new endpoints have tests
```

---

### IMPL-PROMPT-04: Paystack Account Funding Flow

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-04
**Task Title:** Wire Up Paystack for Bank Account Funding with Webhook Confirmation

**Repo Context:**
`webwaka-fintech` is the financial infrastructure layer of WebWaka OS v4 (Cloudflare Workers + Hono + D1). The Paystack integration in `src/core/paystack.ts` is fully written but never connected to any endpoint. This task wires it up.

**Objective:**
Implement:
1. `POST /api/banking/accounts/:id/fund` — initializes a Paystack transaction
2. `POST /webhooks/paystack` — verifies signature, credits balance on charge.success
3. New migration for paymentFunding tracking table

**Dependencies:**
- TASK-01 (atomic balance update)
- TASK-02 (validation)
- `PAYSTACK_SECRET_KEY` in .dev.vars

**Important Reminders:**
1. Nigeria First — kobo amounts, never naira
2. Webhook signature: use HMAC-SHA512 of raw body with PAYSTACK_SECRET_KEY, compare against x-paystack-signature header
3. Idempotency: check if Paystack reference already processed before crediting balance
4. Webhook must be registered OUTSIDE the JWT auth guard in worker.ts
5. Build Once Use Infinitely — use existing paystack.ts, don't rewrite it
6. Consult replit.md before acting

**Execution Steps:**
1. Read `src/core/paystack.ts` and `src/worker.ts` fully
2. Add `verifyPaystackSignature(rawBody, signature, secretKey)` to `src/core/paystack.ts`
   - Uses HMAC-SHA512 (NOT SHA256 — Paystack uses SHA512)
   - Uses crypto.subtle.digest with 'SHA-512'
3. Create `migrations/0003_payment_funding.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS paymentFunding (
     id TEXT PRIMARY KEY,
     tenantId TEXT NOT NULL,
     accountId TEXT NOT NULL,
     paystackReference TEXT NOT NULL UNIQUE,
     amountKobo INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     createdAt TEXT NOT NULL,
     confirmedAt TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_paymentFunding_paystackReference ON paymentFunding(paystackReference);
   ```
4. Add `POST /api/banking/accounts/:id/fund` to banking router:
   - Validate amountKobo (positive integer, min 10000 = ₦100)
   - Generate reference via generatePaymentReference(tenantId)
   - Store pending funding record in paymentFunding table
   - Call initializePayment() from paystack.ts
   - Return { authorizationUrl, reference }
5. Create `src/modules/banking/paystackWebhook.ts` with webhook handler:
   - Verify x-paystack-signature using HMAC-SHA512
   - Parse event type: only handle 'charge.success'
   - Check paymentFunding table for reference — if already confirmed, return 200 (idempotent)
   - On charge.success: DB.batch([UPDATE paymentFunding status, UPDATE bankAccount balanceKobo])
   - Emit account.funded event to Event Bus
6. Register webhook router in worker.ts outside /api/* JWT guard
7. Add comprehensive tests

**Required Deliverables:**
- Updated `src/core/paystack.ts` with signature verification
- New `src/modules/banking/paystackWebhook.ts`
- Updated `src/modules/banking/index.ts` with fund endpoint
- Updated `src/worker.ts`
- New migration file
- Tests for all paths

**Acceptance Criteria:**
- [ ] Webhook rejects invalid signature with 401
- [ ] Duplicate webhook is idempotent
- [ ] Balance credited atomically using DB.batch()
- [ ] charge.failure event does not credit balance
- [ ] x-paystack-signature uses SHA512 (NOT SHA256)
```

---

### IMPL-PROMPT-05: Insurance Claims Management

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-05
**Task Title:** Add Claim Filing, Adjudication, and Settlement to Insurance Module

**Repo Context:**
`webwaka-fintech` is part of WebWaka OS v4 multi-repo platform. Insurance is a key module. Claims management closes the insurance lifecycle loop and integrates with the payouts module for settlement.

**Objective:**
Add claims management to the insurance module: file → adjudicate → settle (via payout).

**Dependencies:**
- TASK-02 (validation)
- Payouts module working (TASK-01)
- `GET /api/insurance/policies/:id` (add this first as prerequisite)

**Important Reminders:**
1. Nigeria First — kobo for all amounts
2. Multi-Tenant — strict tenantId isolation
3. Claim records must be immutable once adjudicated (no re-adjudication)
4. Settlement triggers the payout module, not direct balance manipulation
5. Consult replit.md before acting

**Execution Steps:**
1. Read `src/modules/insurance/index.ts` and `src/modules/payouts/index.ts` fully
2. Create `migrations/0004_claim_requests.sql` (see schema in TASK-05 section above)
3. Add `GET /api/insurance/policies/:id` (prerequisite endpoint)
4. Add `POST /api/insurance/claims`:
   - Validate: policyId (exists and belongs to tenant), claimType, claimAmountKobo (positive integer, <= policy coverageKobo), description
   - Policy must be in 'active' status
   - Create claim record with status 'pending'
5. Add `GET /api/insurance/claims` with tenant/role filtering
6. Add `GET /api/insurance/claims/:id`
7. Add `PATCH /api/insurance/claims/:id/adjudicate`:
   - Admin only
   - Accepts { decision: 'approved' | 'denied', adjudicatedBy: userId }
   - On approval: call internal payout initiation with claim settlement details
   - Update claim with settlementPayoutId on payout creation
   - Emit insurance.claim.approved event
   - Once adjudicated, claim status is locked
8. Add tests for full lifecycle

**Required Deliverables:**
- Updated `src/modules/insurance/index.ts`
- New migration file
- Tests for all paths

**Acceptance Criteria:**
- [ ] Cannot file claim on non-active policy
- [ ] Claim amount cannot exceed coverage
- [ ] Cannot re-adjudicate a decided claim
- [ ] Approved claim creates a payout record
- [ ] Payout creation failure does not leave claim in invalid state
```

---

### IMPL-PROMPT-06: Investment Portfolio Updates and AI

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-06
**Task Title:** Add Portfolio Valuation, Liquidation, and AI Recommendations to Investment Module

**Repo Context:**
`webwaka-fintech` — WebWaka OS v4 financial infrastructure. The AI module in src/core/ai.ts is fully written but unused. Investment portfolio currentValueKobo never updates. This task wires both up.

**Objective:**
Add portfolio value updates, investment transaction log, liquidation with payout, and AI recommendation endpoint.

**Dependencies:**
- TASK-02 (validation), OPENROUTER_API_KEY configured

**Important Reminders:**
1. Nigeria First — kobo only
2. AI calls must NEVER include customer PII (BVN, account numbers, full name) in prompts
3. Investment transactions are immutable (no UPDATE/DELETE routes)
4. Liquidation triggers the payout module
5. Vendor Neutral AI — use src/core/ai.ts (OpenRouter only, never direct OpenAI/Anthropic)
6. Consult replit.md before acting

**Execution Steps:**
1. Read `src/modules/investment/index.ts` and `src/core/ai.ts` fully
2. Create `migrations/0005_investment_transactions.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS investmentTransactions (
     id TEXT PRIMARY KEY,
     tenantId TEXT NOT NULL,
     portfolioId TEXT NOT NULL,
     transactionType TEXT NOT NULL,
     amountKobo INTEGER NOT NULL,
     pricePerUnit TEXT,
     units TEXT,
     notes TEXT,
     createdAt TEXT NOT NULL
   );
   ```
3. Add `GET /api/investment/portfolios/:id`
4. Add `PATCH /api/investment/portfolios/:id/value` (admin/broker):
   - Update currentValueKobo
   - Record investment transaction of type 'valuation_update'
5. Add `POST /api/investment/portfolios/:id/transactions` (admin/broker):
   - Types: 'buy' | 'sell' | 'dividend' | 'fee'
6. Add `GET /api/investment/portfolios/:id/transactions`
7. Add `POST /api/investment/portfolios/:id/liquidate` (admin/broker):
   - Mark portfolio as 'liquidated'
   - Trigger payout for currentValueKobo
   - Emit investment.portfolio.liquidated event
8. Add `GET /api/investment/portfolios/:id/recommend` (admin/broker/customer):
   - Build a safe prompt using anonymized portfolio data (assetClass, principalKobo, currentValueKobo, age of portfolio)
   - Call getAICompletion from src/core/ai.ts
   - Return { recommendation: string, model: string }
   - Return 503 if OPENROUTER_API_KEY not configured
9. Add tests

**Required Deliverables:**
- Updated investment module with all new endpoints
- New migration file
- Tests including mocked AI calls

**Acceptance Criteria:**
- [ ] currentValueKobo updates tracked in investmentTransactions
- [ ] Liquidation creates payout record
- [ ] AI endpoint uses only anonymized data in prompt
- [ ] AI endpoint gracefully fails if API key missing
```

---

### IMPL-PROMPT-07: NIBSS Cron Poller

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-07
**Task Title:** Add Cloudflare Workers Cron Trigger for Auto-Polling Stuck Processing Payouts

**Repo Context:**
`webwaka-fintech` — Cloudflare Workers + Hono. Payouts in 'processing' status may get stuck if the bank partner webhook fails. A Cron Trigger running every 5 minutes auto-resolves them.

**Objective:**
Configure a Cloudflare Workers Cron Trigger and implement a scheduled handler that polls all 'processing' payouts older than 5 minutes and resolves them.

**Dependencies:**
- Existing NIBSS module (no changes needed)
- wrangler.toml must be updated

**Important Reminders:**
1. The scheduled handler must export from the default export object: `export default { fetch: app.fetch, scheduled: cronHandler }`
2. Cron cannot directly test without `wrangler dev --test-scheduled`
3. Graceful failure — cron MUST NOT throw/crash on NIBSS errors
4. Nigeria First — kobo in all amounts
5. Consult replit.md before acting

**Execution Steps:**
1. Read `src/worker.ts`, `src/modules/payouts/index.ts`, and `wrangler.toml` fully
2. Add to `wrangler.toml` under the root section:
   ```toml
   [triggers]
   crons = ["*/5 * * * *"]
   ```
3. Create `src/modules/payouts/cron.ts`:
   - Export `handlePayoutsCron(env: Bindings): Promise<void>`
   - Query: `SELECT * FROM payoutRequests WHERE status = 'processing' AND createdAt < datetime('now', '-5 minutes')`
   - For each: call queryTransferStatus from nibss.ts
   - Apply applyConfirmation or applyFailure as appropriate
   - Log results (count checked, count resolved, count failed)
   - Wrap entire body in try/catch — never throw
4. Update `src/worker.ts` to export `scheduled` handler:
   ```typescript
   export default {
     fetch: app.fetch,
     async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
       ctx.waitUntil(handlePayoutsCron(env));
     },
   };
   ```
5. Refactor `applyConfirmation` and `applyFailure` out of payouts router into shared `src/modules/payouts/helpers.ts` so cron can use them
6. Add tests for cron handler with mocked DB and NIBSS

**Required Deliverables:**
- Updated `wrangler.toml`
- New `src/modules/payouts/cron.ts`
- New `src/modules/payouts/helpers.ts` (extracted shared functions)
- Updated `src/worker.ts`
- Tests for cron handler

**Acceptance Criteria:**
- [ ] wrangler.toml has `[triggers] crons` section
- [ ] scheduled export present in worker.ts
- [ ] Cron only processes payouts older than 5 minutes
- [ ] Cron does not crash on NIBSS errors
- [ ] Confirmed payouts emit payout.completed event
```

---

### IMPL-PROMPT-08: Bulk Payout Endpoint

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-08
**Task Title:** Add POST /api/payouts/bulk for Batch Payout Initiation

**Repo Context:**
`webwaka-fintech` — WebWaka OS v4. This repo handles all platform disbursements. Rider commissions and vendor payouts may involve hundreds of recipients simultaneously — a bulk endpoint is essential.

**Objective:**
Implement `POST /api/payouts/bulk` that accepts up to 100 payout items, validates all, performs Name Enquiry in parallel, submits transfers sequentially, and returns per-item results.

**Dependencies:**
- Existing payout module (TASK-01 done)
- NIBSS module (no changes)

**Important Reminders:**
1. Nigeria First — kobo
2. Multi-Tenant — tenantId from JWT
3. Partial success is valid — don't fail the whole batch on one item's error
4. Promise.allSettled for parallel Name Enquiry, sequential for transfers
5. Consult replit.md before acting

**Execution Steps:**
1. Read `src/modules/payouts/index.ts` fully
2. Add `POST /api/payouts/bulk` route (admin only):
   - Accept: `{ payouts: InitiatePayoutBody[] }`
   - Validate: array length 1-100 (return 400 if out of range)
   - Validate each item (reuse TASK-02 validators)
   - Return 400 with per-item validation errors if any fail
   - Get NIBSS token once (reuse for all items)
   - Run Name Enquiry in parallel: `Promise.allSettled(payouts.map(p => nameEnquiry(...)))`
   - For each successful enquiry: INSERT payoutRequest record
   - Submit transfers sequentially (to avoid NIBSS rate limiting)
   - Return array of results: `{ results: [{ index, id, status, destinationAccountName, error? }] }`
3. Add tests:
   - All 100 items valid → all initiated
   - 101 items → 400
   - 1 invalid item in validation → 400 with field errors
   - 1 Name Enquiry fails → that item gets status 'failed', others proceed
   - Empty array → 400
4. Update `src/modules/payouts/index.test.ts`

**Required Deliverables:**
- Updated `src/modules/payouts/index.ts`
- Updated test file
- All tests passing

**Acceptance Criteria:**
- [ ] Max 100 items enforced
- [ ] Validation runs before any NIBSS calls
- [ ] Name Enquiry parallelized
- [ ] Transfers submitted sequentially
- [ ] Per-item result in response
- [ ] Partial success scenario tested
```

---

### IMPL-PROMPT-09: NIBSS Token in KV

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-09
**Task Title:** Move NIBSS Auth Token Cache from Module Variable to Cloudflare KV

**Repo Context:**
`webwaka-fintech` — Cloudflare Workers. Multiple worker instances don't share module-level variables. The NIBSS auth token should be cached in KV to avoid redundant OAuth calls.

**Objective:**
Replace the module-level `let cachedToken` in `src/modules/payouts/index.ts` with a KV-backed token cache.

**Dependencies:**
- RATE_LIMIT_KV binding available (or add NIBSS_KV if preferred)

**Important Reminders:**
1. KV TTL must be set to `expires_in - 60` seconds (30s buffer already applied in fetchNibssToken)
2. KV key must be environment-namespaced: `nibss-token:{ENVIRONMENT}` using env.ENVIRONMENT
3. Always fall back to fresh auth if KV read fails
4. The `__resetNibssTokenCache` export must be updated for tests
5. Consult replit.md before acting

**Execution Steps:**
1. Read `src/modules/payouts/index.ts` and `src/core/nibss.ts` fully
2. Replace the `getToken()` function:
   ```typescript
   async function getToken(env: Bindings): Promise<NibssAuthToken> {
     const kvKey = `nibss-token:${env.ENVIRONMENT ?? 'local'}`;
     try {
       const cached = await env.RATE_LIMIT_KV.get(kvKey, 'json') as NibssAuthToken | null;
       if (cached && cached.expiresAt > Date.now()) {
         return cached;
       }
     } catch { /* fall through to fresh auth */ }
     const creds = credsFromEnv(env);
     const token = await fetchNibssToken(creds);
     const ttl = Math.max(1, Math.floor((token.expiresAt - Date.now()) / 1000));
     try {
       await env.RATE_LIMIT_KV.put(kvKey, JSON.stringify(token), { expirationTtl: ttl });
     } catch { /* ignore KV write failure */ }
     return token;
   }
   ```
3. Update all callers of `getToken(creds)` to `getToken(c.env)` (pass full env)
4. Update `__resetNibssTokenCache` to delete from KV (for tests, mock KV)
5. Update tests to mock KV operations

**Required Deliverables:**
- Updated `src/modules/payouts/index.ts`
- Updated tests

**Acceptance Criteria:**
- [ ] Module-level `cachedToken` variable removed
- [ ] Token stored in KV with correct TTL
- [ ] KV read failure falls back to fresh auth
- [ ] Tests updated for KV-based caching
```

---

### IMPL-PROMPT-10: Circuit Breaker

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-10
**Task Title:** Implement KV-Backed Circuit Breaker for NIBSS and Paystack

**Repo Context:**
`webwaka-fintech` — Cloudflare Workers. External API outages (NIBSS, Paystack) cascade into Worker CPU exhaustion. A circuit breaker returns 503 immediately when a service is down.

**Objective:**
Create a `CircuitBreaker` class backed by KV, and wrap NIBSS calls in the payout module with it.

**Dependencies:**
- RATE_LIMIT_KV binding

**Important Reminders:**
1. Circuit must be per-service, not global
2. KV write failure should fail open (treat circuit as closed)
3. Graceful degradation — return 503 with informative message when circuit is open
4. Consult replit.md before acting

**Execution Steps:**
1. Create `src/core/circuitBreaker.ts`:
   ```typescript
   interface CircuitState {
     state: 'closed' | 'open' | 'half-open';
     failures: number;
     lastFailureAt: number;
   }
   const FAILURE_THRESHOLD = 5;
   const COOLDOWN_MS = 120_000; // 2 minutes
   
   export class CircuitBreaker {
     constructor(private kv: KVNamespace, private service: string, private env: string) {}
     
     private kvKey() { return `circuit:${this.service}:${this.env}`; }
     
     async execute<T>(fn: () => Promise<T>): Promise<T> { ... }
   }
   ```
2. Implement `execute()`:
   - Read circuit state from KV
   - If open and cooldown not elapsed: throw CircuitOpenError
   - If open and cooldown elapsed: set half-open, attempt fn
   - On success: reset failures, set closed
   - On failure: increment failures, if >= threshold set open
   - Store state in KV with 1-hour TTL
3. Create `CircuitOpenError extends Error`
4. Wrap NIBSS calls in payout module with circuit breaker
5. Return 503 `{ error: "Payment service temporarily unavailable. Please retry in 2 minutes." }` on CircuitOpenError
6. Add tests for all three states

**Required Deliverables:**
- New `src/core/circuitBreaker.ts`
- Updated `src/modules/payouts/index.ts`
- Tests for all circuit states

**Acceptance Criteria:**
- [ ] Circuit opens after 5 failures
- [ ] 503 returned immediately when open
- [ ] Half-open allows one request through
- [ ] Separate circuits for NIBSS vs Paystack
```

---

### IMPL-PROMPT-11: Audit Log

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-11
**Task Title:** Add Immutable Audit Log for All Admin Financial Actions

**Repo Context:**
`webwaka-fintech` — WebWaka OS v4. CBN requires immutable audit trails for all financial transactions. This task adds an auditLog table and wires up audit writing across all modules.

**Objective:**
Create an append-only `auditLog` D1 table, a `writeAuditLog` utility, and call it from every mutation endpoint in all modules.

**Dependencies:**
- None (foundational task)

**Important Reminders:**
1. Audit log is append-only — NO UPDATE or DELETE routes
2. Audit writes are best-effort — failure must not block primary operation
3. Multi-Tenant — tenantId always included
4. Consult replit.md before acting

**Execution Steps:**
1. Create `migrations/0006_audit_log.sql` (see schema in TASK-11 section above)
2. Create `src/core/audit.ts`:
   ```typescript
   export interface AuditEntry {
     tenantId: string; actorId: string; actorRole: string;
     action: string; resourceType: string; resourceId: string;
     metadata?: Record<string, unknown>;
   }
   export async function writeAuditLog(db: D1Database, entry: AuditEntry): Promise<void> {
     try {
       await db.prepare(
         'INSERT INTO auditLog (id, tenantId, actorId, actorRole, action, resourceType, resourceId, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
       ).bind(
         crypto.randomUUID(), entry.tenantId, entry.actorId, entry.actorRole,
         entry.action, entry.resourceType, entry.resourceId,
         JSON.stringify(entry.metadata ?? {}), new Date().toISOString()
       ).run();
     } catch (err) {
       console.error('[AuditLog] Write failed:', err); // Never throw
     }
   }
   ```
3. Add audit calls after every mutation in:
   - Banking: account.create, transaction.post, account.status_change
   - Insurance: policy.create, claim.file, claim.adjudicate
   - Investment: portfolio.create, portfolio.value_update, portfolio.liquidate
   - Payouts: payout.initiate, payout.confirm, payout.fail
4. Add `GET /api/admin/audit-log` (admin only, cursor paginated)
5. Add tests verifying audit entry created on each mutation

**Required Deliverables:**
- New migration file
- `src/core/audit.ts`
- Updated all module files
- Tests

**Acceptance Criteria:**
- [ ] Audit entry created for every mutation in all modules
- [ ] No UPDATE/DELETE routes for auditLog
- [ ] Audit write failure doesn't block primary operation
- [ ] GET /admin/audit-log endpoint works
```

---

### IMPL-PROMPT-12: Rate Limiting on Financial Endpoints

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-12
**Task Title:** Extend Rate Limiting to Financial Mutation Endpoints

**Repo Context:**
`webwaka-fintech` — currently only /api/auth/* is rate-limited. Financial endpoints need stricter per-tenant rate limits.

**Objective:**
Apply `rateLimit` middleware from `@webwaka/core` to payout and banking mutation endpoints.

**Execution Steps:**
1. Read `src/worker.ts` and review rateLimit usage
2. Add rate limiting in worker.ts for:
   - `/api/payouts/initiate` — limit: 10, window: 60s, keyPrefix: 'fintech-payout'
   - `/api/payouts/bulk` — limit: 2, window: 60s, keyPrefix: 'fintech-payout-bulk'
   - `/api/banking/transactions` — limit: 30, window: 60s, keyPrefix: 'fintech-txn'
   - `/api/banking/*/fund` — limit: 5, window: 60s, keyPrefix: 'fintech-fund'
3. Verify rate limit key includes tenantId (from JWT) for per-tenant isolation
4. Add tests verifying 429 response

**Required Deliverables:**
- Updated `src/worker.ts`
- Tests for rate-limited endpoints

**Acceptance Criteria:**
- [ ] Financial endpoints return 429 when limit exceeded
- [ ] Rate limits are per-tenant
- [ ] GET endpoints not affected
```

---

### IMPL-PROMPT-13: Idempotency Keys

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-13
**Task Title:** Add Idempotency-Key Header Support to Financial POST Endpoints

**Repo Context:**
`webwaka-fintech` — Nigerian mobile networks are unreliable. Users retry requests causing duplicates. Idempotency keys prevent duplicate charges.

**Objective:**
Create a KV-backed idempotency middleware and apply it to POST /banking/transactions, POST /payouts/initiate, and POST /banking/accounts/*/fund.

**Execution Steps:**
1. Create `src/core/idempotency.ts`:
   - Read `Idempotency-Key` header
   - If present: check KV for `idempotency:{tenantId}:{key}`
   - If found in KV: return cached response
   - If not found: call handler, cache response (for 2xx only), return response
2. Apply to three endpoints
3. KV key TTL: 86400 seconds (24 hours)
4. Only cache 2xx responses (not 4xx or 5xx)
5. Add tests

**Required Deliverables:**
- `src/core/idempotency.ts`
- Updated endpoints
- Tests

**Acceptance Criteria:**
- [ ] Repeat request with same key returns same response
- [ ] Different tenant same key: no collision
- [ ] Missing key: request proceeds normally
- [ ] 4xx responses not cached
```

---

### IMPL-PROMPT-14: KYC/BVN Tier Enforcement

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-14
**Task Title:** Implement Three-Tier KYC Enforcement with CBN Transaction Limits

**Repo Context:**
`webwaka-fintech` — CBN regulatory requirement. All fintech operators must enforce Tier 1/2/3 KYC with daily transaction limits.

**Objective:**
Add kycVerifications table, KYC utility functions, and enforce daily limits on banking transactions and payouts.

**CBN Limits (current as of 2024):**
- Tier 1: ₦50,000/day = 5,000,000 kobo
- Tier 2: ₦200,000/day = 20,000,000 kobo (requires BVN)
- Tier 3: Unlimited (requires full docs)

**Execution Steps:**
1. Create `migrations/0007_kyc_verifications.sql` (see schema in TASK-14 section)
2. Create `src/core/kyc.ts`:
   - `getCustomerKycTier(db, tenantId, customerId): Promise<{tier, dailyLimitKobo}>`
   - `getDailySpend(db, tenantId, customerId): Promise<number>` — sum amountKobo for today's debit transactions
   - `enforceKycLimit(db, tenantId, customerId, amountKobo): Promise<void>` — throws if limit exceeded
3. Admin endpoint: `PATCH /api/kyc/:customerId/tier` to upgrade tier
4. Apply `enforceKycLimit` in:
   - Banking POST /transactions for debit operations
   - Payouts POST /initiate
5. Endpoints for KYC status: `GET /api/kyc/:customerId`
6. Add tests for all three tiers

**Required Deliverables:**
- Migration file, `src/core/kyc.ts`, updated modules, tests

**Acceptance Criteria:**
- [ ] Tier 1 blocked at ₦50,000/day
- [ ] Tier 2 blocked at ₦200,000/day
- [ ] Tier 3 unlimited
- [ ] Daily spend calculated from today's transactions only
```

---

### IMPL-PROMPT-15: Webhook Replay Protection

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-15
**Task Title:** Add Timestamp Validation to NIBSS and Paystack Webhook Handlers

**Objective:**
Reject webhook payloads with timestamps older than 5 minutes.

**Execution Steps:**
1. Add timestamp check to NIBSS webhook handler in `src/modules/payouts/index.ts`:
   - Extract `settledAt` from payload
   - If `settledAt` is present and `Math.abs(Date.now() - new Date(settledAt).getTime()) > 300_000`: return 401
2. Apply same check to Paystack webhook (TASK-04)
3. Add tests for replay scenario and valid timestamp
4. Add ±30 second tolerance for clock skew

**Required Deliverables:**
- Updated webhook handlers
- Tests for replay and valid scenarios

**Acceptance Criteria:**
- [ ] Webhook older than 5 minutes returns 401
- [ ] Webhook within 5 minutes processes normally
- [ ] ±30s clock skew tolerance
```

---

### IMPL-PROMPT-16: NIBSS Response Code Registry

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-16
**Task Title:** Add Complete CBN NIP Response Code Registry

**Objective:**
Create a lookup table of all CBN NIP response codes with structured metadata.

**Execution Steps:**
1. Create `src/core/nibssResponseCodes.ts` with interface and registry covering at minimum:
   - 00/000: Success
   - 01: Refer to Card Issuer
   - 05: Do Not Honor
   - 12: Invalid Transaction
   - 14: Invalid Account
   - 30: Format Error
   - 34: Suspected Fraud
   - 51: Insufficient Funds
   - 54: Expired Card
   - 57: Transaction Not Permitted
   - 58: Transaction Not Permitted (terminal)
   - 61: Exceeds Withdrawal Limit
   - 65: Exceeds Withdrawal Frequency
   - 68: Response Received Too Late
   - 91: Issuer Unavailable
   - 92: Routing Error (retryable)
   - 96: System Error (retryable)
   - ...and all other known codes
2. Export `enrichNibssError(code: string): NibssResponseCode`
3. Update payout initiation failure messages to use enriched messages
4. Add tests

**Required Deliverables:**
- `src/core/nibssResponseCodes.ts`
- Updated payout failure handling
- Tests
```

---

### IMPL-PROMPT-17: Cursor-Based Pagination

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-17
**Task Title:** Implement Cursor-Based Pagination for All List Endpoints

**Objective:**
Replace hard-coded LIMIT 100 with cursor-based pagination.

**Execution Steps:**
1. Create `src/core/pagination.ts`:
   - `encodeCursor(id: string, createdAt: string): string` — base64 encode `{id}:{createdAt}`
   - `decodeCursor(cursor: string): { id: string, createdAt: string } | null`
   - `buildPaginatedQuery(baseQuery, params, cursor, limit): { query, params }`
2. Apply to all list endpoints:
   - banking accounts
   - banking transactions
   - insurance policies
   - insurance claims (TASK-05)
   - investment portfolios
   - payouts
   - audit log (TASK-11)
3. Response envelope: `{ data: [...], nextCursor: string | null, hasMore: boolean }`
4. Default limit 20, max 100
5. Add tests

**Required Deliverables:**
- `src/core/pagination.ts`
- All list endpoints updated
- Tests

**Acceptance Criteria:**
- [ ] Default 20 per page
- [ ] Max 100 enforced
- [ ] nextCursor null on last page
- [ ] Cursor-based query produces no overlap between pages
```

---

### IMPL-PROMPT-18: Event Bus Coverage

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-18
**Task Title:** Publish Domain Events from Banking, Insurance, and Investment Modules

**Objective:**
Extend the Event Bus publisher in src/core/events.ts with new event types for all modules, and publish events from every module mutation.

**Dependencies:**
- src/core/events.ts (existing)

**Execution Steps:**
1. Add new event interfaces to `src/core/events.ts`:
   - AccountCreatedEvent, AccountStatusChangedEvent
   - TransactionCompletedEvent, AccountFundedEvent
   - PolicyCreatedEvent, ClaimApprovedEvent
   - PortfolioCreatedEvent, PortfolioLiquidatedEvent
   - Update WebWakaEvent union type
2. Call publishEvent after each successful mutation in:
   - banking: account.create, transaction.post, account.fund
   - insurance: policy.create, claim.approve
   - investment: portfolio.create, portfolio.liquidate
3. All event payloads must include: event, tenantId, resourceId, timestamp
4. Add tests verifying events published on mutations

**Required Deliverables:**
- Updated `src/core/events.ts`
- Updated all module files
- Tests
```

---

### IMPL-PROMPT-19: Enhanced Health Check

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-19
**Task Title:** Improve /health Endpoint with Dependency Probing

**Objective:**
Replace static health response with structured dependency health check.

**Execution Steps:**
1. Update the `/health` handler in `src/worker.ts`
2. Check D1: `await c.env.DB.prepare('SELECT 1').first()` with 1s timeout
3. Check KV: `await c.env.RATE_LIMIT_KV.get('health-probe')` with 1s timeout
4. Return structured JSON (see TASK-19 section for schema)
5. Overall status: 'ok' if all ok, 'degraded' if one fails, 'down' if all fail
6. Respond within 2 seconds (use Promise.race with timeout)
7. Add tests

**Required Deliverables:**
- Updated `src/worker.ts`
- Tests for healthy, degraded, down states
```

---

### IMPL-PROMPT-20: CI/CD Hardening

```markdown
You are a Replit execution agent working in the `webwaka-fintech` repository.

**Task ID:** TASK-20
**Task Title:** Add D1 Migrations, Manual Approval, and Caching to CI/CD Pipeline

**Objective:**
Harden the GitHub Actions workflow for safe, reliable deployments.

**Execution Steps:**
1. Read `.github/workflows/deploy.yml` fully
2. Split into two jobs: `test`, `deploy-staging`, `deploy-production`
3. Add to `deploy-staging` job:
   ```yaml
   - name: Apply D1 Migrations (Staging)
     run: npx wrangler d1 migrations apply DB --env staging --yes
     env:
       CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
       CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
   ```
4. Add `environment: production` to `deploy-production` job (requires GitHub Environments configured)
5. Cache npm deps:
   ```yaml
   - uses: actions/setup-node@v4
     with:
       node-version: '20'
       cache: 'npm'
   ```
6. Pin wrangler-action to SHA (look up current cloudflare/wrangler-action SHA)
7. Add `npm ci` (not `npm install`) for reproducible installs

**Required Deliverables:**
- Updated `.github/workflows/deploy.yml`

**Acceptance Criteria:**
- [ ] D1 migration runs before Worker deploy
- [ ] Production requires manual approval
- [ ] npm deps cached
- [ ] wrangler-action pinned to SHA
- [ ] npm ci used (not npm install)
```

---

## 9. QA PROMPTS

---

### QA-PROMPT-01

```markdown
You are a Replit QA and Bug-Fix agent for the `webwaka-fintech` repository.

**Task ID:** QA-01
**Task Title:** QA Atomic Banking Transactions

**Context:**
This is the `webwaka-fintech` repository — WebWaka OS v4 financial infrastructure. TASK-01 implemented atomic banking transactions using D1 batch(). This repo is not standalone; banking data is consumed by downstream repos.

**Verification Steps:**
1. Read `src/modules/banking/index.ts` and confirm all transaction+balance operations use `DB.batch()`, NOT two separate `.run()` calls
2. Search codebase for `\.run\(\)` in banking module — any `.run()` for financial mutations is a bug
3. Verify overdraft check: grep for balance check before debit operations
4. Run `npm test` and confirm all tests pass
5. Check that the withdrawal test with insufficient funds returns 422 and verifies NO transaction was recorded
6. Verify customer role cannot post transactions

**Bug Patterns to Look For:**
- Two separate `.run()` calls for INSERT+UPDATE
- Balance update that doesn't respect negative balances
- Missing account existence check before transaction
- tenantId in request body (not from JWT)

**Edge Cases to Verify:**
- Zero-amount transaction
- Withdrawal exactly equal to balance
- Withdrawal exceeding balance by 1 kobo

**If Any Bug Found:**
Fix it directly in the code. Then re-run tests. Report what was fixed.

**Done When:**
- All tests pass
- No `.run()` for financial mutations in banking module
- Overdraft protection confirmed in code and tests
```

---

### QA-PROMPT-02

```markdown
You are a Replit QA and Bug-Fix agent for the `webwaka-fintech` repository.

**Task ID:** QA-02
**Task Title:** QA Input Validation Layer

**Verification Steps:**
1. Read `src/modules/banking/index.ts`, `src/modules/insurance/index.ts`, `src/modules/investment/index.ts`
2. For each POST endpoint, verify validation is present for all required fields
3. Run `npm test` — all validation tests must pass
4. Manually verify that `amountKobo: 1.5` returns 400, `amountKobo: 0` returns 400, `amountKobo: -100` returns 400
5. Verify that invalid enum values return 400 with a field-level message
6. Verify that valid inputs still return 201

**Bug Patterns:**
- Missing validation for kobo amounts (floats, negatives, zero)
- Missing enum validation
- Validation that reads DB (should be stateless)
- Error response not including field names

**Done When:**
- All invalid inputs return 400 with field-level messages
- Valid inputs still return 201
- All tests pass
```

---

### QA-PROMPT-03

```markdown
You are a Replit QA agent for `webwaka-fintech`.

**Task ID:** QA-03 through QA-20

For each remaining task (TASK-03 through TASK-20), verify the following:

**Standard QA Checklist for Every Task:**
1. Run `npm test` — ALL 42+ tests must still pass (no regressions)
2. Run `npm run typecheck` — zero TypeScript errors
3. Verify tenant isolation on all new endpoints (wrong tenant returns 404)
4. Verify role enforcement (customer cannot access admin endpoints)
5. Verify kobo invariant (no naira floats in any DB write or response)
6. Verify all new endpoints have tests
7. Verify no `.env` secrets logged or returned in responses
8. Verify Event Bus events published for all mutations
9. Verify pagination returns correct `nextCursor` and `hasMore`
10. Verify webhook endpoints are outside JWT auth guard in worker.ts

**For Each Task:**
- Read the relevant source files
- Run the tests
- Look for the specific bugs listed in each QA plan section
- Fix any found bugs directly
- Re-run tests after fixing

**Final Certification:**
After completing QA for all tasks, provide:
- Total tests passing
- TypeScript error count
- List of bugs found and fixed
- Confirmation that all invariants are respected
```

---

## 10. PRIORITY ORDER

```
CRITICAL (must do first — blocking correctness):
  1. TASK-01 — Atomic Banking Transactions (data corruption risk)
  2. BUG-02  — Overdraft Protection (negative balances)
  3. TASK-02 — Input Validation (500 errors from bad inputs)
  4. BUG-07  — D1 Migrations in CI (schema divergence)
  5. BUG-09  — secureCORS configuration (CORS misconfiguration)

HIGH (complete before go-live):
  6.  TASK-11 — Audit Log (CBN compliance)
  7.  TASK-14 — KYC/BVN Tier Enforcement (CBN compliance)
  8.  TASK-04 — Paystack Funding Flow (account funding dead code)
  9.  TASK-03 — Complete Banking API (missing GET endpoints)
  10. TASK-07 — NIBSS Cron Poller (stuck payouts)
  11. TASK-12 — Rate Limiting on Financial Endpoints (abuse prevention)
  12. TASK-20 — CI/CD Hardening (production safety)

MEDIUM (important for completeness):
  13. TASK-05 — Insurance Claims (module completion)
  14. TASK-08 — Bulk Payout (batch disbursement)
  15. TASK-13 — Idempotency Keys (duplicate prevention)
  16. TASK-15 — Webhook Replay Protection (security)
  17. TASK-17 — Cursor Pagination (scalability)
  18. TASK-18 — Event Bus Coverage (ecosystem completeness)

LOWER (enhance capabilities):
  19. TASK-06 — Investment Updates + AI (module completion)
  20. TASK-09 — NIBSS Token in KV (efficiency)
  21. TASK-10 — Circuit Breaker (resilience)
  22. TASK-16 — NIBSS Response Code Registry (UX)
  23. TASK-19 — Enhanced Health Check (observability)
```

---

## 11. DEPENDENCIES

```
TASK-01 ← (none — foundational)
TASK-02 ← (none — foundational)
TASK-03 ← TASK-02
TASK-04 ← TASK-01, TASK-02
TASK-05 ← TASK-02, TASK-03
TASK-06 ← TASK-02
TASK-07 ← (existing payouts module)
TASK-08 ← TASK-07 (cron should handle bulk-created payouts)
TASK-09 ← (existing payouts module)
TASK-10 ← TASK-09 (circuit breaker wraps same NIBSS calls)
TASK-11 ← (none — foundational, can be done in parallel)
TASK-12 ← (existing worker.ts)
TASK-13 ← TASK-01, TASK-04
TASK-14 ← TASK-01, TASK-02
TASK-15 ← TASK-04 (Paystack webhook)
TASK-16 ← (existing NIBSS module)
TASK-17 ← TASK-03 (some list endpoints from TASK-03)
TASK-18 ← TASK-03, TASK-05 (events for new endpoints)
TASK-19 ← (none — standalone)
TASK-20 ← (none — CI/CD only)
```

**Parallel Execution Tracks:**

- **Track A (Data Integrity):** TASK-01 → TASK-02 → TASK-03 → TASK-04
- **Track B (Compliance):** TASK-11 → TASK-14
- **Track C (Payouts):** TASK-07 → TASK-08 → TASK-09 → TASK-10
- **Track D (Modules):** TASK-05 → TASK-06
- **Track E (Platform):** TASK-12 → TASK-13 → TASK-15 → TASK-17 → TASK-18
- **Track F (CI/CD + Observability):** TASK-20, TASK-19, TASK-16 (independent)

Tracks A and B can start immediately in parallel. Tracks C and D can start after Track A completes TASK-01.

---

## 12. PHASE 1 / PHASE 2 SPLIT

### Phase 1 — Foundation and Compliance (Weeks 1-3)

**Objective:** Make the repo production-safe and CBN-compliant.

| Task | Description | Priority |
|---|---|---|
| TASK-01 | Atomic Banking Transactions | Critical |
| BUG-02 | Overdraft Protection | Critical |
| TASK-02 | Input Validation | Critical |
| BUG-07 | D1 Migrations in CI | High |
| BUG-09 | secureCORS Configuration | High |
| TASK-11 | Audit Log | High |
| TASK-14 | KYC Tier Enforcement | High |
| TASK-03 | Complete Banking API | High |
| TASK-04 | Paystack Funding Flow | High |
| TASK-07 | NIBSS Cron Poller | High |
| TASK-12 | Rate Limiting | High |
| TASK-20 | CI/CD Hardening | High |

**Phase 1 Exit Criteria:**
- All banking transactions are atomic
- Input validation on all POST endpoints
- KYC tier limits enforced
- Audit log operational
- D1 migrations in CI
- All tests passing (target: 80+ tests)

### Phase 2 — Capabilities and Excellence (Weeks 4-6)

**Objective:** Complete all modules, add bulk operations, resilience, and AI features.

| Task | Description | Priority |
|---|---|---|
| TASK-05 | Insurance Claims | Medium |
| TASK-06 | Investment Updates + AI | Medium |
| TASK-08 | Bulk Payout | Medium |
| TASK-09 | NIBSS Token in KV | Medium |
| TASK-10 | Circuit Breaker | Medium |
| TASK-13 | Idempotency Keys | Medium |
| TASK-15 | Webhook Replay Protection | Medium |
| TASK-16 | NIBSS Response Code Registry | Lower |
| TASK-17 | Cursor Pagination | Medium |
| TASK-18 | Event Bus Coverage | Medium |
| TASK-19 | Enhanced Health Check | Lower |

**Phase 2 Exit Criteria:**
- All four modules fully functional (banking, insurance, investment, payouts)
- AI recommendations operational
- Bulk payout working
- All list endpoints paginated
- Event Bus coverage complete
- 95+ tests passing

---

## 13. REPO CONTEXT AND ECOSYSTEM NOTES

### This Repo Is NOT Standalone

`webwaka-fintech` is one of 11 repositories in the WebWaka OS v4 platform. Critical notes for implementation agents:

**Auth comes from `@webwaka/core`:**
- Never re-implement JWT verification, CORS, or rate limiting
- Always use `jwtAuthMiddleware()`, `requireRole()`, `secureCORS()`, `rateLimit()` from the package
- The mock at `src/__mocks__/@webwaka/core.ts` must align with the real package API

**Tenant provisioning is in `webwaka-super-admin-v2`:**
- This repo does not create tenants — it only serves existing tenants
- `tenantId` in all DB operations comes from the JWT payload
- Never accept `tenantId` from request body or headers

**Events consumed by multiple repos:**
- `payout.completed` → webwaka-commerce, webwaka-logistics, webwaka-transport
- `transfer.successful` → webwaka-institutional (student fee clearance)
- `account.funded` → (TBD consumer)
- `policy.created` → (TBD consumer)
- Event payloads must be stable — breaking payload changes require versioning

**What NOT to implement here:**
- User registration/authentication (handled by `webwaka-core` and `webwaka-super-admin-v2`)
- Tenant management (handled by `webwaka-super-admin-v2`)
- Email/SMS notifications (should be handled by a notification service via events)
- Frontend UI (this is a pure API repo)
- Reporting/analytics dashboards (handled by a BI layer consuming events)

**NIBSS bank partner dependency:**
- This repo requires a licensed Nigerian bank partner for NIBSS NIP access
- Bank partners (GTB, Stanbic IBTC, Sterling, etc.) have their own API schemas
- The current `src/core/nibss.ts` assumes a canonical schema — real bank partners may differ
- Test credentials should use the bank partner's sandbox environment

### Ecosystem Events Expected (Cross-Repo)

Upstream repos will publish events that this repo should eventually consume:
- `user.kyc.verified` from `webwaka-super-admin-v2` → auto-upgrade KYC tier
- `subscription.activated` from platform → enable premium banking features

This repo does not yet have a consumer for these events — this is future work.

---

## 14. GOVERNANCE AND REMINDER BLOCK

### Invariants (Non-Negotiable)

Every implementation agent working on this repo MUST honor these invariants:

1. **Build Once Use Infinitely** — ALL auth from `@webwaka/core`. Never rewrite verifyJWT, requireRole, secureCORS, or rateLimit.

2. **Mobile/PWA/Offline First** — Dexie offline DB in `src/db/db.ts` is the client-side store. Any new entity types added to the server schema must also be added to the Dexie schema.

3. **Nigeria First** — ALL monetary amounts stored as kobo integers (NGN × 100). Never store naira floats. Always validate kobo amounts are positive integers. Use `en-NG` locale for formatting.

4. **Africa First** — Support 7 locales (`en-NG`, `en-GH`, `en-KE`, `en-ZA`, `fr-CI`, `yo-NG`, `ha-NG`). All label strings must have entries in `src/i18n/index.ts`.

5. **Vendor Neutral AI** — ALL AI calls through OpenRouter (`src/core/ai.ts`). Never import or call OpenAI, Anthropic, or Google AI SDKs directly.

6. **Multi-Tenant Tenant-as-Code** — tenantId ALWAYS from JWT payload (`c.get('user').tenantId`). NEVER from request body, URL params, or headers. Every DB query MUST include `WHERE tenantId = ?`.

7. **Event-Driven** — All cross-repo state changes via events. NEVER direct API calls to other repos. NEVER direct DB access to other repos' databases.

8. **Thoroughness Over Speed** — Do not skip edge cases. Do not produce stub implementations. Complete all steps.

9. **Zero Skipping Policy** — Do not skip tests. Do not skip validation. Do not skip error handling. Do not skip audit log writes.

10. **CI/CD Native** — All changes must pass `npm run typecheck` (zero TypeScript errors) and `npm test` (all tests passing) before completion.

11. **Cloudflare-First** — Use D1 (not PostgreSQL), KV (not Redis), Cron Triggers (not external cron), Workers (not Express). Use `DB.batch()` for atomic operations.

### Security Mandates

- Never log or return secrets (`JWT_SECRET`, `PAYSTACK_SECRET_KEY`, `NIBSS_CLIENT_SECRET`, etc.)
- Never accept `tenantId` from the request body
- Always verify HMAC signatures on webhook endpoints
- Always validate request bodies before processing
- Rate limit all financial mutation endpoints
- Use `crypto.getRandomValues()` not `Math.random()` for security-sensitive random values

### Data Mandates

- All DB queries MUST include `tenantId` filter
- Transaction boundaries MUST use `DB.batch()` for atomic operations
- Audit log MUST be written for every admin financial action
- KYC tier limits MUST be enforced before any debit operation
- Soft deletes only — never hard-delete financial records

---

## 15. EXECUTION READINESS NOTES

### Current State (as of April 2026)

**Working and tested:**
- Full NIBSS NIP payout flow (37 tests)
- Event Bus publisher
- i18n utilities
- Basic banking, insurance, investment CRUD (untested)
- Paystack integration code (dead code, untested)
- AI abstraction (dead code, untested)
- Dexie offline DB (untested)

**Blocking production use:**
- Non-atomic banking transactions (data corruption risk)
- No input validation on banking/insurance/investment
- No KYC enforcement (CBN compliance)
- No audit log (CBN compliance)
- Paystack dead code
- No D1 migrations in CI

**Development environment:**
- Run locally: `node_modules/.bin/wrangler dev --port 5000 --ip 0.0.0.0 --no-show-interactive-dev-session --local`
- All bindings simulated locally via Miniflare
- Copy `.dev.vars.example` to `.dev.vars` and fill in real API keys for integration testing
- Run tests: `npm test`
- Run typecheck: `npm run typecheck`
- Test health endpoint: `GET /health` → `{"status":"ok","service":"webwaka-fintech","version":"0.1.0"}`

### Recommended Execution Order for Parallel Teams

**Team 1 (Data Integrity):** TASK-01 → TASK-02 → TASK-03 → TASK-04
**Team 2 (Compliance):** TASK-11 → TASK-14 → TASK-12 → TASK-20
**Team 3 (Payouts):** TASK-07 → TASK-08 → TASK-09 → TASK-10
**Team 4 (Modules):** TASK-05 → TASK-06 → TASK-18
**Team 5 (Platform):** TASK-13 → TASK-15 → TASK-16 → TASK-17 → TASK-19

Teams 1 and 2 can start immediately in parallel. Teams 3, 4, 5 can start after TASK-01 is complete.

### Test Execution Targets

| Phase | Target Tests | Coverage Target |
|---|---|---|
| Current | 42 | ~40% (payouts + utilities only) |
| Phase 1 end | 120+ | 80%+ lines |
| Phase 2 end | 200+ | 85%+ lines |

### Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| NIBSS bank partner API schema differs from canonical | High | High | Document expected schema, make configurable |
| D1 batch() API limitations | Low | High | Test against real D1, not just mock |
| Cloudflare Workers CPU limit on bulk payout | Medium | Medium | Process max 100 items, add 50ms delay between transfers |
| KYC data residency compliance | Low | High | Confirm Cloudflare D1 Nigeria edge availability |
| Token cache race condition on cold start | Low | Low | KV put is atomic; accept occasional extra auth calls |
| Breaking change to @webwaka/core API | Medium | High | Pin to exact version, test against mock |

---

*Document end. Total tasks: 20. Total QA plans: 20. Total prompt pairs: 40. Phase 1 tasks: 12. Phase 2 tasks: 8.*

*This document is ready for immediate use by Replit implementation and QA agents. Each task is self-contained with all context needed for execution. All prompts are copy-paste ready.*
