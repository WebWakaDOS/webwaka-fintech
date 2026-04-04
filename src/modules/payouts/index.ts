/**
 * NIBSS NIP Payout Module — WebWaka Fintech Suite
 *
 * Endpoints:
 *   POST /api/payouts/initiate          — Initiate a new NIP payout (admin only)
 *   GET  /api/payouts                   — List payout requests for the tenant
 *   GET  /api/payouts/:id               — Get a single payout request
 *   POST /api/payouts/webhook           — Bank partner webhook (unauthenticated, HMAC-verified)
 *   GET  /api/payouts/:id/status        — Manual status refresh from NIBSS
 *
 * Invariant 1: payout.completed event published to Event Bus after confirmation.
 * Invariant 2: Single source of truth — all platform disbursements go through this module.
 * Invariant 5: Nigeria First — all amounts in kobo.
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, InitiatePayoutBody, NibssWebhookPayload } from '../../core/types';
import {
  fetchNibssToken,
  nameEnquiry,
  initiateTransfer,
  queryTransferStatus,
  generateNibssReference,
  validateNuban,
  validateBankCode,
  NibssError,
  type NibssCredentials,
  type NibssAuthToken,
} from '../../core/nibss';
import { publishEvent } from '../../core/events';

export const payoutsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

/**
 * Webhook router — mounted at /webhooks/nibss-nip (outside /api/* JWT guard).
 * The bank partner calls this endpoint directly; auth is via HMAC-SHA256 signature.
 */
export const payoutsWebhookRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Token Cache (per Worker instance, reset on cold-start) ──────────────────
// Cloudflare Workers are single-threaded; no mutex needed.
let cachedToken: NibssAuthToken | null = null;

async function getToken(creds: NibssCredentials): Promise<NibssAuthToken> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken;
  }
  cachedToken = await fetchNibssToken(creds);
  return cachedToken;
}

/** Reset the NIBSS token cache. Exported for use in tests only. */
export function __resetNibssTokenCache(): void {
  cachedToken = null;
}

function credsFromEnv(env: Bindings): NibssCredentials {
  return {
    baseUrl: env.NIBSS_BASE_URL,
    clientId: env.NIBSS_CLIENT_ID,
    clientSecret: env.NIBSS_CLIENT_SECRET,
    sourceBankCode: env.NIBSS_SOURCE_BANK_CODE,
    sourceAccountNumber: env.NIBSS_SOURCE_ACCOUNT_NUMBER,
  };
}

