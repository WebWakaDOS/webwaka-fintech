/**
 * Open Banking API Module (#20)
 *
 * Allows third-party developers to register apps and obtain API keys to build
 * on top of tenant wallets within the WebWaka platform.
 *
 * Supported scopes:
 *   accounts.read       — Read bank account details
 *   transactions.read   — Read transaction history
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
 *   GET    /api/open-banking/data/transactions — Third-party: read transactions (API key auth)
 *   GET    /api/open-banking/data/balances     — Third-party: read balances (API key auth)
 */

import { Hono, type Context } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, OpenBankingScope } from '../../core/types';

export const openBankingRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

const VALID_SCOPES: OpenBankingScope[] = ['accounts.read', 'transactions.read', 'balances.read', 'payments.initiate'];

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
    `INSERT INTO openBankingApps (id, tenantId, appName, description, webhookUrl, status, scopes, createdBy, createdAt, updatedAt)
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
    'SELECT id, tenantId, appName, description, webhookUrl, status, scopes, createdBy, createdAt FROM openBankingApps WHERE tenantId = ? ORDER BY createdAt DESC'
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
    'SELECT id, tenantId, appName, description, webhookUrl, status, scopes, createdBy, createdAt FROM openBankingApps WHERE id = ? AND tenantId = ?'
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
    `UPDATE openBankingApps SET status = 'revoked', updatedAt = ? WHERE id = ? AND tenantId = ?`
  )
    .bind(now, id, tenantId)
    .run();

  if (!result.meta.changes) return c.json({ error: 'App not found' }, 404);

  await c.env.DB.prepare(
    `UPDATE openBankingApiKeys SET status = 'revoked' WHERE appId = ? AND tenantId = ?`
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

  const app = await c.env.DB.prepare(`SELECT id FROM openBankingApps WHERE id = ? AND tenantId = ? AND status = 'active'`)
    .bind(appId, tenantId).first();
  if (!app) return c.json({ error: 'Active app not found' }, 404);

  const rawKey = `wk_ob_${crypto.randomUUID().replace(/-/g, '')}`;
  const keyPrefix = rawKey.slice(0, 16);
  const keyHash = await hashKey(rawKey);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO openBankingApiKeys (id, tenantId, appId, keyHash, keyPrefix, status, expiresAt, createdAt)
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
    'SELECT id, appId, keyPrefix, status, lastUsedAt, expiresAt, createdAt FROM openBankingApiKeys WHERE appId = ? AND tenantId = ?'
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
    `UPDATE openBankingApiKeys SET status = 'revoked' WHERE id = ? AND tenantId = ?`
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
    'SELECT id, accountNumber, accountType, status, createdAt FROM bankAccounts WHERE tenantId = ? AND customerId = ? AND status = ?'
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
    'SELECT id, accountNumber, accountType, balanceKobo, status FROM bankAccounts WHERE tenantId = ? AND customerId = ? AND status = ?'
  )
    .bind(tenantId, customerId, 'active')
    .all();
  return c.json({ data: results });
});

openBankingRouter.get('/data/transactions', async (c) => {
  const { tenantId, scopes } = await resolveApiKey(c);
  if (!tenantId) return c.json({ error: 'Invalid or missing API key' }, 401);
  if (!scopes.includes('transactions.read')) return c.json({ error: 'Insufficient scope. Requires: transactions.read' }, 403);

  const customerId = c.req.query('customerId');
  const accountId = c.req.query('accountId');
  if (!customerId || !accountId) return c.json({ error: 'customerId and accountId query parameters are required' }, 400);

  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.type, t.amountKobo, t.status, t.description, t.createdAt
     FROM transactions t
     JOIN bankAccounts b ON t.accountId = b.id
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
     FROM openBankingApiKeys k
     JOIN openBankingApps a ON k.appId = a.id
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

  await c.env.DB.prepare('UPDATE openBankingApiKeys SET lastUsedAt = ? WHERE id = ?')
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
