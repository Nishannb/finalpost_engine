/** Edit-style registry (pure): catalog shape, lock state, overrides, and request resolution. */
import {describe, expect, it} from 'vitest';

import {buildEditStyleCatalog, EDIT_STYLE_IDS, EDIT_STYLES, isStyleAvailable, resolveRequestedStyle, styleTier, v1ReleaseViolation, V1_RELEASE_STYLES} from './editStyles.ts';

const ON = {enabled: true, availableOverride: '', orderOverride: ''};

describe('edit-style registry', () => {
  it('has exactly the four v1 styles; Documentary and Newsroom are not exposed', () => {
    expect([...EDIT_STYLE_IDS]).toEqual(['basic_captions', 'ai_clean_cut', 'kinetic_typography', 'explainer']);
    expect(EDIT_STYLE_IDS.some(id => /faceless|documentary|newsroom/.test(id))).toBe(false);
  });

  it('declares tiers, modes, engine-flag needs and Gemini caps as agreed', () => {
    expect(EDIT_STYLE_IDS.map(id => EDIT_STYLES[id].tier)).toEqual(['free', 'pro', 'pro', 'pro']);
    expect(EDIT_STYLE_IDS.map(id => EDIT_STYLES[id].mode)).toEqual(['basic_captions', 'full_edit', 'full_edit', 'full_edit']);
    expect(EDIT_STYLE_IDS.map(id => EDIT_STYLES[id].available)).toEqual([true, true, true, true]); // production: all four ship
    expect(EDIT_STYLE_IDS.map(id => EDIT_STYLES[id].needsEngineFlags)).toEqual([false, false, true, true]);
    expect(EDIT_STYLE_IDS.map(id => EDIT_STYLES[id].geminiMaxRequests)).toEqual([0, 3, 12, 12]);
    expect(EDIT_STYLES.kinetic_typography.degradesTo).toBe('ai_clean_cut');
    expect(EDIT_STYLES.explainer.degradesTo).toBe('ai_clean_cut');
  });

  it('catalog: Pro styles are locked without Pro and unlocked with it; free styles never lock', () => {
    const free = buildEditStyleCatalog({config: ON, hasPro: false});
    expect(free.map(s => [s.id, s.locked])).toEqual([
      ['basic_captions', false],
      ['ai_clean_cut', true],
      ['kinetic_typography', true],
      ['explainer', true],
    ]);
    expect(buildEditStyleCatalog({config: ON, hasPro: true}).every(s => !s.locked)).toBe(true);
    expect(free[0]).toEqual(expect.objectContaining({name: 'Basic Captions', tier: 'free', available: true, previewAsset: 'basic_captions', sortOrder: 10}));
  });

  it('EDIT_STYLES_AVAILABLE and EDIT_STYLES_ORDER change the catalog without a code change', () => {
    const config = {...ON, availableOverride: 'basic_captions, kinetic_typography', orderOverride: 'kinetic_typography,basic_captions,bogus'};
    const catalog = buildEditStyleCatalog({config, hasPro: true});
    expect(catalog.map(s => s.id)).toEqual(['kinetic_typography', 'basic_captions', 'ai_clean_cut', 'explainer']);
    expect(catalog.map(s => s.sortOrder)).toEqual([10, 20, 30, 40]);
    expect(catalog.map(s => s.available)).toEqual([true, true, false, false]);
    expect(isStyleAvailable('ai_clean_cut', config)).toBe(false);
  });

  it('resolveRequestedStyle: kill switch off or no style = null (mode unchanged)', () => {
    expect(resolveRequestedStyle('ai_clean_cut', {...ON, enabled: false})).toBeNull();
    expect(resolveRequestedStyle('not-a-style', {...ON, enabled: false})).toBeNull();
    expect(resolveRequestedStyle(undefined, ON)).toBeNull();
    expect(resolveRequestedStyle('', ON)).toBeNull();
  });

  it('resolveRequestedStyle: unknown and unavailable are distinct errors', () => {
    expect(resolveRequestedStyle('faceless_documentary', ON)).toEqual({error: 'unknown_style', style: 'faceless_documentary'});
    expect(resolveRequestedStyle('kinetic_typography', {...ON, availableOverride: 'basic_captions,ai_clean_cut'})).toEqual({error: 'style_unavailable', style: 'kinetic_typography'});
  });

  it('resolveRequestedStyle: degraded is a boolean + reasons; only a flag-dependent style with the engine flags off is degraded up front', () => {
    expect(resolveRequestedStyle('basic_captions', ON)).toEqual({style: 'basic_captions', tier: 'free', mode: 'basic_captions', degraded: false, degradedReasons: [], styleNotes: []});
    expect(resolveRequestedStyle('ai_clean_cut', ON)).toEqual({style: 'ai_clean_cut', tier: 'pro', mode: 'full_edit', degraded: false, degradedReasons: [], styleNotes: []});
    expect(resolveRequestedStyle('explainer', {...ON, availableOverride: 'explainer'})).toEqual({
      style: 'explainer',
      tier: 'pro',
      mode: 'full_edit',
      degraded: true,
      degradedReasons: ['engine_flags_off'],
      styleNotes: [],
    });
    expect(resolveRequestedStyle('explainer', {...ON, availableOverride: 'explainer', engineFlags: true})).toMatchObject({degraded: false, degradedReasons: [], styleNotes: []});
    expect(styleTier('explainer')).toBe('pro');
    expect(styleTier(undefined)).toBeUndefined();
  });
});

