/**
 * Accepted callers:
 *
 *  1. Shared `x-engine-key` + `userId` (service / Python API).
 *  2. Mobile Supabase access token — either:
 *     - ES256/RS256 via project JWKS (`jose`), or
 *     - Auth `/user` introspection fallback, or
 *     - HS256 via Legacy JWT Secret.
 */

import {createHmac, timingSafeEqual} from 'node:crypto';

import type {NextFunction, Request, Response} from 'express';
import * as jose from 'jose';

import {env} from '../config/env.ts';
import {EngineError} from '../lib/errors.ts';
import {logger} from '../lib/logger.ts';

export type AuthContext = {
  userId: string;
  via: 'dev' | 'service-key' | 'supabase-jwt';
};

type JwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

type AuthFailReason =
  | 'dev_bypass'
  | 'missing_bearer'
  | 'missing_supabase_config'
  | 'unsupported_alg'
  | 'invalid_or_expired_token'
  | 'jwks_error'
  | 'ok';

let remoteJwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

export function getAuth(res: Response): AuthContext {
  const auth = res.locals.auth as AuthContext | undefined;
  if (!auth) {
    throw new EngineError('unauthorized', 'Missing authentication context');
  }
  return auth;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
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
    if (!bearer) {
      logAuthFailure(req, 'missing_bearer');
      next(
        new EngineError('unauthorized', 'Unauthorized', {
          reason: 'missing_bearer',
        }),
      );
      return;
    }

    if (!env.SUPABASE_URL && !env.SUPABASE_JWT_SECRET) {
      logAuthFailure(req, 'missing_supabase_config');
      next(
        new EngineError('unauthorized', 'Unauthorized', {
          reason: 'missing_supabase_config',
        }),
      );
      return;
    }

    const verified = await verifySupabaseAccessTokenDetailed(bearer);
    if (verified.userId) {
      res.locals.auth = {
        userId: verified.userId,
        via: 'supabase-jwt',
      } satisfies AuthContext;
      next();
      return;
    }

    logAuthFailure(req, verified.reason, verified.alg, verified.detail);
    next(
      new EngineError('unauthorized', 'Unauthorized', {
        reason: verified.reason,
        alg: verified.alg,
      }),
    );
  } catch (error) {
    logger.error({error, path: req.path}, 'auth middleware error');
    next(error);
  }
}

/** Public entry used by tests and callers. */
export async function verifySupabaseAccessToken(token: string): Promise<string | null> {
  const result = await verifySupabaseAccessTokenDetailed(token);
  return result.userId;
}

async function verifySupabaseAccessTokenDetailed(token: string): Promise<{
  userId: string | null;
  reason: AuthFailReason;
  alg?: string;
  detail?: string;
}> {
  const header = decodeJwtHeader(token);
  if (!header?.alg) {
    return {userId: null, reason: 'invalid_or_expired_token', detail: 'bad_header'};
  }

  if (header.alg === 'HS256') {
    if (!env.SUPABASE_JWT_SECRET) {
      return {
        userId: null,
        reason: 'missing_supabase_config',
        alg: header.alg,
        detail: 'hs256_without_secret',
      };
    }
    const userId = verifySupabaseJwtHs256(token, env.SUPABASE_JWT_SECRET);
    return {
      userId,
      reason: userId ? 'ok' : 'invalid_or_expired_token',
      alg: header.alg,
    };
  }

  if (header.alg === 'ES256' || header.alg === 'RS256') {
    if (!env.SUPABASE_URL) {
      return {
        userId: null,
        reason: 'missing_supabase_config',
        alg: header.alg,
        detail: 'asymmetric_without_supabase_url',
      };
    }

    try {
      const fromJwks = await verifySupabaseJwtJwks(token);
      if (fromJwks) {
        return {userId: fromJwks, reason: 'ok', alg: header.alg};
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn({alg: header.alg, detail}, 'jwks verify failed; trying auth /user');
      // Fall through to Auth API introspection.
      const fromAuth = await verifyViaSupabaseAuthUser(token);
      if (fromAuth) {
        return {userId: fromAuth, reason: 'ok', alg: header.alg};
      }
      return {userId: null, reason: 'jwks_error', alg: header.alg, detail};
    }

    const fromAuth = await verifyViaSupabaseAuthUser(token);
    if (fromAuth) {
      return {userId: fromAuth, reason: 'ok', alg: header.alg};
    }
    return {
      userId: null,
      reason: 'invalid_or_expired_token',
      alg: header.alg,
    };
  }

  return {userId: null, reason: 'unsupported_alg', alg: header.alg};
}

/**
 * @deprecated Prefer verifySupabaseAccessToken — kept for callers/tests that
 * only exercise the legacy HS256 path.
 */
export function verifySupabaseJwt(token: string, secret: string): string | null {
  return verifySupabaseJwtHs256(token, secret);
}

function verifySupabaseJwtHs256(token: string, secret: string): string | null {
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

  return readSubIfValid(payload);
}

async function verifySupabaseJwtJwks(token: string): Promise<string | null> {
  const jwks = getRemoteJwks();
  const {payload} = await jose.jwtVerify(token, jwks, {
    algorithms: ['ES256', 'RS256'],
  });
  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  return sub || null;
}

/**
 * Authoritative fallback: ask Supabase Auth if this access token is valid.
 * Needs SUPABASE_ANON_KEY (public) + SUPABASE_URL.
 */
async function verifyViaSupabaseAuthUser(token: string): Promise<string | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return null;
  }
  const base = env.SUPABASE_URL.replace(/\/+$/, '');
  const response = await fetch(`${base}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.SUPABASE_ANON_KEY,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    logger.warn(
      {status: response.status},
      'supabase /auth/v1/user rejected access token',
    );
    return null;
  }
  const body = (await response.json()) as {id?: unknown};
  const id = String(body.id ?? '').trim();
  return id || null;
}

function getRemoteJwks(): ReturnType<typeof jose.createRemoteJWKSet> {
  if (!remoteJwks) {
    const base = env.SUPABASE_URL.replace(/\/+$/, '');
    remoteJwks = jose.createRemoteJWKSet(
      new URL(`${base}/auth/v1/.well-known/jwks.json`),
    );
  }
  return remoteJwks;
}

/** Test helper — clear JWKS cache between cases. */
export function clearJwksCacheForTests(): void {
  remoteJwks = null;
}

function decodeJwtHeader(token: string): JwtHeader | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as JwtHeader;
  } catch {
    return null;
  }
}

function readSubIfValid(payloadB64: string): string | null {
  let claims: {sub?: string; exp?: number};
  try {
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
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

function logAuthFailure(
  req: Request,
  reason: AuthFailReason,
  alg?: string,
  detail?: string,
): void {
  logger.warn(
    {
      path: req.path,
      method: req.method,
      reason,
      alg: alg ?? null,
      detail: detail ?? null,
      hasSupabaseUrl: Boolean(env.SUPABASE_URL),
      hasJwtSecret: Boolean(env.SUPABASE_JWT_SECRET),
      hasAnonKey: Boolean(env.SUPABASE_ANON_KEY),
      hasBearer: Boolean(req.header('authorization')),
    },
    'auth rejected',
  );
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
