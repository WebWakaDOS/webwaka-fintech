/**
 * Standing Orders Module (#14: Direct Debits / Recurring Transfers)
 *
 * Automated recurring transfers on a fixed schedule.
 * Execution is triggered by calling POST /api/standing-orders/process-due
 * (designed to be called by a cron/scheduled worker).
 *
 * Endpoints:
 *   POST   /api/standing-orders             — Create a standing order
 *   GET    /api/standing-orders             — List standing orders
 *   GET    /api/standing-orders/:id         — Get single order
 *   PUT    /api/standing-orders/:id/pause   — Pause a standing order
 *   PUT    /api/standing-orders/:id/resume  — Resume a paused order
 *   DELETE /api/standing-orders/:id         — Cancel a standing order
 *   POST   /api/standing-orders/process-due — Execute all due standing orders (admin/cron)
 */

import { Hono, type Context } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';
import { validateNuban, validateBankCode } from '../../core/nibss';

export const standingOrdersRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

standingOrdersRouter.post('/', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    customerId: string;
    sourceAccountId: string;
    destinationAccountNumber: string;
    destinationBankCode: string;
    destinationAccountName: string;
    amountKobo: number;
    narration: string;
    frequencyDays: number;
    startDate?: string;
    maxExecutions?: number;
  }>();

  const { customerId, sourceAccountId, destinationAccountNumber, destinationBankCode, destinationAccountName, amountKobo, narration, frequencyDays } = body;
  if (!customerId || !sourceAccountId || !destinationAccountNumber || !destinationBankCode || !destinationAccountName || !amountKobo || !narration || !frequencyDays) {
    return c.json({ error: 'Missing required fields' }, 400);
  }
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
    return c.json({ error: 'amountKobo must be a positive integer' }, 400);
  }
  if (!validateNuban(destinationAccountNumber)) {
    return c.json({ error: 'destinationAccountNumber must be a 10-digit NUBAN' }, 400);
  }
  if (!validateBankCode(destinationBankCode)) {
    return c.json({ error: 'destinationBankCode must be a 3–6 digit CBN bank code' }, 400);
  }
  if (user.role === 'customer' && user.userId !== customerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const account = await c.env.DB.prepare(
    'SELECT id FROM bankAccounts WHERE id = ? AND tenantId = ? AND customerId = ? AND status = ?'
  )
    .bind(sourceAccountId, tenantId, customerId, 'active')
    .first();
  if (!account) return c.json({ error: 'Source account not found or not active' }, 404);

  const startDate = body.startDate ?? new Date().toISOString().slice(0, 10);
  const nextExecutionAt = new Date(`${startDate}T00:00:00.000Z`).toISOString();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO standingOrders
       (id, tenantId, customerId, sourceAccountId, destinationAccountNumber, destinationBankCode,
        destinationAccountName, amountKobo, narration, frequencyDays, status, nextExecutionAt,
        executionCount, maxExecutions, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?, ?)`
  )
    .bind(id, tenantId, customerId, sourceAccountId, destinationAccountNumber, destinationBankCode, destinationAccountName, amountKobo, narration.slice(0, 100), frequencyDays, nextExecutionAt, body.maxExecutions ?? null, now, now)
    .run();

  return c.json({ success: true, id, nextExecutionAt, status: 'active' }, 201);
});

standingOrdersRouter.get('/', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const query = user.role === 'customer'
    ? 'SELECT * FROM standingOrders WHERE tenantId = ? AND customerId = ? ORDER BY createdAt DESC'
    : 'SELECT * FROM standingOrders WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 200';
  const params = user.role === 'customer' ? [tenantId, user.userId] : [tenantId];

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

standingOrdersRouter.get('/:id', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM standingOrders WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!row) return c.json({ error: 'Standing order not found' }, 404);
  if (user.role === 'customer' && row.customerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);
  return c.json({ data: row });
});

standingOrdersRouter.put('/:id/pause', requireRole(['admin', 'teller', 'customer']), async (c) => {
  return setOrderStatus(c, 'active', 'paused');
});

standingOrdersRouter.put('/:id/resume', requireRole(['admin', 'teller']), async (c) => {
  return setOrderStatus(c, 'paused', 'active');
});

standingOrdersRouter.delete('/:id', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const row = await c.env.DB.prepare('SELECT customerId FROM standingOrders WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!row) return c.json({ error: 'Standing order not found' }, 404);
  if (user.role === 'customer' && row.customerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);

  await c.env.DB.prepare(
    `UPDATE standingOrders SET status = 'cancelled', updatedAt = ? WHERE id = ? AND tenantId = ?`
  ).bind(now, id, tenantId).run();
  return c.json({ success: true });
});

standingOrdersRouter.post('/process-due', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const now = new Date().toISOString();

  const { results: dueOrders } = await c.env.DB.prepare(
    `SELECT * FROM standingOrders
     WHERE tenantId = ? AND status = 'active' AND nextExecutionAt <= ?
     AND (maxExecutions IS NULL OR executionCount < maxExecutions)
     LIMIT 50`
  )
    .bind(tenantId, now)
    .all();

  const processed: Array<{ id: string; status: string; reason?: string }> = [];

  for (const orderRaw of dueOrders) {
    const order = orderRaw as Record<string, unknown>;
    const id = order.id as string;

    try {
      const account = await c.env.DB.prepare(
        'SELECT balanceKobo FROM bankAccounts WHERE id = ? AND tenantId = ? AND status = ?'
      )
        .bind(order.sourceAccountId, tenantId, 'active')
        .first() as Record<string, number> | null;

      if (!account || account.balanceKobo < Number(order.amountKobo)) {
        processed.push({ id, status: 'skipped', reason: 'Insufficient balance' });
        continue;
      }

      const reference = `SO-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const nextExecution = new Date(Date.now() + Number(order.frequencyDays) * 24 * 60 * 60 * 1000).toISOString();
      const newCount = Number(order.executionCount) + 1;
      const newStatus = (order.maxExecutions && newCount >= Number(order.maxExecutions)) ? 'cancelled' : 'active';

      await c.env.DB.batch([
        c.env.DB.prepare(
          'UPDATE bankAccounts SET balanceKobo = balanceKobo - ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
        ).bind(order.amountKobo, now, order.sourceAccountId, tenantId),
        c.env.DB.prepare(
          `INSERT INTO transactions (id, tenantId, accountId, type, amountKobo, reference, status, description, createdAt)
           VALUES (?, ?, ?, 'transfer', ?, ?, 'success', ?, ?)`
        ).bind(crypto.randomUUID(), tenantId, order.sourceAccountId, order.amountKobo, reference, `Standing order: ${order.narration}`, now),
        c.env.DB.prepare(
          `UPDATE standingOrders SET executionCount = ?, lastExecutedAt = ?, nextExecutionAt = ?, status = ?, updatedAt = ? WHERE id = ? AND tenantId = ?`
        ).bind(newCount, now, nextExecution, newStatus, now, id, tenantId),
      ]);

      processed.push({ id, status: 'executed' });
    } catch (err) {
      console.error(`[StandingOrders] Failed to process ${id}:`, err);
      processed.push({ id, status: 'error', reason: 'Execution error' });
    }
  }

  return c.json({ processed: processed.length, results: processed });
});

async function setOrderStatus(c: Context<{ Bindings: Bindings; Variables: AppVariables }>, from: string, to: string) {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const row = await c.env.DB.prepare('SELECT customerId FROM standingOrders WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!row) return c.json({ error: 'Standing order not found' }, 404);
  if (user.role === 'customer' && row.customerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);

  const result = await c.env.DB.prepare(
    `UPDATE standingOrders SET status = ?, updatedAt = ? WHERE id = ? AND tenantId = ? AND status = ?`
  ).bind(to, now, id, tenantId, from).run();

  if (!result.meta.changes) return c.json({ error: `Order not found or not in ${from} state` }, 400);
  return c.json({ success: true, status: to });
}