describe('Subject Stage picker option (SUBJECT_STAGE_PICKER; separate from Kinetic Typography)', () => {
  const PICKER = {...ON, subjectStagePicker: true};
  const V1 = {enabled: true, availableOverride: V1_RELEASE_STYLES.join(','), orderOverride: V1_RELEASE_STYLES.join(',')};

  it('flag off (default): not listed, not startable; the V1 catalog is exactly Basic Captions + Kinetic', () => {
    expect(buildEditStyleCatalog({config: ON, hasPro: true}).map(e => e.id)).toEqual(['basic_captions', 'ai_clean_cut', 'kinetic_typography', 'explainer']);
    expect(buildEditStyleCatalog({config: V1, hasPro: true}).filter(e => e.available).map(e => e.id).sort()).toEqual(['basic_captions', 'kinetic_typography']);
    expect(resolveRequestedStyle('subject_stage', ON)).toEqual({error: 'style_unavailable', style: 'subject_stage'});
    expect(resolveRequestedStyle('subject_stage', V1)).toEqual({error: 'style_unavailable', style: 'subject_stage'});
  });

  it('flag on: listed as its own Pro option next to Kinetic; Kinetic stays selectable on its own', () => {
    const catalog = buildEditStyleCatalog({config: PICKER, hasPro: false});
    const ids = catalog.map(e => e.id);
    expect(ids).toContain('subject_stage');
    expect(ids).toContain('kinetic_typography');
    const stage = catalog.find(e => e.id === 'subject_stage')!;
    expect(stage).toMatchObject({tier: 'pro', available: true, locked: true});
    expect(buildEditStyleCatalog({config: PICKER, hasPro: true}).find(e => e.id === 'subject_stage')!.locked).toBe(false);
    expect(resolveRequestedStyle('kinetic_typography', PICKER)).toMatchObject({style: 'kinetic_typography', mode: 'full_edit'});
    expect(resolveRequestedStyle('subject_stage', PICKER)).toMatchObject({style: 'subject_stage', tier: 'pro', mode: 'full_edit'});
  });

  it('flag on also lists it under the V1 release config, which still only offers the V1 styles otherwise', () => {
    const ids = buildEditStyleCatalog({config: {...V1, subjectStagePicker: true}, hasPro: true}).filter(e => e.available).map(e => e.id).sort();
    expect(ids).toEqual(['basic_captions', 'kinetic_typography', 'subject_stage']);
    expect(isStyleAvailable('ai_clean_cut', {availableOverride: V1.availableOverride, subjectStagePicker: true})).toBe(false);
  });

  it('V1 release gate: Subject Stage needs camera footage and the engine flags; Kinetic rules are unchanged', () => {
    const base = {release: true, mode: 'full_edit', engineFlags: true};
    expect(v1ReleaseViolation({...base, style: 'subject_stage', footageKind: 'camera'})).toBeNull();
    expect(v1ReleaseViolation({...base, style: 'subject_stage', footageKind: 'screen_recording'})).toMatchObject({code: 'footage_unsupported'});
    expect(v1ReleaseViolation({...base, style: 'subject_stage', footageKind: undefined})).toMatchObject({code: 'footage_unsupported'});
    expect(v1ReleaseViolation({...base, engineFlags: false, style: 'subject_stage', footageKind: 'camera'})).toMatchObject({code: 'style_unavailable'});
    expect(v1ReleaseViolation({...base, engineFlags: false, style: 'kinetic_typography', footageKind: 'camera'})).toMatchObject({code: 'kinetic_unavailable'});
    expect(v1ReleaseViolation({release: false, style: 'subject_stage', mode: 'full_edit', footageKind: undefined, engineFlags: true})).toBeNull();
  });
});
