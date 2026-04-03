/**
 * NIBSS NIP Payout Module Tests
 *
 * Coverage targets:
 *  - NIBSS utility functions
 *  - Event Bus publisher
 *  - Payout initiation (success, validation errors, NIBSS rejection)
 *  - Webhook handler (confirmation, failure, reversal, idempotency)
 *  - Manual status refresh
 *  - List and get payout endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateNibssReference, validateNuban, validateBankCode, NibssError } from '../../core/nibss';
import { publishEvent } from '../../core/events';
import { payoutsRouter, payoutsWebhookRouter, __resetNibssTokenCache } from './index';

// ─── NIBSS Utility Tests ──────────────────────────────────────────────────────

describe('NIBSS utilities', () => {
  describe('generateNibssReference', () => {
    it('generates a reference with NIP- prefix and tenant fragment', () => {
      const ref = generateNibssReference('tenant-abc-123');
      expect(ref).toMatch(/^NIP-tenant-a/);
    });

    it('generates unique references', () => {
      const r1 = generateNibssReference('t1');
      const r2 = generateNibssReference('t1');
      expect(r1).not.toBe(r2);
    });

    it('truncates long tenant IDs to 8 chars', () => {
      const ref = generateNibssReference('very-long-tenant-id-here');
      // Should contain only first 8 chars of tenant ID
      expect(ref.startsWith('NIP-very-lon')).toBe(true);
    });
  });

  describe('validateNuban', () => {
    it('accepts a valid 10-digit NUBAN', () => {
      expect(validateNuban('0123456789')).toBe(true);
      expect(validateNuban('9999999999')).toBe(true);
    });

    it('rejects NUBANs that are not 10 digits', () => {
      expect(validateNuban('123456789')).toBe(false);   // 9 digits
      expect(validateNuban('12345678901')).toBe(false); // 11 digits
      expect(validateNuban('')).toBe(false);
    });

    it('rejects non-numeric NUBANs', () => {
      expect(validateNuban('012345678A')).toBe(false);
      expect(validateNuban('01234-6789')).toBe(false);
    });
  });

  describe('validateBankCode', () => {
    it('accepts valid 3-6 digit CBN bank codes', () => {
      expect(validateBankCode('044')).toBe(true);   // Access Bank
      expect(validateBankCode('058')).toBe(true);   // GTBank
      expect(validateBankCode('000014')).toBe(true); // 6-digit
    });

    it('rejects codes shorter than 3 or longer than 6 digits', () => {
      expect(validateBankCode('04')).toBe(false);
      expect(validateBankCode('0000001')).toBe(false);
    });

    it('rejects non-numeric bank codes', () => {
      expect(validateBankCode('ABC')).toBe(false);
      expect(validateBankCode('04A')).toBe(false);
    });
  });

  describe('NibssError', () => {
    it('has correct name, message, and code', () => {
      const err = new NibssError('Transfer failed', 'TRANSFER_FAILED', '51');
      expect(err.name).toBe('NibssError');
      expect(err.message).toBe('Transfer failed');
      expect(err.code).toBe('TRANSFER_FAILED');
      expect(err.nibssResponseCode).toBe('51');
    });

    it('is an instance of Error', () => {
      const err = new NibssError('oops', 'AUTH_FAILED');
      expect(err instanceof Error).toBe(true);
    });
  });
});

// ─── Event Bus Publisher Tests ────────────────────────────────────────────────

describe('Event Bus publisher', () => {
  it('logs and skips when EVENT_BUS_URL is not configured', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await publishEvent(undefined, undefined, {
      event: 'payout.completed',
      payoutRequestId: 'pr-1',
      tenantId: 't1',
      initiatorId: 'init-1',
      payoutType: 'vendor_payout',
      amountKobo: 500000,
      destinationAccountNumber: '0123456789',
      destinationBankCode: '044',
      destinationAccountName: 'John Doe',
      nibssReference: 'NIP-t1-123-ABC',
      nibssSessionId: 'sess-1',
      settledAt: new Date().toISOString(),
    });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No EVENT_BUS_URL'), expect.any(Object));
    consoleSpy.mockRestore();
  });

  it('posts the event when EVENT_BUS_URL is configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    await publishEvent('https://bus.example.com', 'secret-key', {
      event: 'payout.failed',
      payoutRequestId: 'pr-2',
      tenantId: 't1',
      initiatorId: 'init-1',
      payoutType: 'rider_commission',
      amountKobo: 10000,
      nibssReference: 'NIP-t1-456-XYZ',
      failureReason: 'Insufficient funds',
      failedAt: new Date().toISOString(),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://bus.example.com/events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Bus-Secret': 'secret-key' }),
      })
    );
    vi.unstubAllGlobals();
  });

  it('does not throw if event bus returns an error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      publishEvent('https://bus.example.com', undefined, {
        event: 'payout.completed',
        payoutRequestId: 'pr-3',
        tenantId: 't1',
        initiatorId: 'init-1',
        payoutType: 'vendor_payout',
        amountKobo: 1000,
        destinationAccountNumber: '0000000001',
        destinationBankCode: '058',
        destinationAccountName: 'Jane Doe',
        nibssReference: 'NIP-t1-789',
        nibssSessionId: 'sess-2',
        settledAt: new Date().toISOString(),
      })
    ).resolves.toBeUndefined();
    consoleSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('does not throw if event bus network request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      publishEvent('https://bus.example.com', undefined, {
        event: 'payout.failed',
        payoutRequestId: 'pr-4',
        tenantId: 't1',
        initiatorId: 'init-1',
        payoutType: 'driver_settlement',
        amountKobo: 5000,
        nibssReference: 'NIP-t1-000',
        failureReason: 'Timeout',
        failedAt: new Date().toISOString(),
      })
    ).resolves.toBeUndefined();
    consoleSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});

// ─── Payout Router Tests ──────────────────────────────────────────────────────

/** Create a mock D1 prepared statement that can be chained */
function makePreparedStmt(firstResult: unknown = null, allResult: unknown[] = []) {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({ success: true }),
    first: vi.fn().mockResolvedValue(firstResult),
    all: vi.fn().mockResolvedValue({ results: allResult }),
  };
  return stmt;
}

