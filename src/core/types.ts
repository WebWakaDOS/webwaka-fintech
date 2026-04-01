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
