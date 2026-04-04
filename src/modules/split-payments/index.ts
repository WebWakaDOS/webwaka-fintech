/**
 * Split Payments Module (#15)
 *
 * Automatically splits incoming funds between multiple destination accounts
 * according to a configured percentage rule.
 *
 * Endpoints:
 *   POST   /api/split-payments/rules               — Create a split rule
 *   GET    /api/split-payments/rules               — List rules
 *   GET    /api/split-payments/rules/:id           — Get single rule
 *   DELETE /api/split-payments/rules/:id           — Deactivate a rule
 *   POST   /api/split-payments/apply               — Apply a split rule to an incoming amount
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const splitPaymentsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

splitPaymentsRouter.post('/rules', requireRole(['admin', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    name: string;
    sourceAccountId: string;
    recipients: Array<{ destinationAccountId: string; sharePercent: number }>;
  }>();

  if (!body.name || !body.sourceAccountId || !body.recipients?.length) {
    return c.json({ error: 'name, sourceAccountId, and recipients are required' }, 400);
  }

  const totalPercent = body.recipients.reduce((s, r) => s + r.sharePercent, 0);
  if (totalPercent !== 100) {
    return c.json({ error: `Recipients share percentages must sum to 100. Got ${totalPercent}.` }, 400);
  }
  if (body.recipients.some((r) => r.sharePercent <= 0 || r.sharePercent > 100)) {
    return c.json({ error: 'Each recipient sharePercent must be between 1 and 100' }, 400);
  }

  const source = await c.env.DB.prepare('SELECT id FROM bankAccounts WHERE id = ? AND tenantId = ?')
    .bind(body.sourceAccountId, tenantId).first();
  if (!source) return c.json({ error: 'Source account not found' }, 404);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO splitPaymentRules (id, tenantId, name, sourceAccountId, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  )
    .bind(id, tenantId, body.name, body.sourceAccountId, now, now)
    .run();

  for (const recipient of body.recipients) {
    await c.env.DB.prepare(
      'INSERT INTO splitPaymentRecipients (id, ruleId, tenantId, destinationAccountId, sharePercent, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(crypto.randomUUID(), id, tenantId, recipient.destinationAccountId, recipient.sharePercent, now)
      .run();
  }

  return c.json({ success: true, id, recipientCount: body.recipients.length }, 201);
});

splitPaymentsRouter.get('/rules', requireRole(['admin', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const { results: rules } = await c.env.DB.prepare(
    'SELECT * FROM splitPaymentRules WHERE tenantId = ? ORDER BY createdAt DESC'
  )
    .bind(tenantId)
    .all();

  const enriched = await Promise.all(
    (rules as Record<string, unknown>[]).map(async (rule) => {
      const { results: recipients } = await c.env.DB.prepare(
        'SELECT * FROM splitPaymentRecipients WHERE ruleId = ?'
      ).bind(rule.id).all();
      return { ...rule, recipients };
    })
  );

  return c.json({ data: enriched });
});

splitPaymentsRouter.get('/rules/:id', requireRole(['admin', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const rule = await c.env.DB.prepare('SELECT * FROM splitPaymentRules WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!rule) return c.json({ error: 'Split rule not found' }, 404);

  const { results: recipients } = await c.env.DB.prepare(
    'SELECT * FROM splitPaymentRecipients WHERE ruleId = ?'
  ).bind(id).all();

  return c.json({ data: { ...rule, recipients } });
});

splitPaymentsRouter.delete('/rules/:id', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const result = await c.env.DB.prepare(
    `UPDATE splitPaymentRules SET status = 'inactive', updatedAt = ? WHERE id = ? AND tenantId = ?`
  )
    .bind(now, id, tenantId)
    .run();

  if (!result.meta.changes) return c.json({ error: 'Rule not found' }, 404);
  return c.json({ success: true });
});

splitPaymentsRouter.post('/apply', requireRole(['admin', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{ ruleId: string; incomingAmountKobo: number; description?: string }>();

  if (!body.ruleId || !body.incomingAmountKobo) {
    return c.json({ error: 'ruleId and incomingAmountKobo are required' }, 400);
  }
  if (!Number.isInteger(body.incomingAmountKobo) || body.incomingAmountKobo <= 0) {
    return c.json({ error: 'incomingAmountKobo must be a positive integer' }, 400);
  }

  const rule = await c.env.DB.prepare(`SELECT * FROM splitPaymentRules WHERE id = ? AND tenantId = ? AND status = 'active'`)
    .bind(body.ruleId, tenantId).first() as Record<string, unknown> | null;
  if (!rule) return c.json({ error: 'Active split rule not found' }, 404);

  const { results: recipients } = await c.env.DB.prepare(
    'SELECT * FROM splitPaymentRecipients WHERE ruleId = ?'
  ).bind(body.ruleId).all();

  const now = new Date().toISOString();
  const description = body.description ?? `Split payment from rule: ${rule.name}`;
  const splits: Array<{ accountId: string; amountKobo: number; reference: string }> = [];
  let remainingKobo = body.incomingAmountKobo;

  const recipientList = recipients as Record<string, unknown>[];

  for (let i = 0; i < recipientList.length; i++) {
    const recipient = recipientList[i];
    const amountKobo = i === recipientList.length - 1
      ? remainingKobo
      : Math.floor(body.incomingAmountKobo * (Number(recipient.sharePercent) / 100));
    remainingKobo -= amountKobo;
    const reference = `SPLIT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${i}`;

    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE bankAccounts SET balanceKobo = balanceKobo + ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
      ).bind(amountKobo, now, recipient.destinationAccountId, tenantId),
      c.env.DB.prepare(
        `INSERT INTO transactions (id, tenantId, accountId, type, amountKobo, reference, status, description, createdAt)
         VALUES (?, ?, ?, 'deposit', ?, ?, 'success', ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, recipient.destinationAccountId, amountKobo, reference, description, now),
    ]);

    splits.push({ accountId: recipient.destinationAccountId as string, amountKobo, reference });
  }

  return c.json({ success: true, totalKobo: body.incomingAmountKobo, splits });
});
