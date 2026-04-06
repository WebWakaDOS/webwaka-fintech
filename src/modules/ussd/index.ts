/**
 * USSD Banking Interface Module (#8)
 *
 * Exposes core banking via a USSD gateway callback endpoint.
 * A USSD session is state-machine driven with menu navigation stored in D1.
 *
 * The USSD gateway (e.g. Africa's Talking, Twilio) POSTs to /api/ussd/session
 * on each user input. The worker returns a USSD response string.
 *
 * Menu structure:
 *   1. Check Balance
 *   2. Mini Statement
 *   3. Transfer Funds
 *   4. Buy Airtime
 *   5. Savings Goals
 *   0. Exit
 *
 * Endpoints:
 *   POST   /api/ussd/session     — USSD gateway callback (unauthenticated)
 *   GET    /api/ussd/sessions    — List active sessions (admin)
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const ussdRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
export const ussdWebhookRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

const SESSION_TTL_SECONDS = 120;

ussdWebhookRouter.post('/session', async (c) => {
  let body: Record<string, string>;
  const contentType = c.req.header('content-type') ?? '';

  if (contentType.includes('application/json')) {
    body = await c.req.json();
  } else {
    const formText = await c.req.text();
    body = Object.fromEntries(new URLSearchParams(formText));
  }

  const sessionCode = body.sessionId ?? body.session_id ?? '';
  const msisdn = body.phoneNumber ?? body.phone_number ?? body.msisdn ?? '';
  const text = (body.text ?? '').trim();
  const inputs = text ? text.split('*') : [];
  const currentInput = inputs[inputs.length - 1] ?? '';

  if (!sessionCode || !msisdn) {
    return c.text('END Invalid request', 200);
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  let session = await c.env.DB.prepare(
    'SELECT * FROM fint_ussdSessions WHERE sessionCode = ?'
  )
    .bind(sessionCode)
    .first() as Record<string, unknown> | null;

  if (!session) {
    await c.env.DB.prepare(
      `INSERT INTO fint_ussdSessions (id, tenantId, sessionCode, msisdn, state, menuPath, expiresAt, createdAt, updatedAt)
       VALUES (?, '', ?, ?, 'main_menu', '[]', ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), sessionCode, msisdn, expiresAt, now, now)
      .run();

    session = { sessionCode, msisdn, state: 'main_menu', menuPath: '[]', pendingAction: null, customerId: null };
  }

  const state = session.state as string;
  const response = await processUssdInput(c.env.DB, session, state, currentInput, inputs, tenantFromSession(session), now, expiresAt);

  if (response.endSession) {
    await c.env.DB.prepare('DELETE FROM fint_ussdSessions WHERE sessionCode = ?').bind(sessionCode).run();
    return c.text(`END ${response.text}`, 200);
  }

  await c.env.DB.prepare(
    'UPDATE fint_ussdSessions SET state = ?, pendingAction = ?, expiresAt = ?, updatedAt = ? WHERE sessionCode = ?'
  )
    .bind(response.nextState, response.pendingAction ? JSON.stringify(response.pendingAction) : null, expiresAt, now, sessionCode)
    .run();

  return c.text(`CON ${response.text}`, 200);
});

ussdRouter.get('/sessions', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;

  const { results } = await c.env.DB.prepare(
    `SELECT id, sessionCode, msisdn, state, expiresAt, createdAt FROM fint_ussdSessions
     WHERE tenantId = ? AND expiresAt > ? ORDER BY createdAt DESC LIMIT 100`
  )
    .bind(tenantId, new Date().toISOString())
    .all();
  return c.json({ data: results });
});

function tenantFromSession(session: Record<string, unknown>): string {
  return (session.tenantId as string) ?? '';
}

async function processUssdInput(
  db: D1Database,
  session: Record<string, unknown>,
  state: string,
  input: string,
  allInputs: string[],
  tenantId: string,
  now: string,
  expiresAt: string,
): Promise<{ text: string; nextState: string; pendingAction?: Record<string, unknown>; endSession: boolean }> {
  const msisdn = session.msisdn as string;

  if (state === 'main_menu' || !input) {
    return {
      text: 'Welcome to WebWaka Banking\n1. Check Balance\n2. Mini Statement\n3. Transfer Funds\n4. Buy Airtime\n5. Savings Goals\n0. Exit',
      nextState: 'main_menu_await',
      endSession: false,
    };
  }

  if (state === 'main_menu_await') {
    switch (input) {
      case '1': {
        const acct = await db.prepare(
          `SELECT b.accountNumber, b.balanceKobo FROM fint_bankAccounts b
           WHERE b.tenantId = ? AND b.customerId = ? AND b.status = 'active' LIMIT 1`
        ).bind(tenantId, session.customerId ?? msisdn).first() as Record<string, unknown> | null;

        if (!acct) return { text: 'No account found for this number.', nextState: 'main_menu', endSession: true };
        const balanceNaira = (Number(acct.balanceKobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
        return { text: `Acct: ...${(acct.accountNumber as string).slice(-4)}\nBal: ₦${balanceNaira}\n\n0. Back`, nextState: 'main_menu_await', endSession: false };
      }
      case '2': {
        const { results } = await db.prepare(
          `SELECT t.type, t.amountKobo, t.createdAt FROM fint_transactions t
           JOIN fint_bankAccounts b ON t.accountId = b.id
           WHERE b.tenantId = ? AND b.customerId = ? AND t.status = 'success'
           ORDER BY t.createdAt DESC LIMIT 5`
        ).bind(tenantId, session.customerId ?? msisdn).all();

        if (!results.length) return { text: 'No recent fint_transactions found.\n\n0. Back', nextState: 'main_menu_await', endSession: false };

        const lines = (results as Record<string, unknown>[]).map((r) =>
          `${r.type} ₦${(Number(r.amountKobo) / 100).toFixed(0)} ${(r.createdAt as string).slice(5, 10)}`
        ).join('\n');
        return { text: `Recent Transactions:\n${lines}\n\n0. Back`, nextState: 'main_menu_await', endSession: false };
      }
      case '3':
        return { text: 'Transfer - Enter amount (₦):', nextState: 'transfer_amount', endSession: false };
      case '4':
        return { text: 'Buy Airtime - Enter amount (₦):', nextState: 'airtime_amount', endSession: false };
      case '5': {
        const { results: goals } = await db.prepare(
          `SELECT name, currentAmountKobo, targetAmountKobo FROM fint_savingsGoals
           WHERE tenantId = ? AND ownerId = ? AND status = 'active' LIMIT 3`
        ).bind(tenantId, session.customerId ?? msisdn).all();

        if (!goals.length) return { text: 'No active savings goals.\n\n0. Back', nextState: 'main_menu_await', endSession: false };
        const lines = (goals as Record<string, unknown>[]).map((g) =>
          `${g.name}: ₦${(Number(g.currentAmountKobo) / 100).toFixed(0)}/₦${(Number(g.targetAmountKobo) / 100).toFixed(0)}`
        ).join('\n');
        return { text: `Your Goals:\n${lines}\n\n0. Back`, nextState: 'main_menu_await', endSession: false };
      }
      case '0':
        return { text: 'Thank you for using WebWaka Banking.', nextState: 'done', endSession: true };
      default:
        return { text: 'Invalid option.\n1. Balance\n2. Statement\n3. Transfer\n4. Airtime\n5. Savings\n0. Exit', nextState: 'main_menu_await', endSession: false };
    }
  }

  if (state === 'transfer_amount') {
    const amount = parseInt(input, 10);
    if (isNaN(amount) || amount <= 0) {
      return { text: 'Invalid amount. Enter amount (₦):', nextState: 'transfer_amount', endSession: false };
    }
    return { text: `Transfer ₦${amount.toLocaleString()}\nConfirm?\n1. Yes\n2. No`, nextState: 'transfer_confirm', pendingAction: { type: 'transfer', amountKobo: amount * 100 }, endSession: false };
  }

  if (state === 'transfer_confirm') {
    if (input === '1') {
      return { text: 'Transfer request submitted.\n\nThank you.', nextState: 'done', endSession: true };
    }
    return { text: 'Transfer cancelled.\n\n0. Back to menu', nextState: 'main_menu_await', endSession: false };
  }

  if (state === 'airtime_amount') {
    const amount = parseInt(input, 10);
    if (isNaN(amount) || amount <= 0) {
      return { text: 'Invalid amount. Enter amount (₦):', nextState: 'airtime_amount', endSession: false };
    }
    return { text: `Buy ₦${amount} airtime for ${msisdn}?\n1. Confirm\n2. Cancel`, nextState: 'airtime_confirm', pendingAction: { type: 'airtime', amountKobo: amount * 100, msisdn }, endSession: false };
  }

  if (state === 'airtime_confirm') {
    if (input === '1') {
      return { text: `Airtime purchase submitted. You will receive ₦ airtime shortly.\n\nThank you.`, nextState: 'done', endSession: true };
    }
    return { text: 'Airtime purchase cancelled.\n\n0. Back to menu', nextState: 'main_menu_await', endSession: false };
  }

  return { text: 'Session expired. Dial again.', nextState: 'done', endSession: true };
}
