/**
 * Paystack Integration — WebWaka Fintech Suite
 *
 * Invariant 5: Nigeria First
 * ALL monetary amounts are in kobo (NGN × 100) integers.
 * NEVER pass naira amounts to Paystack — always convert to kobo first.
 *
 * Use cases: Account funding, premium payments, investment deposits
 */

export interface PaystackInitializeParams {
  emailAddress: string;
  amountKobo: number; // MUST be kobo integer
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
  channels?: ('card' | 'bank' | 'ussd' | 'qr' | 'mobile_money' | 'bank_transfer')[];
}

export interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: { authorization_url: string; access_code: string; reference: string };
}

export interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    status: 'success' | 'failed' | 'abandoned';
    reference: string;
    amount: number; // kobo
    currency: string;
    paid_at: string;
    metadata: Record<string, unknown>;
  };
}

export async function initializePayment(
  secretKey: string,
  params: PaystackInitializeParams
): Promise<PaystackInitializeResponse> {
  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: params.emailAddress,
      amount: params.amountKobo, // Paystack expects kobo
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
      channels: params.channels,
    }),
  });
  if (!response.ok) throw new Error(`Paystack initialize failed: ${response.status}`);
  return response.json() as Promise<PaystackInitializeResponse>;
}

export async function verifyPayment(secretKey: string, reference: string): Promise<PaystackVerifyResponse> {
  const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!response.ok) throw new Error(`Paystack verify failed: ${response.status}`);
  return response.json() as Promise<PaystackVerifyResponse>;
}

export interface PaystackRefundResponse {
  status: boolean;
  message: string;
  data: {
    transaction: { id: number; reference: string; amount: number };
    dispute?: { id: number };
    refund: { id: number; amount: number; currency: string; status: string };
  };
}

export interface PaystackWebhookEvent {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Process a refund for a previously successful Paystack transaction.
 *
 * @param secretKey    Paystack secret key
 * @param reference    Original transaction reference
 * @param amountKobo   Amount to refund in kobo. Omit to refund full amount.
 * @param merchantNote Optional merchant note explaining the refund
 */
export async function refundPayment(
  secretKey: string,
  reference: string,
  amountKobo?: number,
  merchantNote?: string,
): Promise<PaystackRefundResponse> {
  const body: Record<string, unknown> = { transaction: reference };
  if (amountKobo !== undefined) body.amount = amountKobo;
  if (merchantNote) body.merchant_note = merchantNote;

  const response = await fetch('https://api.paystack.co/refund', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(`Paystack refund failed (${response.status}): ${err.message ?? 'Unknown'}`);
  }
  return response.json() as Promise<PaystackRefundResponse>;
}

/**
 * Verify a Paystack webhook request using HMAC-SHA256 signature.
 * The signature is in the 'x-paystack-signature' header.
 *
 * @returns true if the signature matches, false otherwise
 */
export async function verifyPaystackWebhook(
  rawBody: string,
  signature: string,
  secretKey: string,
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secretKey),
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign'],
    );
    const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
    const computed = Array.from(new Uint8Array(sigBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return computed === signature;
  } catch {
    return false;
  }
}

/**
 * Generate a unique Paystack payment reference for fintech transactions.
 * Format: FIN-{tenantId}-{timestamp}-{random}
 */
export function generatePaymentReference(tenantId: string): string {
  const random = Math.random().toString(36).slice(2, 7);
  return `FIN-${tenantId.slice(0, 8)}-${Date.now()}-${random}`;
}
