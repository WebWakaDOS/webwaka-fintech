# WebWaka Fintech Suite

## Project Overview
A Cloudflare Workers backend API for the WebWaka OS v4 platform providing Banking, Insurance, and Investment services for Nigerian and African markets.

## Architecture
- **Runtime**: Cloudflare Workers (via Wrangler dev locally)
- **Framework**: Hono (lightweight web framework)
- **Language**: TypeScript
- **Database**: Cloudflare D1 (SQL, accessed via `DB` binding)
- **KV Storage**: Cloudflare KV (SESSIONS_KV, RATE_LIMIT_KV)
- **Object Storage**: Cloudflare R2 (MEDIA_BUCKET)
- **Auth**: JWT via `@webwaka/core`
- **Offline Client**: Dexie (IndexedDB)
- **AI**: OpenRouter abstraction
- **Payments**: Paystack (kobo integers, en-NG locale)

## Key Invariants
1. **Nigeria First** — kobo integers (100 kobo = 1 Naira), en-NG locale
2. **Offline First** — Dexie IndexedDB + mutation queue
3. **Multi-tenant** — tenantId extracted from JWT, never from headers/body
4. **Vendor Neutral AI** — OpenRouter only

## Project Structure
- `src/worker.ts` — Entry point, global middleware, route mounting
- `src/core/` — Types, AI, payment processing
- `src/db/` — Database schema and Dexie offline DB
- `src/modules/` — banking, insurance, investment routers
- `src/middleware/` — JWT and other middleware
- `src/i18n/` — 7-locale African i18n
- `migrations/` — Cloudflare D1 SQL migrations
- `docs/` — Research documents

## Running Locally
- **Start**: Workflow "Start application" runs `npx wrangler dev --port 8000 --no-show-interactive-dev-session`
- **Port**: 8000 (backend/console mode)
- **Health check**: GET /health

## Key Endpoints
- `GET /health` — Health check (unauthenticated)
- `POST /api/auth/*` — Auth endpoints (rate limited)
- `GET|POST /api/banking/*` — Banking module (JWT required)
- `GET|POST /api/insurance/*` — Insurance module (JWT required)
- `GET|POST /api/investment/*` — Investment module (JWT required)
- `POST /api/payouts/initiate` — Initiate NIBSS NIP payout (admin only)
- `GET /api/payouts` — List payout requests (admin only, filterable by status/payoutType)
- `GET /api/payouts/:id` — Get single payout request (admin only)
- `GET /api/payouts/:id/status` — Refresh status from NIBSS (admin only)
- `POST /webhooks/nibss-nip` — Bank partner webhook (HMAC-verified, no JWT)

## Environment / Secrets
Set via `wrangler secret put` for each environment (staging/production):
- `JWT_SECRET` — JWT signing secret
- `PAYSTACK_SECRET_KEY` — Paystack API key
- `OPENROUTER_API_KEY` — OpenRouter API key
- `TERMII_API_KEY` — Termii SMS API key
- `NIBSS_BASE_URL` — Bank partner NIP gateway base URL
- `NIBSS_CLIENT_ID` — Bank partner OAuth2 client ID
- `NIBSS_CLIENT_SECRET` — Bank partner OAuth2 client secret (also used for webhook HMAC verification)
- `NIBSS_SOURCE_BANK_CODE` — CBN bank code of the sending institution
- `NIBSS_SOURCE_ACCOUNT_NUMBER` — Source clearing account number
- `EVENT_BUS_URL` — (optional) WebWaka Event Bus URL for cross-repo events
- `EVENT_BUS_SECRET` — (optional) Event Bus shared secret header

## Deployment
Configured for Cloudflare Workers:
- Staging: `npm run deploy:staging`
- Production: `npm run deploy:production`
- Environments defined in `wrangler.toml`

## Package Manager
npm
