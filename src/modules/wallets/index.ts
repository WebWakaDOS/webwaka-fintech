/**
 * Multi-Currency Wallets Module (#10)
 *
 * Supports NGN, USD, and GBP wallet balances per customer.
 * All amounts stored as minor units (kobo for NGN, cents for USD/GBP).
 *
 * Endpoints:
 *   POST   /api/wallets                     — Create wallet for a currency
 *   GET    /api/wallets                     — List all wallets for customer
 *   GET    /api/wallets/:customerId          — Get wallets for a specific customer
 *   POST   /api/wallets/:id/fund            — Fund wallet (admin: credit)
 *   POST   /api/wallets/:id/debit           — Debit wallet (admin)
 *   POST   /api/wallets/convert             — Convert between currencies (FX)
 *   PUT    /api/wallets/:id/freeze          — Freeze wallet
 *   PUT    /api/wallets/:id/unfreeze        — Unfreeze wallet
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, WalletCurrency } from '../../core/types';

export const walletsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

const SUPPORTED_CURRENCIES: WalletCurrency[] = ['NGN', 'USD', 'GBP'];

walletsRouter.post('/', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{ customerId: string; currency: WalletCurrency }>();

  if (!body.customerId || !body.currency) {
    return c.json({ error: 'customerId and currency are required' }, 400);
  }
  if (!SUPPORTED_CURRENCIES.includes(body.currency)) {
    return c.json({ error: `Unsupported currency. Supported: ${SUPPORTED_CURRENCIES.join(', ')}` }, 400);
  }
  if (user.role === 'customer' && user.userId !== body.customerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await c.env.DB.prepare(
      `INSERT INTO multiCurrencyWallets (id, tenantId, customerId, currency, balanceMinorUnits, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 0, 'active', ?, ?)`
    )
      .bind(id, tenantId, body.customerId, body.currency, now, now)
      .run();
  } catch {
    return c.json({ error: `A ${body.currency} wallet already exists for this customer` }, 409);
  }

  return c.json({ success: true, id, currency: body.currency, balanceMinorUnits: 0 }, 201);
});

walletsRouter.get('/', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const query = user.role === 'customer'
    ? 'SELECT * FROM multiCurrencyWallets WHERE tenantId = ? AND customerId = ? ORDER BY currency'
    : 'SELECT * FROM multiCurrencyWallets WHERE tenantId = ? ORDER BY customerId, currency LIMIT 500';
  const params = user.role === 'customer' ? [tenantId, user.userId] : [tenantId];

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

walletsRouter.get('/:customerId', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const customerId = c.req.param('customerId');

  if (user.role === 'customer' && user.userId !== customerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM multiCurrencyWallets WHERE tenantId = ? AND customerId = ? ORDER BY currency'
  )
    .bind(tenantId, customerId)
    .all();
  return c.json({ data: results });
});

walletsRouter.post('/:id/fund', requireRole(['admin', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ amountMinorUnits: number; description?: string }>();

  if (!Number.isInteger(body.amountMinorUnits) || body.amountMinorUnits <= 0) {
    return c.json({ error: 'amountMinorUnits must be a positive integer' }, 400);
  }

  const wallet = await c.env.DB.prepare('SELECT * FROM multiCurrencyWallets WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!wallet) return c.json({ error: 'Wallet not found' }, 404);
  if (wallet.status !== 'active') return c.json({ error: 'Wallet is not active' }, 400);

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    'UPDATE multiCurrencyWallets SET balanceMinorUnits = balanceMinorUnits + ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
  )
    .bind(body.amountMinorUnits, now, id, tenantId)
    .run();

  const newBalance = Number(wallet.balanceMinorUnits) + body.amountMinorUnits;
  return c.json({ success: true, currency: wallet.currency, newBalanceMinorUnits: newBalance });
});

walletsRouter.post('/:id/debit', requireRole(['admin', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ amountMinorUnits: number; description?: string }>();

  if (!Number.isInteger(body.amountMinorUnits) || body.amountMinorUnits <= 0) {
    return c.json({ error: 'amountMinorUnits must be a positive integer' }, 400);
  }

  const wallet = await c.env.DB.prepare('SELECT * FROM multiCurrencyWallets WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!wallet) return c.json({ error: 'Wallet not found' }, 404);
  if (wallet.status !== 'active') return c.json({ error: 'Wallet is not active' }, 400);
  if (Number(wallet.balanceMinorUnits) < body.amountMinorUnits) {
    return c.json({ error: 'Insufficient wallet balance' }, 422);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    'UPDATE multiCurrencyWallets SET balanceMinorUnits = balanceMinorUnits - ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
  )
    .bind(body.amountMinorUnits, now, id, tenantId)
    .run();

  return c.json({ success: true, currency: wallet.currency, newBalanceMinorUnits: Number(wallet.balanceMinorUnits) - body.amountMinorUnits });
});

walletsRouter.post('/convert', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    customerId: string;
    fromCurrency: WalletCurrency;
    toCurrency: WalletCurrency;
    fromAmountMinorUnits: number;
    exchangeRate: number;  // units of toCurrency per 1 unit of fromCurrency
  }>();

  if (!body.customerId || !body.fromCurrency || !body.toCurrency || !body.fromAmountMinorUnits || !body.exchangeRate) {
    return c.json({ error: 'Missing required fields' }, 400);
  }
  if (user.role === 'customer' && user.userId !== body.customerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  if (body.fromCurrency === body.toCurrency) {
    return c.json({ error: 'Source and destination currencies must be different' }, 400);
  }

  const [fromWallet, toWallet] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM multiCurrencyWallets WHERE tenantId = ? AND customerId = ? AND currency = ?')
      .bind(tenantId, body.customerId, body.fromCurrency)
      .first() as Promise<Record<string, unknown> | null>,
    c.env.DB.prepare('SELECT * FROM multiCurrencyWallets WHERE tenantId = ? AND customerId = ? AND currency = ?')
      .bind(tenantId, body.customerId, body.toCurrency)
      .first() as Promise<Record<string, unknown> | null>,
  ]);

  if (!fromWallet) return c.json({ error: `No ${body.fromCurrency} wallet found` }, 404);
  if (!toWallet) return c.json({ error: `No ${body.toCurrency} wallet found. Create it first.` }, 404);
  if (Number(fromWallet.balanceMinorUnits) < body.fromAmountMinorUnits) {
    return c.json({ error: 'Insufficient balance' }, 422);
  }

  const toAmount = Math.round(body.fromAmountMinorUnits * body.exchangeRate);
  const now = new Date().toISOString();

  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE multiCurrencyWallets SET balanceMinorUnits = balanceMinorUnits - ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
    ).bind(body.fromAmountMinorUnits, now, fromWallet.id as string, tenantId),
    c.env.DB.prepare(
      'UPDATE multiCurrencyWallets SET balanceMinorUnits = balanceMinorUnits + ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
    ).bind(toAmount, now, toWallet.id as string, tenantId),
  ]);

  return c.json({
    success: true,
    from: { currency: body.fromCurrency, debitedMinorUnits: body.fromAmountMinorUnits },
    to: { currency: body.toCurrency, creditedMinorUnits: toAmount },
    appliedRate: body.exchangeRate,
  });
});

walletsRouter.put('/:id/freeze', requireRole(['admin', 'teller']), async (c) => updateWalletStatus(c, 'active', 'frozen'));
walletsRouter.put('/:id/unfreeze', requireRole(['admin', 'teller']), async (c) => updateWalletStatus(c, 'frozen', 'active'));

async function updateWalletStatus(c: Parameters<Parameters<typeof walletsRouter.put>[1]>[0], from: string, to: string) {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const result = await c.env.DB.prepare(
    `UPDATE multiCurrencyWallets SET status = ?, updatedAt = ? WHERE id = ? AND tenantId = ? AND status = ?`
  ).bind(to, now, id, tenantId, from).run();

  if (!result.meta.changes) return c.json({ error: `Wallet not found or not in ${from} state` }, 404);
  return c.json({ success: true, status: to });
}
