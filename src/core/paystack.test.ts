import { describe, it, expect } from 'vitest';
import { generatePaymentReference } from './paystack';

describe('Paystack utilities', () => {
  it('generatePaymentReference creates unique references', () => {
    const ref1 = generatePaymentReference('tenant123');
    const ref2 = generatePaymentReference('tenant123');
    
    expect(ref1).toMatch(/^FIN-tenant12/);
    expect(ref1).not.toBe(ref2);
  });
});
