/**
 * Phase 24: the planned-vs-rendered accounting must agree with the measured frames, and the renders must be deterministic.
 * Reads the audit artifacts under remotion/out/phase24-audit (written by phase24Render.test.ts + the python tools). Skipped when they
 * are not present (a clean checkout); it never renders and never calls the network.
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

const AUDIT = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), 'remotion', 'out', 'phase24-audit');
const PHASE23 = join(AUDIT, '..', 'phase23-audit', 'morning-habits', 'run-a', 'render-result.json');
const ready = ['before', 'after'].every(v => existsSync(join(AUDIT, v, 'accounting.json')) && existsSync(join(AUDIT, v, 'run-a', 'render-result.json')) && existsSync(join(AUDIT, v, 'run-b', 'render-result.json')));
const read = (...parts: string[]) => JSON.parse(readFileSync(join(AUDIT, ...parts), 'utf8'));

describe.skipIf(!ready)('phase 24 evidence (stored artifacts)', () => {
  for (const variant of ['before', 'after']) {
    it(`${variant}: every cutaway's pipeline outcome agrees with what was measured in the encoded frames (test 9)`, () => {
      const accounting = read(variant, 'accounting.json');
      expect(accounting.agreement).toEqual({agree: accounting.cutaways.length, of: accounting.cutaways.length});
      for (const row of accounting.cutaways) {
        const visible = row.rendered !== null;
        expect(row.agrees_with_pipeline).toBe(true);
        if (row.outcome.startsWith('rendered_')) expect(visible).toBe(true);
        else expect(visible).toBe(false);
        expect(row.outcome).not.toBe('unknown_insufficient_evidence');
      }
    });

    it(`${variant}: two renders of the same input are byte-identical and the blueprint identity matches (test 12)`, () => {
      const a = read(variant, 'run-a', 'render-result.json');
      const b = read(variant, 'run-b', 'render-result.json');
      expect(a.encodedSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.encodedSha256).toBe(b.encodedSha256);
      expect(a.blueprintIdentitySha256).toBe(b.blueprintIdentitySha256);
      expect(a.renderError).toBeNull();
    });
  }

  it('the default (legacy) path still produces exactly the Phase 23 video (nothing changed unless the flag is on)', () => {
    if (!existsSync(PHASE23)) return;
    expect(read('before', 'run-a', 'render-result.json').encodedSha256).toBe(JSON.parse(readFileSync(PHASE23, 'utf8')).encodedSha256);
    expect(read('before', 'run-a', 'render-result.json').flags.CUTAWAY_SCHEDULING).toBe('legacy');
  });

  it('with the flag on, the previously lost sunlight cutaway is on screen, and no clip is shown longer than its asset (tests 2, 3)', () => {
    const before = read('before', 'accounting.json');
    const after = read('after', 'accounting.json');
    const sunlightBefore = before.cutaways.find((row: {asset_intended: string}) => row.asset_intended === 'ub_2');
    const sunlightAfter = after.cutaways.find((row: {asset_intended: string}) => row.asset_intended === 'ub_2');
    expect(sunlightBefore.outcome).toBe('rejected_by_scheduling_rule');
    expect(sunlightBefore.pipeline_reason).toBe('clip_within_1.5s_of_previous_clip');
    expect(sunlightAfter.outcome).toBe('rendered_with_modified_timing');
    expect(sunlightAfter.rendered.asset_index_on_screen).toBe(2);
    const durations: Record<string, number> = {ub_1: 5, ub_2: 3, ub_3: 6};
    for (const row of after.cutaways.filter((item: {rendered: unknown}) => item.rendered)) {
      expect(row.rendered.shown_seconds).toBeLessThanOrEqual(durations[row.asset_intended] + 1e-9);
      expect(row.rendered.asset_time_last).toBeLessThanOrEqual(durations[row.asset_intended] + 0.05);
    }
    expect(after.flags ?? read('after', 'run-a', 'render-result.json').flags).toMatchObject({CUTAWAY_SCHEDULING: 'beat_preserving', HOOK_TITLE_POLICY: 'placeholder', OCCUPANCY_CONTEXT_V2: false});
  });

  it('a missing asset is never reported as rendered; the stock rejection keeps its cause', () => {
    for (const variant of ['before', 'after']) {
      const row = read(variant, 'accounting.json').cutaways.find((item: {asset_intended: string}) => item.asset_intended.startsWith('(stock keyword'));
      expect(row.outcome).toBe('asset_unavailable_or_unconfigured');
      expect(row.rendered).toBeNull();
      expect(row.pipeline_cause).toBe('stock_disabled:user_assets_supplied+stock_unconfigured');
    }
  });
});