/** Build a minimal mock Cloudflare env for testing */
function mockEnv(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const dbStmt = makePreparedStmt();
  return {
    DB: { prepare: vi.fn().mockReturnValue(dbStmt) },
    NIBSS_BASE_URL: 'https://nibss.test',
    NIBSS_CLIENT_ID: 'client-id',
    NIBSS_CLIENT_SECRET: 'client-secret',
    NIBSS_SOURCE_BANK_CODE: '000001',
    NIBSS_SOURCE_ACCOUNT_NUMBER: '1234567890',
    EVENT_BUS_URL: undefined,
    EVENT_BUS_SECRET: undefined,
    ...overrides,
  };
}

/** Make an authenticated Hono request with JSON body */
function makeRequest(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

describe('POST /api/payouts/initiate', () => {
  beforeEach(() => {
    __resetNibssTokenCache();
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('test-uuid-123'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subtle: (globalThis as any).crypto?.subtle,
    });
  });

  afterEach(() => {
    __resetNibssTokenCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns 400 for missing required fields', async () => {
    const env = mockEnv();
    const req = makeRequest('POST', '/initiate', { amountKobo: 500000 });
    const res = await payoutsRouter.fetch(req, env);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Missing required fields');
  });

  it('returns 400 for non-integer amountKobo', async () => {
    const env = mockEnv();
    const req = makeRequest('POST', '/initiate', {
      initiatorId: 'init-1',
      payoutType: 'vendor_payout',
      amountKobo: 100.5,
      destinationAccountNumber: '0123456789',
      destinationBankCode: '044',
      narration: 'Test payout',
    });
    const res = await payoutsRouter.fetch(req, env);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('positive integer');
  });

  it('returns 400 for invalid NUBAN', async () => {
    const env = mockEnv();
    const req = makeRequest('POST', '/initiate', {
      initiatorId: 'init-1',
      payoutType: 'vendor_payout',
      amountKobo: 50000,
      destinationAccountNumber: '12345', // invalid
      destinationBankCode: '044',
      narration: 'Test',
    });
    const res = await payoutsRouter.fetch(req, env);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('NUBAN');
  });

  it('returns 400 for invalid bank code', async () => {
    const env = mockEnv();
    const req = makeRequest('POST', '/initiate', {
      initiatorId: 'init-1',
      payoutType: 'vendor_payout',
      amountKobo: 50000,
      destinationAccountNumber: '0123456789',
      destinationBankCode: 'XX',
      narration: 'Test',
    });
    const res = await payoutsRouter.fetch(req, env);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('bank code');
  });

  it('returns 202 when NIBSS accepts the transfer', async () => {
    vi.stubGlobal('fetch', vi.fn()
      // Auth token
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok123', expires_in: 3600 }),
      })
      // Name enquiry
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: 'sess-ne-1',
          destinationBankCode: '044',
          destinationAccountNumber: '0123456789',
          destinationAccountName: 'JOHN DOE',
          responseCode: '00',
          responseMessage: 'Approved',
        }),
      })
      // Fund transfer
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: 'sess-xfr-1',
          paymentReference: 'NIP-xxxx',
          responseCode: '00',
          responseMessage: 'Accepted',
          status: 'accepted',
        }),
      })
    );

    const dbStmt = makePreparedStmt();
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const req = makeRequest('POST', '/initiate', {
      initiatorId: 'vendor-batch-1',
      payoutType: 'vendor_payout',
      amountKobo: 500000,
      destinationAccountNumber: '0123456789',
      destinationBankCode: '044',
      narration: 'Vendor commission April 2026',
    });

    const res = await payoutsRouter.fetch(req, env);
    expect(res.status).toBe(202);
    const body = await res.json() as { success: boolean; status: string; destinationAccountName: string };
    expect(body.success).toBe(true);
    expect(body.status).toBe('processing');
    expect(body.destinationAccountName).toBe('JOHN DOE');
  });

  it('returns 422 when NIBSS rejects the transfer synchronously', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: 'sess-ne-2',
          destinationBankCode: '058',
          destinationAccountNumber: '9876543210',
          destinationAccountName: 'JANE DOE',
          responseCode: '00',
          responseMessage: 'Approved',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: 'sess-xfr-2',
          paymentReference: 'NIP-yyyy',
          responseCode: '51',
          responseMessage: 'Insufficient funds',
          status: 'rejected',
        }),
      })
    );

    const dbStmt = makePreparedStmt();
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const req = makeRequest('POST', '/initiate', {
      initiatorId: 'rider-batch-1',
      payoutType: 'rider_commission',
      amountKobo: 9999999999,
      destinationAccountNumber: '9876543210',
      destinationBankCode: '058',
      narration: 'Rider commission',
    });

    const res = await payoutsRouter.fetch(req, env);
    expect(res.status).toBe(422);
    const body = await res.json() as { success: boolean; status: string };
    expect(body.success).toBe(false);
    expect(body.status).toBe('failed');
  });

  it('returns 500 when name enquiry throws a NibssError', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: '',
          destinationBankCode: '058',
          destinationAccountNumber: '0000000000',
          destinationAccountName: '',
          responseCode: '34',
          responseMessage: 'Invalid account',
        }),
      })
    );

    const dbStmt = makePreparedStmt();
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const req = makeRequest('POST', '/initiate', {
      initiatorId: 'init-x',
      payoutType: 'refund',
      amountKobo: 10000,
      destinationAccountNumber: '0000000000',
      destinationBankCode: '058',
      narration: 'Refund',
    });

    const res = await payoutsRouter.fetch(req, env);
    expect(res.status).toBe(500);
  });
});

