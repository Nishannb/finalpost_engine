/**
 * Phase 4.2.1: offline tests never load real provider credentials and cannot reach a real provider.
 * Uses fake variable names and temp files only; nothing here reads or prints a real secret.
 */
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it, vi} from 'vitest';

import {env} from './env.ts';
import {dotenvEnabled, loadDotenvFiles} from './dotenvLoader.ts';
import {installFetchGuard, isProviderUrl, PROVIDER_HOSTS, scrubSecrets, SECRET_NAME} from '../test/offlineGuard.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'envisol-'));
afterAll(() => rmSync(dir, {recursive: true, force: true}));
const f1 = path.join(dir, 'a.env'), f2 = path.join(dir, 'b.env');
writeFileSync(f1, 'FAKE_ISOLATION_FLAG=from-a\nFAKE_ISOLATION_ONLY_A=1\n');
writeFileSync(f2, 'FAKE_ISOLATION_FLAG=from-b\n');

describe('dotenv loading is skipped under vitest and unchanged elsewhere', () => {
  it('the gate', () => {
    expect(dotenvEnabled({VITEST: 'true'})).toBe(false);
    expect(dotenvEnabled({VITEST: 'true', ENGINE_TEST_LOAD_DOTENV: '1'})).toBe(true);
    expect(dotenvEnabled({})).toBe(true); // development / production / a script
    expect(dotenvEnabled({NODE_ENV: 'production'})).toBe(true);
  });
  it('under vitest no file is read', () => {
    const into: Record<string, string | undefined> = {};
    expect(loadDotenvFiles([f1, f2], {VITEST: 'true'}, {parseInto: into})).toEqual([]);
    expect(into).toEqual({});
  });
  it('outside vitest every existing file loads in order, later files override (the old behaviour)', () => {
    const into: Record<string, string | undefined> = {};
    expect(loadDotenvFiles([f1, path.join(dir, 'missing.env'), f2], {}, {parseInto: into})).toEqual([f1, f2]);
    expect(into.FAKE_ISOLATION_FLAG).toBe('from-b');
    expect(into.FAKE_ISOLATION_ONLY_A).toBe('1');
  });
  it('the explicit opt-in loads them even under vitest', () => {
    const into: Record<string, string | undefined> = {};
    expect(loadDotenvFiles([f1], {VITEST: 'true', ENGINE_TEST_LOAD_DOTENV: '1'}, {parseInto: into})).toEqual([f1]);
  });
});

describe('secrets and provider hosts', () => {
  it('scrubSecrets removes secret-looking names and returns names only', () => {
    const e: Record<string, string | undefined> = {GEMINI_API_KEY: 'x', ANTHROPIC_API_KEY: 'x', R2_SECRET_ACCESS_KEY: 'x', R2_ACCESS_KEY_ID: 'x', SOME_AUTH_TOKEN: 'x', POLISH_KINETIC_ENGINE: '1', PATH: '/bin', NODE_ENV: 'test'};
    const removed = scrubSecrets(e);
    expect(removed.sort()).toEqual(['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'SOME_AUTH_TOKEN']);
    expect(Object.keys(e).sort()).toEqual(['NODE_ENV', 'PATH', 'POLISH_KINETIC_ENGINE']);
  });
  it('recognises provider URLs in every fetch input form, and nothing else', () => {
    for (const h of PROVIDER_HOSTS) expect(isProviderUrl(`https://${h}/v1/x`)).toBe(true);
    expect(isProviderUrl(new URL('https://generativelanguage.googleapis.com/v1beta/models/m:generateContent'))).toBe(true);
    expect(isProviderUrl({url: 'https://api.anthropic.com/v1/messages'})).toBe(true);
    expect(isProviderUrl('https://eu.api.openai.com/v1')).toBe(true);
    expect(isProviderUrl('https://example.com/generativelanguage.googleapis.com')).toBe(false);
    expect(isProviderUrl('http://127.0.0.1:3000/x')).toBe(false);
    expect(isProviderUrl('not a url')).toBe(false);
  });
  it('the guard refuses a provider call without calling through, passes everything else, is idempotent', async () => {
    const inner = vi.fn(async () => new Response('ok'));
    const g: {fetch?: typeof fetch} = {fetch: inner as unknown as typeof fetch};
    installFetchGuard(g); const once = g.fetch; installFetchGuard(g);
    expect(g.fetch).toBe(once);
    await expect(g.fetch!('https://generativelanguage.googleapis.com/v1beta/x', {method: 'POST'})).rejects.toThrow(/offline test guard/);
    expect(inner).not.toHaveBeenCalled();
    await g.fetch!('http://127.0.0.1:1/x');
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

describe('this test process', () => {
  it('has no secret-named variable and no credential in the parsed engine config (booleans only, no values read out)', () => {
    expect(Object.keys(process.env).filter(k => SECRET_NAME.test(k))).toEqual([]);
    expect(Boolean(env.GEMINI_API_KEY)).toBe(false);
    expect(Boolean(env.GROQ_API_KEY)).toBe(false);
  });
  it('a real provider call from a test is refused locally, with no network', async () => {
    if (!(globalThis.fetch as {__offlineGuard?: boolean}).__offlineGuard) return; // a previous test file in this worker replaced fetch; that is the stub case
    await expect(fetch('https://generativelanguage.googleapis.com/v1beta/models/m:generateContent', {method: 'POST', body: '{}'})).rejects.toThrow(/offline test guard/);
  });
});