// ─── POST /api/payouts/initiate ───────────────────────────────────────────────
payoutsRouter.post('/initiate', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  let body: InitiatePayoutBody;
  try {
    body = await c.req.json<InitiatePayoutBody>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // Validate required fields
  const { initiatorId, payoutType, amountKobo, destinationAccountNumber, destinationBankCode, narration, sourceAccountId } = body;
  if (!initiatorId || !payoutType || !amountKobo || !destinationAccountNumber || !destinationBankCode || !narration) {
    return c.json({ error: 'Missing required fields: initiatorId, payoutType, amountKobo, destinationAccountNumber, destinationBankCode, narration' }, 400);
  }

  // Validate kobo amount
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
    return c.json({ error: 'amountKobo must be a positive integer (kobo)' }, 400);
  }

  // Validate NUBAN and bank code
  if (!validateNuban(destinationAccountNumber)) {
    return c.json({ error: 'destinationAccountNumber must be a 10-digit NUBAN' }, 400);
  }
  if (!validateBankCode(destinationBankCode)) {
    return c.json({ error: 'destinationBankCode must be a 3–6 digit CBN bank code' }, 400);
  }

  // QA-FIN-1: Pre-flight balance check and deduction when a source account is supplied
  if (sourceAccountId) {
    const srcAccount = await c.env.DB.prepare(
      'SELECT balanceKobo FROM bankAccounts WHERE id = ? AND tenantId = ? AND status = ?'
    ).bind(sourceAccountId, tenantId, 'active').first() as Record<string, number> | null;

    if (!srcAccount) {
      return c.json({ error: 'Source account not found or not active' }, 404);
    }
    if (srcAccount.balanceKobo < amountKobo) {
      return c.json({ error: 'Insufficient balance in source account' }, 422);
    }
  }

  const creds = credsFromEnv(c.env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const nibssReference = generateNibssReference(tenantId);

  // Deduct balance before calling NIBSS — reversal happens on any failure path
  let balanceDeducted = false;
  if (sourceAccountId) {
    await c.env.DB.prepare(
      'UPDATE bankAccounts SET balanceKobo = balanceKobo - ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
    ).bind(amountKobo, now, sourceAccountId, tenantId).run();
    balanceDeducted = true;
  }

  try {
    // Step 1: Authenticate with NIBSS bank partner
    const token = await getToken(creds);

    // Step 2: Name Enquiry — verify account before transfer
    const enquiry = await nameEnquiry(creds, token, { destinationBankCode, destinationAccountNumber });

    // Step 3: Record payout request as 'processing'
    await c.env.DB.prepare(
      `INSERT INTO payoutRequests
         (id, tenantId, initiatorId, payoutType, amountKobo, destinationAccountNumber,
          destinationBankCode, destinationAccountName, narration, nibssReference, sourceAccountId, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?)`
    )
      .bind(
        id, tenantId, initiatorId, payoutType, amountKobo,
        destinationAccountNumber, destinationBankCode, enquiry.destinationAccountName,
        narration.slice(0, 100), nibssReference, sourceAccountId ?? null, now, now
      )
      .run();

    // Step 4: Initiate NIBSS NIP transfer
    const transfer = await initiateTransfer(creds, token, {
      paymentReference: nibssReference,
      amountKobo,
      destinationBankCode,
      destinationAccountNumber,
      destinationAccountName: enquiry.destinationAccountName,
      narration: narration.slice(0, 100),
      nameEnquirySessionId: enquiry.sessionId,
    });

    if (transfer.status === 'rejected') {
      // Mark as failed immediately on synchronous rejection
      await c.env.DB.prepare(
        `UPDATE payoutRequests SET status = 'failed', failureReason = ?, updatedAt = ? WHERE id = ? AND tenantId = ?`
      )
        .bind(`NIBSS rejected: ${transfer.responseMessage} (${transfer.responseCode})`, now, id, tenantId)
        .run();

      // Reverse balance deduction — NIBSS did not accept the transfer
      if (balanceDeducted && sourceAccountId) {
        await c.env.DB.prepare(
          'UPDATE bankAccounts SET balanceKobo = balanceKobo + ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
        ).bind(amountKobo, now, sourceAccountId, tenantId).run();
      }

      // Publish payout.failed event
      await publishEvent(c.env.EVENT_BUS_URL, c.env.EVENT_BUS_SECRET, {
        event: 'payout.failed',
        payoutRequestId: id,
        tenantId,
        initiatorId,
        payoutType,
        amountKobo,
        nibssReference,
        failureReason: `NIBSS rejected: ${transfer.responseMessage}`,
        failedAt: now,
      });

      return c.json({
        success: false,
        id,
        nibssReference,
        status: 'failed',
        reason: transfer.responseMessage,
      }, 422);
    }

    // Transfer accepted — update with NIBSS session ID, await webhook for final settlement
    await c.env.DB.prepare(
      `UPDATE payoutRequests SET nibssSessionId = ?, updatedAt = ? WHERE id = ? AND tenantId = ?`
    )
      .bind(transfer.sessionId, now, id, tenantId)
      .run();

    return c.json({
      success: true,
      id,
      nibssReference,
      nibssSessionId: transfer.sessionId,
      status: 'processing',
      destinationAccountName: enquiry.destinationAccountName,
      message: 'Transfer submitted to NIBSS NIP. Awaiting settlement confirmation.',
    }, 202);

  } catch (err) {
    const reason = err instanceof NibssError ? err.message : 'Internal error during payout initiation';

    // If row was created, mark as failed
    await c.env.DB.prepare(
      `UPDATE payoutRequests SET status = 'failed', failureReason = ?, updatedAt = ? WHERE id = ? AND tenantId = ?`
    )
      .bind(reason, now, id, tenantId)
      .run();

    // Reverse balance deduction — upstream provider unavailable (Offline Resilience)
    if (balanceDeducted && sourceAccountId) {
      await c.env.DB.prepare(
        'UPDATE bankAccounts SET balanceKobo = balanceKobo + ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
      ).bind(amountKobo, now, sourceAccountId, tenantId).run();
    }

    console.error('[Payouts] Initiation error:', err);
    return c.json({ error: reason }, 500);
  }
});