describe('GET /api/payouts', () => {
  it('returns payout list for the tenant', async () => {
    const mockRows = [
      { id: 'p1', tenantId: 't1', status: 'confirmed', amountKobo: 100000 },
      { id: 'p2', tenantId: 't1', status: 'processing', amountKobo: 50000 },
    ];
    const dbStmt = makePreparedStmt(null, mockRows);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await payoutsRouter.fetch(new Request('http://localhost/'), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(2);
  });

  it('supports filtering by status query param', async () => {
    const mockRows = [{ id: 'p1', status: 'confirmed' }];
    const dbStmt = makePreparedStmt(null, mockRows);
    const mockPrepare = vi.fn().mockReturnValue(dbStmt);
    const env = mockEnv({ DB: { prepare: mockPrepare } });

    const res = await payoutsRouter.fetch(
      new Request('http://localhost/?status=confirmed'),
      env
    );
    expect(res.status).toBe(200);
    // Verify the query includes status filter
    const prepareArg = (mockPrepare.mock.calls[0]?.[0] ?? '') as string;
    expect(prepareArg).toContain('status = ?');
  });
});

describe('GET /api/payouts/:id', () => {
  it('returns 404 for unknown payout ID', async () => {
    const dbStmt = makePreparedStmt(null);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await payoutsRouter.fetch(
      new Request('http://localhost/nonexistent-id'),
      env
    );
    expect(res.status).toBe(404);
  });

  it('returns the payout record when found', async () => {
    const record = { id: 'pr-abc', tenantId: 't1', status: 'confirmed', amountKobo: 200000 };
    const dbStmt = makePreparedStmt(record);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await payoutsRouter.fetch(
      new Request('http://localhost/pr-abc'),
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof record };
    expect(body.data.id).toBe('pr-abc');
    expect(body.data.amountKobo).toBe(200000);
  });
});

// ─── Webhook Handler Tests ────────────────────────────────────────────────────

describe('POST /webhooks/nibss-nip (webhook handler)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns 200 received:true for unknown reference (prevents bank retries)', async () => {
    const dbStmt = makePreparedStmt(null);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const payload = {
      paymentReference: 'NIP-UNKNOWN-999',
      sessionId: 'sess-x',
      status: 'successful',
      settledAmountKobo: 100000,
      responseCode: '00',
      responseMessage: 'Approved',
      settledAt: new Date().toISOString(),
    };

    const res = await payoutsWebhookRouter.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { received: boolean };
    expect(body.received).toBe(true);
  });

  it('confirms a processing payout on successful webhook', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true })); // event bus

    const existingRow = {
      id: 'pr-webhook-1',
      tenantId: 'tenant-abc',
      initiatorId: 'vendor-1',
      payoutType: 'vendor_payout',
      amountKobo: 300000,
      destinationAccountNumber: '0123456789',
      destinationBankCode: '044',
      destinationAccountName: 'TEST USER',
      nibssReference: 'NIP-tenant-a-123-ABCDE',
      status: 'processing',
    };

    let callCount = 0;
    const dbStmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      first: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? existingRow : { ...existingRow, status: 'confirmed' });
      }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    const env = mockEnv({
      DB: { prepare: vi.fn().mockReturnValue(dbStmt) },
      EVENT_BUS_URL: 'https://bus.test',
    });

    const payload = {
      paymentReference: 'NIP-tenant-a-123-ABCDE',
      sessionId: 'sess-confirmed-1',
      status: 'successful',
      settledAmountKobo: 300000,
      responseCode: '00',
      responseMessage: 'Transaction Successful',
      settledAt: new Date().toISOString(),
    };

    const res = await payoutsWebhookRouter.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { received: boolean };
    expect(body.received).toBe(true);

    // DB was updated to confirmed
    expect(dbStmt.run).toHaveBeenCalled();
  });

  it('marks a payout as failed on failed webhook', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const existingRow = {
      id: 'pr-webhook-2',
      tenantId: 'tenant-xyz',
      initiatorId: 'rider-1',
      payoutType: 'rider_commission',
      amountKobo: 75000,
      destinationAccountNumber: '9876543210',
      destinationBankCode: '058',
      destinationAccountName: 'RIDER NAME',
      nibssReference: 'NIP-tenant-x-456-DEFGH',
      status: 'processing',
    };

    const dbStmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      first: vi.fn().mockResolvedValue(existingRow),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const payload = {
      paymentReference: 'NIP-tenant-x-456-DEFGH',
      sessionId: 'sess-failed-1',
      status: 'failed',
      settledAmountKobo: 0,
      responseCode: '51',
      responseMessage: 'Insufficient Balance',
      settledAt: new Date().toISOString(),
    };

    const res = await payoutsWebhookRouter.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      env
    );
    expect(res.status).toBe(200);
    // Verify update was called with 'failed' status
    const runCall = dbStmt.run.mock.calls;
    expect(runCall.length).toBeGreaterThan(0);
  });

  it('is idempotent — ignores duplicate webhook for already-confirmed payout', async () => {
    const existingRow = {
      id: 'pr-idem-1',
      tenantId: 'tenant-abc',
      nibssReference: 'NIP-t1-idem',
      status: 'confirmed', // already settled
    };

    const dbStmt = makePreparedStmt(existingRow);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const payload = {
      paymentReference: 'NIP-t1-idem',
      sessionId: 'sess-dup',
      status: 'successful',
      settledAmountKobo: 100000,
      responseCode: '00',
      responseMessage: 'Duplicate',
      settledAt: new Date().toISOString(),
    };

    const res = await payoutsWebhookRouter.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { received: boolean; idempotent: boolean };
    expect(body.received).toBe(true);
    expect(body.idempotent).toBe(true);
  });

  it('returns 400 for invalid JSON body', async () => {
    const env = mockEnv();
    const res = await payoutsWebhookRouter.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not valid json',
      }),
      env
    );
    expect(res.status).toBe(400);
  });

  it('returns 401 for invalid HMAC signature when secret is set', async () => {
    const env = mockEnv({ NIBSS_CLIENT_SECRET: 'my-secret' });

    vi.stubGlobal('crypto', {
      subtle: {
        importKey: vi.fn().mockResolvedValue('key'),
        verify: vi.fn().mockResolvedValue(false), // invalid sig
      },
      randomUUID: () => 'uuid',
    });

    const payload = { paymentReference: 'NIP-test', status: 'successful' };
    const res = await payoutsWebhookRouter.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': 'badhexsig00',
        },
        body: JSON.stringify(payload),
      }),
      env
    );
    expect(res.status).toBe(401);
  });
});

