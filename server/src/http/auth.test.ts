import {createHmac} from 'node:crypto';

import * as jose from 'jose';
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
    SUPABASE_ANON_KEY: 'test-anon-key',
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

  it('verifies ES256 tokens via JWKS (jose)', async () => {
    const {privateKey, publicKey} = await jose.generateKeyPair('ES256');
    const kid = 'test-es256-kid';
    const jwk = await jose.exportJWK(publicKey);
    const token = await new jose.SignJWT({role: 'authenticated'})
      .setProtectedHeader({alg: 'ES256', kid, typ: 'JWT'})
      .setSubject('user-es')
      .setExpirationTime('1h')
      .sign(privateKey);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('jwks.json')) {
          return {
            ok: true,
            json: async () => ({
              keys: [{...jwk, kid, alg: 'ES256', use: 'sig', kty: 'EC'}],
            }),
            // jose may read clone / headers
            headers: new Headers({'content-type': 'application/json'}),
            status: 200,
          };
        }
        return {ok: false, status: 404, json: async () => ({})};
      }),
    );

    await expect(verifySupabaseAccessToken(token)).resolves.toBe('user-es');
  });

  it('falls back to /auth/v1/user when JWKS fails', async () => {
    const {privateKey} = await jose.generateKeyPair('ES256');
    const token = await new jose.SignJWT({})
      .setProtectedHeader({alg: 'ES256', kid: 'unknown', typ: 'JWT'})
      .setSubject('user-fallback')
      .setExpirationTime('1h')
      .sign(privateKey);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('jwks.json')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({'content-type': 'application/json'}),
            json: async () => ({keys: []}),
          };
        }
        if (url.includes('/auth/v1/user')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({'content-type': 'application/json'}),
            json: async () => ({id: 'user-fallback'}),
          };
        }
        return {ok: false, status: 404, json: async () => ({})};
      }),
    );

    await expect(verifySupabaseAccessToken(token)).resolves.toBe('user-fallback');
  });
});
