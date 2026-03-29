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

/**
 * Generate a unique Paystack payment reference for fintech transactions.
 * Format: FIN-{tenantId}-{timestamp}-{random}
 */
export function generatePaymentReference(tenantId: string): string {
  const random = Math.random().toString(36).slice(2, 7);
  return `FIN-${tenantId.slice(0, 8)}-${Date.now()}-${random}`;
}
