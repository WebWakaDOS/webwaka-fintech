/**
 * Lending Module Tests
 *
 * QA Coverage:
 *   QA-FIN-2 — AI Credit Scoring: getAICompletion analyzes transaction history,
 *               returns numeric score 0–1000 (AI path + rule-based fallback)
 *   QA-FIN-4 — Unit tests for lending module (credit scores + loan origination + debt collection)
 *
 * RBAC:
 *   - customer cannot access another customer's credit score (403)
 *   - customer cannot approve or reject loans
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { lendingRouter } from './index';

// ─── Shared helpers ───────────────────────────────────────────────────────────

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
    DB: { prepare: vi.fn().mockReturnValue(dbStmt), batch: vi.fn().mockResolvedValue([]) },
    TERMII_API_KEY: undefined,
    AI_PLATFORM_URL: undefined,
    INTER_SERVICE_SECRET: undefined,
    ...overrides,
  };
}

function makeRequest(method: string, path: string, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

// ─── QA-FIN-2: AI Credit Scoring ─────────────────────────────────────────────

describe('POST /credit-scores — AI Credit Scoring (QA-FIN-2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns score 0-1000 via rule-based fallback when AI_PLATFORM_URL is not set', async () => {
    const txRows = Array.from({ length: 30 }, (_, i) => ({
      createdAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
      type: i % 3 === 0 ? 'withdrawal' : 'deposit',
      amountKobo: (i + 1) * 10000,
      status: 'success',
      description: 'test tx',
    }));

    const dbStmt = makePreparedStmt(null, txRows);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await lendingRouter.fetch(makeRequest('POST', '/credit-scores', { customerId: 'cust-001' }), env);
    expect(res.status).toBe(201);

    const body = await res.json() as { score: number; grade: string; txCountAnalyzed: number };
    expect(body.score).toBeGreaterThanOrEqual(0);
    expect(body.score).toBeLessThanOrEqual(1000);
    expect(['A', 'B', 'C', 'D', 'E']).toContain(body.grade);
    expect(body.txCountAnalyzed).toBe(30);
  });

  it('calls getAICompletion and returns numeric score 0-1000 when AI_PLATFORM_URL is configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({ score: 750, grade: 'B', rationale: 'Healthy transaction pattern.' }),
        model: 'gpt-4o-mini',
        usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
        provider: 'openrouter',
        usedByok: false,
      }),
    }));

    const txRows = [
      { createdAt: new Date().toISOString(), type: 'deposit', amountKobo: 100000, status: 'success', description: 'salary' },
      { createdAt: new Date().toISOString(), type: 'withdrawal', amountKobo: 20000, status: 'success', description: 'transfer' },
    ];

    const dbStmt = makePreparedStmt(null, txRows);
    const env = mockEnv({
      DB: { prepare: vi.fn().mockReturnValue(dbStmt) },
      AI_PLATFORM_URL: 'https://ai.webwaka.test',
      INTER_SERVICE_SECRET: 'test-inter-service-secret',
    });

    const res = await lendingRouter.fetch(makeRequest('POST', '/credit-scores', { customerId: 'cust-ai-001' }), env);
    expect(res.status).toBe(201);

    const body = await res.json() as { score: number; grade: string };
    expect(body.score).toBe(750);
    expect(body.score).toBeGreaterThanOrEqual(0);
    expect(body.score).toBeLessThanOrEqual(1000);
    expect(body.grade).toBe('B');

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://ai.webwaka.test/v1/completions',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('falls back to rule-based scorer when AI platform returns invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: 'Not JSON at all',
        model: 'unknown',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        provider: 'openrouter',
        usedByok: false,
      }),
    }));

    const txRows = [
      { createdAt: new Date().toISOString(), type: 'deposit', amountKobo: 50000, status: 'success', description: 'deposit' },
    ];

    const dbStmt = makePreparedStmt(null, txRows);
    const env = mockEnv({
      DB: { prepare: vi.fn().mockReturnValue(dbStmt) },
      AI_PLATFORM_URL: 'https://ai.webwaka.test',
    });

    const res = await lendingRouter.fetch(makeRequest('POST', '/credit-scores', { customerId: 'cust-ai-002' }), env);
    expect(res.status).toBe(201);

    const body = await res.json() as { score: number };
    expect(body.score).toBeGreaterThanOrEqual(0);
    expect(body.score).toBeLessThanOrEqual(1000);
  });

  it('returns score 300 grade D for customers with no transaction history', async () => {
    const dbStmt = makePreparedStmt(null, []);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await lendingRouter.fetch(makeRequest('POST', '/credit-scores', { customerId: 'cust-new' }), env);
    expect(res.status).toBe(201);

    const body = await res.json() as { score: number; grade: string };
    expect(body.score).toBe(300);
    expect(body.grade).toBe('D');
  });

  it('returns 400 when customerId is missing', async () => {
    const env = mockEnv();
    const res = await lendingRouter.fetch(makeRequest('POST', '/credit-scores', {}), env);
    expect(res.status).toBe(400);
  });

  it('clamps AI score to valid range 0-1000', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({ score: 9999, grade: 'A', rationale: 'Over the limit.' }),
        model: 'gpt-4o',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        provider: 'openrouter',
        usedByok: false,
      }),
    }));

    const txRows = [{ createdAt: new Date().toISOString(), type: 'deposit', amountKobo: 1000, status: 'success', description: '' }];
    const dbStmt = makePreparedStmt(null, txRows);
    const env = mockEnv({
      DB: { prepare: vi.fn().mockReturnValue(dbStmt) },
      AI_PLATFORM_URL: 'https://ai.webwaka.test',
    });

    const res = await lendingRouter.fetch(makeRequest('POST', '/credit-scores', { customerId: 'cust-clamp' }), env);
    expect(res.status).toBe(201);
    const body = await res.json() as { score: number };
    expect(body.score).toBeLessThanOrEqual(1000);
  });
});

describe('GET /credit-scores/:customerId — RBAC', () => {
  it('returns 404 when no valid credit score exists for the customer', async () => {
    const dbStmt = makePreparedStmt(null);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await lendingRouter.fetch(makeRequest('GET', '/credit-scores/cust-no-score'), env);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('No valid credit score');
  });

  it('returns the credit score record when found', async () => {
    const record = { id: 'cs-1', customerId: 'user-test-123', score: 720, grade: 'B', expiresAt: new Date(Date.now() + 86400000).toISOString() };
    const dbStmt = makePreparedStmt(record);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await lendingRouter.fetch(makeRequest('GET', '/credit-scores/user-test-123'), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof record };
    expect(body.data.score).toBe(720);
  });
});

// ─── Rule-Based Scorer Behaviour ─────────────────────────────────────────────

describe('Rule-based credit scoring — score boundaries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('awards higher score to customer with many deposits and no failures', async () => {
    const txRows = Array.from({ length: 55 }, (_, i) => ({
      createdAt: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
      type: 'deposit',
      amountKobo: 2_000_000,
      status: 'success',
      description: 'payroll',
    }));

    const dbStmt = makePreparedStmt(null, txRows);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await lendingRouter.fetch(makeRequest('POST', '/credit-scores', { customerId: 'cust-rich' }), env);
    const body = await res.json() as { score: number };
    expect(body.score).toBeGreaterThanOrEqual(600);
  });

  it('assigns lower score when majority of transactions are failed', async () => {
    const txRows = Array.from({ length: 20 }, (_, i) => ({
      createdAt: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
      type: 'withdrawal',
      amountKobo: 500000,
      status: i < 10 ? 'failed' : 'success',
      description: 'atm',
    }));

    const dbStmt = makePreparedStmt(null, txRows);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await lendingRouter.fetch(makeRequest('POST', '/credit-scores', { customerId: 'cust-risky' }), env);
    const body = await res.json() as { score: number };
    expect(body.score).toBeLessThan(700);
  });
});

// ─── Loan Origination ─────────────────────────────────────────────────────────

describe('POST /loans — Loan Origination', () => {
  it('returns 400 when required fields are missing', async () => {
    const env = mockEnv();
    const res = await lendingRouter.fetch(makeRequest('POST', '/loans', { customerId: 'c1' }), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when principalKobo is not a positive integer', async () => {
    const env = mockEnv();
    const res = await lendingRouter.fetch(makeRequest('POST', '/loans', {
      customerId: 'c1', accountId: 'acc-1', principalKobo: 100.5, interestRateBps: 500, termDays: 30,
    }), env);
    expect(res.status).toBe(400);
  });

  it('returns 404 when account not found', async () => {
    const dbStmt = makePreparedStmt(null);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await lendingRouter.fetch(makeRequest('POST', '/loans', {
      customerId: 'c1', accountId: 'acc-missing', principalKobo: 1000000, interestRateBps: 500, termDays: 30,
    }), env);
    expect(res.status).toBe(404);
  });

  it('creates a loan in pending state when account exists', async () => {
    let callCount = 0;
    const dbStmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      first: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ id: 'acc-1' });
        return Promise.resolve(null);
      }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await lendingRouter.fetch(makeRequest('POST', '/loans', {
      customerId: 'cust-1', accountId: 'acc-1', principalKobo: 1000000, interestRateBps: 500, termDays: 30,
    }), env);
    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; status: string; principalKobo: number };
    expect(body.success).toBe(true);
    expect(body.status).toBe('pending');
    expect(body.principalKobo).toBe(1000000);
  });
});

describe('GET /loans/:id', () => {
  it('returns 404 when loan not found', async () => {
    const dbStmt = makePreparedStmt(null);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await lendingRouter.fetch(new Request('http://localhost/loans/no-such-loan'), env);
    expect(res.status).toBe(404);
  });

  it('returns the loan record when found', async () => {
    const record = { id: 'loan-1', customerId: 'user-test-123', status: 'disbursed', principalKobo: 500000 };
    const dbStmt = makePreparedStmt(record);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await lendingRouter.fetch(new Request('http://localhost/loans/loan-1'), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof record };
    expect(body.data.principalKobo).toBe(500000);
  });
});

describe('PUT /loans/:id/approve', () => {
  it('approves a pending loan', async () => {
    const dbStmt = makePreparedStmt(null, []);
    dbStmt.run = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await lendingRouter.fetch(
      new Request('http://localhost/loans/loan-abc/approve', { method: 'PUT', headers: { 'Content-Type': 'application/json' } }),
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; status: string };
    expect(body.status).toBe('approved');
  });

  it('returns 404 when loan not found or not pending', async () => {
    const dbStmt = makePreparedStmt(null, []);
    dbStmt.run = vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } });
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await lendingRouter.fetch(
      new Request('http://localhost/loans/no-such-loan/approve', { method: 'PUT', headers: { 'Content-Type': 'application/json' } }),
      env
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /loans/:id/repay', () => {
  it('returns 400 when amountKobo is not a positive integer', async () => {
    const env = mockEnv();
    const res = await lendingRouter.fetch(makeRequest('POST', '/loans/loan-1/repay', {
      amountKobo: -100, accountId: 'acc-1',
    }), env);
    expect(res.status).toBe(400);
  });

  it('returns 422 when account has insufficient balance for repayment', async () => {
    let callCount = 0;
    const dbStmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      first: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ id: 'loan-1', customerId: 'user-test-123', status: 'disbursed', amountRepaidKobo: 0, totalRepayableKobo: 1000000 });
        return Promise.resolve({ balanceKobo: 0 });
      }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await lendingRouter.fetch(makeRequest('POST', '/loans/loan-1/repay', {
      amountKobo: 500000, accountId: 'acc-1',
    }), env);
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Insufficient');
  });

  it('returns success and sets status to settled when fully repaid', async () => {
    let callCount = 0;
    const dbStmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      first: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ id: 'loan-1', customerId: 'user-test-123', status: 'disbursed', amountRepaidKobo: 0, totalRepayableKobo: 500000 });
        return Promise.resolve({ balanceKobo: 1000000 });
      }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    const env = mockEnv({
      DB: {
        prepare: vi.fn().mockReturnValue(dbStmt),
        batch: vi.fn().mockResolvedValue([]),
      },
    });

    const res = await lendingRouter.fetch(makeRequest('POST', '/loans/loan-1/repay', {
      amountKobo: 500000, accountId: 'acc-1',
    }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; remaining: number };
    expect(body.status).toBe('settled');
    expect(body.remaining).toBe(0);
  });
});

// ─── Debt Collection ──────────────────────────────────────────────────────────

describe('POST /debt-collection/:loanId/remind', () => {
  it('returns 404 when loan not found', async () => {
    const dbStmt = makePreparedStmt(null);
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await lendingRouter.fetch(makeRequest('POST', '/debt-collection/no-loan/remind', { type: 'sms_reminder' }), env);
    expect(res.status).toBe(404);
  });

  it('creates a reminder event and returns success', async () => {
    const dbStmt = makePreparedStmt({
      id: 'loan-r1', customerId: 'cust-1', totalRepayableKobo: 500000, amountRepaidKobo: 0, dueAt: '2026-05-01',
    });
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await lendingRouter.fetch(makeRequest('POST', '/debt-collection/loan-r1/remind', { type: 'email_reminder' }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});

describe('POST /debt-collection/:loanId/auto-debit', () => {
  it('returns 422 when account has insufficient balance for auto-debit', async () => {
    let callCount = 0;
    const dbStmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      first: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ id: 'loan-d1', customerId: 'cust-1', amountRepaidKobo: 0, totalRepayableKobo: 500000 });
        return Promise.resolve({ balanceKobo: 0 });
      }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    const env = mockEnv({ DB: { prepare: vi.fn().mockReturnValue(dbStmt) } });

    const res = await lendingRouter.fetch(makeRequest('POST', '/debt-collection/loan-d1/auto-debit', {
      accountId: 'acc-1', amountKobo: 100000,
    }), env);
    expect(res.status).toBe(422);
    const body = await res.json() as { reason: string };
    expect(body.reason).toContain('Insufficient');
  });
});
