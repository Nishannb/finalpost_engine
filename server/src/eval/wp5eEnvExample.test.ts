/**
 * WP5E source-text tests: .env.example documents the Gemini cap warning and keeps the mvp / Claude comments accurate. The files are only read: no server code is imported, no network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const example = readFileSync(resolve(REPO, '.env.example'), 'utf8');
const env = readFileSync(resolve(REPO, 'server/src/config/env.ts'), 'utf8');
const lines = example.split('\n');
const lineOf = (prefix: string) => lines.findIndex(line => line.startsWith(prefix));
const blockFrom = (prefix: string) => {
  const start = lineOf(prefix);
  const out = [lines[start]!];
  for (let i = start + 1; i < lines.length && /^#\s{20,}#/.test(lines[i]!); i += 1) out.push(lines[i]!);
  return out.join('\n');
};

describe('GEMINI_EDIT_MAX_REQUESTS in .env.example', () => {
  const block = blockFrom('# GEMINI_EDIT_MAX_REQUESTS=');
  it('is still present as a commented, unset example (the default is not changed)', () => {
    expect(lineOf('# GEMINI_EDIT_MAX_REQUESTS=')).toBeGreaterThan(-1);
    expect(lines.some(line => /^GEMINI_EDIT_MAX_REQUESTS=/.test(line))).toBe(false);
  });
  it('names the warning and says it is a warning, not a refusal', () => {
    expect(example).toContain('gemini_edit_budget_unconfigured');
    expect(block).toContain('gemini_edit_budget_unconfigured');
    expect(block).toMatch(/only a warning/);
    expect(block).toMatch(/NOT refused/);
  });
  it('says unset or 0 means no cap, on PRODUCT_EDIT_PROFILE=mvp, and tells operators to set a positive count before a paid run', () => {
    expect(block).toMatch(/UNSET OR 0 MEANS NO CAP/);
    expect(block).toContain('PRODUCT_EDIT_PROFILE=mvp');
    expect(block).toMatch(/Set a positive request count before any paid run/);
  });
  it('describes negative and non-numeric values the way env.ts and the budget code read them', () => {
    expect(block).toMatch(/negative value fails closed/);
    expect(block).toMatch(/non-numeric value is read as unset/);
    // env.ts: num() falls back to the default (0) for a non-finite value
    expect(env).toMatch(/!Number\.isFinite\(parsed\)/);
    expect(env).toContain('GEMINI_EDIT_MAX_REQUESTS: num(0),');
  });
});

describe('PRODUCT_EDIT_PROFILE and CLAUDE_EDIT_BUDGET_USD comments', () => {
  const profile = lines[lineOf('# PRODUCT_EDIT_PROFILE=')]!;
  const claude = lines[lineOf('# CLAUDE_EDIT_BUDGET_USD=')]!;
  it('WP7C: document that mvp is an explicit opt-out by the exact string, and that the default is cuts', () => {
    expect(profile).toContain('# PRODUCT_EDIT_PROFILE=mvp');
    expect(profile).toMatch(/only the exact string "mvp"/);
    expect(profile).toMatch(/Not the default/);
    expect(profile).toMatch(/Not settable by API callers/);
  });
  it('the profile comment agrees with the code: only "mvp" selects it (after the env trim)', () => {
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts'),");
    expect(readFileSync(resolve(REPO, 'server/src/lib/productEditProfile.ts'), 'utf8')).toContain("return raw === 'legacy' || raw === 'mvp' || raw === 'polish' ? raw : 'cuts';"); // WP7C: legacy and mvp are the explicit opt-outs, cuts is the default
    expect(env).toMatch(/\.transform\(raw => \(raw \?\? fallback\)\.trim\(\)\)/);
  });
  it('the Claude comment names both reasons the code records, and keeps "no default on purpose"', () => {
    expect(claude).toContain('No default on purpose');
    expect(claude).toContain('claude_graphics_disabled:claude_budget_unconfigured');
    expect(claude).toContain('claude_budget_invalid');
    const bound = readFileSync(resolve(REPO, 'server/src/lib/productEditProfile.ts'), 'utf8');
    expect(bound).toContain("reason: 'claude_budget_unconfigured'");
    expect(bound).toContain("reason: 'claude_budget_invalid'");
  });
});

describe('nothing else changed', () => {
  it('the real defaults in env.ts are as before', () => {
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts'),");
    expect(env).toContain('MOTION_GRAPHICS_ENABLED: bool(false),');
    expect(env).toContain('CLAUDE_EDIT_BUDGET_USD: num(0),');
    expect(env).toContain('GEMINI_EDIT_MAX_REQUESTS: num(0),');
  });
  it('the other documented variables are still in the example', () => {
    for (const name of ['CLAUDE_EDIT_MAX_REQUESTS', 'CLAUDE_EDIT_MAX_TOKENS', 'INGEST_ALLOWED_PRIVATE_HOSTS']) expect(lineOf(`# ${name}=`), name).toBeGreaterThan(-1);
  });
  it('no key or secret value was added', () => {
    expect(example).not.toMatch(/(sk-|AIza)[A-Za-z0-9_-]{10,}/);
  });
});
