/**
 * Mono Open Banking Integration — WebWaka Fintech Suite
 *
 * Mono is a leading Nigerian Open Banking API provider enabling users to link
 * external bank accounts and retrieve financial data (accounts, balances,
 * fint_transactions) as well as initiate payments via Direct Pay.
 *
 * Invariant 5: Nigeria First — Mono supports all Nigerian commercial banks.
 * Invariant 1: Build Once Use Infinitely — all Mono calls route through here.
 *
 * Docs: https://mono.co/api
 */

export interface MonoConfig {
  secretKey: string;
  /** Override base URL for testing */
  baseUrl?: string;
}

export interface MonoConnectResponse {
  /** The Mono Connect widget URL to redirect the user to for account linking */
  monoConnectUrl: string;
  /** Our state param to verify callback integrity */
  state: string;
}

export interface MonoAccountResponse {
  id: string;
  name: string;
  currency: string;
  type: string;
  accountNumber: string;
  balance: number;
  institution: {
    name: string;
    bankCode: string;
    type: string;
  };
  bvn?: string;
}

export interface MonoTransaction {
  id: string;
  narration: string;
  amount: number;
  type: 'debit' | 'credit';
  balance: number;
  date: string;
  category?: string;
}

export interface MonoTransactionsResponse {
  total: number;
  fint_transactions: MonoTransaction[];
}

export interface MonoDirectPayResponse {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  timestamp: string;
}

export class MonoError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'MonoError';
  }
}

function getBaseUrl(config: MonoConfig): string {
  return config.baseUrl ?? 'https://api.withmono.com';
}

async function monoRequest<T>(
  config: MonoConfig,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const url = `${getBaseUrl(config)}${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      'mono-sec-key': config.secretKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });

  const data = await resp.json() as Record<string, unknown>;

  if (!resp.ok) {
    const msg = String((data as { message?: string }).message ?? `Mono API error ${resp.status}`);
    const code = String((data as { code?: string }).code ?? '');
    throw new MonoError(msg, resp.status, code);
  }

  return data as T;
}

/**
 * Exchange the Mono Connect token (from callback) for an accountId.
 * Called when a user completes the Mono Connect widget flow.
 */
export async function exchangeToken(
  config: MonoConfig,
  code: string,
): Promise<{ id: string }> {
  return monoRequest<{ id: string }>(config, 'POST', '/account/auth', { code });
}

/**
 * Retrieve account details using an accountId.
 */
export async function getAccountDetails(
  config: MonoConfig,
  accountId: string,
): Promise<MonoAccountResponse> {
  const data = await monoRequest<{ account: MonoAccountResponse }>(
    config, 'GET', `/accounts/${accountId}`,
  );
  return data.account;
}

/**
 * Retrieve the current balance for a linked account.
 * Returns balance in the smallest currency unit (kobo for NGN).
 */
export async function getAccountBalance(
  config: MonoConfig,
  accountId: string,
): Promise<{ balance: number; currency: string }> {
  const account = await getAccountDetails(config, accountId);
  return { balance: account.balance, currency: account.currency };
}

/**
 * Retrieve recent fint_transactions for a linked account.
 */
export async function getTransactions(
  config: MonoConfig,
  accountId: string,
  options: { start?: string; end?: string; narration?: string; limit?: number } = {},
): Promise<MonoTransactionsResponse> {
  const params = new URLSearchParams();
  if (options.start) params.set('start', options.start);
  if (options.end) params.set('end', options.end);
  if (options.narration) params.set('narration', options.narration);
  if (options.limit) params.set('paginate', 'false');

  const path = `/accounts/${accountId}/fint_transactions${params.toString() ? `?${params}` : ''}`;
  return monoRequest<MonoTransactionsResponse>(config, 'GET', path);
}

/**
 * Initiate a Direct Pay payment from a linked Mono account.
 * The user must have granted the `payments.initiate` scope.
 */
export async function initiateDirectPay(
  config: MonoConfig,
  params: {
    accountId: string;
    amount: number;
    type: 'onetime-debit';
    reference: string;
    description: string;
    redirectUrl: string;
  },
): Promise<MonoDirectPayResponse> {
  return monoRequest<MonoDirectPayResponse>(config, 'POST', '/payments/initiate', {
    account_id: params.accountId,
    amount: params.amount,
    type: params.type,
    reference: params.reference,
    description: params.description,
    redirect_url: params.redirectUrl,
  });
}

/**
 * Verify a Direct Pay transaction by reference.
 */
export async function verifyDirectPay(
  config: MonoConfig,
  reference: string,
): Promise<MonoDirectPayResponse> {
  return monoRequest<MonoDirectPayResponse>(config, 'GET', `/payments/${reference}`);
}