// ─── GET /api/payouts ─────────────────────────────────────────────────────────
payoutsRouter.get('/', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const status = c.req.query('status');
  const payoutType = c.req.query('payoutType');

  let query = 'SELECT * FROM payoutRequests WHERE tenantId = ?';
  const params: (string | number)[] = [tenantId];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (payoutType) {
    query += ' AND payoutType = ?';
    params.push(payoutType);
  }

  query += ' ORDER BY createdAt DESC LIMIT 100';

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

// ─── GET /api/payouts/:id ─────────────────────────────────────────────────────
payoutsRouter.get('/:id', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    'SELECT * FROM payoutRequests WHERE id = ? AND tenantId = ?'
  )
    .bind(id, tenantId)
    .first();

  if (!row) return c.json({ error: 'Payout request not found' }, 404);
  return c.json({ data: row });
});

// ─── GET /api/payouts/:id/status — Manual NIBSS status refresh ────────────────
payoutsRouter.get('/:id/status', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    'SELECT * FROM payoutRequests WHERE id = ? AND tenantId = ?'
  )
    .bind(id, tenantId)
    .first() as Record<string, unknown> | null;

  if (!row) return c.json({ error: 'Payout request not found' }, 404);

  // Only query NIBSS if still in flight
  if (row.status !== 'processing') {
    return c.json({ data: row, fromCache: true });
  }

  try {
    const creds = credsFromEnv(c.env);
    const token = await getToken(creds);
    const nibssStatus = await queryTransferStatus(creds, token, row.nibssReference as string);
    const now = new Date().toISOString();

    if (nibssStatus.status === 'successful') {
      await applyConfirmation(c.env, {
        id,
        tenantId,
        row,
        nibssSessionId: nibssStatus.sessionId,
        settledAt: nibssStatus.settledAt ?? now,
        now,
      });
    } else if (nibssStatus.status === 'failed' || nibssStatus.status === 'reversed') {
      await applyFailure(c.env, {
        id,
        tenantId,
        row,
        reason: `${nibssStatus.responseMessage} (${nibssStatus.responseCode})`,
        status: nibssStatus.status,
        now,
      });
    }

    const updated = await c.env.DB.prepare(
      'SELECT * FROM payoutRequests WHERE id = ? AND tenantId = ?'
    )
      .bind(id, tenantId)
      .first();

    return c.json({ data: updated, fromCache: false });
  } catch (err) {
    console.error('[Payouts] Status query error:', err);
    return c.json({ data: row, fromCache: true, warning: 'NIBSS status query failed' });
  }
});

