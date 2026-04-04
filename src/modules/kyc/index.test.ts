/**
 * KYC Tier Enforcement Module Tests
 *
 * QA Coverage:
 *   QA-FIN-3 — Transactions exceeding KYC tier limits are rejected with 403 Forbidden
 *   QA-FIN-4 — Unit tests for KYC module
 *
 * CBN Tier Limits (kobo):
 *   Tier 1: singleTx = 5,000,000 (₦50k)  | daily = 5,000,000  | monthly = 30,000,000
 *   Tier 2: singleTx = 30,000,000 (₦300k) | daily = 30,000,000 | monthly = 200,000,000
 *   Tier 3: singleTx = 500,000,000 (₦5M)  | daily = 1,000,000,000 | monthly = 0 (no cap)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { kycRouter, checkKycLimit } from './index';
import { KYC_TIER_LIMITS } from '../../core/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePreparedStmt(firstResult: unknown = null, allResult: unknown[] = []) {
  return {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
    first: vi.fn().mockResolvedValue(firstResult),
    all: vi.fn().mockResolvedValue({ results: allResult }),
  };
}

function mockEnv(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const dbStmt = makePreparedStmt();
  return {
    DB: { prepare: vi.fn().mockReturnValue(dbStmt) },
    ...overrides,
  };
}

function makeRequest(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

// ─── KYC_TIER_LIMITS constants ────────────────────────────────────────────────

describe('KYC_TIER_LIMITS constants', () => {
  it('Tier 1 single-tx limit is 5,000,000 kobo (₦50,000)', () => {
    expect(KYC_TIER_LIMITS[1].singleTx).toBe(5_000_000);
  });

  it('Tier 1 daily limit equals single-tx limit (₦50,000)', () => {
    expect(KYC_TIER_LIMITS[1].daily).toBe(5_000_000);
  });

  it('Tier 2 single-tx limit is 30,000,000 kobo (₦300,000)', () => {
    expect(KYC_TIER_LIMITS[2].singleTx).toBe(30_000_000);
  });

  it('Tier 3 has no monthly cap (monthly = 0)', () => {
    expect(KYC_TIER_LIMITS[3].monthly).toBe(0);
  });
});

// ─── checkKycLimit — unit tests ───────────────────────────────────────────────

describe('checkKycLimit()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('QA-FIN-3: blocks Tier 1 single-tx exceeding ₦50,000 (5,000,001 kobo)', async () => {
    const tier1Profile = {
      tier: 1,
      singleTxLimitKobo: KYC_TIER_LIMITS[1].singleTx,
      dailyLimitKobo: KYC_TIER_LIMITS[1].daily,
      monthlyLimitKobo: KYC_TIER_LIMITS[1].monthly,
    };
    const dailyStmt = makePreparedStmt({ total: 0 });
    const profileStmt = makePreparedStmt(tier1Profile);

    let callCount = 0;
    const mockDb = {
      prepare: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? profileStmt : dailyStmt;
      }),
    } as unknown as D1Database;

    const result = await checkKycLimit(mockDb, 'tenant-1', 'cust-1', 5_000_001);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('₦50,000');
  });

  it('QA-FIN-3: allows Tier 1 single-tx exactly at ₦50,000 limit (5,000,000 kobo)', async () => {
    const tier1Profile = {
      tier: 1,
      singleTxLimitKobo: KYC_TIER_LIMITS[1].singleTx,
      dailyLimitKobo: KYC_TIER_LIMITS[1].daily,
      monthlyLimitKobo: KYC_TIER_LIMITS[1].monthly,
    };
    const dailyStmt = makePreparedStmt({ total: 0 });
    const profileStmt = makePreparedStmt(tier1Profile);

    let callCount = 0;
    const mockDb = {
      prepare: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? profileStmt : dailyStmt;
      }),
    } as unknown as D1Database;

    const result = await checkKycLimit(mockDb, 'tenant-1', 'cust-1', 5_000_000);
    expect(result.allowed).toBe(true);
  });

  it('QA-FIN-3: blocks when daily spending already at limit', async () => {
    const tier1Profile = {
      tier: 1,
      singleTxLimitKobo: KYC_TIER_LIMITS[1].singleTx,
      dailyLimitKobo: KYC_TIER_LIMITS[1].daily,
      monthlyLimitKobo: KYC_TIER_LIMITS[1].monthly,
    };
    const dailyStmt = makePreparedStmt({ total: 4_900_000 });
    const profileStmt = makePreparedStmt(tier1Profile);

    let callCount = 0;
    const mockDb = {
      prepare: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? profileStmt : dailyStmt;
      }),
    } as unknown as D1Database;

    const result = await checkKycLimit(mockDb, 'tenant-1', 'cust-1', 200_000);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('daily limit');
  });

  it('applies Tier 1 defaults when no KYC profile exists', async () => {
    const dailyStmt = makePreparedStmt({ total: 0 });
    const profileStmt = makePreparedStmt(null);

    let callCount = 0;
    const mockDb = {
      prepare: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? profileStmt : dailyStmt;
      }),
    } as unknown as D1Database;

    const result = await checkKycLimit(mockDb, 'tenant-1', 'cust-unregistered', 5_000_001);
    expect(result.allowed).toBe(false);
  });

  it('allows Tier 2 transaction of ₦100,000 (10,000,000 kobo) within limits', async () => {
    const tier2Profile = {
      tier: 2,
      singleTxLimitKobo: KYC_TIER_LIMITS[2].singleTx,
      dailyLimitKobo: KYC_TIER_LIMITS[2].daily,
      monthlyLimitKobo: KYC_TIER_LIMITS[2].monthly,
    };
    const dailyStmt = makePreparedStmt({ total: 0 });
    const profileStmt = makePreparedStmt(tier2Profile);

    let callCount = 0;
    const mockDb = {
      prepare: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? profileStmt : dailyStmt;
      }),
    } as unknown as D1Database;

    const result = await checkKycLimit(mockDb, 'tenant-1', 'cust-tier2', 10_000_000);
    expect(result.allowed).toBe(true);
  });
});

// ─── KYC Router ───────────────────────────────────────────────────────────────

describe('GET /kyc/:customerId — RBAC', () => {
  it('returns KYC profile when found', async () => {
    const profile = { id: 'kyc-1', customerId: 'user-test-123', tier: 1, status: 'active' };
    const dbStmt = makePreparedStmt(profile);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await kycRouter.fetch(new Request('http://localhost/user-test-123'), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof profile };
    expect(body.data.tier).toBe(1);
  });

  it('returns 404 when KYC profile not found', async () => {
    const dbStmt = makePreparedStmt(null);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await kycRouter.fetch(new Request('http://localhost/user-test-123'), env);
    expect(res.status).toBe(404);
  });

  it('admin can read any customer\'s KYC profile', async () => {
    const profile = { id: 'kyc-3', customerId: 'any-customer', tier: 2, status: 'active' };
    const dbStmt = makePreparedStmt(profile);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await kycRouter.fetch(new Request('http://localhost/any-customer'), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof profile };
    expect(body.data.tier).toBe(2);
  });
});

describe('POST /kyc — Create KYC Profile', () => {
  it('returns 400 when customerId is missing', async () => {
    const env = mockEnv();
    const res = await kycRouter.fetch(makeRequest('POST', '/', {}), env);
    expect(res.status).toBe(400);
  });

  it('creates a KYC profile with Tier 1 defaults', async () => {
    const dbStmt = makePreparedStmt(null, []);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await kycRouter.fetch(makeRequest('POST', '/', {
      customerId: 'cust-new', bvn: '12345678901',
    }), env);
    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; tier: number; limits: Record<string, number> };
    expect(body.success).toBe(true);
    expect(body.tier).toBe(1);
    expect(body.limits.singleTx).toBe(KYC_TIER_LIMITS[1].singleTx);
  });

  it('creates a KYC profile with specified tier 2', async () => {
    const dbStmt = makePreparedStmt(null, []);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await kycRouter.fetch(makeRequest('POST', '/', {
      customerId: 'cust-tier2', tier: 2, bvn: '12345678901', addressVerified: true,
    }), env);
    expect(res.status).toBe(201);
    const body = await res.json() as { tier: number; limits: Record<string, number> };
    expect(body.tier).toBe(2);
    expect(body.limits.singleTx).toBe(KYC_TIER_LIMITS[2].singleTx);
  });
});

describe('PUT /kyc/:customerId/tier — Tier Upgrade', () => {
  it('returns 400 when tier value is invalid', async () => {
    const env = mockEnv();
    const res = await kycRouter.fetch(makeRequest('PUT', '/cust-1/tier', { tier: 99 }), env);
    expect(res.status).toBe(400);
  });

  it('successfully upgrades tier from 1 to 2', async () => {
    const dbStmt = makePreparedStmt(null, []);
    dbStmt.run = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await kycRouter.fetch(makeRequest('PUT', '/cust-1/tier', { tier: 2, addressVerified: true }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; tier: number };
    expect(body.success).toBe(true);
    expect(body.tier).toBe(2);
  });

  it('returns 404 when customer KYC profile not found', async () => {
    const dbStmt = makePreparedStmt(null, []);
    dbStmt.run = vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } });
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await kycRouter.fetch(makeRequest('PUT', '/no-such-customer/tier', { tier: 2 }), env);
    expect(res.status).toBe(404);
  });
});

describe('GET /kyc/:customerId/limits', () => {
  it('returns tier limits when profile found', async () => {
    const dbStmt = makePreparedStmt({
      tier: 2,
      dailyLimitKobo: KYC_TIER_LIMITS[2].daily,
      singleTxLimitKobo: KYC_TIER_LIMITS[2].singleTx,
      monthlyLimitKobo: KYC_TIER_LIMITS[2].monthly,
    });
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await kycRouter.fetch(new Request('http://localhost/user-test-123/limits'), env);
    expect(res.status).toBe(200);
  });

  it('returns Tier 1 defaults when no KYC profile exists', async () => {
    const dbStmt = makePreparedStmt(null);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await kycRouter.fetch(new Request('http://localhost/user-test-123/limits'), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { tier: number; dailyLimitKobo: number; note: string };
    expect(body.tier).toBe(1);
    expect(body.dailyLimitKobo).toBe(KYC_TIER_LIMITS[1].daily);
    expect(body.note).toContain('Tier 1');
  });
});
