/**
 * Open Banking API Module (#20)
 *
 * Allows third-party developers to register apps and obtain API keys to build
 * on top of tenant wallets within the WebWaka platform.
 *
 * Supported scopes:
 *   accounts.read       — Read bank account details
 *   fint_transactions.read   — Read transaction history
 *   balances.read       — Read account balances
 *   payments.initiate   — Initiate outbound payments
 *
 * Endpoints:
 *   POST   /api/open-banking/apps              — Register a new app
 *   GET    /api/open-banking/apps              — List apps
 *   GET    /api/open-banking/apps/:id          — Get single app
 *   DELETE /api/open-banking/apps/:id          — Revoke app
 *   POST   /api/open-banking/apps/:id/keys     — Generate API key for app
 *   DELETE /api/open-banking/apps/:appId/keys/:keyId — Revoke API key
 *   GET    /api/open-banking/apps/:id/keys     — List API keys (prefixes only)
 *
 *   GET    /api/open-banking/data/accounts     — Third-party: read accounts (API key auth)
 *   GET    /api/open-banking/data/fint_transactions — Third-party: read fint_transactions (API key auth)
 *   GET    /api/open-banking/data/balances     — Third-party: read balances (API key auth)
 */

import { Hono, type Context } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, OpenBankingScope } from '../../core/types';
import { publishEvent } from '../../core/events';
import {
  exchangeToken,
  getAccountDetails,
  getAccountBalance,
  getTransactions,
  type MonoConfig,
} from '../../core/mono';

export const openBankingRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

const VALID_SCOPES: OpenBankingScope[] = ['accounts.read', 'fint_transactions.read', 'balances.read', 'payments.initiate'];

openBankingRouter.post('/apps', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    appName: string;
    description?: string;
    webhookUrl?: string;
    scopes: OpenBankingScope[];
  }>();

  if (!body.appName || !body.scopes?.length) {
    return c.json({ error: 'appName and scopes are required' }, 400);
  }
  const invalidScopes = body.scopes.filter((s) => !VALID_SCOPES.includes(s));
  if (invalidScopes.length > 0) {
    return c.json({ error: `Invalid scopes: ${invalidScopes.join(', ')}. Valid: ${VALID_SCOPES.join(', ')}` }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO fint_openBankingApps (id, tenantId, appName, description, webhookUrl, status, scopes, createdBy, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  )
    .bind(id, tenantId, body.appName, body.description ?? null, body.webhookUrl ?? null, JSON.stringify(body.scopes), user.userId, now, now)
    .run();

  return c.json({ success: true, id, appName: body.appName, scopes: body.scopes }, 201);
});

openBankingRouter.get('/apps', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const { results } = await c.env.DB.prepare(
    'SELECT id, tenantId, appName, description, webhookUrl, status, scopes, createdBy, createdAt FROM fint_openBankingApps WHERE tenantId = ? ORDER BY createdAt DESC'
  )
    .bind(tenantId)
    .all();
  return c.json({ data: results });
});

openBankingRouter.get('/apps/:id', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    'SELECT id, tenantId, appName, description, webhookUrl, status, scopes, createdBy, createdAt FROM fint_openBankingApps WHERE id = ? AND tenantId = ?'
  )
    .bind(id, tenantId).first();
  if (!row) return c.json({ error: 'App not found' }, 404);
  return c.json({ data: row });
});

openBankingRouter.delete('/apps/:id', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const result = await c.env.DB.prepare(
    `UPDATE fint_openBankingApps SET status = 'revoked', updatedAt = ? WHERE id = ? AND tenantId = ?`
  )
    .bind(now, id, tenantId)
    .run();

  if (!result.meta.changes) return c.json({ error: 'App not found' }, 404);

  await c.env.DB.prepare(
    `UPDATE fint_openBankingApiKeys SET status = 'revoked' WHERE appId = ? AND tenantId = ?`
  )
    .bind(id, tenantId)
    .run();

  return c.json({ success: true });
});

openBankingRouter.post('/apps/:id/keys', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const appId = c.req.param('id');
  const body = await c.req.json<{ expiresAt?: string }>().catch(() => ({}));

  const app = await c.env.DB.prepare(`SELECT id FROM fint_openBankingApps WHERE id = ? AND tenantId = ? AND status = 'active'`)
    .bind(appId, tenantId).first();
  if (!app) return c.json({ error: 'Active app not found' }, 404);

  const rawKey = `wk_ob_${crypto.randomUUID().replace(/-/g, '')}`;
  const keyPrefix = rawKey.slice(0, 16);
  const keyHash = await hashKey(rawKey);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO fint_openBankingApiKeys (id, tenantId, appId, keyHash, keyPrefix, status, expiresAt, createdAt)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
  )
    .bind(id, tenantId, appId, keyHash, keyPrefix, (body as Record<string, string>).expiresAt ?? null, now)
    .run();

  return c.json({
    success: true,
    id,
    apiKey: rawKey,
    keyPrefix,
    warning: 'Store this API key securely — it will not be shown again.',
  }, 201);
});

