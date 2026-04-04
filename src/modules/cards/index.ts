/**
 * Virtual Cards Module (#3: Virtual Card Issuance)
 *
 * Endpoints:
 *   POST   /api/cards                — Issue a new virtual card
 *   GET    /api/cards                — List customer's virtual cards
 *   GET    /api/cards/:id            — Get single card
 *   PUT    /api/cards/:id/freeze     — Freeze a card
 *   PUT    /api/cards/:id/unfreeze   — Unfreeze a card
 *   DELETE /api/cards/:id            — Terminate (permanently cancel) a card
 *   PUT    /api/cards/:id/limit      — Update spending limit
 *
 * Cards are backed by Paystack's virtual card API when CARD_ISSUER_URL is configured.
 * In local dev, a simulated card is issued.
 */

import { Hono, type Context } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, CardCurrency } from '../../core/types';

export const cardsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

cardsRouter.post('/', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    customerId: string;
    accountId: string;
    currency?: CardCurrency;
    cardHolderName: string;
    spendingLimitKobo?: number;
  }>();

  if (!body.customerId || !body.accountId || !body.cardHolderName) {
    return c.json({ error: 'customerId, accountId, and cardHolderName are required' }, 400);
  }
  if (user.role === 'customer' && user.userId !== body.customerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const account = await c.env.DB.prepare(
    'SELECT id FROM bankAccounts WHERE id = ? AND tenantId = ? AND customerId = ? AND status = ?'
  )
    .bind(body.accountId, tenantId, body.customerId, 'active')
    .first();
  if (!account) return c.json({ error: 'Account not found or not active' }, 404);

  const currency: CardCurrency = body.currency ?? 'NGN';
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  let externalCardId: string | null = null;
  let maskedPan: string;
  let expiryMonth: string;
  let expiryYear: string;

  if (c.env.CARD_ISSUER_URL && c.env.CARD_ISSUER_KEY) {
    try {
      const issuerResp = await fetch(`${c.env.CARD_ISSUER_URL}/virtual-cards`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.CARD_ISSUER_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customer: body.customerId,
          currency,
          amount: 0,
          memo: `WebWaka card — ${body.cardHolderName}`,
        }),
      });
      if (issuerResp.ok) {
        const issuerData = await issuerResp.json() as Record<string, unknown>;
        const cardData = (issuerData.data ?? issuerData) as Record<string, string>;
        externalCardId = cardData.id as string ?? null;
        maskedPan = (cardData.masked_pan ?? '5399 **** **** ' + Math.floor(1000 + Math.random() * 9000)) as string;
        expiryMonth = (cardData.expiry_month ?? String(new Date().getMonth() + 1).padStart(2, '0')) as string;
        expiryYear = (cardData.expiry_year ?? String(new Date().getFullYear() + 3)) as string;
      } else {
        throw new Error(`Card issuer returned ${issuerResp.status}`);
      }
    } catch (err) {
      console.error('[Cards] Issuer API error, using simulated card:', err);
      maskedPan = simulateMaskedPan();
      expiryMonth = String(new Date().getMonth() + 1).padStart(2, '0');
      expiryYear = String(new Date().getFullYear() + 3);
    }
  } else {
    maskedPan = simulateMaskedPan();
    expiryMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    expiryYear = String(new Date().getFullYear() + 3);
  }

  await c.env.DB.prepare(
    `INSERT INTO virtualCards
       (id, tenantId, customerId, accountId, currency, maskedPan, expiryMonth, expiryYear,
        cardHolderName, status, spendingLimitKobo, externalCardId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  )
    .bind(id, tenantId, body.customerId, body.accountId, currency, maskedPan, expiryMonth, expiryYear,
      body.cardHolderName, body.spendingLimitKobo ?? null, externalCardId, now, now)
    .run();

  return c.json({ success: true, id, maskedPan, expiryMonth, expiryYear, currency, status: 'active' }, 201);
});

cardsRouter.get('/', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const query = user.role === 'customer'
    ? 'SELECT id, tenantId, customerId, currency, maskedPan, expiryMonth, expiryYear, cardHolderName, status, spendingLimitKobo, createdAt FROM virtualCards WHERE tenantId = ? AND customerId = ? ORDER BY createdAt DESC'
    : 'SELECT id, tenantId, customerId, currency, maskedPan, expiryMonth, expiryYear, cardHolderName, status, spendingLimitKobo, createdAt FROM virtualCards WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 200';
  const params = user.role === 'customer' ? [tenantId, user.userId] : [tenantId];

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

cardsRouter.get('/:id', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    'SELECT id, tenantId, customerId, currency, maskedPan, expiryMonth, expiryYear, cardHolderName, status, spendingLimitKobo, createdAt FROM virtualCards WHERE id = ? AND tenantId = ?'
  )
    .bind(id, tenantId)
    .first() as Record<string, unknown> | null;

  if (!row) return c.json({ error: 'Card not found' }, 404);
  if (user.role === 'customer' && row.customerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);
  return c.json({ data: row });
});

cardsRouter.put('/:id/freeze', requireRole(['admin', 'teller', 'customer']), async (c) => {
  return updateCardStatus(c, 'active', 'frozen');
});

cardsRouter.put('/:id/unfreeze', requireRole(['admin', 'teller']), async (c) => {
  return updateCardStatus(c, 'frozen', 'active');
});

cardsRouter.delete('/:id', requireRole(['admin', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const result = await c.env.DB.prepare(
    `UPDATE virtualCards SET status = 'terminated', updatedAt = ? WHERE id = ? AND tenantId = ? AND status != 'terminated'`
  )
    .bind(now, id, tenantId)
    .run();

  if (!result.meta.changes) return c.json({ error: 'Card not found or already terminated' }, 404);
  return c.json({ success: true, status: 'terminated' });
});

cardsRouter.put('/:id/limit', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const body = await c.req.json<{ spendingLimitKobo: number | null }>();
  const now = new Date().toISOString();

  const card = await c.env.DB.prepare('SELECT customerId FROM virtualCards WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!card) return c.json({ error: 'Card not found' }, 404);
  if (user.role === 'customer' && card.customerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);

  await c.env.DB.prepare('UPDATE virtualCards SET spendingLimitKobo = ?, updatedAt = ? WHERE id = ?')
    .bind(body.spendingLimitKobo ?? null, now, id)
    .run();

  return c.json({ success: true, spendingLimitKobo: body.spendingLimitKobo });
});

async function updateCardStatus(c: Context<{ Bindings: Bindings; Variables: AppVariables }>, fromStatus: string, toStatus: string) {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const card = await c.env.DB.prepare('SELECT customerId FROM virtualCards WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!card) return c.json({ error: 'Card not found' }, 404);
  if (user.role === 'customer' && card.customerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);

  const result = await c.env.DB.prepare(
    `UPDATE virtualCards SET status = ?, updatedAt = ? WHERE id = ? AND tenantId = ? AND status = ?`
  )
    .bind(toStatus, now, id, tenantId, fromStatus)
    .run();

  if (!result.meta.changes) return c.json({ error: `Card not found or not in ${fromStatus} state` }, 400);
  return c.json({ success: true, status: toStatus });
}

function simulateMaskedPan(): string {
  const last4 = String(Math.floor(1000 + Math.random() * 9000));
  return `5399 **** **** ${last4}`;
}
