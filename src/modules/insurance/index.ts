import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const insuranceRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

insuranceRouter.get('/policies', requireRole(['admin', 'agent', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const query = user.role === 'customer' 
    ? 'SELECT * FROM insurancePolicies WHERE tenantId = ? AND customerId = ? ORDER BY createdAt DESC'
    : 'SELECT * FROM insurancePolicies WHERE tenantId = ? ORDER BY createdAt DESC';
    
  const params = user.role === 'customer' ? [tenantId, user.userId] : [tenantId];

  const { results } = await c.env.DB.prepare(query)
    .bind(...params)
    .all();

  return c.json({ data: results });
});

insuranceRouter.post('/policies', requireRole(['admin', 'agent']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json();

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await c.env.DB.prepare(
    'INSERT INTO insurancePolicies (id, tenantId, customerId, policyType, premiumKobo, coverageKobo, status, startDate, endDate, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, tenantId, body.customerId, body.policyType, body.premiumKobo, body.coverageKobo, 'active', body.startDate, body.endDate, createdAt)
    .run();

  return c.json({ success: true, id }, 201);
});
