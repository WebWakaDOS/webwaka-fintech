/**
 * KYC Tier Enforcement Module (#16)
 *
 * Endpoints:
 *   GET    /api/kyc/:customerId           — Get KYC profile for a customer
 *   POST   /api/kyc                       — Create/upsert KYC profile
 *   PUT    /api/kyc/:customerId/tier      — Upgrade KYC tier (admin only)
 *   GET    /api/kyc/:customerId/limits    — Get current transaction limits
 *
 * CBN KYC Tiers:
 *   Tier 1 — BVN only:            ₦50k/day, ₦300k/month
 *   Tier 2 — BVN + address:       ₦300k/day, ₦2M/month
 *   Tier 3 — Full corporate KYC:  ₦10M/day, no monthly cap
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, KycTier } from '../../core/types';
import { KYC_TIER_LIMITS } from '../../core/types';
import { verifyIdentity, type DojahVerifyParams } from '../../core/dojah';
import { publishEvent } from '../../core/events';

export const kycRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

kycRouter.get('/:customerId', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const customerId = c.req.param('customerId');

  if (user.role === 'customer' && user.userId !== customerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const row = await c.env.DB.prepare(
    'SELECT * FROM fint_kycProfiles WHERE tenantId = ? AND customerId = ?'
  )
    .bind(tenantId, customerId)
    .first();

  if (!row) return c.json({ error: 'KYC profile not found' }, 404);
  return c.json({ data: row });
});

kycRouter.post('/', requireRole(['admin', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    customerId: string;
    bvn?: string;
    nin?: string;
    tier?: KycTier;
    addressVerified?: boolean;
    corporateVerified?: boolean;
  }>();

  if (!body.customerId) {
    return c.json({ error: 'customerId is required' }, 400);
  }

  const tier = (body.tier ?? 1) as KycTier;
  const limits = KYC_TIER_LIMITS[tier];
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO fint_kycProfiles
       (id, tenantId, customerId, tier, bvn, nin, addressVerified, corporateVerified,
        dailyLimitKobo, singleTxLimitKobo, monthlyLimitKobo, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT(customerId) DO UPDATE SET
       tier = excluded.tier, bvn = excluded.bvn, nin = excluded.nin,
       addressVerified = excluded.addressVerified, corporateVerified = excluded.corporateVerified,
       dailyLimitKobo = excluded.dailyLimitKobo, singleTxLimitKobo = excluded.singleTxLimitKobo,
       monthlyLimitKobo = excluded.monthlyLimitKobo, updatedAt = excluded.updatedAt`
  )
    .bind(
      id, tenantId, body.customerId, tier,
      body.bvn ?? null, body.nin ?? null,
      body.addressVerified ? 1 : 0, body.corporateVerified ? 1 : 0,
      limits.daily, limits.singleTx, limits.monthly,
      now, now
    )
    .run();

  return c.json({ success: true, id, tier, limits }, 201);
});

kycRouter.put('/:customerId/tier', requireRole(['admin']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const customerId = c.req.param('customerId');
  const body = await c.req.json<{ tier: KycTier; bvn?: string; nin?: string; addressVerified?: boolean; corporateVerified?: boolean }>();

  const tier = body.tier as KycTier;
  if (![1, 2, 3].includes(tier)) {
    return c.json({ error: 'tier must be 1, 2, or 3' }, 400);
  }

  const limits = KYC_TIER_LIMITS[tier];
  const now = new Date().toISOString();

  const result = await c.env.DB.prepare(
    `UPDATE fint_kycProfiles SET
       tier = ?, dailyLimitKobo = ?, singleTxLimitKobo = ?, monthlyLimitKobo = ?,
       bvn = COALESCE(?, bvn), nin = COALESCE(?, nin),
       addressVerified = COALESCE(?, addressVerified), corporateVerified = COALESCE(?, corporateVerified),
       updatedAt = ?
     WHERE tenantId = ? AND customerId = ?`
  )
    .bind(
      tier, limits.daily, limits.singleTx, limits.monthly,
      body.bvn ?? null, body.nin ?? null,
      body.addressVerified !== undefined ? (body.addressVerified ? 1 : 0) : null,
      body.corporateVerified !== undefined ? (body.corporateVerified ? 1 : 0) : null,
      now, tenantId, customerId
    )
    .run();

  if (!result.meta.changes) {
    return c.json({ error: 'KYC profile not found' }, 404);
  }

  return c.json({ success: true, tier, limits });
});

kycRouter.get('/:customerId/limits', requireRole(['admin', 'teller', 'customer']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const customerId = c.req.param('customerId');

  if (user.role === 'customer' && user.userId !== customerId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const row = await c.env.DB.prepare(
    'SELECT tier, dailyLimitKobo, singleTxLimitKobo, monthlyLimitKobo FROM fint_kycProfiles WHERE tenantId = ? AND customerId = ?'
  )
    .bind(tenantId, customerId)
    .first() as Record<string, unknown> | null;

  if (!row) {
    const defaults = KYC_TIER_LIMITS[1];
    return c.json({ tier: 1, dailyLimitKobo: defaults.daily, singleTxLimitKobo: defaults.singleTx, monthlyLimitKobo: defaults.monthly, note: 'Default Tier 1 limits applied' });
  }

  return c.json({ data: row });
});

// ─── FT-003: POST /api/kyc/verify — Secondary identity verification via DOJAH ─
//
// Verifies a customer's identity using DOJAH as the secondary KYC provider.
// Results are stored in `fint_kycVerifications` for audit trail.
// Emits a `kyc.verified` event on success.
//
// Supported types: bvn | nin | phone | passport | drivers_license
//
kycRouter.post('/verify', requireRole(['admin', 'teller']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  if (!c.env.DOJAH_APP_ID || !c.env.DOJAH_PRIVATE_KEY) {
    return c.json({ error: 'Secondary KYC provider (DOJAH) is not configured' }, 503);
  }

  const body = await c.req.json<{
    customerId: string;
    verificationType: 'bvn' | 'nin' | 'phone' | 'passport' | 'drivers_license';
    value: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
  }>();

  if (!body.customerId || !body.verificationType || !body.value) {
    return c.json({ error: 'customerId, verificationType, and value are required' }, 400);
  }

  const params: DojahVerifyParams = {
    type: body.verificationType,
    value: body.value,
    firstName: body.firstName,
    lastName: body.lastName,
    dateOfBirth: body.dateOfBirth,
  };

  const now = new Date().toISOString();
  const verificationId = crypto.randomUUID();

  let verificationStatus = 'failed';
  let responseData: Record<string, unknown> = {};

  try {
    const result = await verifyIdentity(
      { appId: c.env.DOJAH_APP_ID, privateKey: c.env.DOJAH_PRIVATE_KEY, mode: c.env.DOJAH_MODE as 'sandbox' | 'production' | undefined },
      params,
    );
    verificationStatus = result.entity?.isMatch ? 'verified' : 'mismatch';
    responseData = result.entity as unknown as Record<string, unknown>;
  } catch (err) {
    verificationStatus = 'error';
    responseData = { error: err instanceof Error ? err.message : 'DOJAH request failed' };
  }

  // Store verification record for audit trail
  await c.env.DB.prepare(
    `INSERT INTO fint_kycVerifications
       (id, tenantId, customerId, verificationType, provider, status, responseData, createdAt)
     VALUES (?, ?, ?, ?, 'dojah', ?, ?, ?)`
  )
    .bind(verificationId, tenantId, body.customerId, body.verificationType, verificationStatus, JSON.stringify(responseData), now)
    .run();

  // FT-005: Emit kyc.verified event on successful verification
  if (verificationStatus === 'verified') {
    await publishEvent(c.env.EVENT_BUS_URL, c.env.EVENT_BUS_SECRET, {
      event: 'kyc.verified',
      verificationId,
      tenantId,
      customerId: body.customerId,
      verificationType: body.verificationType,
      provider: 'dojah',
      occurredAt: now,
    });
  }

  return c.json({
    verificationId,
    status: verificationStatus,
    verificationType: body.verificationType,
    customerId: body.customerId,
    ...(verificationStatus === 'error' ? { error: (responseData as { error?: string }).error } : {}),
  }, verificationStatus === 'verified' ? 200 : verificationStatus === 'error' ? 502 : 422);
});

/**
 * Checks if a transaction passes KYC limits for a given customer.
 * Called internally from other modules.
 */
