/**
 * WP5I source-text tests: .env.production.example carries the same mvp / budget operator notes as .env.example, all as commented examples. The files are only read: no server code is
 * imported, no network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const production = readFileSync(resolve(REPO, '.env.production.example'), 'utf8');
const example = readFileSync(resolve(REPO, '.env.example'), 'utf8');
const env = readFileSync(resolve(REPO, 'server/src/config/env.ts'), 'utf8');
const lines = production.split('\n');
const lineStarting = (prefix: string) => lines.find(line => line.startsWith(prefix)) ?? '';
const NEW_VARIABLES = ['PRODUCT_EDIT_PROFILE', 'MOTION_GRAPHICS_ENABLED', 'CLAUDE_EDIT_BUDGET_USD', 'CLAUDE_EDIT_MAX_REQUESTS', 'CLAUDE_EDIT_MAX_TOKENS', 'INGEST_ALLOWED_PRIVATE_HOSTS', 'GEMINI_EDIT_MAX_REQUESTS'];

describe('.env.production.example documents the mvp profile and the budgets', () => {
  it('names the Gemini warning and the exact string mvp for the profile', () => {
    expect(production).toContain('gemini_edit_budget_unconfigured');
    expect(production).toContain('# PRODUCT_EDIT_PROFILE=mvp');
    expect(lineStarting('# PRODUCT_EDIT_PROFILE=')).toMatch(/only the exact string "mvp"/);
    expect(lineStarting('# PRODUCT_EDIT_PROFILE=')).toMatch(/Not the default/); // WP7C: the default is cuts
  });
  it('the Gemini block says unset/0 is no cap, that it is only a warning, and to set a positive count before a paid run', () => {
    const at = lines.findIndex(line => line.startsWith('# GEMINI_EDIT_MAX_REQUESTS='));
    expect(at).toBeGreaterThan(-1);
    const block = lines.slice(at, at + 3).join('\n');
    expect(block).toMatch(/UNSET OR 0 MEANS NO CAP/);
    expect(block).toContain('PRODUCT_EDIT_PROFILE=mvp');
    expect(block).toMatch(/only a warning/);
    expect(block).toMatch(/NOT refused/);
    expect(block).toMatch(/Set a positive request count before any paid run/);
    expect(block).toMatch(/negative value fails closed/);
    expect(block).toMatch(/non-numeric value is read as unset/);
  });
  it('the Claude budget and graphics lines name the recorded reasons and the dependency on the budget and the Anthropic key', () => {
    expect(lineStarting('# CLAUDE_EDIT_BUDGET_USD=')).toContain('No default on purpose');
    expect(lineStarting('# CLAUDE_EDIT_BUDGET_USD=')).toContain('claude_graphics_disabled:claude_budget_unconfigured');
    expect(lineStarting('# CLAUDE_EDIT_BUDGET_USD=')).toContain('claude_budget_invalid');
    expect(lineStarting('# MOTION_GRAPHICS_ENABLED=')).toMatch(/OFF by default/);
    expect(lineStarting('# MOTION_GRAPHICS_ENABLED=')).toContain('ANTHROPIC_API_KEY');
    expect(lineStarting('# MOTION_GRAPHICS_ENABLED=')).toMatch(/positive CLAUDE_EDIT_BUDGET_USD/);
  });
  it('the notes agree with the ones in .env.example (same profile, budget and Gemini wording)', () => {
    for (const prefix of ['# PRODUCT_EDIT_PROFILE=', '# CLAUDE_EDIT_BUDGET_USD=', '# CLAUDE_EDIT_MAX_REQUESTS=', '# CLAUDE_EDIT_MAX_TOKENS=', '# INGEST_ALLOWED_PRIVATE_HOSTS=', '# GEMINI_EDIT_MAX_REQUESTS=']) {
      const fromExample = example.split('\n').find(line => line.startsWith(prefix));
      expect(fromExample, prefix).toBeDefined();
      expect(lineStarting(prefix), prefix).toBe(fromExample);
    }
  });
});

describe('nothing live changed', () => {
  it('every new variable is a commented example (no live assignment), and each is a variable env.ts already defines', () => {
    for (const name of NEW_VARIABLES) {
      expect(lines.some(line => new RegExp(`^${name}=`).test(line)), name).toBe(false);
      expect(env, name).toContain(`${name}:`);
    }
  });
  it('the existing production lines and placeholders are as they were', () => {
    for (const line of ['NODE_ENV=production', 'PORT=8090', 'DEV_AUTH_BYPASS=0', 'PIPELINE_MODE=lean', 'REMOTION_COMPOSITION_ID=ShortVideo', 'MAX_SOURCE_DURATION_SEC=300', 'BLUEPRINT_TTL_SEC=604800', 'GEMINI_API_KEY=', 'GROQ_API_KEY=', 'R2_ACCESS_KEY_ID=', 'R2_SECRET_ACCESS_KEY=', 'AWS_SECRET_ACCESS_KEY=']) {
      expect(lines, line).toContain(line);
    }
  });
  it('no key or secret value was added', () => {
    expect(production).not.toMatch(/(sk-|AIza)[A-Za-z0-9_-]{10,}/);
  });
  it('the real defaults in env.ts are unchanged', () => {
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts'),");
    expect(env).toContain('MOTION_GRAPHICS_ENABLED: bool(false),');
    expect(env).toContain('CLAUDE_EDIT_BUDGET_USD: num(0),');
    expect(env).toContain('GEMINI_EDIT_MAX_REQUESTS: num(0),');
  });
});
