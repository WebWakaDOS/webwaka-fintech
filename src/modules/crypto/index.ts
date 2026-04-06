/**
 * Crypto On/Off Ramps Module (#11)
 *
 * Enables NGN-to-crypto (on-ramp) and crypto-to-NGN (off-ramp) via licensed exchange partners.
 * Supported: USDT, USDC, BTC
 *
 * Endpoints:
 *   GET    /api/crypto/rates                — Get current exchange rates
 *   POST   /api/crypto/on-ramp             — Buy crypto with NGN (NGN → crypto)
 *   POST   /api/crypto/off-ramp            — Sell crypto for NGN (crypto → NGN)
 *   GET    /api/crypto/fint_transactions        — List crypto fint_transactions
 *   GET    /api/crypto/fint_transactions/:id    — Get single transaction
 *   PUT    /api/crypto/fint_transactions/:id/confirm — Confirm external tx hash (admin)
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, CryptoCurrency } from '../../core/types';

export const cryptoRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

const SUPPORTED_CRYPTO: CryptoCurrency[] = ['USDT', 'USDC', 'BTC'];

cryptoRouter.get('/rates', requireRole(['admin', 'teller', 'customer']), async (c) => {
  if (c.env.CRYPTO_EXCHANGE_URL && c.env.CRYPTO_EXCHANGE_KEY) {
    try {
      const resp = await fetch(`${c.env.CRYPTO_EXCHANGE_URL}/rates?base=NGN`, {
        headers: { Authorization: `Bearer ${c.env.CRYPTO_EXCHANGE_KEY}` },
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json();
        return c.json({ source: 'live', data });
      }
    } catch (err) {
      console.warn('[Crypto] Live rate fetch failed, using indicative rates:', err);
    }
  }

  // Indicative placeholder rates (NGN per 1 unit of crypto)
  return c.json({
    source: 'indicative',
    note: 'Configure CRYPTO_EXCHANGE_URL and CRYPTO_EXCHANGE_KEY for live rates',
    rates: {
      USDT: { ngnPerUnit: 165000000, koboPerUnit: 165_000_000 },  // ~₦1,650
      USDC: { ngnPerUnit: 165000000, koboPerUnit: 165_000_000 },
      BTC:  { ngnPerUnit: 10000000000, koboPerUnit: 10_000_000_000 },  // ~₦100,000
    },
  });
});

cryptoRouter.post('/on-ramp', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    customerId: string;
    accountId: string;
    cryptoCurrency: CryptoCurrency;
    fiatAmountKobo: number;
    exchangeRate: string;  // kobo per 1 crypto unit
    cryptoWalletAddress: string;
  }>();

  if (!body.customerId || !body.accountId || !body.cryptoCurrency || !body.fiatAmountKobo || !body.exchangeRate || !body.cryptoWalletAddress) {
    return c.json({ error: 'Missing required fields' }, 400);
  }
  if (!SUPPORTED_CRYPTO.includes(body.cryptoCurrency)) {
    return c.json({ error: `Unsupported crypto. Supported: ${SUPPORTED_CRYPTO.join(', ')}` }, 400);
  }
  if (!Number.isInteger(body.fiatAmountKobo) || body.fiatAmountKobo <= 0) {
    return c.json({ error: 'fiatAmountKobo must be a positive integer' }, 400);
  }
  if (user.role === 'customer' && user.userId !== body.customerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const account = await c.env.DB.prepare(
    'SELECT balanceKobo FROM fint_bankAccounts WHERE id = ? AND tenantId = ? AND customerId = ? AND status = ?'
  )
    .bind(body.accountId, tenantId, body.customerId, 'active')
    .first() as Record<string, number> | null;

  if (!account) return c.json({ error: 'Account not found or not active' }, 404);
  if (account.balanceKobo < body.fiatAmountKobo) return c.json({ error: 'Insufficient NGN balance' }, 422);

  const rateKobo = parseFloat(body.exchangeRate);
  const cryptoAmountUnits = (body.fiatAmountKobo / rateKobo).toFixed(8);
  const reference = `ONRAMP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  let externalStatus: 'pending' | 'failed' = 'pending';
  let externalTxHash: string | null = null;

  if (c.env.CRYPTO_EXCHANGE_URL && c.env.CRYPTO_EXCHANGE_KEY) {
    try {
      const resp = await fetch(`${c.env.CRYPTO_EXCHANGE_URL}/on-ramp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.env.CRYPTO_EXCHANGE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference,
          cryptoCurrency: body.cryptoCurrency,
          cryptoAmount: cryptoAmountUnits,
          fiatAmountKobo: body.fiatAmountKobo,
          destinationAddress: body.cryptoWalletAddress,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (resp.ok) {
        const data = await resp.json() as Record<string, unknown>;
        externalTxHash = data.txHash as string ?? null;
        externalStatus = 'pending';
      }
    } catch (err) {
      console.error('[Crypto] On-ramp exchange error:', err);
      return c.json({ error: 'Exchange partner unreachable' }, 502);
    }
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO fint_cryptoTransactions (id, tenantId, customerId, accountId, direction, cryptoCurrency, cryptoAmountUnits, fiatAmountKobo, exchangeRate, externalTxHash, status, reference, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 'on_ramp', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, tenantId, body.customerId, body.accountId, body.cryptoCurrency, cryptoAmountUnits, body.fiatAmountKobo, body.exchangeRate, externalTxHash, externalStatus, reference, now, now),
    c.env.DB.prepare(
      'UPDATE fint_bankAccounts SET balanceKobo = balanceKobo - ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
    ).bind(body.fiatAmountKobo, now, body.accountId, tenantId),
    c.env.DB.prepare(
      `INSERT INTO fint_transactions (id, tenantId, accountId, type, amountKobo, reference, status, description, createdAt)
       VALUES (?, ?, ?, 'withdrawal', ?, ?, 'success', ?, ?)`
    ).bind(crypto.randomUUID(), tenantId, body.accountId, body.fiatAmountKobo, reference, `On-ramp: ${cryptoAmountUnits} ${body.cryptoCurrency}`, now),
  ]);

  return c.json({ success: true, id, reference, cryptoAmountUnits, cryptoCurrency: body.cryptoCurrency, fiatAmountKobo: body.fiatAmountKobo, status: externalStatus }, 201);
});

cryptoRouter.post('/off-ramp', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    customerId: string;
    accountId: string;
    cryptoCurrency: CryptoCurrency;
    cryptoAmountUnits: string;
    exchangeRate: string;  // kobo per 1 crypto unit
  }>();

  if (!body.customerId || !body.accountId || !body.cryptoCurrency || !body.cryptoAmountUnits || !body.exchangeRate) {
    return c.json({ error: 'Missing required fields' }, 400);
  }
  if (!SUPPORTED_CRYPTO.includes(body.cryptoCurrency)) {
    return c.json({ error: `Unsupported crypto` }, 400);
  }
  if (user.role === 'customer' && user.userId !== body.customerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const rateKobo = parseFloat(body.exchangeRate);
  const fiatAmountKobo = Math.round(parseFloat(body.cryptoAmountUnits) * rateKobo);
  const reference = `OFFRAMP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  let externalStatus: 'pending' | 'failed' = 'pending';

  if (c.env.CRYPTO_EXCHANGE_URL && c.env.CRYPTO_EXCHANGE_KEY) {
    try {
      const resp = await fetch(`${c.env.CRYPTO_EXCHANGE_URL}/off-ramp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.env.CRYPTO_EXCHANGE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference, cryptoCurrency: body.cryptoCurrency, cryptoAmount: body.cryptoAmountUnits, fiatAmountKobo }),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) externalStatus = 'failed';
    } catch (err) {
      console.error('[Crypto] Off-ramp error:', err);
      return c.json({ error: 'Exchange partner unreachable' }, 502);
    }
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO fint_cryptoTransactions (id, tenantId, customerId, accountId, direction, cryptoCurrency, cryptoAmountUnits, fiatAmountKobo, exchangeRate, status, reference, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 'off_ramp', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, tenantId, body.customerId, body.accountId, body.cryptoCurrency, body.cryptoAmountUnits, fiatAmountKobo, body.exchangeRate, externalStatus, reference, now, now),
  ]);

  if (externalStatus === 'pending') {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE fint_bankAccounts SET balanceKobo = balanceKobo + ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
      ).bind(fiatAmountKobo, now, body.accountId, tenantId),
      c.env.DB.prepare(
        `INSERT INTO fint_transactions (id, tenantId, accountId, type, amountKobo, reference, status, description, createdAt)
         VALUES (?, ?, ?, 'deposit', ?, ?, 'success', ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, body.accountId, fiatAmountKobo, reference, `Off-ramp: ${body.cryptoAmountUnits} ${body.cryptoCurrency} → NGN`, now),
    ]);
  }

  return c.json({ success: externalStatus === 'pending', id, reference, fiatAmountKobo, cryptoCurrency: body.cryptoCurrency, status: externalStatus }, 201);
});

cryptoRouter.get('/fint_transactions', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const query = user.role === 'customer'
    ? 'SELECT * FROM fint_cryptoTransactions WHERE tenantId = ? AND customerId = ? ORDER BY createdAt DESC LIMIT 100'
    : 'SELECT * FROM fint_cryptoTransactions WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 200';
  const params = user.role === 'customer' ? [tenantId, user.userId] : [tenantId];

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

cryptoRouter.get('/fint_transactions/:id', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM fint_cryptoTransactions WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!row) return c.json({ error: 'Transaction not found' }, 404);
  if (user.role === 'customer' && row.customerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);
  return c.json({ data: row });
});

cryptoRouter.put('/fint_transactions/:id/confirm', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ externalTxHash: string }>();
  const now = new Date().toISOString();

  const result = await c.env.DB.prepare(
    `UPDATE fint_cryptoTransactions SET status = 'confirmed', externalTxHash = ?, updatedAt = ? WHERE id = ? AND tenantId = ?`
  )
    .bind(body.externalTxHash, now, id, tenantId)
    .run();

  if (!result.meta.changes) return c.json({ error: 'Transaction not found' }, 404);
  return c.json({ success: true, status: 'confirmed' });
});
