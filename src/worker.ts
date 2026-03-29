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
import type { Bindings } from './core/types';
import { bankingRouter } from './modules/banking/index';
import { insuranceRouter } from './modules/insurance/index';
import { investmentRouter } from './modules/investment/index';

const app = new Hono<{ Bindings: Bindings }>();

// ─── Global Middleware ────────────────────────────────────────────────────────

// Invariant: No wildcard CORS — environment-aware allowlist only
app.use('*', async (c, next) => {
  const corsMiddleware = secureCORS(c.env.ENVIRONMENT);
  return corsMiddleware(c, next);
});

// Rate limiting on all auth and mutation endpoints
app.use('/api/auth/*', async (c, next) => {
  const limiter = rateLimit(c.env.RATE_LIMIT_KV, { maxRequests: 10, windowSeconds: 60 });
  return limiter(c, next);
});

// JWT authentication on all /api/* routes
// tenantId is ALWAYS extracted from JWT payload — NEVER from headers or body
app.use('/api/*', async (c, next) => {
  const authMiddleware = jwtAuthMiddleware(c.env.JWT_SECRET, c.env.SESSIONS_KV);
  return authMiddleware(c, next);
});

// ─── Health Check (unauthenticated) ──────────────────────────────────────────
app.get('/health', (c) => c.json({ status: 'ok', service: 'webwaka-fintech', version: '0.1.0' }));

// ─── Module Routes ────────────────────────────────────────────────────────────
app.route('/api/banking', bankingRouter);
app.route('/api/insurance', insuranceRouter);
app.route('/api/investment', investmentRouter);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
