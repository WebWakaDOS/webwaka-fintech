/**
 * Savings Goals Module (#5: Ajo / Esusu)
 *
 * Supports personal savings targets and group rotating savings (Ajo/Esusu).
 *
 * Endpoints:
 *   POST   /api/savings                          — Create a savings goal
 *   GET    /api/savings                          — List goals (owner/member view)
 *   GET    /api/savings/:id                      — Get goal details
 *   DELETE /api/savings/:id                      — Cancel a goal
 *   POST   /api/savings/:id/members              — Add member to group goal (Ajo)
 *   DELETE /api/savings/:id/members/:customerId  — Remove member
 *   POST   /api/savings/:id/contribute           — Contribute to a savings goal
 *   GET    /api/savings/:id/contributions        — List contributions
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, SavingsGoalType } from '../../core/types';

export const savingsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

savingsRouter.post('/', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    name: string;
    type?: SavingsGoalType;
    targetAmountKobo: number;
    contributionKobo: number;
    cycleDays?: number;
    targetDate?: string;
  }>();

  if (!body.name || !body.targetAmountKobo || !body.contributionKobo) {
    return c.json({ error: 'name, targetAmountKobo, and contributionKobo are required' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO savingsGoals (id, tenantId, ownerId, name, type, targetAmountKobo, currentAmountKobo, contributionKobo, cycleDays, status, targetDate, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'active', ?, ?, ?)`
  )
    .bind(id, tenantId, user.userId, body.name, body.type ?? 'personal', body.targetAmountKobo, body.contributionKobo, body.cycleDays ?? 30, body.targetDate ?? null, now, now)
    .run();

  if (body.type === 'group') {
    await c.env.DB.prepare(
      'INSERT INTO savingsGoalMembers (id, tenantId, goalId, customerId, joinedAt) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(crypto.randomUUID(), tenantId, id, user.userId, now)
      .run();
  }

  return c.json({ success: true, id }, 201);
});

savingsRouter.get('/', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  if (user.role === 'customer') {
    const { results } = await c.env.DB.prepare(
      `SELECT g.* FROM savingsGoals g
       WHERE g.tenantId = ? AND (
         g.ownerId = ? OR
         EXISTS (SELECT 1 FROM savingsGoalMembers m WHERE m.goalId = g.id AND m.customerId = ?)
       )
       ORDER BY g.createdAt DESC`
    )
      .bind(tenantId, user.userId, user.userId)
      .all();
    return c.json({ data: results });
  }

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM savingsGoals WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 200'
  )
    .bind(tenantId)
    .all();
  return c.json({ data: results });
});

savingsRouter.get('/:id', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const goal = await c.env.DB.prepare('SELECT * FROM savingsGoals WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!goal) return c.json({ error: 'Savings goal not found' }, 404);

  if (user.role === 'customer') {
    const isMember = await c.env.DB.prepare(
      'SELECT 1 FROM savingsGoalMembers WHERE goalId = ? AND customerId = ?'
    ).bind(id, user.userId).first();
    if (goal.ownerId !== user.userId && !isMember) return c.json({ error: 'Forbidden' }, 403);
  }

  const { results: members } = await c.env.DB.prepare(
    'SELECT customerId, joinedAt FROM savingsGoalMembers WHERE goalId = ?'
  ).bind(id).all();

  return c.json({ data: { ...goal, members } });
});

savingsRouter.delete('/:id', requireRole(['admin', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const goal = await c.env.DB.prepare('SELECT ownerId FROM savingsGoals WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!goal) return c.json({ error: 'Savings goal not found' }, 404);
  if (user.role === 'customer' && goal.ownerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);

  await c.env.DB.prepare(
    `UPDATE savingsGoals SET status = 'cancelled', updatedAt = ? WHERE id = ? AND tenantId = ?`
  ).bind(now, id, tenantId).run();

  return c.json({ success: true });
});

savingsRouter.post('/:id/members', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ customerId: string }>();

  const goal = await c.env.DB.prepare(`SELECT ownerId, type FROM savingsGoals WHERE id = ? AND tenantId = ? AND status = 'active'`)
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!goal) return c.json({ error: 'Goal not found or not active' }, 404);
  if (goal.type !== 'group') return c.json({ error: 'Only group goals support members' }, 400);
  if (user.role === 'customer' && goal.ownerId !== user.userId) return c.json({ error: 'Only the goal owner can add members' }, 403);

  const now = new Date().toISOString();
  try {
    await c.env.DB.prepare(
      'INSERT INTO savingsGoalMembers (id, tenantId, goalId, customerId, joinedAt) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), tenantId, id, body.customerId, now).run();
  } catch {
    return c.json({ error: 'Member already exists in this goal' }, 409);
  }

  return c.json({ success: true });
});

savingsRouter.delete('/:id/members/:customerId', requireRole(['admin', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const customerId = c.req.param('customerId');

  const goal = await c.env.DB.prepare('SELECT ownerId FROM savingsGoals WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!goal) return c.json({ error: 'Goal not found' }, 404);
  if (user.role === 'customer' && goal.ownerId !== user.userId && user.userId !== customerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM savingsGoalMembers WHERE goalId = ? AND customerId = ?')
    .bind(id, customerId).run();
  return c.json({ success: true });
});

savingsRouter.post('/:id/contribute', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ accountId: string; amountKobo: number }>();

  if (!Number.isInteger(body.amountKobo) || body.amountKobo <= 0) {
    return c.json({ error: 'amountKobo must be a positive integer' }, 400);
  }

  const goal = await c.env.DB.prepare(`SELECT * FROM savingsGoals WHERE id = ? AND tenantId = ? AND status = 'active'`)
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!goal) return c.json({ error: 'Savings goal not found or not active' }, 404);

  const account = await c.env.DB.prepare('SELECT balanceKobo FROM bankAccounts WHERE id = ? AND tenantId = ?')
    .bind(body.accountId, tenantId).first() as Record<string, number> | null;
  if (!account) return c.json({ error: 'Account not found' }, 404);
  if (account.balanceKobo < body.amountKobo) return c.json({ error: 'Insufficient balance' }, 422);

  const reference = `SAV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const newAmount = Number(goal.currentAmountKobo) + body.amountKobo;
  const isCompleted = newAmount >= Number(goal.targetAmountKobo);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO savingsGoalContributions (id, tenantId, goalId, customerId, accountId, amountKobo, reference, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), tenantId, id, user.userId, body.accountId, body.amountKobo, reference, now),
    c.env.DB.prepare(
      `UPDATE savingsGoals SET currentAmountKobo = ?, status = ?, updatedAt = ? WHERE id = ? AND tenantId = ?`
    ).bind(newAmount, isCompleted ? 'completed' : 'active', now, id, tenantId),
    c.env.DB.prepare(
      'UPDATE bankAccounts SET balanceKobo = balanceKobo - ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
    ).bind(body.amountKobo, now, body.accountId, tenantId),
    c.env.DB.prepare(
      `INSERT INTO transactions (id, tenantId, accountId, type, amountKobo, reference, status, description, createdAt)
       VALUES (?, ?, ?, 'withdrawal', ?, ?, 'success', ?, ?)`
    ).bind(crypto.randomUUID(), tenantId, body.accountId, body.amountKobo, reference, `Savings contribution — ${goal.name}`, now),
  ]);

  return c.json({ success: true, reference, newTotal: newAmount, isCompleted });
});

savingsRouter.get('/:id/contributions', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const goal = await c.env.DB.prepare('SELECT ownerId FROM savingsGoals WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!goal) return c.json({ error: 'Goal not found' }, 404);

  const query = user.role === 'customer'
    ? 'SELECT * FROM savingsGoalContributions WHERE tenantId = ? AND goalId = ? AND customerId = ? ORDER BY createdAt DESC'
    : 'SELECT * FROM savingsGoalContributions WHERE tenantId = ? AND goalId = ? ORDER BY createdAt DESC';
  const params = user.role === 'customer' ? [tenantId, id, user.userId] : [tenantId, id];

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});
