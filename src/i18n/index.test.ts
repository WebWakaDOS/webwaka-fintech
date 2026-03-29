import { describe, it, expect } from 'vitest';
import { toSubunit, formatCurrency, ACCOUNT_TYPE_LABELS, TRANSACTION_TYPE_LABELS } from './index';

describe('i18n utilities', () => {
  it('toSubunit converts major currency to kobo integers', () => {
    expect(toSubunit(100, 'NGN')).toBe(10000);
    expect(toSubunit(100.5, 'NGN')).toBe(10050);
    expect(toSubunit(50, 'GHS')).toBe(5000);
  });

  it('formatCurrency formats kobo correctly', () => {
    // 10000 kobo = 100 NGN
    const formatted = formatCurrency(10000, 'NGN', 'en-NG');
    expect(formatted).toContain('100');
  });

  it('contains labels for savings account', () => {
    expect(ACCOUNT_TYPE_LABELS.savings['en-NG']).toBe('Savings Account');
    expect(ACCOUNT_TYPE_LABELS.savings['yo-NG']).toBe('Akaunti Ifowopamọ');
  });

  it('contains labels for deposit', () => {
    expect(TRANSACTION_TYPE_LABELS.deposit['en-NG']).toBe('Deposit');
    expect(TRANSACTION_TYPE_LABELS.deposit['yo-NG']).toBe('Idogo');
  });
});
