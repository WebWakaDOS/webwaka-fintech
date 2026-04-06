/**
 * Banking Module — Core Accounts & Transactions
 *
 * Enhanced with:
 *   - KYC tier limit enforcement (#16)
 *   - Real-time fraud detection (#9)
 *   - Overdraft protection check (#6)
 *
 * Endpoints:
 *   GET    /api/banking/accounts             — List accounts
 *   POST   /api/banking/accounts             — Create account
 *   GET    /api/banking/accounts/:id         — Get account details
 *   PUT    /api/banking/accounts/:id/status  — Freeze/unfreeze/close account (admin)
 *   POST   /api/banking/fint_transactions         — Record deposit/withdrawal
 *   GET    /api/banking/fint_transactions         — List fint_transactions for account
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';
import { checkKycLimit } from '../kyc/index';
import { runFraudRules } from '../fraud/index';
import { publishEvent } from '../../core/events';

export const bankingRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

bankingRouter.get('/accounts', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const query = user.role === 'customer'
    ? 'SELECT * FROM fint_bankAccounts WHERE tenantId = ? AND customerId = ? ORDER BY createdAt DESC'
    : 'SELECT * FROM fint_bankAccounts WHERE tenantId = ? ORDER BY createdAt DESC';
  const params = user.role === 'customer' ? [tenantId, user.userId] : [tenantId];

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

bankingRouter.post('/accounts', requireRole(['admin', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json();

  if (!body.customerId || !body.accountType) {
    return c.json({ error: 'customerId and accountType are required' }, 400);
  }

  const validTypes = ['savings', 'current', 'corporate', 'fixed_deposit'];
  if (!validTypes.includes(body.accountType)) {
    return c.json({ error: `accountType must be one of: ${validTypes.join(', ')}` }, 400);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const accountNumber = Math.floor(1000000000 + Math.random() * 9000000000).toString();

  await c.env.DB.prepare(
    'INSERT INTO fint_bankAccounts (id, tenantId, accountNumber, customerId, accountType, balanceKobo, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, tenantId, accountNumber, body.customerId, body.accountType, 0, 'active', createdAt, createdAt)
    .run();

  return c.json({ success: true, id, accountNumber }, 201);
});

bankingRouter.get('/accounts/:id', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM fint_bankAccounts WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!row) return c.json({ error: 'Account not found' }, 404);
  if (user.role === 'customer' && row.customerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);
  return c.json({ data: row });
});

bankingRouter.put('/accounts/:id/status', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ status: 'active' | 'dormant' | 'frozen' | 'closed' }>();

  const validStatuses = ['active', 'dormant', 'frozen', 'closed'];
  if (!validStatuses.includes(body.status)) {
    return c.json({ error: `status must be one of: ${validStatuses.join(', ')}` }, 400);
  }

  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    'UPDATE fint_bankAccounts SET status = ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
  )
    .bind(body.status, now, id, tenantId)
    .run();

  if (!result.meta.changes) return c.json({ error: 'Account not found' }, 404);
  return c.json({ success: true, status: body.status });
});

bankingRouter.post('/fint_transactions', requireRole(['admin', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    accountId: string;
    type: 'deposit' | 'withdrawal' | 'transfer' | 'fee' | 'interest';
    amountKobo: number;
    description?: string;
    skipKycCheck?: boolean;
  }>();

  if (!body.accountId || !body.type || !body.amountKobo) {
    return c.json({ error: 'accountId, type, and amountKobo are required' }, 400);
  }
  if (!Number.isInteger(body.amountKobo) || body.amountKobo <= 0) {
    return c.json({ error: 'amountKobo must be a positive integer' }, 400);
  }

  const account = await c.env.DB.prepare(
    'SELECT * FROM fint_bankAccounts WHERE id = ? AND tenantId = ? AND status = ?'
  )
    .bind(body.accountId, tenantId, 'active')
    .first() as Record<string, unknown> | null;

  if (!account) return c.json({ error: 'Account not found or not active' }, 404);

  if (!body.skipKycCheck && ['withdrawal', 'transfer'].includes(body.type)) {
    const kycCheck = await checkKycLimit(c.env.DB, tenantId, account.customerId as string, body.amountKobo);
    if (!kycCheck.allowed) {
      return c.json({ error: kycCheck.reason }, 403);
    }
  }

  if (body.type === 'withdrawal' || body.type === 'transfer') {
    if ((account.balanceKobo as number) < body.amountKobo) {
      return c.json({ error: 'Insufficient balance' }, 422);
    }
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const reference = `TRX-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const fint_fraudAlerts = await runFraudRules(c.env.DB, tenantId, {
    accountId: body.accountId,
    customerId: account.customerId as string,
    amountKobo: body.amountKobo,
    type: body.type,
    reference,
  });

  await c.env.DB.prepare(
    'INSERT INTO fint_transactions (id, tenantId, accountId, type, amountKobo, reference, status, description, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, tenantId, body.accountId, body.type, body.amountKobo, reference, 'success', body.description ?? '', createdAt)
    .run();

  const balanceModifier = ['deposit', 'interest'].includes(body.type) ? body.amountKobo : -body.amountKobo;
  await c.env.DB.prepare(
    'UPDATE fint_bankAccounts SET balanceKobo = balanceKobo + ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
  )
    .bind(balanceModifier, createdAt, body.accountId, tenantId)
    .run();

  if (fint_fraudAlerts.length > 0) {
    for (const alert of fint_fraudAlerts) {
      await c.env.DB.prepare(
        `INSERT INTO fint_fraudAlerts (id, tenantId, customerId, accountId, transactionId, ruleTriggered, severity, status, details, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
      )
        .bind(crypto.randomUUID(), tenantId, account.customerId as string, body.accountId, id, alert.rule, alert.severity, JSON.stringify(alert.details), createdAt)
        .run();
    }
  }

  // ─── FT-005: Event emission for all banking fint_transactions ────────────────────
  const eventType = body.type === 'deposit' || body.type === 'interest'
    ? 'banking.deposit'
    : body.type === 'withdrawal'
      ? 'banking.withdrawal'
      : 'banking.transfer';

  await publishEvent(c.env.EVENT_BUS_URL, c.env.EVENT_BUS_SECRET, {
    event: eventType as 'banking.deposit' | 'banking.withdrawal' | 'banking.transfer',
    transactionId: id,
    tenantId,
    accountId: body.accountId,
    customerId: account.customerId as string,
    amountKobo: body.amountKobo,
    reference,
    description: body.description,
    occurredAt: createdAt,
  });

  return c.json({
    success: true,
    id,
    reference,
    fraudAlertsTriggered: fint_fraudAlerts.length,
    ...(fint_fraudAlerts.length > 0 ? { fint_fraudAlerts: fint_fraudAlerts.map((a) => ({ rule: a.rule, severity: a.severity })) } : {}),
  }, 201);
});

bankingRouter.get('/fint_transactions', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const accountId = c.req.query('accountId');

  if (!accountId) return c.json({ error: 'accountId query parameter is required' }, 400);

  const account = await c.env.DB.prepare('SELECT customerId FROM fint_bankAccounts WHERE id = ? AND tenantId = ?')
    .bind(accountId, tenantId).first() as Record<string, unknown> | null;
  if (!account) return c.json({ error: 'Account not found' }, 404);
  if (user.role === 'customer' && account.customerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM fint_transactions WHERE tenantId = ? AND accountId = ? ORDER BY createdAt DESC LIMIT 100'
  )
    .bind(tenantId, accountId)
    .all();
  return c.json({ data: results });
});
