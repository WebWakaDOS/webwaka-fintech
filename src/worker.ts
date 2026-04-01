/**
 * WebWaka Fintech Suite — Worker Entry Point
 *
 * Platform: Cloudflare Workers + Hono
 * Invariants enforced:
 *   1. Build Once Use Infinitely — all auth from @webwaka/core
 *   2. Mobile First — Hono lightweight API
 *   3. PWA First — Cloudflare Workers + Pages
 *   4. Offline First — Dexie offline store in client
 *   5. Nigeria First — Paystack kobo, en-NG locale
 *   6. Africa First — 7-locale i18n
 *   7. Vendor Neutral AI — OpenRouter abstraction only
 */

import { Hono } from 'hono';
import { jwtAuthMiddleware, secureCORS, rateLimit } from '@webwaka/core';
import type { Bindings, AppVariables } from './core/types';
import { bankingRouter } from './modules/banking/index';
import { insuranceRouter } from './modules/insurance/index';
import { investmentRouter } from './modules/investment/index';

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Global Middleware ────────────────────────────────────────────────────────

// Invariant: No wildcard CORS — environment-aware allowlist only
// secureCORS() v1.3.0: takes SecureCORSOptions (no positional env string)
app.use('*', secureCORS());

// Rate limiting on all auth and mutation endpoints
// rateLimit() v1.3.0: takes RateLimitOptions (KV resolved from c.env.RATE_LIMIT_KV internally)
app.use('/api/auth/*', rateLimit({ limit: 10, windowSeconds: 60, keyPrefix: 'fintech-auth' }));

// JWT authentication on all /api/* routes
// jwtAuthMiddleware() v1.3.0: takes JwtAuthOptions (JWT_SECRET resolved from c.env.JWT_SECRET internally)
// tenantId is ALWAYS extracted from JWT payload — NEVER from headers or body
app.use('/api/*', jwtAuthMiddleware());

// ─── Health Check (unauthenticated) ──────────────────────────────────────────
app.get('/health', (c) => c.json({ status: 'ok', service: 'webwaka-fintech', version: '0.1.0' }));

// ─── Module Routes ────────────────────────────────────────────────────────────
app.route('/api/banking', bankingRouter);
app.route('/api/insurance', insuranceRouter);
app.route('/api/investment', investmentRouter);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
