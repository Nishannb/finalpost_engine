/**
 * Phase 30, Step 2: `DesignTokens` is a pure alias of `NorthStarDesign`. The type-level assertions are NOT enforced by the normal `tsc` run
 * (server tsconfig excludes *.test.ts) nor by plain `vitest run`; they are enforced by `remotion/out/phase30-audit/tsconfig.alias-check.json`
 * (see the Phase 30 report, with a mutation control). The runtime assertions pin that the serialised design object, and therefore the
 * persisted blueprint key, did not change.
 */
import {describe, expect, expectTypeOf, it} from 'vitest';

import type {DesignTokens, NorthStarDesign, TimelineBlueprint} from '../types/blueprint.ts';
import {designFromProfile} from '../stages/contentProfile/artDirection.ts';
import {parseContentProfile} from '../stages/contentProfile/contentProfile.ts';
import {PROFILE_RESPONSE} from './phase28Scenarios.ts';

describe('DesignTokens alias (Step 2)', () => {
  it('is exactly NorthStarDesign, in both directions, and the blueprint field keeps its name and type', () => {
    expectTypeOf<DesignTokens>().toEqualTypeOf<NorthStarDesign>();
    expectTypeOf<NorthStarDesign>().toEqualTypeOf<DesignTokens>();
    expectTypeOf<TimelineBlueprint['northStarDesign']>().toEqualTypeOf<NorthStarDesign | undefined>();
    expectTypeOf<TimelineBlueprint['northStarDesign']>().toEqualTypeOf<DesignTokens | undefined>();
    expect(true).toBe(true);
  });

  it('the object designFromProfile returns serialises with the same keys as before the rename', () => {
    const design: DesignTokens = designFromProfile(parseContentProfile(PROFILE_RESPONSE));
    expect(Object.keys(JSON.parse(JSON.stringify(design))).sort()).toEqual(
      ['contentType', 'cornerRadius', 'density', 'displayFont', 'enabled', 'inkColor', 'motionPreset', 'primaryColor', 'secondaryColor', 'surfaceColor'],
    );
  });
});
