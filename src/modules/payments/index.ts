/**
 * Paystack Payments Module — FT-004
 *
 * Endpoints:
 *   POST   /api/payments/initiate             — Initialize a Paystack payment
 *   GET    /api/payments/verify/:reference    — Verify a Paystack payment status
 *   POST   /api/payments/refund               — Initiate a Paystack refund
 *   GET    /api/payments/refunds              — List refunds for this tenant
 *
 * Webhook (no JWT, HMAC-verified):
 *   POST   /webhooks/paystack                 — Receive Paystack events
 *
 * Invariant 5 (Nigeria First): all amounts in kobo (NGN × 100).
 * Invariant 1 (Event-Driven): paystack.payment_success / paystack.refund_initiated
 *                              emitted to Event Bus on state changes.
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';
import {
  initializePayment,
  verifyPayment,
  refundPayment,
  verifyPaystackWebhook,
  generatePaymentReference,
} from '../../core/paystack';
import { publishEvent } from '../../core/events';

export const paymentsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

/**
 * Webhook router — mounted at /webhooks/paystack (outside /api/* JWT guard).
 * Paystack calls this endpoint; auth is via HMAC-SHA512 signature in
 * x-paystack-signature header.
 */
export const paystackWebhookRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── POST /api/payments/initiate ─────────────────────────────────────────────

paymentsRouter.post('/initiate', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  if (!c.env.PAYSTACK_SECRET_KEY) {
    return c.json({ error: 'Paystack is not configured for this environment' }, 503);
  }

  const body = await c.req.json<{
    emailAddress: string;
    amountKobo: number;
    callbackUrl?: string;
    metadata?: Record<string, unknown>;
    channels?: ('card' | 'bank' | 'ussd' | 'qr' | 'mobile_money' | 'bank_transfer')[];
  }>();

  if (!body.emailAddress || !body.amountKobo) {
    return c.json({ error: 'emailAddress and amountKobo are required' }, 400);
  }
  if (!Number.isInteger(body.amountKobo) || body.amountKobo <= 0) {
    return c.json({ error: 'amountKobo must be a positive integer' }, 400);
  }

  const reference = generatePaymentReference(tenantId);

  const result = await initializePayment(c.env.PAYSTACK_SECRET_KEY, {
    emailAddress: body.emailAddress,
    amountKobo: body.amountKobo,
    reference,
    callbackUrl: body.callbackUrl ?? `${c.req.header('origin') ?? 'https://app.webwaka.com'}/payment/callback`,
    metadata: { tenantId, initiatorId: user.userId, ...body.metadata },
    channels: body.channels,
  });

  return c.json({ data: result.data, reference }, 201);
});

// ─── GET /api/payments/verify/:reference ─────────────────────────────────────

paymentsRouter.get('/verify/:reference', requireRole(['admin', 'teller', 'customer']), async (c) => {
  if (!c.env.PAYSTACK_SECRET_KEY) {
    return c.json({ error: 'Paystack is not configured for this environment' }, 503);
  }

  const reference = c.req.param('reference');
  const result = await verifyPayment(c.env.PAYSTACK_SECRET_KEY, reference);
  return c.json({ data: result.data });
});

// ─── POST /api/payments/refund ────────────────────────────────────────────────

