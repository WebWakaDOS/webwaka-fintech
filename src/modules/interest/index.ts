/**
 * Interest-Bearing Accounts Module (#17)
 *
 * Daily interest is accrued on savings and fixed-deposit accounts at a configurable
 * annual rate. Interest can be credited to accounts via the accrue endpoint or batch job.
 *
 * Endpoints:
 *   POST   /api/interest/accrue            — Accrue daily interest for all eligible accounts
 *   POST   /api/interest/credit            — Credit accrued but uncredited interest (batch)
 *   GET    /api/interest/accruals          — List accruals for tenant
 *   GET    /api/interest/accruals/:accountId — Get accruals for a specific account
 *
 * Annual rate defaults:
 *   savings:       8% p.a. = 800 bps
 *   fixed_deposit: 12% p.a. = 1200 bps
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const interestRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

const ANNUAL_RATE_BPS: Record<string, number> = {
  savings: 800,       // 8% p.a.
  fixed_deposit: 1200, // 12% p.a.
};

interestRouter.post('/accrue', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{ accrualDate?: string }>();

  const accrualDate = body.accrualDate ?? new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  const { results: eligibleAccounts } = await c.env.DB.prepare(
    `SELECT id, customerId, accountType, balanceKobo FROM bankAccounts
     WHERE tenantId = ? AND status = 'active' AND accountType IN ('savings', 'fixed_deposit')
     AND balanceKobo > 0`
  )
    .bind(tenantId)
    .all();

  const accounts = eligibleAccounts as Record<string, unknown>[];
  const accruals: Array<{ accountId: string; dailyInterestKobo: number }> = [];

  for (const account of accounts) {
    const annualRateBps = ANNUAL_RATE_BPS[account.accountType as string] ?? 800;
    const dailyInterestKobo = Math.floor((Number(account.balanceKobo) * annualRateBps) / (10000 * 365));

    if (dailyInterestKobo <= 0) continue;

    const existingAccrual = await c.env.DB.prepare(
      'SELECT id FROM interestAccruals WHERE tenantId = ? AND accountId = ? AND accrualDate = ?'
    ).bind(tenantId, account.id, accrualDate).first();

    if (existingAccrual) continue;

    await c.env.DB.prepare(
      `INSERT INTO interestAccruals (id, tenantId, accountId, customerId, accrualDate, principalKobo, annualRateBps, dailyInterestKobo, credited, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    )
      .bind(crypto.randomUUID(), tenantId, account.id, account.customerId, accrualDate, account.balanceKobo, annualRateBps, dailyInterestKobo, now)
      .run();

    accruals.push({ accountId: account.id as string, dailyInterestKobo });
  }

  return c.json({
    success: true,
    accrualDate,
    accountsProcessed: accounts.length,
    accrualsMade: accruals.length,
    totalInterestKobo: accruals.reduce((s, a) => s + a.dailyInterestKobo, 0),
  });
});

interestRouter.post('/credit', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{ upToDate?: string }>();

  const upToDate = body.upToDate ?? new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  const { results: uncreditedRows } = await c.env.DB.prepare(
    `SELECT * FROM interestAccruals WHERE tenantId = ? AND credited = 0 AND accrualDate <= ?
     ORDER BY accrualDate ASC LIMIT 500`
  )
    .bind(tenantId, upToDate)
    .all();

  const accruals = uncreditedRows as Record<string, unknown>[];
  let credited = 0;

  for (const accrual of accruals) {
    const reference = `INT-${accrual.accrualDate}-${(accrual.accountId as string).slice(-8)}`;
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          'UPDATE bankAccounts SET balanceKobo = balanceKobo + ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
        ).bind(accrual.dailyInterestKobo, now, accrual.accountId, tenantId),
        c.env.DB.prepare(
          `INSERT INTO transactions (id, tenantId, accountId, type, amountKobo, reference, status, description, createdAt)
           VALUES (?, ?, ?, 'interest', ?, ?, 'success', ?, ?)`
        ).bind(crypto.randomUUID(), tenantId, accrual.accountId, accrual.dailyInterestKobo, reference, `Daily interest — ${accrual.accrualDate}`, now),
        c.env.DB.prepare(
          'UPDATE interestAccruals SET credited = 1, creditedAt = ? WHERE id = ? AND tenantId = ?'
        ).bind(now, accrual.id, tenantId),
      ]);
      credited++;
    } catch (err) {
      console.error(`[Interest] Failed to credit accrual ${accrual.id}:`, err);
    }
  }

  return c.json({ success: true, totalCredited: credited, upToDate });
});

interestRouter.get('/accruals', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const credited = c.req.query('credited');

  let query = 'SELECT * FROM interestAccruals WHERE tenantId = ?';
  const params: (string | number)[] = [tenantId];
  if (credited !== undefined) { query += ' AND credited = ?'; params.push(credited === 'true' ? 1 : 0); }
  query += ' ORDER BY accrualDate DESC, createdAt DESC LIMIT 500';

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

interestRouter.get('/accruals/:accountId', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const accountId = c.req.param('accountId');

  if (user.role === 'customer') {
    const account = await c.env.DB.prepare('SELECT customerId FROM bankAccounts WHERE id = ? AND tenantId = ?')
      .bind(accountId, tenantId).first() as Record<string, unknown> | null;
    if (!account || account.customerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);
  }

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM interestAccruals WHERE tenantId = ? AND accountId = ? ORDER BY accrualDate DESC LIMIT 200'
  )
    .bind(tenantId, accountId)
    .all();
  return c.json({ data: results });
});
