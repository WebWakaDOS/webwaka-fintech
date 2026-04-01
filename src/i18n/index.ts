/**
 * Internationalisation — WebWaka Fintech Suite
 *
 * Invariant 5: Nigeria First — en-NG is the default locale
 * Invariant 6: Africa First — 7 locales supported
 *
 * Currency: All amounts stored as kobo integers (NGN × 100).
 * NEVER store naira floats. ALWAYS convert to kobo before DB writes.
 */

export const DEFAULT_LOCALE = 'en-NG';
export const SUPPORTED_LOCALES = ['en-NG', 'en-GH', 'en-KE', 'en-ZA', 'fr-CI', 'yo-NG', 'ha-NG'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

// Currency subunit multipliers (all × 100 for kobo/pesewa/cent)
const CURRENCY_SUBUNIT: Record<string, number> = {
  NGN: 100, GHS: 100, KES: 100, ZAR: 100, XOF: 100,
};

/**
 * Convert a major currency unit to its subunit (kobo, pesewa, cent).
 * Always returns an integer — Invariant 5: Nigeria First.
 */
export function toSubunit(amount: number, currency: string): number {
  const multiplier = CURRENCY_SUBUNIT[currency] ?? 100;
  return Math.round(amount * multiplier);
}

/**
 * Format a kobo integer amount as a human-readable currency string.
 * @param amountKobo — amount in kobo (integer)
 * @param currency — ISO 4217 currency code
 * @param locale — BCP 47 locale string (defaults to en-NG)
 */
export function formatCurrency(amountKobo: number, currency: string, locale: SupportedLocale = DEFAULT_LOCALE): string {
  const majorAmount = amountKobo / (CURRENCY_SUBUNIT[currency] ?? 100);
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(majorAmount);
}

// Nigerian account types
// Use AccountType as key to enable exhaustive type-safe indexing (noUncheckedIndexedAccess)
export const ACCOUNT_TYPE_LABELS: Record<'savings' | 'current' | 'corporate' | 'fixed_deposit', Record<SupportedLocale, string>> = {
  savings: {
    'en-NG': 'Savings Account', 'en-GH': 'Savings Account', 'en-KE': 'Savings Account',
    'en-ZA': 'Savings Account', 'fr-CI': 'Compte d\'Épargne', 'yo-NG': 'Akaunti Ifowopamọ', 'ha-NG': 'Asusun Ajiya',
  },
  current: {
    'en-NG': 'Current Account', 'en-GH': 'Current Account', 'en-KE': 'Current Account',
    'en-ZA': 'Cheque Account', 'fr-CI': 'Compte Courant', 'yo-NG': 'Akaunti Lọwọlọwọ', 'ha-NG': 'Asusun Yanzu',
  },
  corporate: {
    'en-NG': 'Corporate Account', 'en-GH': 'Corporate Account', 'en-KE': 'Business Account',
    'en-ZA': 'Business Account', 'fr-CI': 'Compte d\'Entreprise', 'yo-NG': 'Akaunti Ile-iṣẹ', 'ha-NG': 'Asusun Kamfanin',
  },
  fixed_deposit: {
    'en-NG': 'Fixed Deposit', 'en-GH': 'Fixed Deposit', 'en-KE': 'Fixed Deposit',
    'en-ZA': 'Fixed Deposit', 'fr-CI': 'Dépôt à Terme', 'yo-NG': 'Akaunti Idogo', 'ha-NG': 'Ajiya Kafaffen',
  },
};

// Transaction types
// Use TransactionType subset as key to enable exhaustive type-safe indexing
export const TRANSACTION_TYPE_LABELS: Record<'deposit' | 'withdrawal' | 'transfer', Record<SupportedLocale, string>> = {
  deposit: {
    'en-NG': 'Deposit', 'en-GH': 'Deposit', 'en-KE': 'Deposit',
    'en-ZA': 'Deposit', 'fr-CI': 'Dépôt', 'yo-NG': 'Idogo', 'ha-NG': 'Ajiya',
  },
  withdrawal: {
    'en-NG': 'Withdrawal', 'en-GH': 'Withdrawal', 'en-KE': 'Withdrawal',
    'en-ZA': 'Withdrawal', 'fr-CI': 'Retrait', 'yo-NG': 'Yiyọ', 'ha-NG': 'Cirewa',
  },
  transfer: {
    'en-NG': 'Transfer', 'en-GH': 'Transfer', 'en-KE': 'Transfer',
    'en-ZA': 'Transfer', 'fr-CI': 'Transfert', 'yo-NG': 'Gbigbe', 'ha-NG': 'Canja wuri',
  },
};
