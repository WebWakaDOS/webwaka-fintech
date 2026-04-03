/**
 * Shared types for WebWaka Fintech Suite
 * All monetary values are in kobo (NGN × 100) — Invariant 5: Nigeria First
 */

import type { AuthUser } from '@webwaka/core';

export interface Bindings {
  DB: D1Database;
  SESSIONS_KV: KVNamespace;
  RATE_LIMIT_KV: KVNamespace;
  MEDIA_BUCKET: R2Bucket;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  PAYSTACK_SECRET_KEY: string;
  OPENROUTER_API_KEY: string;
  TERMII_API_KEY: string;
  /** NIBSS NIP bank partner credentials */
  NIBSS_BASE_URL: string;
  NIBSS_CLIENT_ID: string;
  NIBSS_CLIENT_SECRET: string;
  /** CBN bank code of the sending institution (e.g. "000001") */
  NIBSS_SOURCE_BANK_CODE: string;
  /** Source account number held at the clearing bank */
  NIBSS_SOURCE_ACCOUNT_NUMBER: string;
  /** Event Bus URL for cross-repo events (optional: silently skipped if absent) */
  EVENT_BUS_URL?: string;
  EVENT_BUS_SECRET?: string;
}

/**
 * Hono Variables — typed context values injected by jwtAuthMiddleware.
 * Use with Hono<{ Bindings: Bindings; Variables: AppVariables }>.
 */
export interface AppVariables {
  /** Authenticated user — set by jwtAuthMiddleware from @webwaka/core */
  user: AuthUser;
  /** Tenant ID — ALWAYS sourced from JWT payload, NEVER from headers */
  tenantId: string;
}


export type AccountType = 'savings' | 'current' | 'corporate' | 'fixed_deposit';
export type AccountStatus = 'active' | 'dormant' | 'frozen' | 'closed';
export type TransactionType = 'deposit' | 'withdrawal' | 'transfer' | 'fee' | 'interest';
export type TransactionStatus = 'pending' | 'success' | 'failed' | 'reversed';

export interface BankAccount {
  id: string;
  tenantId: string;
  accountNumber: string;
  customerId: string;
  accountType: AccountType;
  balanceKobo: number; // ALWAYS kobo — Invariant 5
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  tenantId: string;
  accountId: string;
  type: TransactionType;
  amountKobo: number; // ALWAYS kobo
  reference: string;
  status: TransactionStatus;
  description: string;
  createdAt: string;
}

export interface InsurancePolicy {
  id: string;
  tenantId: string;
  customerId: string;
  policyType: 'life' | 'health' | 'vehicle' | 'property';
  premiumKobo: number; // ALWAYS kobo
  coverageKobo: number; // ALWAYS kobo
  status: 'active' | 'lapsed' | 'cancelled' | 'claimed';
  startDate: string;
  endDate: string;
  createdAt: string;
}

export interface InvestmentPortfolio {
  id: string;
  tenantId: string;
  customerId: string;
  assetClass: 'stocks' | 'bonds' | 'real_estate' | 'crypto';
  principalKobo: number; // ALWAYS kobo
  currentValueKobo: number; // ALWAYS kobo
  status: 'active' | 'liquidated';
  createdAt: string;
}

// ─── NIBSS NIP Payout Types ───────────────────────────────────────────────────

/** All possible lifecycle states for a payout request */
export type PayoutStatus = 'pending' | 'processing' | 'confirmed' | 'failed' | 'reversed';

/**
 * Platform-initiated payout to any Nigerian bank account via NIBSS NIP.
 * Invariant 5: Nigeria First — amountKobo is always in kobo.
 */
export interface PayoutRequest {
  id: string;
  tenantId: string;
  /** Internal reference (e.g. rider commission batch ID, vendor payout ID) */
  initiatorId: string;
  /** Free-text category: 'vendor_payout' | 'rider_commission' | 'driver_settlement' | 'refund' */
  payoutType: string;
  /** Amount in kobo — ALWAYS kobo (Invariant 5) */
  amountKobo: number;
  /** Destination account number (10 digits, NUBAN) */
  destinationAccountNumber: string;
  /** CBN bank code of the destination bank */
  destinationBankCode: string;
  /** Account name as returned by NIBSS Name Enquiry */
  destinationAccountName: string;
  /** Human-readable narration (max 100 chars) */
  narration: string;
  /** Unique NIBSS payment reference */
  nibssReference: string;
  /** Reference returned by NIBSS upon successful submission */
  nibssSessionId?: string;
  status: PayoutStatus;
  /** ISO-8601 timestamp when NIBSS confirmed or failed the transfer */
  settledAt?: string;
  /** Error message if status is 'failed' */
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** Request body to initiate a new payout */
export interface InitiatePayoutBody {
  initiatorId: string;
  payoutType: string;
  amountKobo: number;
  destinationAccountNumber: string;
  destinationBankCode: string;
  narration: string;
}

/** Webhook payload sent by the bank partner after NIBSS NIP transfer settles */
export interface NibssWebhookPayload {
  /** The nibssReference we sent on initiation */
  paymentReference: string;
  sessionId: string;
  status: 'successful' | 'failed' | 'reversed';
  /** Amount the bank settled (kobo) */
  settledAmountKobo: number;
  responseCode: string;
  responseMessage: string;
  settledAt: string;
}