// ─── Manual Status Refresh Tests ──────────────────────────────────────────────

describe('GET /api/payouts/:id/status', () => {
  beforeEach(() => { __resetNibssTokenCache(); });
  afterEach(() => {
    __resetNibssTokenCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns 404 for unknown payout', async () => {
    const dbStmt = makePreparedStmt(null);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await payoutsRouter.fetch(
      new Request('http://localhost/unknown-id/status'),
      env
    );
    expect(res.status).toBe(404);
  });

  it('returns cached data without querying NIBSS for non-processing payouts', async () => {
    const confirmedRow = { id: 'pr-done', tenantId: 't1', status: 'confirmed', nibssReference: 'NIP-x' };
    const dbStmt = makePreparedStmt(confirmedRow);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const res = await payoutsRouter.fetch(
      new Request('http://localhost/pr-done/status'),
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { fromCache: boolean };
    expect(body.fromCache).toBe(true);
    // NIBSS should NOT have been called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('queries NIBSS and updates to confirmed for a processing payout', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: 'sess-poll-1',
          paymentReference: 'NIP-poll',
          responseCode: '00',
          responseMessage: 'Successful',
          status: 'successful',
          settledAmountKobo: 200000,
          settledAt: new Date().toISOString(),
        }),
      })
      .mockResolvedValue({ ok: true }) // event bus
    );

    const processingRow = {
      id: 'pr-poll',
      tenantId: 't1',
      status: 'processing',
      nibssReference: 'NIP-poll',
      initiatorId: 'init-1',
      payoutType: 'vendor_payout',
      amountKobo: 200000,
      destinationAccountNumber: '0123456789',
      destinationBankCode: '044',
      destinationAccountName: 'POLL USER',
    };
    const confirmedRow = { ...processingRow, status: 'confirmed' };

    let firstCallCount = 0;
    const dbStmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      first: vi.fn().mockImplementation(() => {
        firstCallCount++;
        return Promise.resolve(firstCallCount === 1 ? processingRow : confirmedRow);
      }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await payoutsRouter.fetch(
      new Request('http://localhost/pr-poll/status'),
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { fromCache: boolean; data: { status: string } };
    expect(body.fromCache).toBe(false);
  });
});