paymentsRouter.post('/refund', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  if (!c.env.PAYSTACK_SECRET_KEY) {
    return c.json({ error: 'Paystack is not configured for this environment' }, 503);
  }

  const body = await c.req.json<{
    reference: string;
    amountKobo?: number;
    merchantNote?: string;
  }>();

  if (!body.reference) {
    return c.json({ error: 'reference is required' }, 400);
  }
  if (body.amountKobo !== undefined && (!Number.isInteger(body.amountKobo) || body.amountKobo <= 0)) {
    return c.json({ error: 'amountKobo must be a positive integer when provided' }, 400);
  }

  const now = new Date().toISOString();

  const result = await refundPayment(
    c.env.PAYSTACK_SECRET_KEY,
    body.reference,
    body.amountKobo,
    body.merchantNote,
  );

  const refundId = crypto.randomUUID();
  const refundRecord = result.data.refund;
  const amountKobo = refundRecord.amount;

  // Store refund record for audit trail
  await c.env.DB.prepare(
    `INSERT INTO paystackRefunds
       (id, tenantId, paystackRefundId, originalReference, amountKobo, currency, status, merchantNote, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      refundId,
      tenantId,
      refundRecord.id,
      body.reference,
      amountKobo,
      refundRecord.currency,
      refundRecord.status,
      body.merchantNote ?? null,
      now,
      now,
    )
    .run();

  // FT-005: Emit paystack.refund_initiated event
  await publishEvent(c.env.EVENT_BUS_URL, c.env.EVENT_BUS_SECRET, {
    event: 'paystack.refund_initiated',
    refundId,
    tenantId,
    originalReference: body.reference,
    amountKobo,
    occurredAt: now,
  });

  return c.json({ success: true, refundId, data: result.data }, 201);
});

// ─── GET /api/payments/refunds ────────────────────────────────────────────────

paymentsRouter.get('/refunds', requireRole(['admin', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM paystackRefunds WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 100'
  )
    .bind(tenantId)
    .all();

  return c.json({ data: results });
});

// ─── POST /webhooks/paystack — Paystack event receiver ────────────────────────

paystackWebhookRouter.post('/', async (c) => {
  const signature = c.req.header('x-paystack-signature') ?? '';
  const rawBody = await c.req.text();

  // Reject requests with missing signature when webhook secret is configured
  if (c.env.PAYSTACK_WEBHOOK_SECRET) {
    if (!signature) {
      console.warn('[Paystack Webhook] Missing x-paystack-signature header');
      return c.json({ error: 'Missing signature' }, 401);
    }
    const isValid = await verifyPaystackWebhook(rawBody, signature, c.env.PAYSTACK_WEBHOOK_SECRET);
    if (!isValid) {
      console.warn('[Paystack Webhook] Invalid signature');
      return c.json({ error: 'Invalid signature' }, 401);
    }
  }

  let payload: { event: string; data: Record<string, unknown> };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const now = new Date().toISOString();
  const { event, data } = payload;

  // Idempotency: skip if we've already processed this event
  const paystackEventId = (data.id as string | undefined) ?? `${event}-${Date.now()}`;
  const existingEvent = await c.env.DB.prepare(
    'SELECT id FROM paystackEvents WHERE paystackEventId = ?'
  )
    .bind(paystackEventId)
    .first();

  if (existingEvent) {
    console.log(`[Paystack Webhook] Already processed event ${paystackEventId}`);
    return c.json({ received: true, idempotent: true });
  }

  // Record the webhook event
  await c.env.DB.prepare(
    `INSERT INTO paystackEvents (id, paystackEventId, event, data, processedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), paystackEventId, event, JSON.stringify(data), now, now)
    .run();

  // Handle specific event types
  if (event === 'charge.success') {
    const reference = data.reference as string;
    const amountKobo = data.amount as number;
    const currency = data.currency as string;
    const email = (data.customer as Record<string, string> | undefined)?.email;

    await publishEvent(c.env.EVENT_BUS_URL, c.env.EVENT_BUS_SECRET, {
      event: 'paystack.payment_success',
      reference,
      amountKobo,
      currency,
      email,
      occurredAt: now,
    });
  }

  if (event === 'refund.processed') {
    // Update our stored refund record if it exists
    const reference = data.transaction_reference as string | undefined;
    if (reference) {
      await c.env.DB.prepare(
        `UPDATE paystackRefunds SET status = 'processed', updatedAt = ? WHERE originalReference = ?`
      )
        .bind(now, reference)
        .run();
    }
  }

  return c.json({ received: true });
});
