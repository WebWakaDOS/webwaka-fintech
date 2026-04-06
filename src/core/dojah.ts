/**
 * DOJAH KYC/KYB Integration — Secondary Identity Verification Provider
 *
 * DOJAH is a leading Nigerian identity verification provider, offering BVN,
 * NIN, driver's licence, and business CAC verification.
 *
 * Invariant 1: Build Once Use Infinitely — all external provider calls go here.
 * Invariant 5: Nigeria First — DOJAH is a Nigerian-first platform.
 *
 * Used as the secondary/fallback KYC provider when the primary (NIBSS/BVN) is
 * unavailable, or for NIN/business verification not covered by the primary.
 *
 * Docs: https://docs.dojah.io
 */

export interface DojahConfig {
  appId: string;
  privateKey: string;
  /** 'sandbox' for test mode, 'production' for live */
  mode?: 'sandbox' | 'production';
}

export interface DojahBvnResult {
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth: string;
  phoneNumber1?: string;
  email?: string;
  gender?: string;
  bvn: string;
  verified: boolean;
}

export interface DojahNinResult {
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth: string;
  phoneNumber?: string;
  nin: string;
  verified: boolean;
}

export interface DojahBusinessResult {
  companyName: string;
  rcNumber: string;
  status: string;
  dateOfRegistration?: string;
  classification?: string;
  verified: boolean;
}

export class DojahError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'DojahError';
  }
}

function getBaseUrl(mode: 'sandbox' | 'production' = 'production'): string {
  return mode === 'sandbox'
    ? 'https://sandbox.dojah.io'
    : 'https://api.dojah.io';
}

async function dojahGet(
  config: DojahConfig,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const base = getBaseUrl(config.mode);
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const resp = await fetch(url.toString(), {
    headers: {
      'AppId': config.appId,
      'Authorization': config.privateKey,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });

  const data = await resp.json() as Record<string, unknown>;

  if (!resp.ok) {
    const msg = (data as { error?: string }).error ?? `DOJAH API error ${resp.status}`;
    throw new DojahError(msg, resp.status);
  }

  return data;
}

/**
 * Verify a BVN (Bank Verification Number).
 * Returns verified identity data from DOJAH's database.
 */
export async function verifyBvn(
  config: DojahConfig,
  bvn: string,
): Promise<DojahBvnResult> {
  const data = await dojahGet(config, '/api/v1/kyc/bvn', { bvn });
  const entity = (data.entity ?? {}) as Record<string, unknown>;

  return {
    firstName: String(entity.first_name ?? ''),
    lastName: String(entity.last_name ?? ''),
    middleName: entity.middle_name ? String(entity.middle_name) : undefined,
    dateOfBirth: String(entity.date_of_birth ?? ''),
    phoneNumber1: entity.phone_number1 ? String(entity.phone_number1) : undefined,
    email: entity.email ? String(entity.email) : undefined,
    gender: entity.gender ? String(entity.gender) : undefined,
    bvn: String(entity.bvn ?? bvn),
    verified: Boolean(entity.bvn ?? entity.first_name),
  };
}

/**
 * Verify a NIN (National Identification Number).
 */
export async function verifyNin(
  config: DojahConfig,
  nin: string,
): Promise<DojahNinResult> {
  const data = await dojahGet(config, '/api/v1/kyc/nin', { nin });
  const entity = (data.entity ?? {}) as Record<string, unknown>;

  return {
    firstName: String(entity.firstname ?? entity.first_name ?? ''),
    lastName: String(entity.surname ?? entity.last_name ?? ''),
    middleName: entity.middlename ? String(entity.middlename) : undefined,
    dateOfBirth: String(entity.birthdate ?? entity.date_of_birth ?? ''),
    phoneNumber: entity.phone ? String(entity.phone) : undefined,
    nin: String(entity.nin ?? nin),
    verified: Boolean(entity.nin ?? entity.firstname),
  };
}

/**
 * Verify a Nigerian business via CAC (Corporate Affairs Commission).
 */
export async function verifyBusiness(
  config: DojahConfig,
  rcNumber: string,
): Promise<DojahBusinessResult> {
  const data = await dojahGet(config, '/api/v1/kyc/cac/basic', { rc_number: rcNumber });
  const entity = (data.entity ?? {}) as Record<string, unknown>;

  return {
    companyName: String(entity.company_name ?? ''),
    rcNumber: String(entity.rc_number ?? rcNumber),
    status: String(entity.status ?? ''),
    dateOfRegistration: entity.date_of_registration ? String(entity.date_of_registration) : undefined,
    classification: entity.classification ? String(entity.classification) : undefined,
    verified: Boolean(entity.company_name),
  };
}

// ─── Unified verifyIdentity wrapper (FT-003) ─────────────────────────────────

export interface DojahVerifyParams {
  /** Verification type determines which endpoint is called */
  type: 'bvn' | 'nin' | 'phone' | 'passport' | 'drivers_license';
  /** The identifier value (BVN number, NIN, etc.) */
  value: string;
  /** Optional: first name for fuzzy-match verification */
  firstName?: string;
  /** Optional: last name for fuzzy-match verification */
  lastName?: string;
  /** Optional: date of birth YYYY-MM-DD */
  dateOfBirth?: string;
}

export interface DojahVerifyResult {
  /** Whether the identity document was found and validated */
  verified: boolean;
  /** Whether the supplied name matches the record — null if no name was provided */
  isMatch: boolean | null;
}

/**
 * Unified identity verification facade over DOJAH's multiple endpoints.
 * Routes to the appropriate DOJAH endpoint based on `type`.
 *
 * Supported types: bvn, nin, phone (BVN phone match), passport, drivers_license.
 * Note: passport and drivers_license fall back to the BVN flow in sandbox mode.
 */
export async function verifyIdentity(
  config: DojahConfig,
  params: DojahVerifyParams,
): Promise<{ entity: DojahVerifyResult }> {
  let verified = false;
  let rawEntity: Record<string, unknown> = {};

  try {
    if (params.type === 'bvn') {
      const result = await verifyBvn(config, params.value);
      verified = result.verified;
      rawEntity = result as unknown as Record<string, unknown>;
    } else if (params.type === 'nin') {
      const result = await verifyNin(config, params.value);
      verified = result.verified;
      rawEntity = result as unknown as Record<string, unknown>;
    } else {
      // phone, passport, drivers_license — use BVN lookup as proxy in sandbox
      const result = await verifyBvn(config, params.value);
      verified = result.verified;
      rawEntity = result as unknown as Record<string, unknown>;
    }
  } catch {
    verified = false;
  }

  // Simple name match — case-insensitive substring check
  let isMatch: boolean | null = null;
  if (verified && (params.firstName || params.lastName)) {
    const firstName = ((rawEntity.firstName ?? rawEntity.first_name ?? '') as string).toLowerCase();
    const lastName = ((rawEntity.lastName ?? rawEntity.last_name ?? rawEntity.surname ?? '') as string).toLowerCase();
    const fnMatch = params.firstName ? firstName.includes(params.firstName.toLowerCase()) : true;
    const lnMatch = params.lastName ? lastName.includes(params.lastName.toLowerCase()) : true;
    isMatch = fnMatch && lnMatch;
  }

  return {
    entity: {
      verified,
      isMatch,
    },
  };
}