// ─── POST /webhooks/nibss-nip — Bank partner settlement callback ──────────────
// Mounted on payoutsWebhookRouter at /webhooks/nibss-nip in worker.ts.
// No JWT auth — bank partner calls this directly.
// Authentication is via HMAC-SHA256 signature on the X-Webhook-Signature header.
payoutsWebhookRouter.post('/', async (c) => {
  // Validate webhook signature
  const signature = c.req.header('X-Webhook-Signature');
  const rawBody = await c.req.text();

  // When NIBSS_CLIENT_SECRET is configured, signature verification is MANDATORY.
  // Requests that omit the header are rejected — not silently passed through.
  if (c.env.NIBSS_CLIENT_SECRET) {
    if (!signature) {
      console.warn('[Payouts] Webhook: missing X-Webhook-Signature header');
      return c.json({ error: 'Missing signature' }, 401);
    }
    const isValid = await verifyWebhookSignature(rawBody, signature, c.env.NIBSS_CLIENT_SECRET);
    if (!isValid) {
      console.warn('[Payouts] Webhook: invalid signature');
      return c.json({ error: 'Invalid signature' }, 401);
    }
  }

  let payload: NibssWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as NibssWebhookPayload;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const { paymentReference, sessionId, status, responseMessage, responseCode, settledAt } = payload;

  // Look up the payout request by nibssReference (tenantId-agnostic — the bank doesn't know our tenants)
  const row = await c.env.DB.prepare(
    'SELECT * FROM payoutRequests WHERE nibssReference = ?'
  )
    .bind(paymentReference)
    .first() as Record<string, unknown> | null;

  if (!row) {
    // Unknown reference — acknowledge to prevent retries
    console.warn(`[Payouts] Webhook: unknown reference ${paymentReference}`);
    return c.json({ received: true });
  }

  if (row.status !== 'processing') {
    // Already settled — idempotent acknowledgement
    return c.json({ received: true, idempotent: true });
  }

  const tenantId = row.tenantId as string;
  const id = row.id as string;
  const now = new Date().toISOString();

  if (status === 'successful') {
    await applyConfirmation(c.env, { id, tenantId, row, nibssSessionId: sessionId, settledAt: settledAt ?? now, now });
  } else {
    await applyFailure(c.env, {
      id,
      tenantId,
      row,
      reason: `${responseMessage} (${responseCode})`,
      status: status === 'reversed' ? 'reversed' : 'failed',
      now,
    });
  }

  return c.json({ received: true });
});

// ─── Shared settlement helpers ────────────────────────────────────────────────

async function applyConfirmation(
  env: Bindings,
  opts: {
    id: string;
    tenantId: string;
    row: Record<string, unknown>;
    nibssSessionId: string;
    settledAt: string;
    now: string;
  }
): Promise<void> {
  const { id, tenantId, row, nibssSessionId, settledAt, now } = opts;

  await env.DB.prepare(
    `UPDATE payoutRequests SET status = 'confirmed', nibssSessionId = ?, settledAt = ?, updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  )
    .bind(nibssSessionId, settledAt, now, id, tenantId)
    .run();

  // Invariant 1: Emit payout.completed event to the Event Bus
  await publishEvent(env.EVENT_BUS_URL, env.EVENT_BUS_SECRET, {
    event: 'payout.completed',
    payoutRequestId: id,
    tenantId,
    initiatorId: row.initiatorId as string,
    payoutType: row.payoutType as string,
    amountKobo: row.amountKobo as number,
    destinationAccountNumber: row.destinationAccountNumber as string,
    destinationBankCode: row.destinationBankCode as string,
    destinationAccountName: row.destinationAccountName as string,
    nibssReference: row.nibssReference as string,
    nibssSessionId,
    settledAt,
  });
}

async function applyFailure(
  env: Bindings,
  opts: {
    id: string;
    tenantId: string;
    row: Record<string, unknown>;
    reason: string;
    status: 'failed' | 'reversed';
    now: string;
  }
): Promise<void> {
  const { id, tenantId, row, reason, status, now } = opts;

  await env.DB.prepare(
    `UPDATE payoutRequests SET status = ?, failureReason = ?, settledAt = ?, updatedAt = ?
     WHERE id = ? AND tenantId = ?`
  )
    .bind(status, reason, now, now, id, tenantId)
    .run();

  // Offline Resilience: reverse the internal wallet deduction when NIBSS reports failure
  if (row.sourceAccountId) {
    await env.DB.prepare(
      'UPDATE bankAccounts SET balanceKobo = balanceKobo + ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
    ).bind(row.amountKobo as number, now, row.sourceAccountId as string, tenantId).run();
  }

  await publishEvent(env.EVENT_BUS_URL, env.EVENT_BUS_SECRET, {
    event: 'payout.failed',
    payoutRequestId: id,
    tenantId,
    initiatorId: row.initiatorId as string,
    payoutType: row.payoutType as string,
    amountKobo: row.amountKobo as number,
    nibssReference: row.nibssReference as string,
    failureReason: reason,
    failedAt: now,
  });
}

/**
 * Verify HMAC-SHA256 webhook signature.
 * The bank partner signs the raw JSON body with the shared NIBSS_CLIENT_SECRET.
 */
async function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const sigBytes = hexToBytes(signature);
    return crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(body));
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
