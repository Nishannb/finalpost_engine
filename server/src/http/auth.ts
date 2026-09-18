/**
 * Two accepted callers:
 *
 *  1. The Kinmel Python API, using the shared `x-engine-key` header and naming
 *     the end user in the body (`userId`) — this is the normal production path.
 *  2. The mobile app directly, using its Supabase access token, verified here
 *     against the project's JWT secret so quotas key off a real user id.
 */

import {createHmac, timingSafeEqual} from 'node:crypto';

import type {NextFunction, Request, Response} from 'express';

import {env} from '../config/env.ts';
import {EngineError} from '../lib/errors.ts';

export type AuthContext = {
  userId: string;
  via: 'dev' | 'service-key' | 'supabase-jwt';
};

export function getAuth(res: Response): AuthContext {
  const auth = res.locals.auth as AuthContext | undefined;
  if (!auth) {
    throw new EngineError('unauthorized', 'Missing authentication context');
  }
  return auth;
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (env.NODE_ENV !== 'production' && env.DEV_AUTH_BYPASS) {
    res.locals.auth = {userId: 'dev-user', via: 'dev'} satisfies AuthContext;
    next();
    return;
  }

  const engineKey = String(req.header('x-engine-key') ?? '');
  if (env.ENGINE_API_KEY && engineKey && safeEquals(engineKey, env.ENGINE_API_KEY)) {
    const body = (req.body ?? {}) as {userId?: unknown};
    const userId = String(body.userId ?? req.query.userId ?? '').trim();
    if (!userId) {
      next(
        new EngineError(
          'bad_request',
          'Service-key callers must include `userId` so usage can be metered',
        ),
      );
      return;
    }
    res.locals.auth = {userId, via: 'service-key'} satisfies AuthContext;
    next();
    return;
  }

  const bearer = String(req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (bearer && env.SUPABASE_JWT_SECRET) {
    const userId = verifySupabaseJwt(bearer, env.SUPABASE_JWT_SECRET);
    if (userId) {
      res.locals.auth = {userId, via: 'supabase-jwt'} satisfies AuthContext;
      next();
      return;
    }
  }

  next(new EngineError('unauthorized', 'Unauthorized'));
}

/**
 * HS256 verification without a JWT dependency.
 *
 * Supabase signs access tokens with the project secret, so this is a signature
 * check plus an expiry check — nothing exotic, and it keeps the dependency tree
 * small on a memory-constrained host.
 */
export function verifySupabaseJwt(token: string, secret: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [header, payload, signature] = parts as [string, string, string];

  const expected = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  if (!safeEquals(signature, expected)) {
    return null;
  }

  let claims: {sub?: string; exp?: number; aud?: string};
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && claims.exp <= now) {
    return null;
  }
  const sub = String(claims.sub ?? '').trim();
  return sub || null;
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
