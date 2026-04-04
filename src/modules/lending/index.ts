/**
 * Lending Module — AI Credit Scoring (#2) + Loan Origination (#18) + Debt Collection (#19)
 *
 * Endpoints:
 *   POST   /api/lending/credit-scores           — Compute AI credit score for a customer
 *   GET    /api/lending/credit-scores/:customerId — Get latest credit score
 *
 *   POST   /api/lending/loans                   — Apply for a loan
 *   GET    /api/lending/loans                   — List loans (admin: all; customer: own)
 *   GET    /api/lending/loans/:id               — Get single loan
 *   PUT    /api/lending/loans/:id/approve       — Approve loan (admin)
 *   PUT    /api/lending/loans/:id/disburse      — Disburse approved loan (admin)
 *   POST   /api/lending/loans/:id/repay         — Record a repayment
 *   PUT    /api/lending/loans/:id/reject        — Reject loan application (admin)
 *
 *   POST   /api/lending/debt-collection/:loanId/remind   — Trigger SMS/email reminder
 *   POST   /api/lending/debt-collection/:loanId/auto-debit — Attempt auto-debit
 *   GET    /api/lending/debt-collection/:loanId           — List collection events
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, CreditGrade, LoanStatus } from '../../core/types';
import { getAICompletion } from '../../core/ai-platform-client';

export const lendingRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── AI Credit Scoring (#2) ───────────────────────────────────────────────────

lendingRouter.post('/credit-scores', requireRole(['admin', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{ customerId: string }>();

  if (!body.customerId) return c.json({ error: 'customerId is required' }, 400);

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { results: txRows } = await c.env.DB.prepare(
    `SELECT t.type, t.amountKobo, t.status, t.createdAt, t.description
     FROM transactions t
     JOIN bankAccounts b ON t.accountId = b.id
     WHERE b.tenantId = ? AND b.customerId = ? AND t.createdAt >= ?
     ORDER BY t.createdAt DESC LIMIT 200`
  )
    .bind(tenantId, body.customerId, ninetyDaysAgo)
    .all();

  const txCount = txRows.length;
  const txSummary = txRows.map((r) => {
    const row = r as Record<string, unknown>;
    return `${row.createdAt?.toString().slice(0, 10)} ${row.type} ₦${Number(row.amountKobo) / 100} (${row.status})`;
  }).join('\n');

  let score: number;
  let grade: CreditGrade;
  let rationale: string;
  let modelUsed: string | undefined;

  if (txCount === 0) {
    score = 300;
    grade = 'D';
    rationale = 'No transaction history found in the last 90 days. Score set to minimum viable level.';
  } else {
    try {
      const aiEnv = {
        AI_PLATFORM_URL: c.env.AI_PLATFORM_URL ?? '',
        INTER_SERVICE_SECRET: c.env.INTER_SERVICE_SECRET ?? '',
        TENANT_ID: tenantId,
      };

      const prompt = c.env.AI_PLATFORM_URL
        ? `Analyze the following 90-day transaction history for a Nigerian bank customer and return a credit score between 0 and 1000.

Transaction History (${txCount} transactions):
${txSummary}

Return ONLY valid JSON in this exact format:
{"score": <integer 0-1000>, "grade": "<A|B|C|D|E>", "rationale": "<2-3 sentence explanation>"}

Grading: A=800-1000, B=600-799, C=400-599, D=200-399, E=0-199.
Consider: transaction frequency, deposit/withdrawal ratio, failed transactions, average balance indicators.`
        : '';

      if (c.env.AI_PLATFORM_URL && prompt) {
        const aiResp = await getAICompletion(aiEnv, {
          prompt,
          capabilityId: 'ai.fintech.credit_scoring',
          maxTokens: 256,
          temperature: 0.1,
          systemPrompt: 'You are a credit scoring AI for a Nigerian digital bank. Respond only with valid JSON.',
        }, tenantId);

        const parsed = JSON.parse(aiResp.content.trim()) as { score: number; grade: CreditGrade; rationale: string };
        score = Math.max(0, Math.min(1000, Math.round(parsed.score)));
        grade = parsed.grade;
        rationale = parsed.rationale;
        modelUsed = aiResp.model;
      } else {
        const result = computeRuleBasedScore(txRows as Record<string, unknown>[]);
        score = result.score;
        grade = result.grade;
        rationale = result.rationale;
        modelUsed = 'rule-based-v1';
      }
    } catch (err) {
      console.error('[Lending] AI scoring error, falling back to rule-based:', err);
      const result = computeRuleBasedScore(txRows as Record<string, unknown>[]);
      score = result.score;
      grade = result.grade;
      rationale = result.rationale;
      modelUsed = 'rule-based-v1-fallback';
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO creditScores (id, tenantId, customerId, score, grade, rationale, txCountAnalyzed, modelUsed, computedAt, expiresAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, tenantId, body.customerId, score, grade, rationale, txCount, modelUsed ?? null, now, expiresAt)
    .run();

  return c.json({ success: true, id, score, grade, rationale, txCountAnalyzed: txCount, expiresAt }, 201);
});

lendingRouter.get('/credit-scores/:customerId', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const customerId = c.req.param('customerId');

  if (user.role === 'customer' && user.userId !== customerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const now = new Date().toISOString();
  const row = await c.env.DB.prepare(
    `SELECT * FROM creditScores WHERE tenantId = ? AND customerId = ? AND expiresAt > ?
     ORDER BY computedAt DESC LIMIT 1`
  )
    .bind(tenantId, customerId, now)
    .first();

  if (!row) return c.json({ error: 'No valid credit score found. Request a new computation.' }, 404);
  return c.json({ data: row });
});

// ─── Loan Origination (#18) ───────────────────────────────────────────────────

lendingRouter.post('/loans', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    customerId: string;
    accountId: string;
    principalKobo: number;
    interestRateBps: number;
    termDays: number;
  }>();

  const { customerId, accountId, principalKobo, interestRateBps, termDays } = body;
  if (!customerId || !accountId || !principalKobo || !interestRateBps || !termDays) {
    return c.json({ error: 'Missing required fields' }, 400);
  }
  if (!Number.isInteger(principalKobo) || principalKobo <= 0) {
    return c.json({ error: 'principalKobo must be a positive integer' }, 400);
  }

  if (user.role === 'customer' && user.userId !== customerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const account = await c.env.DB.prepare(
    'SELECT id FROM bankAccounts WHERE id = ? AND tenantId = ? AND customerId = ? AND status = ?'
  )
    .bind(accountId, tenantId, customerId, 'active')
    .first();

  if (!account) return c.json({ error: 'Account not found or not eligible' }, 404);

  const now = new Date().toISOString();
  const creditScoreRow = await c.env.DB.prepare(
    `SELECT score FROM creditScores WHERE tenantId = ? AND customerId = ? AND expiresAt > ? ORDER BY computedAt DESC LIMIT 1`
  )
    .bind(tenantId, customerId, now)
    .first() as Record<string, number> | null;

  const interestKobo = Math.round((principalKobo * interestRateBps * termDays) / (10000 * 365));
  const totalRepayableKobo = principalKobo + interestKobo;

  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    `INSERT INTO loans
       (id, tenantId, customerId, accountId, principalKobo, interestRateBps, termDays,
        totalRepayableKobo, amountRepaidKobo, status, creditScoreAtOrigination, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?)`
  )
    .bind(id, tenantId, customerId, accountId, principalKobo, interestRateBps, termDays, totalRepayableKobo, creditScoreRow?.score ?? null, now, now)
    .run();

  return c.json({ success: true, id, principalKobo, totalRepayableKobo, status: 'pending' }, 201);
});

lendingRouter.get('/loans', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const query = user.role === 'customer'
    ? 'SELECT * FROM loans WHERE tenantId = ? AND customerId = ? ORDER BY createdAt DESC'
    : 'SELECT * FROM loans WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 200';
  const params = user.role === 'customer' ? [tenantId, user.userId] : [tenantId];

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

lendingRouter.get('/loans/:id', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM loans WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId)
    .first() as Record<string, unknown> | null;

  if (!row) return c.json({ error: 'Loan not found' }, 404);
  if (user.role === 'customer' && row.customerId !== user.userId) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  return c.json({ data: row });
});

lendingRouter.put('/loans/:id/approve', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const result = await c.env.DB.prepare(
    `UPDATE loans SET status = 'approved', updatedAt = ? WHERE id = ? AND tenantId = ? AND status = 'pending'`
  )
    .bind(now, id, tenantId)
    .run();

  if (!result.meta.changes) return c.json({ error: 'Loan not found or not in pending state' }, 404);
  return c.json({ success: true, status: 'approved' });
});

lendingRouter.put('/loans/:id/reject', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ reason: string }>();
  const now = new Date().toISOString();

  const result = await c.env.DB.prepare(
    `UPDATE loans SET status = 'rejected', rejectionReason = ?, updatedAt = ?
     WHERE id = ? AND tenantId = ? AND status = 'pending'`
  )
    .bind(body.reason ?? 'Application rejected', now, id, tenantId)
    .run();

  if (!result.meta.changes) return c.json({ error: 'Loan not found or not in pending state' }, 404);
  return c.json({ success: true, status: 'rejected' });
});

lendingRouter.put('/loans/:id/disburse', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const loan = await c.env.DB.prepare('SELECT * FROM loans WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId)
    .first() as Record<string, unknown> | null;

  if (!loan) return c.json({ error: 'Loan not found' }, 404);
  if (loan.status !== 'approved') return c.json({ error: 'Loan must be approved before disbursement' }, 400);

  const dueAt = new Date(Date.now() + Number(loan.termDays) * 24 * 60 * 60 * 1000).toISOString();
  const reference = `LOAN-DISB-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE loans SET status = 'disbursed', disbursedAt = ?, dueAt = ?, updatedAt = ? WHERE id = ?`
    ).bind(now, dueAt, now, id),
    c.env.DB.prepare(
      `UPDATE bankAccounts SET balanceKobo = balanceKobo + ?, updatedAt = ? WHERE id = ? AND tenantId = ?`
    ).bind(loan.principalKobo, now, loan.accountId, tenantId),
    c.env.DB.prepare(
      `INSERT INTO transactions (id, tenantId, accountId, type, amountKobo, reference, status, description, createdAt)
       VALUES (?, ?, ?, 'deposit', ?, ?, 'success', ?, ?)`
    ).bind(crypto.randomUUID(), tenantId, loan.accountId, loan.principalKobo, reference, `Loan disbursement — ${id}`, now),
  ]);

  return c.json({ success: true, status: 'disbursed', dueAt, principalKobo: loan.principalKobo });
});

lendingRouter.post('/loans/:id/repay', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ amountKobo: number; accountId: string }>();

  if (!Number.isInteger(body.amountKobo) || body.amountKobo <= 0) {
    return c.json({ error: 'amountKobo must be a positive integer' }, 400);
  }

  const loan = await c.env.DB.prepare('SELECT * FROM loans WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId)
    .first() as Record<string, unknown> | null;

  if (!loan) return c.json({ error: 'Loan not found' }, 404);
  if (!['disbursed', 'active'].includes(loan.status as string)) {
    return c.json({ error: 'Loan is not in a repayable state' }, 400);
  }
  if (user.role === 'customer' && loan.customerId !== user.userId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const account = await c.env.DB.prepare(
    'SELECT balanceKobo FROM bankAccounts WHERE id = ? AND tenantId = ?'
  )
    .bind(body.accountId, tenantId)
    .first() as Record<string, number> | null;

  if (!account) return c.json({ error: 'Account not found' }, 404);
  if (account.balanceKobo < body.amountKobo) {
    return c.json({ error: 'Insufficient balance for repayment' }, 422);
  }

  const newRepaid = Number(loan.amountRepaidKobo) + body.amountKobo;
  const remaining = Number(loan.totalRepayableKobo) - newRepaid;
  const newStatus: LoanStatus = remaining <= 0 ? 'settled' : 'active';
  const reference = `LOAN-REPAY-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE loans SET amountRepaidKobo = ?, status = ?, updatedAt = ? WHERE id = ? AND tenantId = ?`
    ).bind(newRepaid, newStatus, now, id, tenantId),
    c.env.DB.prepare(
      `INSERT INTO loanRepayments (id, tenantId, loanId, amountKobo, reference, status, paidAt)
       VALUES (?, ?, ?, ?, ?, 'success', ?)`
    ).bind(crypto.randomUUID(), tenantId, id, body.amountKobo, reference, now),
    c.env.DB.prepare(
      `UPDATE bankAccounts SET balanceKobo = balanceKobo - ?, updatedAt = ? WHERE id = ? AND tenantId = ?`
    ).bind(body.amountKobo, now, body.accountId, tenantId),
    c.env.DB.prepare(
      `INSERT INTO transactions (id, tenantId, accountId, type, amountKobo, reference, status, description, createdAt)
       VALUES (?, ?, ?, 'fee', ?, ?, 'success', ?, ?)`
    ).bind(crypto.randomUUID(), tenantId, body.accountId, body.amountKobo, reference, `Loan repayment — ${id}`, now),
  ]);

  return c.json({ success: true, reference, amountPaid: body.amountKobo, remaining: Math.max(0, remaining), status: newStatus });
});

// ─── Debt Collection Automation (#19) ────────────────────────────────────────

lendingRouter.post('/debt-collection/:loanId/remind', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const loanId = c.req.param('loanId');
  const body = await c.req.json<{ type: 'sms_reminder' | 'email_reminder'; message?: string }>();

  const loan = await c.env.DB.prepare('SELECT * FROM loans WHERE id = ? AND tenantId = ?')
    .bind(loanId, tenantId)
    .first() as Record<string, unknown> | null;

  if (!loan) return c.json({ error: 'Loan not found' }, 404);

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const message = body.message ?? `Your loan of ₦${(Number(loan.totalRepayableKobo) / 100).toLocaleString()} is due on ${loan.dueAt?.toString().slice(0, 10)}. Outstanding: ₦${((Number(loan.totalRepayableKobo) - Number(loan.amountRepaidKobo)) / 100).toLocaleString()}.`;

  let deliveryStatus = 'sent';

  if (body.type === 'sms_reminder' && c.env.TERMII_API_KEY) {
    try {
      const resp = await fetch('https://api.ng.termii.com/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: loan.customerId,
          from: 'WebWaka',
          sms: message,
          type: 'plain',
          api_key: c.env.TERMII_API_KEY,
          channel: 'generic',
        }),
      });
      if (!resp.ok) deliveryStatus = 'failed';
    } catch {
      deliveryStatus = 'failed';
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO debtCollectionEvents (id, tenantId, loanId, customerId, type, status, message, scheduledAt, executedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, tenantId, loanId, loan.customerId as string, body.type, deliveryStatus, message, now, now, now)
    .run();

  return c.json({ success: true, id, status: deliveryStatus });
});

lendingRouter.post('/debt-collection/:loanId/auto-debit', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const loanId = c.req.param('loanId');
  const body = await c.req.json<{ accountId: string; amountKobo: number }>();

  const loan = await c.env.DB.prepare('SELECT * FROM loans WHERE id = ? AND tenantId = ?')
    .bind(loanId, tenantId)
    .first() as Record<string, unknown> | null;

  if (!loan) return c.json({ error: 'Loan not found' }, 404);

  const account = await c.env.DB.prepare(
    'SELECT balanceKobo FROM bankAccounts WHERE id = ? AND tenantId = ?'
  )
    .bind(body.accountId, tenantId)
    .first() as Record<string, number> | null;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  if (!account || account.balanceKobo < body.amountKobo) {
    await c.env.DB.prepare(
      `INSERT INTO debtCollectionEvents (id, tenantId, loanId, customerId, type, status, amountKobo, scheduledAt, executedAt, createdAt)
       VALUES (?, ?, ?, ?, 'auto_debit_attempt', 'debit_failed', ?, ?, ?, ?)`
    )
      .bind(id, tenantId, loanId, loan.customerId as string, body.amountKobo, now, now, now)
      .run();
    return c.json({ success: false, reason: 'Insufficient balance', status: 'debit_failed' }, 422);
  }

  const reference = `AUTO-DEBIT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newRepaid = Number(loan.amountRepaidKobo) + body.amountKobo;
  const remaining = Number(loan.totalRepayableKobo) - newRepaid;
  const newStatus = remaining <= 0 ? 'settled' : 'active';

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE loans SET amountRepaidKobo = ?, status = ?, updatedAt = ? WHERE id = ? AND tenantId = ?`
    ).bind(newRepaid, newStatus, now, loanId, tenantId),
    c.env.DB.prepare(
      `UPDATE bankAccounts SET balanceKobo = balanceKobo - ?, updatedAt = ? WHERE id = ? AND tenantId = ?`
    ).bind(body.amountKobo, now, body.accountId, tenantId),
    c.env.DB.prepare(
      `INSERT INTO transactions (id, tenantId, accountId, type, amountKobo, reference, status, description, createdAt)
       VALUES (?, ?, ?, 'fee', ?, ?, 'success', ?, ?)`
    ).bind(crypto.randomUUID(), tenantId, body.accountId, body.amountKobo, reference, `Auto-debit loan repayment — ${loanId}`, now),
    c.env.DB.prepare(
      `INSERT INTO debtCollectionEvents (id, tenantId, loanId, customerId, type, status, amountKobo, scheduledAt, executedAt, createdAt)
       VALUES (?, ?, ?, ?, 'auto_debit_attempt', 'deducted', ?, ?, ?, ?)`
    ).bind(id, tenantId, loanId, loan.customerId as string, body.amountKobo, now, now, now),
    c.env.DB.prepare(
      `INSERT INTO loanRepayments (id, tenantId, loanId, amountKobo, reference, status, paidAt)
       VALUES (?, ?, ?, ?, ?, 'success', ?)`
    ).bind(crypto.randomUUID(), tenantId, loanId, body.amountKobo, reference, now),
  ]);

  return c.json({ success: true, reference, amountDebited: body.amountKobo, remaining: Math.max(0, remaining), loanStatus: newStatus });
});

lendingRouter.get('/debt-collection/:loanId', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const loanId = c.req.param('loanId');

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM debtCollectionEvents WHERE tenantId = ? AND loanId = ? ORDER BY createdAt DESC'
  )
    .bind(tenantId, loanId)
    .all();

  return c.json({ data: results });
});

// ─── Rule-based credit scoring fallback ──────────────────────────────────────

function computeRuleBasedScore(txRows: Record<string, unknown>[]): { score: number; grade: CreditGrade; rationale: string } {
  const deposits = txRows.filter((r) => r.type === 'deposit' && r.status === 'success');
  const withdrawals = txRows.filter((r) => r.type === 'withdrawal' && r.status === 'success');
  const failed = txRows.filter((r) => r.status === 'failed');
  const totalDepositsKobo = deposits.reduce((s, r) => s + Number(r.amountKobo), 0);
  const totalWithdrawalsKobo = withdrawals.reduce((s, r) => s + Number(r.amountKobo), 0);

  let score = 500;
  if (txRows.length >= 20) score += 50;
  if (txRows.length >= 50) score += 50;
  if (totalDepositsKobo > totalWithdrawalsKobo) score += 100;
  if (totalDepositsKobo > 500_000_00) score += 100;
  if (failed.length === 0) score += 100;
  else if (failed.length > 5) score -= 150;
  if (withdrawals.length > deposits.length * 2) score -= 100;

  score = Math.max(0, Math.min(1000, score));
  const grade: CreditGrade = score >= 800 ? 'A' : score >= 600 ? 'B' : score >= 400 ? 'C' : score >= 200 ? 'D' : 'E';
  const rationale = `Rule-based analysis: ${txRows.length} transactions in 90 days, ₦${(totalDepositsKobo / 100).toLocaleString()} deposits, ${failed.length} failed transactions.`;

  return { score, grade, rationale };
}
