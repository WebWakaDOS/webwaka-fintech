/**
 * Auth middleware re-exports — WebWaka Fintech Suite
 *
 * Invariant 1: Build Once Use Infinitely
 * ALL auth primitives come from @webwaka/core.
 * NEVER re-implement verifyJWT, requireRole, secureCORS, or rateLimit here.
 */
export {
  verifyJWT,
  signJWT,
  requireRole,
  jwtAuthMiddleware,
  secureCORS,
  rateLimit,
} from '@webwaka/core';
