/**
 * Local mock of @webwaka/core for vitest testing.
 * In production, the real @webwaka/core package is used.
 */

export type WebWakaRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'INSTITUTION_ADMIN' | 'STAFF' | 'VIEWER';

export interface JWTPayload {
  sub: string;
  tenantId: string;
  role: WebWakaRole;
  iat: number;
  exp: number;
}

export async function validateJWT(_token: string, _secret: string): Promise<JWTPayload | null> {
  return {
    sub: 'user-test-123',
    tenantId: 'tenant-inst-123',
    role: 'INSTITUTION_ADMIN',
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

export async function signJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>, _secret: string): Promise<string> {
  return `mock.jwt.${payload.sub}.${payload.tenantId}`;
}

export function requireRole(_allowedRoles: WebWakaRole[]) {
  return async (_c: unknown, next: () => Promise<void>) => { await next(); };
}

export function jwtAuthMiddleware(_jwtSecret: string, _sessionsKV: unknown) {
  return async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    await next();
  };
}

export function secureCORS(_environment: string) {
  return async (_c: unknown, next: () => Promise<void>) => { await next(); };
}

export function rateLimit(_kv: unknown, _opts: { maxRequests: number; windowSeconds: number }) {
  return async (_c: unknown, next: () => Promise<void>) => { await next(); };
}
