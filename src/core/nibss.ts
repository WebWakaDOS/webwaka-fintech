/**
 * NIBSS NIP (Nigeria Inter-Bank Settlement System) Integration
 *
 * WebWaka Fintech Suite — Real-time interbank transfer via licensed bank partner.
 *
 * Invariant 5: Nigeria First
 *   - All monetary values in kobo (NGN × 100)
 *   - NUBAN (10-digit) account numbers enforced
 *   - CBN bank codes for all institutions
 *
 * Flow:
 *   1. nameEnquiry()     — Verify recipient account name before transfer
 *   2. initiateTransfer() — Submit the NIP fund transfer
 *   3. queryStatus()      — Poll for settlement status
 *   4. Webhook            — Bank partner pushes settlement callback (handled in router)
 */

export interface NibssCredentials {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  sourceBankCode: string;
  sourceAccountNumber: string;
}

export interface NibssAuthToken {
  accessToken: string;
  expiresAt: number; // Unix ms
}

export interface NameEnquiryRequest {
  destinationBankCode: string;
  destinationAccountNumber: string;
}

export interface NameEnquiryResponse {
  sessionId: string;
  destinationBankCode: string;
  destinationAccountNumber: string;
  destinationAccountName: string;
  responseCode: string;
  responseMessage: string;
}

export interface TransferRequest {
  /** Unique reference for this transfer — format: NIP-{tenantId}-{timestamp}-{random} */
  paymentReference: string;
  amountKobo: number; // ALWAYS kobo — Invariant 5
  destinationBankCode: string;
  destinationAccountNumber: string;
  destinationAccountName: string;
  narration: string;
  /** NIBSS session ID from name enquiry */
  nameEnquirySessionId: string;
}

export interface TransferResponse {
  sessionId: string;
  paymentReference: string;
  responseCode: string;
  responseMessage: string;
  /** '00' = accepted for processing; final settlement via webhook */
  status: 'accepted' | 'rejected';
}

export interface TransferStatusResponse {
  sessionId: string;
  paymentReference: string;
  responseCode: string;
  responseMessage: string;
  status: 'pending' | 'successful' | 'failed' | 'reversed';
  settledAmountKobo?: number;
  settledAt?: string;
}

/** NIBSS NIP response codes for accepted transactions */
const NIBSS_ACCEPTED_CODES = new Set(['00', '000']);

/**
 * Obtain a short-lived Bearer token from the bank partner OAuth2 endpoint.
 * Token is cached by the caller (see NibssClient class).
 */
export async function fetchNibssToken(creds: NibssCredentials): Promise<NibssAuthToken> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });

  const resp = await fetch(`${creds.baseUrl}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    throw new NibssError(`NIBSS auth failed: HTTP ${resp.status}`, 'AUTH_FAILED');
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000 - 30_000, // 30 s buffer
  };
}

/**
 * Perform NIBSS Name Enquiry to verify the recipient account before transfer.
 * This is mandatory per NIBSS NIP spec to prevent wrong-account transfers.
 */
export async function nameEnquiry(
  creds: NibssCredentials,
  token: NibssAuthToken,
  req: NameEnquiryRequest
): Promise<NameEnquiryResponse> {
  const resp = await fetch(`${creds.baseUrl}/nip/name-enquiry`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sourceBankCode: creds.sourceBankCode,
      destinationBankCode: req.destinationBankCode,
      destinationAccountNumber: req.destinationAccountNumber,
    }),
  });

  if (!resp.ok) {
    throw new NibssError(`Name enquiry HTTP error: ${resp.status}`, 'NAME_ENQUIRY_FAILED');
  }

  const data = (await resp.json()) as NameEnquiryResponse;

  if (!NIBSS_ACCEPTED_CODES.has(data.responseCode)) {
    throw new NibssError(
      `Name enquiry rejected: ${data.responseMessage} (code ${data.responseCode})`,
      'NAME_ENQUIRY_REJECTED',
      data.responseCode
    );
  }

  return data;
}

/**
 * Initiate a NIBSS NIP fund transfer.
 * Amounts MUST be in kobo. A '00' response means accepted for processing —
 * final settlement confirmation arrives via webhook.
 */
export async function initiateTransfer(
  creds: NibssCredentials,
  token: NibssAuthToken,
  req: TransferRequest
): Promise<TransferResponse> {
  if (!Number.isInteger(req.amountKobo) || req.amountKobo <= 0) {
    throw new NibssError('amountKobo must be a positive integer (kobo)', 'INVALID_AMOUNT');
  }

  const resp = await fetch(`${creds.baseUrl}/nip/transfer`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      paymentReference: req.paymentReference,
      amount: req.amountKobo, // Bank partner expects kobo
      sourceBankCode: creds.sourceBankCode,
      sourceAccountNumber: creds.sourceAccountNumber,
      destinationBankCode: req.destinationBankCode,
      destinationAccountNumber: req.destinationAccountNumber,
      destinationAccountName: req.destinationAccountName,
      narration: req.narration.slice(0, 100),
      nameEnquirySessionId: req.nameEnquirySessionId,
      channelCode: '1', // Internet Banking channel
    }),
  });

  if (!resp.ok) {
    throw new NibssError(`Transfer HTTP error: ${resp.status}`, 'TRANSFER_FAILED');
  }

  const data = (await resp.json()) as TransferResponse;
  const accepted = NIBSS_ACCEPTED_CODES.has(data.responseCode);
  return { ...data, status: accepted ? 'accepted' : 'rejected' };
}

/**
 * Query the current settlement status of a submitted transfer.
 * Used for polling when the webhook has not arrived within expected time.
 */
export async function queryTransferStatus(
  creds: NibssCredentials,
  token: NibssAuthToken,
  paymentReference: string
): Promise<TransferStatusResponse> {
  const resp = await fetch(
    `${creds.baseUrl}/nip/transfer/status?paymentReference=${encodeURIComponent(paymentReference)}&sourceBankCode=${creds.sourceBankCode}`,
    {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    }
  );

  if (!resp.ok) {
    throw new NibssError(`Status query HTTP error: ${resp.status}`, 'STATUS_QUERY_FAILED');
  }

  return resp.json() as Promise<TransferStatusResponse>;
}

/**
 * Generate a unique NIBSS payment reference.
 * Format: NIP-{tenantShort}-{timestamp}-{random5}
 */
export function generateNibssReference(tenantId: string): string {
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `NIP-${tenantId.slice(0, 8)}-${Date.now()}-${random}`;
}

/**
 * Validate a NUBAN account number (10 digits, numeric).
 */
export function validateNuban(accountNumber: string): boolean {
  return /^\d{10}$/.test(accountNumber);
}

/**
 * Validate a CBN bank code (3–6 digits).
 */
export function validateBankCode(bankCode: string): boolean {
  return /^\d{3,6}$/.test(bankCode);
}

/** Typed error for NIBSS operations */
export class NibssError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly nibssResponseCode?: string
  ) {
    super(message);
    this.name = 'NibssError';
  }
}
