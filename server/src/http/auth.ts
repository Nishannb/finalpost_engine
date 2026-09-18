/**
 * Accepted callers:
 *
 *  1. Shared `x-engine-key` + `userId` (service / Python API).
 *  2. Mobile Supabase access token — either:
 *     - ES256/RS256 via project JWKS (current Supabase signing keys), or
 *     - HS256 via Legacy JWT Secret (backward compatible).
 */

import {createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify} from 'node:crypto';

import type {NextFunction, Request, Response} from 'express';

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

type Jwk = {
  kty?: string;
  kid?: string;
  alg?: string;
  use?: string;
  crv?: string;
  x?: string;
  y?: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
};
type Jwks = {keys: Jwk[]};

const JWKS_TTL_MS = 10 * 60 * 1000;
let jwksCache: {fetchedAt: number; keys: Jwk[]} | null = null;

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
    if (bearer && (env.SUPABASE_URL || env.SUPABASE_JWT_SECRET)) {
      const userId = await verifySupabaseAccessToken(bearer);
      if (userId) {
        res.locals.auth = {userId, via: 'supabase-jwt'} satisfies AuthContext;
        next();
        return;
      }
    }

    next(new EngineError('unauthorized', 'Unauthorized'));
  } catch (error) {
    next(error);
  }
}

/** Public entry: pick HS256 legacy vs JWKS asymmetric from the token header. */
export async function verifySupabaseAccessToken(token: string): Promise<string | null> {
  const header = decodeJwtHeader(token);
  if (!header?.alg) {
    return null;
  }

  if (header.alg === 'HS256') {
    if (!env.SUPABASE_JWT_SECRET) {
      return null;
    }
    return verifySupabaseJwtHs256(token, env.SUPABASE_JWT_SECRET);
  }

  if (header.alg === 'ES256' || header.alg === 'RS256') {
    if (!env.SUPABASE_URL) {
      logger.warn(
        {alg: header.alg},
        'supabase asymmetric JWT received but SUPABASE_URL is not set',
      );
      return null;
    }
    return verifySupabaseJwtJwks(token, header);
  }

  logger.warn({alg: header.alg}, 'unsupported supabase JWT alg');
  return null;
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

async function verifySupabaseJwtJwks(
  token: string,
  header: JwtHeader,
): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  const keys = await loadJwks();
  const jwk =
    (header.kid ? keys.find(k => k.kid === header.kid) : undefined) ??
    keys.find(k => !header.alg || k.alg === header.alg || !k.alg) ??
    keys[0];
  if (!jwk) {
    return null;
  }

  let key;
  try {
    key = createPublicKey({key: jwk, format: 'jwk'});
  } catch (error) {
    logger.warn({error, kid: header.kid}, 'failed to import supabase JWK');
    return null;
  }

  const data = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = Buffer.from(signatureB64, 'base64url');
  const ok = cryptoVerify(
    header.alg === 'RS256' ? 'RSA-SHA256' : 'SHA256',
    data,
    {
      key,
      dsaEncoding: 'ieee-p1363',
    },
    signature,
  );
  if (!ok) {
    return null;
  }

  return readSubIfValid(payloadB64);
}

async function loadJwks(): Promise<Jwk[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }

  const base = env.SUPABASE_URL.replace(/\/+$/, '');
  const url = `${base}/auth/v1/.well-known/jwks.json`;
  const response = await fetch(url, {
    headers: {Accept: 'application/json'},
  });
  if (!response.ok) {
    throw new EngineError(
      'unauthorized',
      `Could not load Supabase JWKS (HTTP ${response.status})`,
    );
  }
  const body = (await response.json()) as Jwks;
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = {fetchedAt: now, keys};
  return keys;
}

/** Test helper — clear JWKS cache between cases. */
export function clearJwksCacheForTests(): void {
  jwksCache = null;
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

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
