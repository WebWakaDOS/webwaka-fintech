# WebWaka Fintech Suite

## Overview
A multi-tenant fintech API built on Cloudflare Workers + Hono, targeting the Nigerian and African markets. Provides banking, insurance, investment, and automated payouts (NIBSS NIP transfers).

## Architecture
- **Runtime:** Cloudflare Workers (Wrangler / Miniflare for local dev)
- **Framework:** Hono (lightweight HTTP framework)
- **Language:** TypeScript
- **Database:** Cloudflare D1 (SQL), Cloudflare KV (sessions/rate-limit), R2 (media)
- **Auth:** `@webwaka/core` — JWT-based, tenant ID always from JWT (never headers/body)
- **Payments:** Paystack, NIBSS NIP for inter-bank transfers
- **AI:** OpenRouter abstraction
- **SMS/OTP:** Termii

## Core Invariants
1. Build Once Use Infinitely — multi-tenant via JWT tenantId
2. Mobile First — lightweight Hono API
3. PWA First — Cloudflare Workers + Pages
4. Offline First — Dexie (IndexedDB) on client side
5. Nigeria First — all monetary values in kobo (NGN × 100)
6. Africa First — 7-locale i18n
7. Vendor Neutral AI — OpenRouter only

## Project Structure
```
src/
  worker.ts          # Entry point — router + global middleware
  core/
    types.ts         # Shared types (Bindings, AppVariables, domain models)
    nibss.ts         # NIBSS NIP client
    paystack.ts      # Paystack client
    events.ts        # WebWaka Event Bus integration
    ai-platform-client.ts  # OpenRouter AI abstraction
  middleware/
    auth.ts          # Re-exports from @webwaka/core
  modules/
    banking/         # Bank accounts + transactions
    insurance/       # Insurance policies
    investment/      # Investment portfolios
    payouts/         # NIBSS NIP payout + webhook router
  db/
    db.ts            # Dexie offline store definition
    schema.sql       # D1 SQL schema
  i18n/             # 7-locale internationalization
migrations/         # D1 SQL migration scripts
docs/              # Research + design documentation
```

## Running Locally (Replit)
The workflow runs `wrangler dev` using Miniflare to simulate Cloudflare bindings locally:
- **Port:** 8000
- **Workflow:** "Start application"
- All D1, KV, and R2 bindings are simulated locally (no Cloudflare account needed)
- Placeholder secrets are set in `wrangler.toml` [vars] for local dev

## Deploying to Cloudflare
```bash
npm run deploy:staging      # Deploy to staging env
npm run deploy:production   # Deploy to production env
```
Before deploying, set secrets via:
```bash
wrangler secret put JWT_SECRET --env staging
wrangler secret put PAYSTACK_SECRET_KEY --env staging
# ... etc
```

## Key Endpoints
- `GET /health` — Health check (unauthenticated)
- `POST /webhooks/nibss-nip` — NIBSS NIP webhook (HMAC-verified, unauthenticated)
- `GET /api/banking/*` — Banking routes (JWT required)
- `GET /api/insurance/*` — Insurance routes (JWT required)
- `GET /api/investment/*` — Investment routes (JWT required)
- `GET /api/payouts/*` — Payouts routes (JWT required)

## Dependencies
- `@webwaka/core` — WebWaka OS v4 shared primitives (auth, CORS, rate-limit)
- `hono` — Web framework
- `dexie` — IndexedDB wrapper (client-side offline)
- `wrangler` — Cloudflare Workers CLI + Miniflare dev runtime
- `typescript`, `vitest` — Development tooling
