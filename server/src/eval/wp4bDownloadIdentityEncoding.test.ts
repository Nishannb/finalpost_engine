/**
 * WP4B pure tests: the source download asks for the file as is (Accept-Encoding: identity) and refuses a compressed response before writing a byte. lib/pinnedGet.ts imports only node:http,
 * node:https and the guard (nothing is connected at import); lib/tempFiles.ts (logger, env) is read as text. No socket, no network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {isIdentityContentEncoding, sourceRequestHeaders} from '../lib/pinnedGet.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

describe('the request headers', () => {
  it('ask for identity next to the existing User-Agent and Accept', () => {
    expect(sourceRequestHeaders()).toEqual({'User-Agent': 'KinmelVideoEngine/0.1 (video ingest)', Accept: '*/*', 'Accept-Encoding': 'identity'});
  });
  it('are a fresh object each call (a hop cannot change the next hop\'s headers)', () => {
    const first = sourceRequestHeaders();
    first['Accept-Encoding'] = 'gzip';
    expect(sourceRequestHeaders()['Accept-Encoding']).toBe('identity');
  });
});

describe('which Content-Encoding is accepted', () => {
  it('absent, empty and identity (any case, with spaces) are accepted', () => {
    for (const value of [undefined, '', ' ', 'identity', 'Identity', 'IDENTITY', ' identity ', ['identity'], ['']]) expect(isIdentityContentEncoding(value as never), String(value)).toBe(true);
  });
  it('every other encoding is refused, including lists and unknown tokens', () => {
    for (const value of ['gzip', 'GZIP', 'br', 'deflate', 'compress', 'zstd', 'x-gzip', 'identity, gzip', 'gzip, identity', 'identityx', 'aws128gcm', ['gzip'], ['identity', 'br']]) expect(isIdentityContentEncoding(value as never), String(value)).toBe(false);
  });
});

describe('downloadToFile (source text)', () => {
  const temp = stripComments(read('lib', 'tempFiles.ts'));
  const get = stripComments(read('lib', 'pinnedGet.ts'));
  it('sends the shared headers on every hop: the only request call uses them', () => {
    expect(temp.match(/pinnedGet\(/g)).toHaveLength(1);
    expect(temp).toContain('headers: sourceRequestHeaders(),');
    expect(temp).not.toMatch(/Accept-Encoding|'User-Agent'/); // defined once, in pinnedGet.ts
    expect(get.match(/'Accept-Encoding': 'identity'/g)).toHaveLength(1);
  });
  it('refuses a compressed final response with the stated error, destroys it, and does so before any byte is written', () => {
    const refusal = "if (!isIdentityContentEncoding(response.headers['content-encoding'])) {\n      response.destroy();\n      throw new EngineError('source_unreachable', 'Could not download source video (compressed)');\n    }";
    expect(temp).toContain(refusal);
    const at = temp.indexOf(refusal);
    expect(at).toBeGreaterThan(temp.indexOf('for (let hops = 0;'));
    expect(at).toBeLessThan(temp.indexOf('createWriteStream(destination)'));
    expect(at).toBeLessThan(temp.indexOf('await pipeline('));
    expect(temp.match(/createWriteStream\(/g)).toHaveLength(1);
  });
  it('the check runs on the FINAL response only (after the redirect loop), so a redirect hop is not judged by its encoding', () => {
    const loop = temp.slice(temp.indexOf('for (let hops = 0;'), temp.indexOf('const status ='));
    expect(loop).not.toContain('content-encoding');
  });
  it('nothing decompresses: no zlib, no content-decoding, no new import', () => {
    expect(temp).not.toMatch(/zlib|gunzip|inflate|brotli|createGunzip/i);
    expect(get).not.toMatch(/zlib|gunzip|inflate|brotli/i);
    expect([...get.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]).sort()).toEqual(['./addressGuard.ts', 'node:http', 'node:https']);
  });
  it('the address pin, the redirect limit and the allow list are as they were', () => {
    expect(temp.match(/pinPublicHttpUrl\(/g)).toHaveLength(2);
    expect(temp).toContain('if (hops >= MAX_REDIRECT_HOPS) {');
    expect(temp).toContain('const allowHosts = env.INGEST_ALLOWED_PRIVATE_HOSTS');
    expect(get).toContain('lookup: pinnedLookup(target.addresses)');
    expect(get).toContain('agent: false');
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('config', 'env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