export async function checkKycLimit(
  db: D1Database,
  tenantId: string,
  customerId: string,
  amountKobo: number
): Promise<{ allowed: boolean; reason?: string }> {
  const profile = await db.prepare(
    'SELECT tier, singleTxLimitKobo, dailyLimitKobo, monthlyLimitKobo FROM fint_kycProfiles WHERE tenantId = ? AND customerId = ?'
  )
    .bind(tenantId, customerId)
    .first() as Record<string, number> | null;

  const limits = profile ? {
    singleTx: profile.singleTxLimitKobo,
    daily: profile.dailyLimitKobo,
    monthly: profile.monthlyLimitKobo,
  } : KYC_TIER_LIMITS[1];

  if (amountKobo > limits.singleTx) {
    return { allowed: false, reason: `Transaction exceeds your KYC single-transaction limit of ₦${(limits.singleTx / 100).toLocaleString()}` };
  }

  const today = new Date().toISOString().slice(0, 10);
  const dailyRow = await db.prepare(
    `SELECT COALESCE(SUM(amountKobo), 0) as total FROM fint_transactions
     WHERE tenantId = ? AND accountId IN (SELECT id FROM fint_bankAccounts WHERE tenantId = ? AND customerId = ?)
     AND status = 'success' AND createdAt >= ?`
  )
    .bind(tenantId, tenantId, customerId, `${today}T00:00:00.000Z`)
    .first() as Record<string, number> | null;

  const dailyTotal = (dailyRow?.total ?? 0) + amountKobo;
  if (dailyTotal > limits.daily) {
    return { allowed: false, reason: `Transaction would exceed your KYC daily limit of ₦${(limits.daily / 100).toLocaleString()}` };
  }

  return { allowed: true };
}
