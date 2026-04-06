# WebWaka Fintech Suite

Multi-tenant fintech API on **Cloudflare Workers + Hono** targeting the Nigerian and African market.

## Platform

| Component | Technology |
|-----------|------------|
| Runtime | Cloudflare Workers (Miniflare for local dev) |
| Framework | Hono v4 |
| Database | Cloudflare D1 (SQLite) |
| Key-Value | Cloudflare KV |
| Object Storage | Cloudflare R2 |
| Auth | `@webwaka/core` — `jwtAuthMiddleware`, `requireRole`, `secureCORS`, `rateLimit` |
| Package manager | npm |

## Running the Worker

```
node_modules/.bin/wrangler dev --port 8000 --no-show-interactive-dev-session
```

Port 8000 is a console-type output. The workflow is named **Start application**.

## Invariants (Never Break)

1. **Build Once Use Infinitely** — all auth via `@webwaka/core`, never re-implement
2. `tenantId` always from JWT payload, never from request headers/body
3. **Nigeria First** — all monetary values in **kobo** (NGN × 100), integers only
4. AI credit scoring uses `getAICompletion` from `src/core/ai-platform-client.ts` when `AI_PLATFORM_URL` is set; falls back to rule-based scorer automatically

## Modules & Route Map

### Core Modules

| Module | Router file | Route prefix |
|--------|-------------|--------------|
| Banking | `src/modules/banking/index.ts` | `/api/banking` |
| Insurance | `src/modules/insurance/index.ts` | `/api/insurance` |
| Investment | `src/modules/investment/index.ts` | `/api/investment` |
| NIBSS NIP Payouts | `src/modules/payouts/index.ts` | `/api/payouts` + `/webhooks/nibss-nip` |

### Enhancement Modules

| # | Feature | Router file | Route prefix |
|---|---------|-------------|--------------|
| 2 | AI Credit Scoring | `src/modules/lending/index.ts` | `/api/lending/credit-scores` |
| 3 | Virtual Card Issuance | `src/modules/cards/index.ts` | `/api/cards` |
| 4 | CBN Regulatory Reporting | `src/modules/compliance/index.ts` | `/api/compliance/cbn-reports` |
| 5 | Savings Goals (Ajo/Esusu) | `src/modules/savings/index.ts` | `/api/savings` |
| 6 | Overdraft Protection | `src/modules/overdraft/index.ts` | `/api/overdraft` |
| 7 | Bill Payments (VTPass) | `src/modules/bills/index.ts` | `/api/bills` |
| 8 | USSD Banking Interface | `src/modules/ussd/index.ts` | `/api/ussd` + `/webhooks/ussd` |
| 9 | Fraud Detection Engine | `src/modules/fraud/index.ts` | `/api/fraud` |
| 10 | Multi-Currency Wallets | `src/modules/wallets/index.ts` | `/api/wallets` |
| 11 | Crypto On/Off Ramps | `src/modules/crypto/index.ts` | `/api/crypto` |
| 12 | Agent Banking (POS) | `src/modules/agent/index.ts` | `/api/agent` |
| 13 | Automated Reconciliation | `src/modules/compliance/index.ts` | `/api/compliance/reconciliation` |
| 14 | Standing Orders | `src/modules/standing-orders/index.ts` | `/api/standing-orders` |
| 15 | Split Payments | `src/modules/split-payments/index.ts` | `/api/split-payments` |
| 16 | KYC Tier Enforcement | `src/modules/kyc/index.ts` | `/api/kyc` |
| 17 | Interest-Bearing Accounts | `src/modules/interest/index.ts` | `/api/interest` |
| 18 | Loan Origination | `src/modules/lending/index.ts` | `/api/lending/loans` |
| 19 | Debt Collection Automation | `src/modules/lending/index.ts` | `/api/lending/debt-collection` |
| 20 | Open Banking API | `src/modules/open-banking/index.ts` | `/api/open-banking` |

Feature 1 (NIBSS NIP) is the existing payouts module.

### New Enhancement Tasks (FT-001 — FT-009)

| Task | Feature | Files |
|------|---------|-------|
| FT-001 | Payout idempotency key (`X-Idempotency-Key`) + `GET /api/payouts/reconcile` | `payouts/index.ts`, `migrations/0005_new_features.sql` |
| FT-002 | Loan amortization schedule generation (`GET /api/lending/loans/:id/schedule`) | `lending/index.ts`, `migrations/0005_new_features.sql` |
| FT-003 | Secondary KYC via DOJAH (`POST /api/kyc/verify`) | `kyc/index.ts`, `core/dojah.ts` |
| FT-004 | Paystack payments + refunds + webhook (`/api/payments/*`, `/webhooks/paystack`) | `modules/payments/index.ts`, `core/paystack.ts` |
| FT-005 | Full Event Bus expansion — all banking/lending/wallet/KYC events emitted | `core/events.ts`, banking/lending/wallets/kyc modules |
| FT-009 | Mono open banking — consent/exchange/balance/transactions (`/api/open-banking/mono/*`) | `open-banking/index.ts`, `core/mono.ts` |

## Database

Schema: `src/db/schema.sql`
Migrations:
- `migrations/0001_initial_schema.sql`
- `migrations/0002_payout_requests.sql`
- `migrations/0003_enhancements.sql` — all 20+ new tables

