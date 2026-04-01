import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const investmentRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

investmentRouter.get('/portfolios', requireRole(['admin', 'broker', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const query = user.role === 'customer' 
    ? 'SELECT * FROM investmentPortfolios WHERE tenantId = ? AND customerId = ? ORDER BY createdAt DESC'
    : 'SELECT * FROM investmentPortfolios WHERE tenantId = ? ORDER BY createdAt DESC';
    
  const params = user.role === 'customer' ? [tenantId, user.userId] : [tenantId];

  const { results } = await c.env.DB.prepare(query)
    .bind(...params)
    .all();

  return c.json({ data: results });
});

investmentRouter.post('/portfolios', requireRole(['admin', 'broker']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json();

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await c.env.DB.prepare(
    'INSERT INTO investmentPortfolios (id, tenantId, customerId, assetClass, principalKobo, currentValueKobo, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, tenantId, body.customerId, body.assetClass, body.principalKobo, body.principalKobo, 'active', createdAt)
    .run();

  return c.json({ success: true, id }, 201);
});
