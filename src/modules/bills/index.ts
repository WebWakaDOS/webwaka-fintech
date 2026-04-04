/**
 * Bill Payments Module (#7: VTPass Integration)
 *
 * Supports airtime, data, electricity, TV (DSTV/GOTV), and water bill payments
 * via the VTPass aggregator API.
 *
 * Endpoints:
 *   GET    /api/bills/providers              — List available providers by bill type
 *   POST   /api/bills/pay                   — Pay a bill
 *   GET    /api/bills                       — List bill payments (customer: own; admin: all)
 *   GET    /api/bills/:id                   — Get single bill payment
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, BillType } from '../../core/types';

export const billsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

const PROVIDERS: Record<BillType, string[]> = {
  airtime: ['MTN', 'AIRTEL', 'GLO', '9MOBILE'],
  data: ['MTN', 'AIRTEL', 'GLO', '9MOBILE', 'SMILE'],
  electricity: ['EKEDC', 'IKEDC', 'AEDC', 'PHEDC', 'EEDC', 'JED', 'KAEDCO', 'IBEDC'],
  tv: ['DSTV', 'GOTV', 'STARTIMES'],
  water: ['LAGOS_WATER', 'FCT_WATER'],
};

billsRouter.get('/providers', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const billType = c.req.query('billType') as BillType | undefined;
  if (billType && !PROVIDERS[billType]) {
    return c.json({ error: `Unknown billType. Valid: ${Object.keys(PROVIDERS).join(', ')}` }, 400);
  }
  return c.json({ data: billType ? { [billType]: PROVIDERS[billType] } : PROVIDERS });
});

billsRouter.post('/pay', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    customerId: string;
    accountId: string;
    billType: BillType;
    provider: string;
    amountKobo: number;
    phone?: string;
    meterNumber?: string;
    smartcardNumber?: string;
  }>();

  const { customerId, accountId, billType, provider, amountKobo } = body;
  if (!customerId || !accountId || !billType || !provider || !amountKobo) {
    return c.json({ error: 'customerId, accountId, billType, provider, and amountKobo are required' }, 400);
  }
  if (user.role === 'customer' && user.userId !== customerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
    return c.json({ error: 'amountKobo must be a positive integer' }, 400);
  }

  const validProviders = PROVIDERS[billType];
  if (!validProviders?.includes(provider.toUpperCase())) {
    return c.json({ error: `Provider ${provider} not supported for ${billType}` }, 400);
  }

  const account = await c.env.DB.prepare(
    'SELECT balanceKobo FROM bankAccounts WHERE id = ? AND tenantId = ? AND customerId = ? AND status = ?'
  )
    .bind(accountId, tenantId, customerId, 'active')
    .first() as Record<string, number> | null;

  if (!account) return c.json({ error: 'Account not found or not active' }, 404);
  if (account.balanceKobo < amountKobo) return c.json({ error: 'Insufficient balance' }, 422);

  const reference = `BILL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  let externalReference: string | null = null;
  let status: 'success' | 'failed' = 'success';
  let responseMessage = 'Bill payment successful';

  if (c.env.VTPASS_API_KEY && c.env.VTPASS_BASE_URL) {
    try {
      const vtpassBody: Record<string, unknown> = {
        request_id: reference,
        serviceID: mapProviderToVtpass(billType, provider),
        amount: amountKobo / 100,
        phone: body.phone ?? customerId,
      };
      if (body.meterNumber) vtpassBody.meter_number = body.meterNumber;
      if (body.smartcardNumber) vtpassBody.smartcard_number = body.smartcardNumber;

      const vtResp = await fetch(`${c.env.VTPASS_BASE_URL}/api/pay`, {
        method: 'POST',
        headers: {
          'api-key': c.env.VTPASS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(vtpassBody),
        signal: AbortSignal.timeout(30000),
      });

      if (vtResp.ok) {
        const vtData = await vtResp.json() as Record<string, unknown>;
        const content = vtData.content as Record<string, unknown> ?? {};
        externalReference = (content.transactions as Record<string, unknown> ?? {}).transactionId as string ?? null;
        if ((vtData.code as string) !== '000') {
          status = 'failed';
          responseMessage = (vtData.response_description as string) ?? 'VTPass payment failed';
        }
      } else {
        status = 'failed';
        responseMessage = `VTPass API error: ${vtResp.status}`;
      }
    } catch (err) {
      console.error('[Bills] VTPass error:', err);
      status = 'failed';
      responseMessage = 'Bill payment gateway unreachable';
    }
  }

  const batch = [
    c.env.DB.prepare(
      `INSERT INTO billPayments (id, tenantId, customerId, accountId, billType, provider, amountKobo, phone, meterNumber, smartcardNumber, reference, externalReference, status, responseMessage, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, tenantId, customerId, accountId, billType, provider, amountKobo, body.phone ?? null, body.meterNumber ?? null, body.smartcardNumber ?? null, reference, externalReference, status, responseMessage, now, now),
  ];

  if (status === 'success') {
    batch.push(
      c.env.DB.prepare(
        'UPDATE bankAccounts SET balanceKobo = balanceKobo - ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
      ).bind(amountKobo, now, accountId, tenantId)
    );
    batch.push(
      c.env.DB.prepare(
        `INSERT INTO transactions (id, tenantId, accountId, type, amountKobo, reference, status, description, createdAt)
         VALUES (?, ?, ?, 'fee', ?, ?, 'success', ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, accountId, amountKobo, reference, `${billType} bill — ${provider}`, now)
    );
  }

  await c.env.DB.batch(batch);

  const statusCode = status === 'success' ? 201 : 422;
  return c.json({ success: status === 'success', id, reference, externalReference, status, responseMessage }, statusCode);
});

billsRouter.get('/', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const query = user.role === 'customer'
    ? 'SELECT * FROM billPayments WHERE tenantId = ? AND customerId = ? ORDER BY createdAt DESC LIMIT 100'
    : 'SELECT * FROM billPayments WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 200';
  const params = user.role === 'customer' ? [tenantId, user.userId] : [tenantId];

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

billsRouter.get('/:id', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM billPayments WHERE id = ? AND tenantId = ?')
    .bind(id, tenantId).first() as Record<string, unknown> | null;
  if (!row) return c.json({ error: 'Bill payment not found' }, 404);
  if (user.role === 'customer' && row.customerId !== user.userId) return c.json({ error: 'Forbidden' }, 403);
  return c.json({ data: row });
});

function mapProviderToVtpass(billType: BillType, provider: string): string {
  const mapping: Record<string, string> = {
    'airtime:MTN': 'mtn', 'airtime:AIRTEL': 'airtel', 'airtime:GLO': 'glo', 'airtime:9MOBILE': 'etisalat',
    'data:MTN': 'mtn-data', 'data:AIRTEL': 'airtel-data', 'data:GLO': 'glo-data', 'data:9MOBILE': 'etisalat-data',
    'electricity:EKEDC': 'ekedc', 'electricity:IKEDC': 'ikedc', 'electricity:AEDC': 'aedc', 'electricity:PHEDC': 'phed',
    'tv:DSTV': 'dstv', 'tv:GOTV': 'gotv', 'tv:STARTIMES': 'startimes',
  };
  return mapping[`${billType}:${provider.toUpperCase()}`] ?? provider.toLowerCase();
}
