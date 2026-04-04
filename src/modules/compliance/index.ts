/**
 * Compliance Module — CBN Regulatory Reporting (#4) + Automated Reconciliation (#13)
 *
 * Endpoints:
 *   POST   /api/compliance/cbn-reports/generate       — Generate a CBN report
 *   GET    /api/compliance/cbn-reports                — List CBN reports
 *   GET    /api/compliance/cbn-reports/:id            — Get a single report
 *   PUT    /api/compliance/cbn-reports/:id/submit     — Mark a report as submitted
 *
 *   POST   /api/compliance/reconciliation/run         — Run nightly reconciliation
 *   GET    /api/compliance/reconciliation             — List reconciliation reports
 *   GET    /api/compliance/reconciliation/:id         — Get reconciliation report
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const complianceRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── CBN Regulatory Reporting (#4) ───────────────────────────────────────────

complianceRouter.post('/cbn-reports/generate', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    reportType: 'daily_tx_summary' | 'suspicious_tx' | 'large_cash';
    periodStart: string;
    periodEnd: string;
  }>();

  if (!body.reportType || !body.periodStart || !body.periodEnd) {
    return c.json({ error: 'reportType, periodStart, and periodEnd are required' }, 400);
  }

  const now = new Date().toISOString();
  let payload: Record<string, unknown>;

  if (body.reportType === 'daily_tx_summary') {
    const { results: txStats } = await c.env.DB.prepare(
      `SELECT
         t.type,
         COUNT(*) as count,
         SUM(t.amountKobo) as totalKobo,
         AVG(t.amountKobo) as avgKobo
       FROM transactions t
       WHERE t.tenantId = ? AND t.createdAt >= ? AND t.createdAt <= ? AND t.status = 'success'
       GROUP BY t.type`
    )
      .bind(tenantId, body.periodStart, body.periodEnd)
      .all();

    const { results: accountStats } = await c.env.DB.prepare(
      `SELECT COUNT(*) as totalAccounts, SUM(balanceKobo) as totalBalanceKobo
       FROM bankAccounts WHERE tenantId = ? AND status = 'active'`
    )
      .bind(tenantId)
      .all();

    payload = {
      reportType: 'daily_tx_summary',
      tenantId,
      period: { start: body.periodStart, end: body.periodEnd },
      transactionBreakdown: txStats,
      accountSummary: accountStats[0] ?? {},
      generatedAt: now,
    };

  } else if (body.reportType === 'suspicious_tx') {
    const { results: fraudAlerts } = await c.env.DB.prepare(
      `SELECT f.*, t.amountKobo, t.type, t.reference
       FROM fraudAlerts f
       LEFT JOIN transactions t ON f.transactionId = t.id
       WHERE f.tenantId = ? AND f.createdAt >= ? AND f.createdAt <= ?
       AND f.severity IN ('high', 'critical')
       ORDER BY f.createdAt DESC LIMIT 500`
    )
      .bind(tenantId, body.periodStart, body.periodEnd)
      .all();

    payload = {
      reportType: 'suspicious_tx',
      tenantId,
      period: { start: body.periodStart, end: body.periodEnd },
      suspiciousAlerts: fraudAlerts,
      totalAlerts: fraudAlerts.length,
      generatedAt: now,
    };

  } else {
    // large_cash — transactions above ₦5,000,000 (CBN threshold for large cash reporting)
    const largeThresholdKobo = 500_000_000; // ₦5,000,000
    const { results: largeTx } = await c.env.DB.prepare(
      `SELECT t.*, b.accountNumber, b.customerId
       FROM transactions t
       JOIN bankAccounts b ON t.accountId = b.id
       WHERE t.tenantId = ? AND t.createdAt >= ? AND t.createdAt <= ?
       AND t.amountKobo >= ? AND t.status = 'success'
       ORDER BY t.amountKobo DESC LIMIT 500`
    )
      .bind(tenantId, body.periodStart, body.periodEnd, largeThresholdKobo)
      .all();

    payload = {
      reportType: 'large_cash',
      tenantId,
      period: { start: body.periodStart, end: body.periodEnd },
      threshold: { kobo: largeThresholdKobo, naira: largeThresholdKobo / 100 },
      largeTransactions: largeTx,
      count: largeTx.length,
      generatedAt: now,
    };
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO cbnReports (id, tenantId, reportType, periodStart, periodEnd, payload, status, generatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 'generated', ?)`
  )
    .bind(id, tenantId, body.reportType, body.periodStart, body.periodEnd, JSON.stringify(payload), now)
    .run();

  return c.json({ success: true, id, reportType: body.reportType, status: 'generated', payload }, 201);
});

complianceRouter.get('/cbn-reports', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const reportType = c.req.query('reportType');

  let query = 'SELECT id, tenantId, reportType, periodStart, periodEnd, status, generatedAt, submittedAt FROM cbnReports WHERE tenantId = ?';
  const params: string[] = [tenantId];
  if (reportType) { query += ' AND reportType = ?'; params.push(reportType); }
  query += ' ORDER BY generatedAt DESC LIMIT 100';

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

complianceRouter.get('/cbn-reports/:id', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM cbnReports WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first();
  if (!row) return c.json({ error: 'Report not found' }, 404);
  return c.json({ data: row });
});

complianceRouter.put('/cbn-reports/:id/submit', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const result = await c.env.DB.prepare(
    `UPDATE cbnReports SET status = 'submitted', submittedAt = ? WHERE id = ? AND tenantId = ?`
  )
    .bind(now, id, tenantId)
    .run();

  if (!result.meta.changes) return c.json({ error: 'Report not found' }, 404);
  return c.json({ success: true, status: 'submitted', submittedAt: now });
});

// ─── Automated Reconciliation (#13) ──────────────────────────────────────────

complianceRouter.post('/reconciliation/run', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{ reportDate?: string }>();

  const reportDate = body.reportDate ?? new Date().toISOString().slice(0, 10);
  const periodStart = `${reportDate}T00:00:00.000Z`;
  const periodEnd = `${reportDate}T23:59:59.999Z`;

  const { results: txRows } = await c.env.DB.prepare(
    `SELECT type, status, SUM(amountKobo) as totalKobo, COUNT(*) as count
     FROM transactions WHERE tenantId = ? AND createdAt >= ? AND createdAt <= ?
     GROUP BY type, status`
  )
    .bind(tenantId, periodStart, periodEnd)
    .all();

  const rows = txRows as Array<Record<string, unknown>>;
  const totalTransactions = rows.reduce((s, r) => s + Number(r.count), 0);
  const debits = rows.filter((r) => ['withdrawal', 'fee', 'transfer'].includes(r.type as string) && r.status === 'success');
  const credits = rows.filter((r) => ['deposit', 'interest'].includes(r.type as string) && r.status === 'success');
  const totalDebitsKobo = debits.reduce((s, r) => s + Number(r.totalKobo), 0);
  const totalCreditsKobo = credits.reduce((s, r) => s + Number(r.totalKobo), 0);
  const failedTx = rows.filter((r) => r.status === 'failed');

  const discrepancies: Record<string, unknown>[] = [];
  if (failedTx.length > 0) {
    discrepancies.push({ type: 'failed_transactions', count: failedTx.reduce((s, r) => s + Number(r.count), 0), description: 'Transactions with failed status found' });
  }

  const { results: accountRows } = await c.env.DB.prepare(
    'SELECT SUM(balanceKobo) as totalBalance, COUNT(*) as count FROM bankAccounts WHERE tenantId = ? AND status = ?'
  )
    .bind(tenantId, 'active')
    .all();

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO reconciliationReports (id, tenantId, reportDate, totalTransactions, totalDebitsKobo, totalCreditsKobo, discrepanciesFound, discrepancies, status, generatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
  )
    .bind(id, tenantId, reportDate, totalTransactions, totalDebitsKobo, totalCreditsKobo, discrepancies.length, JSON.stringify(discrepancies), now)
    .run();

  return c.json({
    success: true,
    id,
    reportDate,
    totalTransactions,
    totalDebitsKobo,
    totalCreditsKobo,
    netKobo: totalCreditsKobo - totalDebitsKobo,
    discrepanciesFound: discrepancies.length,
    discrepancies,
    accountSummary: accountRows[0] ?? {},
  }, 201);
});

complianceRouter.get('/reconciliation', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const { results } = await c.env.DB.prepare(
    'SELECT id, tenantId, reportDate, totalTransactions, totalDebitsKobo, totalCreditsKobo, discrepanciesFound, status, generatedAt FROM reconciliationReports WHERE tenantId = ? ORDER BY reportDate DESC LIMIT 100'
  )
    .bind(tenantId)
    .all();

  return c.json({ data: results });
});

complianceRouter.get('/reconciliation/:id', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM reconciliationReports WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first();
  if (!row) return c.json({ error: 'Report not found' }, 404);
  return c.json({ data: row });
});
