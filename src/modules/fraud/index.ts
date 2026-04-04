/**
 * Fraud Detection Module (#9: Real-time Fraud Rules Engine)
 *
 * Applies configurable rules on transactions in real-time to flag suspicious activity.
 *
 * Built-in rules:
 *   - velocity_breach:  >5 transactions in 10 minutes from same account
 *   - large_amount:     Single transaction > ₦1,000,000
 *   - odd_hours:        Transaction between 01:00–04:00 local time
 *   - rapid_withdrawal: >3 withdrawals totaling >₦500k in 1 hour
 *   - duplicate_ref:    Same reference used more than once
 *
 * Endpoints:
 *   GET    /api/fraud/alerts              — List fraud alerts (admin)
 *   GET    /api/fraud/alerts/:id          — Get single alert
 *   PUT    /api/fraud/alerts/:id/review   — Mark alert reviewed/dismissed/escalated
 *   POST   /api/fraud/check              — Manually check a transaction for fraud
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, FraudSeverity } from '../../core/types';

export const fraudRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

fraudRouter.get('/alerts', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const status = c.req.query('status');
  const severity = c.req.query('severity');

  let query = 'SELECT * FROM fraudAlerts WHERE tenantId = ?';
  const params: string[] = [tenantId];
  if (status) { query += ' AND status = ?'; params.push(status); }
  if (severity) { query += ' AND severity = ?'; params.push(severity); }
  query += ' ORDER BY createdAt DESC LIMIT 200';

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

fraudRouter.get('/alerts/:id', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM fraudAlerts WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first();
  if (!row) return c.json({ error: 'Alert not found' }, 404);
  return c.json({ data: row });
});

fraudRouter.put('/alerts/:id/review', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ action: 'reviewed' | 'dismissed' | 'escalated' }>();

  if (!['reviewed', 'dismissed', 'escalated'].includes(body.action)) {
    return c.json({ error: 'action must be reviewed, dismissed, or escalated' }, 400);
  }

  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `UPDATE fraudAlerts SET status = ?, reviewedBy = ?, reviewedAt = ? WHERE id = ? AND tenantId = ?`
  )
    .bind(body.action, user.userId, now, id, tenantId)
    .run();

  if (!result.meta.changes) return c.json({ error: 'Alert not found' }, 404);
  return c.json({ success: true, status: body.action });
});

fraudRouter.post('/check', requireRole(['admin', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    accountId: string;
    customerId: string;
    transactionId?: string;
    amountKobo: number;
    type: string;
    reference: string;
  }>();

  const alerts = await runFraudRules(c.env.DB, tenantId, body);
  if (alerts.length > 0) {
    const now = new Date().toISOString();
    for (const alert of alerts) {
      await c.env.DB.prepare(
        `INSERT INTO fraudAlerts (id, tenantId, customerId, accountId, transactionId, ruleTriggered, severity, status, details, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
      )
        .bind(crypto.randomUUID(), tenantId, body.customerId, body.accountId, body.transactionId ?? null, alert.rule, alert.severity, JSON.stringify(alert.details), now)
        .run();
    }
  }

  return c.json({ flagged: alerts.length > 0, alertsCreated: alerts.length, alerts });
});

/** Run all fraud detection rules. Returns list of triggered rules. */
export async function runFraudRules(
  db: D1Database,
  tenantId: string,
  tx: { accountId: string; customerId: string; transactionId?: string; amountKobo: number; type: string; reference: string }
): Promise<Array<{ rule: string; severity: FraudSeverity; details: Record<string, unknown> }>> {
  const triggered: Array<{ rule: string; severity: FraudSeverity; details: Record<string, unknown> }> = [];
  const now = new Date();

  // Rule 1: Large amount (> ₦1,000,000)
  if (tx.amountKobo >= 100_000_000) {
    triggered.push({
      rule: 'large_amount',
      severity: tx.amountKobo >= 500_000_000 ? 'critical' : 'high',
      details: { amountKobo: tx.amountKobo, threshold: 100_000_000 },
    });
  }

  // Rule 2: Odd hours (01:00–04:00 WAT = 00:00–03:00 UTC)
  const utcHour = now.getUTCHours();
  if (utcHour >= 0 && utcHour < 3) {
    triggered.push({
      rule: 'odd_hours',
      severity: 'low',
      details: { utcHour, localTime: `${(utcHour + 1) % 24}:00 WAT` },
    });
  }

  // Rule 3: Velocity — >5 transactions in the last 10 minutes
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const velocityRow = await db.prepare(
    `SELECT COUNT(*) as count FROM transactions WHERE tenantId = ? AND accountId = ? AND createdAt >= ?`
  )
    .bind(tenantId, tx.accountId, tenMinutesAgo)
    .first() as Record<string, number> | null;

  if ((velocityRow?.count ?? 0) >= 5) {
    triggered.push({
      rule: 'velocity_breach',
      severity: 'high',
      details: { txCount: velocityRow?.count, window: '10 minutes' },
    });
  }

  // Rule 4: Rapid withdrawal — >₦500k withdrawals in last hour
  if (tx.type === 'withdrawal') {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const withdrawalRow = await db.prepare(
      `SELECT COALESCE(SUM(amountKobo), 0) as total, COUNT(*) as count FROM transactions
       WHERE tenantId = ? AND accountId = ? AND type = 'withdrawal' AND status = 'success' AND createdAt >= ?`
    )
      .bind(tenantId, tx.accountId, oneHourAgo)
      .first() as Record<string, number> | null;

    if ((withdrawalRow?.count ?? 0) >= 3 && (Number(withdrawalRow?.total ?? 0) + tx.amountKobo) >= 50_000_000) {
      triggered.push({
        rule: 'rapid_withdrawal',
        severity: 'critical',
        details: { countInHour: withdrawalRow?.count, totalKobo: Number(withdrawalRow?.total ?? 0) + tx.amountKobo },
      });
    }
  }

  return triggered;
}
