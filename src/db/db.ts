/**
 * Offline Database — WebWaka Fintech Suite
 *
 * Invariant 4: Offline First
 * Uses Dexie (IndexedDB wrapper) for client-side offline storage.
 * All data is synced to Cloudflare D1 when connectivity is restored.
 *
 * All monetary amounts stored as kobo integers — Invariant 5: Nigeria First
 */

import Dexie, { type Table } from 'dexie';
import type { BankAccount, Transaction, InsurancePolicy, InvestmentPortfolio } from '../core/types';

interface MutationQueueEntry {
  id?: number;
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  payload: unknown;
  tenantId: string;
  createdAt: string;
  retryCount: number;
}

export class FintechOfflineDB extends Dexie {
  fint_bankAccounts!: Table<BankAccount>;
  fint_transactions!: Table<Transaction>;
  fint_insurancePolicies!: Table<InsurancePolicy>;
  fint_investmentPortfolios!: Table<InvestmentPortfolio>;
  mutationQueue!: Table<MutationQueueEntry>;

  constructor() {
    super('webwaka-fintech');
    this.version(1).stores({
      fint_bankAccounts: 'id, tenantId, accountNumber, customerId, status',
      fint_transactions: 'id, tenantId, accountId, type, status, reference',
      fint_insurancePolicies: 'id, tenantId, customerId, policyType, status',
      fint_investmentPortfolios: 'id, tenantId, customerId, assetClass, status',
      mutationQueue: '++id, tenantId, createdAt',
    });
  }
}

export const db = new FintechOfflineDB();

/**
 * Enqueue a mutation for background sync when offline.
 * All kobo amounts must be integers before enqueueing.
 */
export async function enqueueMutation(
  endpoint: string,
  method: MutationQueueEntry['method'],
  payload: unknown,
  tenantId: string
): Promise<void> {
  await db.mutationQueue.add({
    endpoint,
    method,
    payload,
    tenantId,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  });
}

/**
 * Process the mutation queue when connectivity is restored.
 * Called by the service worker on 'online' event.
 */
export async function processMutationQueue(apiBaseUrl: string, jwtToken: string): Promise<void> {
  const entries = await db.mutationQueue.orderBy('createdAt').toArray();
  for (const entry of entries) {
    try {
      const response = await fetch(`${apiBaseUrl}${entry.endpoint}`, {
        method: entry.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwtToken}`,
        },
        body: JSON.stringify(entry.payload),
      });
      if (response.ok && entry.id !== undefined) {
        await db.mutationQueue.delete(entry.id);
      } else if (entry.id !== undefined) {
        await db.mutationQueue.update(entry.id, { retryCount: entry.retryCount + 1 });
      }
    } catch {
      if (entry.id !== undefined) {
        await db.mutationQueue.update(entry.id, { retryCount: entry.retryCount + 1 });
      }
    }
  }
}
