/**
 * Overdraft Protection Module (#6)
 *
 * Provides micro-overdraft coverage for fint_transactions that would otherwise fail
 * due to insufficient funds. The overdraft amount is tracked and must be repaid
 * within a configurable window (default 7 days).
 *
 * Endpoints:
 *   GET    /api/overdraft                        — List overdraft events (admin: all; customer: own)
 *   GET    /api/overdraft/:id                    — Get single overdraft event
 *   POST   /api/overdraft/cover                  — Request overdraft coverage for a transaction
 *   POST   /api/overdraft/:id/repay              — Repay an overdraft
 *   GET    /api/overdraft/summary/:customerId     — Customer overdraft summary
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const overdraftRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

const MAX_OVERDRAFT_KOBO = 5_000_000;      // ₦50,000 max overdraft
const REPAYMENT_DAYS = 7;
const OVERDRAFT_FEE_BPS = 200;             // 2% flat fee on overdraft amount

overdraftRouter.post('/cover', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    customerId: string;
    accountId: string;
    requiredAmountKobo: number;
    transactionReference: string;
    description?: string;
  }>();

  if (!body.customerId || !body.accountId || !body.requiredAmountKobo || !body.transactionReference) {
    return c.json({ error: 'Missing required fields' }, 400);
  }
  if (user.role === 'customer' && user.userId !== body.customerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const account = await c.env.DB.prepare(
    'SELECT balanceKobo FROM fint_bankAccounts WHERE id = ? AND tenantId = ? AND customerId = ? AND status = ?'
  )
    .bind(body.accountId, tenantId, body.customerId, 'active')
    .first() as Record<string, number> | null;

  if (!account) return c.json({ error: 'Account not found or not active' }, 404);

  const shortfallKobo = body.requiredAmountKobo - account.balanceKobo;
  if (shortfallKobo <= 0) {
    return c.json({ eligible: false, reason: 'Account has sufficient balance — no overdraft needed', balanceKobo: account.balanceKobo });
  }
  if (shortfallKobo > MAX_OVERDRAFT_KOBO) {
    return c.json({ eligible: false, reason: `Overdraft required (₦${(shortfallKobo / 100).toLocaleString()}) exceeds maximum limit (₦${(MAX_OVERDRAFT_KOBO / 100).toLocaleString()})` }, 422);
  }

  const existingOverdraft = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM fint_overdraftEvents WHERE tenantId = ? AND accountId = ? AND status = 'active'`
  ).bind(tenantId, body.accountId).first() as Record<string, number> | null;

  if ((existingOverdraft?.count ?? 0) > 0) {
    return c.json({ eligible: false, reason: 'Account already has an active overdraft. Repay existing overdraft first.' }, 422);
  }

  const feesKobo = Math.round((shortfallKobo * OVERDRAFT_FEE_BPS) / 10000);
  const totalOwed = shortfallKobo + feesKobo;
  const repaymentDueAt = new Date(Date.now() + REPAYMENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO fint_overdraftEvents (id, tenantId, accountId, customerId, originalTransactionRef, overdraftAmountKobo, repaymentDueAt, status, feesKobo, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).bind(id, tenantId, body.accountId, body.customerId, body.transactionReference, shortfallKobo, repaymentDueAt, feesKobo, now, now),
    c.env.DB.prepare(
      'UPDATE fint_bankAccounts SET balanceKobo = balanceKobo + ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
    ).bind(shortfallKobo, now, body.accountId, tenantId),
  ]);

  return c.json({
    success: true,
    id,
    overdraftAmountKobo: shortfallKobo,
    feesKobo,
    totalOwedKobo: totalOwed,
    repaymentDueAt,
    message: `₦${(shortfallKobo / 100).toLocaleString()} overdraft granted. Repay by ${repaymentDueAt.slice(0, 10)} to avoid default.`,
  }, 201);
});

overdraftRouter.post('/:id/repay', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ accountId: string }>();

  const event = await c.env.DB.prepare(
    `SELECT * FROM fint_overdraftEvents WHERE id = ? AND tenantId = ? AND status = 'active'`
  ).bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!event) return c.json({ error: 'Active overdraft not found' }, 404);
  if (user.role === 'customer' && event.customerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);

  const totalOwed = Number(event.overdraftAmountKobo) + Number(event.feesKobo);
  const account = await c.env.DB.prepare('SELECT balanceKobo FROM fint_bankAccounts WHERE id = ? AND tenantId = ?')
    .bind(body.accountId, tenantId).first() as Record<string, number> | null;

  if (!account) return c.json({ error: 'Repayment account not found' }, 404);
  if (account.balanceKobo < totalOwed) return c.json({ error: `Insufficient balance. Required: ₦${(totalOwed / 100).toLocaleString()}` }, 422);

  const reference = `OD-REPAY-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE fint_overdraftEvents SET status = 'repaid', repaidAt = ?, updatedAt = ? WHERE id = ? AND tenantId = ?`
    ).bind(now, now, id, tenantId),
    c.env.DB.prepare(
      'UPDATE fint_bankAccounts SET balanceKobo = balanceKobo - ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
    ).bind(totalOwed, now, body.accountId, tenantId),
    c.env.DB.prepare(
      `INSERT INTO fint_transactions (id, tenantId, accountId, type, amountKobo, reference, status, description, createdAt)
       VALUES (?, ?, ?, 'fee', ?, ?, 'success', ?, ?)`
    ).bind(crypto.randomUUID(), tenantId, body.accountId, totalOwed, reference, 'Overdraft repayment', now),
  ]);

  return c.json({ success: true, reference, totalRepaidKobo: totalOwed });
});

overdraftRouter.get('/', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const query = user.role === 'customer'
    ? 'SELECT * FROM fint_overdraftEvents WHERE tenantId = ? AND customerId = ? ORDER BY createdAt DESC'
    : 'SELECT * FROM fint_overdraftEvents WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 200';
  const params = user.role === 'customer' ? [tenantId, user.userId] : [tenantId];

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

overdraftRouter.get('/:id', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM fint_overdraftEvents WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!row) return c.json({ error: 'Overdraft event not found' }, 404);
  if (user.role === 'customer' && row.customerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);
  return c.json({ data: row });
});

overdraftRouter.get('/summary/:customerId', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const customerId = c.req.param('customerId');

  if (user.role === 'customer' && user.userId !== customerId) return c.json({ error: 'Forbidden' }, 403);

  const { results } = await c.env.DB.prepare(
    `SELECT status, COUNT(*) as count, SUM(overdraftAmountKobo) as totalKobo, SUM(feesKobo) as totalFeesKobo
     FROM fint_overdraftEvents WHERE tenantId = ? AND customerId = ? GROUP BY status`
  ).bind(tenantId, customerId).all();

  const activeRow = (results as Record<string, unknown>[]).find((r) => r.status === 'active');

  return c.json({
    data: {
      customerId,
      activeOverdraftKobo: activeRow ? Number(activeRow.totalKobo) : 0,
      breakdown: results,
      maxEligibleKobo: MAX_OVERDRAFT_KOBO,
    },
  });
});