openBankingRouter.get('/apps/:id/keys', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const appId = c.req.param('id');

  const { results } = await c.env.DB.prepare(
    'SELECT id, appId, keyPrefix, status, lastUsedAt, expiresAt, createdAt FROM fint_openBankingApiKeys WHERE appId = ? AND tenantId = ?'
  )
    .bind(appId, tenantId)
    .all();
  return c.json({ data: results });
});

openBankingRouter.delete('/apps/:appId/keys/:keyId', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const keyId = c.req.param('keyId');
  const now = new Date().toISOString();

  const result = await c.env.DB.prepare(
    `UPDATE fint_openBankingApiKeys SET status = 'revoked' WHERE id = ? AND tenantId = ?`
  )
    .bind(keyId, tenantId)
    .run();

  if (!result.meta.changes) return c.json({ error: 'API key not found' }, 404);
  return c.json({ success: true });
});

// ─── Third-party data access endpoints (API key auth) ─────────────────────────

openBankingRouter.get('/data/accounts', async (c) => {
  const { tenantId, scopes } = await resolveApiKey(c);
  if (!tenantId) return c.json({ error: 'Invalid or missing API key' }, 401);
  if (!scopes.includes('accounts.read')) return c.json({ error: 'Insufficient scope. Requires: accounts.read' }, 403);

  const customerId = c.req.query('customerId');
  if (!customerId) return c.json({ error: 'customerId query parameter is required' }, 400);

  const { results } = await c.env.DB.prepare(
    'SELECT id, accountNumber, accountType, status, createdAt FROM fint_bankAccounts WHERE tenantId = ? AND customerId = ? AND status = ?'
  )
    .bind(tenantId, customerId, 'active')
    .all();
  return c.json({ data: results });
});

openBankingRouter.get('/data/balances', async (c) => {
  const { tenantId, scopes } = await resolveApiKey(c);
  if (!tenantId) return c.json({ error: 'Invalid or missing API key' }, 401);
  if (!scopes.includes('balances.read')) return c.json({ error: 'Insufficient scope. Requires: balances.read' }, 403);

  const customerId = c.req.query('customerId');
  if (!customerId) return c.json({ error: 'customerId query parameter is required' }, 400);

  const { results } = await c.env.DB.prepare(
    'SELECT id, accountNumber, accountType, balanceKobo, status FROM fint_bankAccounts WHERE tenantId = ? AND customerId = ? AND status = ?'
  )
    .bind(tenantId, customerId, 'active')
    .all();
  return c.json({ data: results });
});

