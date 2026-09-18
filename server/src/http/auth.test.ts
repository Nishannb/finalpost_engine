import {createHmac, generateKeyPairSync, sign as cryptoSign} from 'node:crypto';

import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  clearJwksCacheForTests,
  verifySupabaseAccessToken,
  verifySupabaseJwt,
} from './auth.ts';

vi.mock('../config/env.ts', () => ({
  env: {
    NODE_ENV: 'test',
    DEV_AUTH_BYPASS: false,
    ENGINE_API_KEY: '',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_JWT_SECRET: 'test-legacy-secret',
  },
  isProduction: false,
}));

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function hs256Token(sub: string, secret: string, expOffsetSec = 3600): string {
  const header = b64urlJson({alg: 'HS256', typ: 'JWT'});
  const payload = b64urlJson({
    sub,
    exp: Math.floor(Date.now() / 1000) + expOffsetSec,
    role: 'authenticated',
  });
  const sig = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

afterEach(() => {
  clearJwksCacheForTests();
  vi.unstubAllGlobals();
});

describe('verifySupabaseJwt (HS256)', () => {
  it('accepts a valid legacy token', () => {
    const token = hs256Token('user-1', 'test-legacy-secret');
    expect(verifySupabaseJwt(token, 'test-legacy-secret')).toBe('user-1');
  });

  it('rejects a bad signature', () => {
    const token = hs256Token('user-1', 'test-legacy-secret');
    expect(verifySupabaseJwt(token, 'wrong-secret')).toBeNull();
  });

  it('rejects expired tokens', () => {
    const token = hs256Token('user-1', 'test-legacy-secret', -10);
    expect(verifySupabaseJwt(token, 'test-legacy-secret')).toBeNull();
  });
});

describe('verifySupabaseAccessToken', () => {
  it('routes HS256 to the legacy secret', async () => {
    const token = hs256Token('user-hs', 'test-legacy-secret');
    await expect(verifySupabaseAccessToken(token)).resolves.toBe('user-hs');
  });

  it('verifies ES256 tokens via JWKS', async () => {
    const {privateKey, publicKey} = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    const jwk = publicKey.export({format: 'jwk'});
    const kid = 'test-es256-kid';
    const header = b64urlJson({alg: 'ES256', typ: 'JWT', kid});
    const payload = b64urlJson({
      sub: 'user-es',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const data = Buffer.from(`${header}.${payload}`);
    const signature = cryptoSign('SHA256', data, {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
    const token = `${header}.${payload}.${signature}`;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({keys: [{...jwk, kid, alg: 'ES256', use: 'sig'}]}),
      })),
    );

    await expect(verifySupabaseAccessToken(token)).resolves.toBe('user-es');
  });
});
