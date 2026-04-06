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

// ─── Core Modules ─────────────────────────────────────────────────────────────
import { bankingRouter } from './modules/banking/index';
import { insuranceRouter } from './modules/insurance/index';
import { investmentRouter } from './modules/investment/index';
import { payoutsRouter, payoutsWebhookRouter } from './modules/payouts/index';

// ─── Enhancement Modules ──────────────────────────────────────────────────────
import { kycRouter } from './modules/kyc/index';
import { lendingRouter } from './modules/lending/index';
import { cardsRouter } from './modules/cards/index';
import { complianceRouter } from './modules/compliance/index';
import { savingsRouter } from './modules/savings/index';
import { billsRouter } from './modules/bills/index';
import { fraudRouter } from './modules/fraud/index';
import { walletsRouter } from './modules/wallets/index';
import { cryptoRouter } from './modules/crypto/index';
import { agentRouter } from './modules/agent/index';
import { standingOrdersRouter } from './modules/standing-orders/index';
import { splitPaymentsRouter } from './modules/split-payments/index';
import { interestRouter } from './modules/interest/index';
import { openBankingRouter } from './modules/open-banking/index';
import { ussdRouter, ussdWebhookRouter } from './modules/ussd/index';
import { overdraftRouter } from './modules/overdraft/index';
import { paymentsRouter, paystackWebhookRouter } from './modules/payments/index';

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Global Middleware ────────────────────────────────────────────────────────

app.use('*', secureCORS());
app.use('/api/auth/*', rateLimit({ limit: 10, windowSeconds: 60, keyPrefix: 'fintech-auth' }));
app.use('/api/*', jwtAuthMiddleware());

// ─── Health Check (unauthenticated) ──────────────────────────────────────────
app.get('/health', (c) => c.json({
  status: 'ok',
  service: 'webwaka-fintech',
  version: '0.2.0',
  features: [
    'banking', 'insurance', 'investment', 'payouts',
    'kyc', 'lending', 'cards', 'compliance', 'savings',
    'bills', 'fraud', 'wallets', 'crypto', 'agent',
    'standing-orders', 'split-payments', 'interest',
    'open-banking', 'ussd', 'overdraft',
    'payments', 'kyc-verify', 'loan-schedules', 'mono-open-banking',
  ],
}));

// ─── Unauthenticated Webhooks ─────────────────────────────────────────────────
// Must be registered BEFORE the /api/* JWT middleware scope.

// NIBSS NIP settlement webhook (HMAC-verified)
app.route('/webhooks/nibss-nip', payoutsWebhookRouter);

// USSD gateway callback (verified by USSD gateway IP allowlist in production)
app.route('/webhooks/ussd', ussdWebhookRouter);

// Paystack payment events (HMAC-SHA512 verified)
app.route('/webhooks/paystack', paystackWebhookRouter);

// ─── Core Module Routes ────────────────────────────────────────────────────────
app.route('/api/banking', bankingRouter);
app.route('/api/insurance', insuranceRouter);
app.route('/api/investment', investmentRouter);
app.route('/api/payouts', payoutsRouter);

// ─── Enhancement Module Routes (Phase 1: Core Banking & Compliance) ───────────
app.route('/api/kyc', kycRouter);                        // #16 KYC Tier Enforcement
app.route('/api/compliance', complianceRouter);          // #4  CBN Reports + #13 Reconciliation

// ─── Enhancement Module Routes (Phase 2: Lending & Credit) ───────────────────
app.route('/api/lending', lendingRouter);                // #2  AI Credit Scoring + #18 Loans + #19 Debt Collection

// ─── Enhancement Module Routes (Phase 3: Consumer Features) ──────────────────
app.route('/api/cards', cardsRouter);                    // #3  Virtual Card Issuance
app.route('/api/savings', savingsRouter);                // #5  Savings Goals (Ajo/Esusu)
app.route('/api/overdraft', overdraftRouter);            // #6  Overdraft Protection
app.route('/api/bills', billsRouter);                    // #7  Bill Payments (VTPass)
app.route('/api/ussd', ussdRouter);                      // #8  USSD Banking (admin session view)
app.route('/api/fraud', fraudRouter);                    // #9  Fraud Detection Rules Engine
app.route('/api/wallets', walletsRouter);                // #10 Multi-Currency Wallets
app.route('/api/crypto', cryptoRouter);                  // #11 Crypto On/Off Ramps
app.route('/api/agent', agentRouter);                    // #12 Agent Banking (POS)
app.route('/api/standing-orders', standingOrdersRouter); // #14 Standing Orders (Direct Debits)
app.route('/api/split-payments', splitPaymentsRouter);   // #15 Split Payments
app.route('/api/interest', interestRouter);              // #17 Interest-Bearing Accounts
app.route('/api/open-banking', openBankingRouter);       // #20 Open Banking API
app.route('/api/payments', paymentsRouter);              // FT-004 Paystack Payments + Refunds

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