openBankingRouter.get('/data/fint_transactions', async (c) => {
  const { tenantId, scopes } = await resolveApiKey(c);
  if (!tenantId) return c.json({ error: 'Invalid or missing API key' }, 401);
  if (!scopes.includes('fint_transactions.read')) return c.json({ error: 'Insufficient scope. Requires: fint_transactions.read' }, 403);

  const customerId = c.req.query('customerId');
  const accountId = c.req.query('accountId');
  if (!customerId || !accountId) return c.json({ error: 'customerId and accountId query parameters are required' }, 400);

  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.type, t.amountKobo, t.status, t.description, t.createdAt
     FROM fint_transactions t
     JOIN fint_bankAccounts b ON t.accountId = b.id
     WHERE t.tenantId = ? AND b.customerId = ? AND t.accountId = ?
     ORDER BY t.createdAt DESC LIMIT 100`
  )
    .bind(tenantId, customerId, accountId)
    .all();
  return c.json({ data: results });
});

async function resolveApiKey(c: Context<{ Bindings: Bindings; Variables: AppVariables }>): Promise<{ tenantId: string | null; scopes: OpenBankingScope[] }> {
  const authHeader = c.req.header('Authorization') ?? '';
  const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : c.req.header('X-API-Key') ?? '';

  if (!apiKey) return { tenantId: null, scopes: [] };

  const keyHash = await hashKey(apiKey);

  const keyRow = await c.env.DB.prepare(
    `SELECT k.id, k.tenantId, k.appId, k.status, k.expiresAt, a.scopes, a.status as appStatus
     FROM fint_openBankingApiKeys k
     JOIN fint_openBankingApps a ON k.appId = a.id
     WHERE k.keyHash = ?`
  )
    .bind(keyHash)
    .first() as Record<string, unknown> | null;

  if (!keyRow || keyRow.status !== 'active' || keyRow.appStatus !== 'active') {
    return { tenantId: null, scopes: [] };
  }
  if (keyRow.expiresAt && new Date(keyRow.expiresAt as string) < new Date()) {
    return { tenantId: null, scopes: [] };
  }

  await c.env.DB.prepare('UPDATE fint_openBankingApiKeys SET lastUsedAt = ? WHERE id = ?')
    .bind(new Date().toISOString(), keyRow.id as string)
    .run();

  const scopes = JSON.parse(keyRow.scopes as string) as OpenBankingScope[];
  return { tenantId: keyRow.tenantId as string, scopes };
}

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── FT-009: Mono Open Banking Integration ────────────────────────────────────
//
// Mono enables Nigerian banks' account linking via OAuth consent.
// Flow:
//   1. POST /api/open-banking/mono/consent       → redirect to Mono Connect widget
//   2. POST /api/open-banking/mono/exchange       → exchange mono code → accountId, store account
//   3. GET  /api/open-banking/mono/accounts       → list linked external accounts
//   4. GET  /api/open-banking/mono/accounts/:id/balance       → current balance
//   5. GET  /api/open-banking/mono/accounts/:id/fint_transactions  → transaction history
//   6. DELETE /api/open-banking/mono/accounts/:id             → unlink account

function monoCredsFromEnv(env: Bindings): MonoConfig {
  if (!env.MONO_SECRET_KEY) throw new Error('MONO_SECRET_KEY is not configured');
  return { secretKey: env.MONO_SECRET_KEY };
}

// POST /api/open-banking/mono/consent — Return a Mono Connect link
openBankingRouter.post('/mono/consent', requireRole(['admin', 'teller', 'customer']), async (c) => {
  if (!c.env.MONO_SECRET_KEY) {
    return c.json({ error: 'Mono open banking is not configured for this environment' }, 503);
  }

  const body = await c.req.json<{ customerId: string; redirectUrl?: string }>();
  if (!body.customerId) return c.json({ error: 'customerId is required' }, 400);

  const user = c.get('user');
  const tenantId = user.tenantId;
  const now = new Date().toISOString();
  const consentId = crypto.randomUUID();

  // Store pending consent record
  await c.env.DB.prepare(
    `INSERT INTO fint_monoConsents (id, tenantId, customerId, status, createdAt, updatedAt)
     VALUES (?, ?, ?, 'pending', ?, ?)`
  )
    .bind(consentId, tenantId, body.customerId, now, now)
    .run();

  // Mono Connect URL — customer opens this in a webview or browser
  const connectUrl = `https://connect.mono.co/?key=${c.env.MONO_SECRET_KEY}&scope=accounts&session_id=${consentId}`;

  return c.json({ consentId, connectUrl, message: 'Open the connectUrl in a browser or webview to link a bank account.' });
});

