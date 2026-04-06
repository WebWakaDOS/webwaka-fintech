/**
 * Agent Banking (POS) Module (#12)
 *
 * Allows registered field agents to perform cash-in, cash-out, and peer transfers
 * on behalf of end customers at physical POS terminals.
 *
 * Agents earn a configurable fee per transaction.
 *
 * Endpoints:
 *   POST   /api/agent/fint_transactions           — Record a POS transaction
 *   GET    /api/agent/fint_transactions           — List fint_transactions (agent: own; admin: all)
 *   GET    /api/agent/fint_transactions/:id       — Get single transaction
 *   GET    /api/agent/summary                — Agent commission summary
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, AgentTxType } from '../../core/types';

export const agentRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// Agent fee schedule (in kobo): flat fees per transaction type
const AGENT_FEES: Record<AgentTxType, number> = {
  cash_in: 10000,     // ₦100
  cash_out: 10000,    // ₦100
  transfer: 5000,     // ₦50
};

agentRouter.post('/fint_transactions', requireRole(['admin', 'agent', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    agentId: string;
    customerId: string;
    accountId: string;
    type: AgentTxType;
    amountKobo: number;
    posTerminalId?: string;
  }>();

  const { agentId, customerId, accountId, type, amountKobo } = body;
  if (!agentId || !customerId || !accountId || !type || !amountKobo) {
    return c.json({ error: 'agentId, customerId, accountId, type, and amountKobo are required' }, 400);
  }
  if (!['cash_in', 'cash_out', 'transfer'].includes(type)) {
    return c.json({ error: 'type must be cash_in, cash_out, or transfer' }, 400);
  }
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
    return c.json({ error: 'amountKobo must be a positive integer' }, 400);
  }

  const account = await c.env.DB.prepare(
    'SELECT balanceKobo FROM fint_bankAccounts WHERE id = ? AND tenantId = ? AND customerId = ? AND status = ?'
  )
    .bind(accountId, tenantId, customerId, 'active')
    .first() as Record<string, number> | null;

  if (!account) return c.json({ error: 'Account not found or not active' }, 404);

  if ((type === 'cash_out' || type === 'transfer') && account.balanceKobo < amountKobo) {
    return c.json({ error: 'Insufficient balance' }, 422);
  }

  const feeKobo = AGENT_FEES[type];
  const reference = `AGENT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const txType = type === 'cash_in' ? 'deposit' : 'withdrawal';
  const balanceModifier = type === 'cash_in' ? amountKobo : -amountKobo;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO fint_agentTransactions (id, tenantId, agentId, customerId, accountId, type, amountKobo, feeKobo, reference, posTerminalId, status, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', ?)`
    ).bind(id, tenantId, agentId, customerId, accountId, type, amountKobo, feeKobo, reference, body.posTerminalId ?? null, now),
    c.env.DB.prepare(
      'UPDATE fint_bankAccounts SET balanceKobo = balanceKobo + ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
    ).bind(balanceModifier, now, accountId, tenantId),
    c.env.DB.prepare(
      `INSERT INTO fint_transactions (id, tenantId, accountId, type, amountKobo, reference, status, description, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, 'success', ?, ?)`
    ).bind(crypto.randomUUID(), tenantId, accountId, txType, amountKobo, reference, `Agent ${type} via POS ${body.posTerminalId ?? 'N/A'}`, now),
  ]);

  return c.json({ success: true, id, reference, feeKobo, amountKobo, type, status: 'success' }, 201);
});

agentRouter.get('/fint_transactions', requireRole(['admin', 'agent', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const query = user.role === 'agent'
    ? 'SELECT * FROM fint_agentTransactions WHERE tenantId = ? AND agentId = ? ORDER BY createdAt DESC LIMIT 200'
    : 'SELECT * FROM fint_agentTransactions WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 500';
  const params = user.role === 'agent' ? [tenantId, user.userId] : [tenantId];

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

agentRouter.get('/fint_transactions/:id', requireRole(['admin', 'agent', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM fint_agentTransactions WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!row) return c.json({ error: 'Transaction not found' }, 404);
  if (user.role === 'agent' && row.agentId !== user.userId) return c.json({ error: 'Forbidden' }, 403);
  return c.json({ data: row });
});

agentRouter.get('/summary', requireRole(['admin', 'agent']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const agentId = user.role === 'agent' ? user.userId : (c.req.query('agentId') ?? user.userId);

  const { results } = await c.env.DB.prepare(
    `SELECT type, COUNT(*) as count, SUM(amountKobo) as totalAmountKobo, SUM(feeKobo) as totalFeesKobo
     FROM fint_agentTransactions WHERE tenantId = ? AND agentId = ? AND status = 'success'
     GROUP BY type`
  )
    .bind(tenantId, agentId)
    .all();

  const totalEarnings = (results as Record<string, number>[]).reduce((s, r) => s + Number(r.totalFeesKobo), 0);

  return c.json({ data: { agentId, breakdown: results, totalEarningsKobo: totalEarnings } });
});