### Table inventory

| Table | Module |
|-------|--------|
| bankAccounts | Banking |
| transactions | Banking |
| insurancePolicies | Insurance |
| investmentPortfolios | Investment |
| payoutRequests | NIBSS NIP |
| kycProfiles | KYC (#16) |
| creditScores | AI Credit Scoring (#2) |
| loans | Loan Origination (#18) |
| loanRepayments | Loan Origination (#18) |
| savingsGoals | Savings Goals (#5) |
| savingsGoalMembers | Savings Goals (#5) |
| savingsGoalContributions | Savings Goals (#5) |
| virtualCards | Virtual Cards (#3) |
| multiCurrencyWallets | Multi-Currency Wallets (#10) |
| billPayments | Bill Payments (#7) |
| standingOrders | Standing Orders (#14) |
| splitPaymentRules | Split Payments (#15) |
| splitPaymentRecipients | Split Payments (#15) |
| fraudAlerts | Fraud Detection (#9) |
| agentTransactions | Agent Banking (#12) |
| cryptoTransactions | Crypto On/Off Ramps (#11) |
| debtCollectionEvents | Debt Collection (#19) |
| openBankingApps | Open Banking (#20) |
| openBankingApiKeys | Open Banking (#20) |
| reconciliationReports | Reconciliation (#13) |
| cbnReports | CBN Reports (#4) |
| interestAccruals | Interest (#17) |
| overdraftEvents | Overdraft Protection (#6) |
| ussdSessions | USSD Banking (#8) |
| payoutIdempotencyKeys | NIBSS NIP Payouts (FT-001) |
| loanRepaymentSchedules | Loan Origination (FT-002) |
| kycVerifications | KYC Verification (FT-003) |
| paystackEvents | Paystack Payments (FT-004) |
| paystackRefunds | Paystack Payments (FT-004) |
| paystackChargebacks | Paystack Payments (FT-004) |
| monoConsents | Mono Open Banking (FT-009) |
| externalBankAccounts | Mono Open Banking (FT-009) |

## Optional Environment Integrations

Configure in `wrangler.toml` [vars] for local dev or via `wrangler secret put` for staging/production:

| Variable | Used by | Fallback |
|----------|---------|----------|
| `AI_PLATFORM_URL` | AI Credit Scoring | Rule-based scorer |
| `INTER_SERVICE_SECRET` | AI Platform auth | — |
| `VTPASS_API_KEY` + `VTPASS_BASE_URL` | Bill Payments | Simulated success |
| `CARD_ISSUER_KEY` + `CARD_ISSUER_URL` | Virtual Cards | Simulated card |
| `CRYPTO_EXCHANGE_URL` + `CRYPTO_EXCHANGE_KEY` | Crypto ramps | Indicative rates |
| `USSD_GATEWAY_URL` + `USSD_GATEWAY_SECRET` | USSD | Session-based only |
| `EVENT_BUS_URL` + `EVENT_BUS_SECRET` | All financial events (FT-005) | Console log |
| `DOJAH_APP_ID` + `DOJAH_PRIVATE_KEY` + `DOJAH_MODE` | Secondary KYC (FT-003) | Returns 503 |
| `MONO_SECRET_KEY` | Mono open banking (FT-009) | Returns 503 |
| `PAYSTACK_WEBHOOK_SECRET` | Paystack webhook HMAC verify (FT-004) | Signature skipped |

## KYC Tier Limits (CBN)

| Tier | Requirement | Single Tx | Daily | Monthly |
|------|-------------|-----------|-------|---------|
| 1 | BVN only | ₦50k | ₦50k | ₦300k |
| 2 | BVN + address | ₦300k | ₦300k | ₦2M |
| 3 | Full corporate | ₦5M | ₦10M | None |

## Fraud Detection Rules

Auto-applied on all banking transactions:

| Rule | Trigger |
|------|---------|
| `large_amount` | > ₦1,000,000 |
| `odd_hours` | 01:00–04:00 WAT |
| `velocity_breach` | >5 tx in 10 minutes |
| `rapid_withdrawal` | >3 withdrawals > ₦500k in 1 hour |

## USSD Session Webhook

Mounted at `/webhooks/ussd` — unauthenticated, outside JWT guard.
Accepts Africa's Talking or similar gateway callbacks.
Returns `CON ...` for continuation or `END ...` to close session.

## Cron-triggered Batch Endpoints

| Endpoint | Function |
|----------|----------|
| `POST /api/standing-orders/process-due` | Execute all due standing orders |
| `POST /api/interest/accrue` | Accrue daily interest for eligible accounts |
| `POST /api/interest/credit` | Credit accrued interest to account balances |
| `POST /api/compliance/reconciliation/run` | Run nightly reconciliation report |

## Open Banking Flow

1. Admin registers app: `POST /api/open-banking/apps`
2. Admin generates API key: `POST /api/open-banking/apps/:id/keys`
3. Third-party uses `Authorization: Bearer <key>` or `X-API-Key: <key>`
4. Third-party calls `/api/open-banking/data/*` endpoints
5. Access is scoped per app: `accounts.read`, `transactions.read`, `balances.read`, `payments.initiate`