// POST /api/open-banking/mono/exchange — Exchange Mono code for account
openBankingRouter.post('/mono/exchange', requireRole(['admin', 'teller', 'customer']), async (c) => {
  if (!c.env.MONO_SECRET_KEY) {
    return c.json({ error: 'Mono open banking is not configured for this environment' }, 503);
  }

  const body = await c.req.json<{ customerId: string; code: string; consentId?: string }>();
  if (!body.customerId || !body.code) {
    return c.json({ error: 'customerId and code are required' }, 400);
  }

  const user = c.get('user');
  const tenantId = user.tenantId;
  const creds = monoCredsFromEnv(c.env);

  // Exchange code for Mono accountId
  const tokenResult = await exchangeToken(creds, body.code);
  const monoAccountId = tokenResult.id;

  // Fetch account details (getAccountDetails returns the account directly)
  const account = await getAccountDetails(creds, monoAccountId);

  const now = new Date().toISOString();
  const externalAccountId = crypto.randomUUID();

  // Store linked external account
  await c.env.DB.prepare(
    `INSERT INTO fint_externalBankAccounts
       (id, tenantId, customerId, provider, providerAccountId, bankName, accountName,
        accountNumber, currency, balanceMinorUnits, lastSyncAt, status, createdAt, updatedAt)
     VALUES (?, ?, ?, 'mono', ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  )
    .bind(
      externalAccountId,
      tenantId,
      body.customerId,
      monoAccountId,
      account.institution.name,
      account.name,
      account.accountNumber,
      account.currency,
      account.balance,
      now,
      now,
      now,
    )
    .run();

  // Update consent to active if consentId was provided
  if (body.consentId) {
    await c.env.DB.prepare(
      `UPDATE fint_monoConsents SET monoAccountId = ?, status = 'active', updatedAt = ? WHERE id = ? AND tenantId = ?`
    )
      .bind(monoAccountId, now, body.consentId, tenantId)
      .run();
  }

  // FT-005: Emit open_banking.account_linked event
  await publishEvent(c.env.EVENT_BUS_URL, c.env.EVENT_BUS_SECRET, {
    event: 'open_banking.account_linked',
    consentId: body.consentId ?? externalAccountId,
    externalAccountId,
    tenantId,
    customerId: body.customerId,
    bankName: account.institution.name,
    currency: account.currency,
    occurredAt: now,
  });

  return c.json({
    externalAccountId,
    bankName: account.institution.name,
    accountName: account.name,
    accountNumber: account.accountNumber,
    currency: account.currency,
    balanceMinorUnits: account.balance,
  }, 201);
});

// GET /api/open-banking/mono/accounts — List linked external accounts
openBankingRouter.get('/mono/accounts', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const customerId = c.req.query('customerId');

  if (user.role === 'customer' && user.userId !== customerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  let query = `SELECT * FROM fint_externalBankAccounts WHERE tenantId = ? AND provider = 'mono' AND status = 'active'`;
  const params: string[] = [tenantId];
  if (customerId) {
    query += ' AND customerId = ?';
    params.push(customerId);
  }
  query += ' ORDER BY createdAt DESC';

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

// GET /api/open-banking/mono/accounts/:id/balance — Live balance from Mono
openBankingRouter.get('/mono/accounts/:id/balance', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  if (!c.env.MONO_SECRET_KEY) {
    return c.json({ error: 'Mono open banking is not configured' }, 503);
  }

  const record = await c.env.DB.prepare(
    `SELECT * FROM fint_externalBankAccounts WHERE id = ? AND tenantId = ? AND provider = 'mono'`
  )
    .bind(id, tenantId)
    .first() as Record<string, unknown> | null;

  if (!record) return c.json({ error: 'External account not found' }, 404);
  if (user.role === 'customer' && record.customerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);

  const creds = monoCredsFromEnv(c.env);
  const balanceResult = await getAccountBalance(creds, record.providerAccountId as string);
  const now = new Date().toISOString();

  // Update cached balance
  await c.env.DB.prepare(
    `UPDATE fint_externalBankAccounts SET balanceMinorUnits = ?, lastSyncAt = ?, updatedAt = ? WHERE id = ?`
  )
    .bind(balanceResult.balance, now, now, id)
    .run();

  return c.json({
    externalAccountId: id,
    currency: record.currency,
    balanceMinorUnits: balanceResult.balance,
    syncedAt: now,
  });
});

// GET /api/open-banking/mono/accounts/:id/fint_transactions — Transaction history
openBankingRouter.get('/mono/accounts/:id/fint_transactions', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const start = c.req.query('start');
  const end = c.req.query('end');

  if (!c.env.MONO_SECRET_KEY) {
    return c.json({ error: 'Mono open banking is not configured' }, 503);
  }

  const record = await c.env.DB.prepare(
    `SELECT * FROM fint_externalBankAccounts WHERE id = ? AND tenantId = ? AND provider = 'mono'`
  )
    .bind(id, tenantId)
    .first() as Record<string, unknown> | null;

  if (!record) return c.json({ error: 'External account not found' }, 404);
  if (user.role === 'customer' && record.customerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);

  const creds = monoCredsFromEnv(c.env);
  const txResult = await getTransactions(creds, record.providerAccountId as string, { start, end });

  return c.json({ data: txResult.fint_transactions, total: txResult.total });
});

// DELETE /api/open-banking/mono/accounts/:id — Unlink external account
openBankingRouter.delete('/mono/accounts/:id', requireRole(['admin', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const record = await c.env.DB.prepare(
    `SELECT * FROM fint_externalBankAccounts WHERE id = ? AND tenantId = ? AND provider = 'mono'`
  )
    .bind(id, tenantId)
    .first() as Record<string, unknown> | null;

  if (!record) return c.json({ error: 'External account not found' }, 404);
  if (user.role === 'customer' && record.customerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE fint_externalBankAccounts SET status = 'unlinked', updatedAt = ? WHERE id = ? AND tenantId = ?`
  )
    .bind(now, id, tenantId)
    .run();

  return c.json({ success: true, message: 'External bank account unlinked.' });
});
