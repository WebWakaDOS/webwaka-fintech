import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings } from '../../core/types';

export const bankingRouter = new Hono<{ Bindings: Bindings }>();

// Invariant 1: Build Once Use Infinitely
// Role-based access control via @webwaka/core primitives

bankingRouter.get('/accounts', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  // Customers can only see their own accounts
  const query = user.role === 'customer' 
    ? 'SELECT * FROM bankAccounts WHERE tenantId = ? AND customerId = ? ORDER BY createdAt DESC'
    : 'SELECT * FROM bankAccounts WHERE tenantId = ? ORDER BY createdAt DESC';
    
  const params = user.role === 'customer' ? [tenantId, user.id] : [tenantId];

  const { results } = await c.env.DB.prepare(query)
    .bind(...params)
    .all();

  return c.json({ data: results });
});

bankingRouter.post('/accounts', requireRole(['admin', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json();

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  
  // Generate random 10 digit account number for demo purposes
  const accountNumber = Math.floor(1000000000 + Math.random() * 9000000000).toString();

  await c.env.DB.prepare(
    'INSERT INTO bankAccounts (id, tenantId, accountNumber, customerId, accountType, balanceKobo, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, tenantId, accountNumber, body.customerId, body.accountType, 0, 'active', createdAt, createdAt)
    .run();

  return c.json({ success: true, id, accountNumber }, 201);
});

bankingRouter.post('/transactions', requireRole(['admin', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json();

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const reference = `TRX-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // In a real app, this would be a transaction
  await c.env.DB.prepare(
    'INSERT INTO transactions (id, tenantId, accountId, type, amountKobo, reference, status, description, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, tenantId, body.accountId, body.type, body.amountKobo, reference, 'success', body.description, createdAt)
    .run();
    
  // Update balance
  const balanceModifier = body.type === 'deposit' ? body.amountKobo : -body.amountKobo;
  await c.env.DB.prepare(
    'UPDATE bankAccounts SET balanceKobo = balanceKobo + ?, updatedAt = ? WHERE id = ? AND tenantId = ?'
  )
    .bind(balanceModifier, createdAt, body.accountId, tenantId)
    .run();

  return c.json({ success: true, id, reference }, 201);
});
