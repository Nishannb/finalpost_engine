/**
 * V1 release mode (env V1_KINETIC_RELEASE), pure: the request gate, the Kinetic style's flags, and the fail-closed decision.
 * With the release switch off every one of these is the behaviour of the earlier phases (asserted below).
 */
import {describe, expect, it} from 'vitest';

import {EDIT_STYLES, V1_RELEASE_STYLES, buildEditStyleCatalog, resolveRequestedStyle, v1ReleaseViolation, type EditStyleConfig} from './editStyles.ts';
import type {EffectiveFlagsEnv} from './effectiveFlags.ts';
import {kineticFailClosed, resolveStyleRun} from './styleRun.ts';

const ENV = {
  MOTION_GRAPHICS_ENABLED: false, POLISH_DEFAULT_EDITS: 'lean', POLISH_FACELESS_DOC: false, POLISH_NEWSROOM_MG: false, POLISH_EXPLAINER_SKILL: false, POLISH_TEXTUAL_MG: false,
  POLISH_MOTION_TEMPLATES: false, POLISH_KINETIC_LED: false, POLISH_KINETIC_ENGINE: false, POLISH_KINETIC_ENGINE_3D: false, POLISH_KINETIC_ENGINE_ADAPTIVE: false,
  POLISH_KINETIC_ENGINE_MOTION: false, POLISH_KINETIC_ENGINE_MATTE: false, POLISH_KINETIC_MATCHCUT_SHUTTER: false, POLISH_SUBJECT_STAGE: false,
} as unknown as EffectiveFlagsEnv;
const run = (style: Parameters<typeof resolveStyleRun>[0]['style'], release: boolean, engineFlags = true) =>
  resolveStyleRun({style, engineFlags, envProfile: 'polish', env: ENV, envGeminiMaxRequests: 0, release});

describe('v1ReleaseViolation (POST /v1/edits/captions gate)', () => {
  const base = {release: true, style: null, mode: undefined, footageKind: 'camera', engineFlags: true} as const;

  it('release off: every non-Kinetic request is untouched, but Kinetic Typography is refused (retryable), never run as the older template path', () => {
    expect(v1ReleaseViolation({...base, release: false, mode: 'full_edit'})).toBeNull();
    expect(v1ReleaseViolation({...base, release: false, style: 'ai_clean_cut', mode: 'full_edit'})).toBeNull();
    expect(v1ReleaseViolation({...base, release: false, style: 'basic_captions', mode: 'basic_captions'})).toBeNull();
    for (const footageKind of ['camera', 'screen_recording', null]) {
      expect(v1ReleaseViolation({...base, release: false, style: 'kinetic_typography', footageKind})).toMatchObject({code: 'kinetic_unavailable', details: {reason: 'v1_release_off'}});
    }
  });

  it('no style: only basic_captions (the Free path) passes; every other mode, and an omitted mode (= full captions pipeline), is refused', () => {
    expect(v1ReleaseViolation({...base, mode: 'basic_captions'})).toBeNull();
    for (const mode of [undefined, 'captions', 'teleprompter_clean', 'full_edit']) {
      expect(v1ReleaseViolation({...base, mode})).toMatchObject({code: 'bad_request', details: {reason: 'style_required'}});
    }
  });

  it('kinetic_typography needs explicit camera footage: unknown, absent and screen recordings are refused with footage_unsupported', () => {
    expect(v1ReleaseViolation({...base, style: 'kinetic_typography', footageKind: 'camera'})).toBeNull();
    for (const footageKind of ['screen_recording', 'unknown', undefined, null]) {
      expect(v1ReleaseViolation({...base, style: 'kinetic_typography', footageKind})).toMatchObject({code: 'footage_unsupported'});
    }
  });

  it('kinetic_typography with the engine flags off is refused (it would have run as AI Clean Cut)', () => {
    expect(v1ReleaseViolation({...base, style: 'kinetic_typography', engineFlags: false})).toMatchObject({code: 'kinetic_unavailable', details: {reason: 'engine_flags_off'}});
  });

  it('basic_captions as a style is never refused, whatever the footage', () => {
    expect(v1ReleaseViolation({...base, style: 'basic_captions', footageKind: 'screen_recording'})).toBeNull();
  });
});

describe('the V1 catalog', () => {
  const config: EditStyleConfig = {enabled: true, availableOverride: V1_RELEASE_STYLES.join(','), orderOverride: V1_RELEASE_STYLES.join(','), engineFlags: true};

  it('lists only Basic Captions and Kinetic Typography as available; the other styles stay in the registry but cannot be started', () => {
    const available = buildEditStyleCatalog({config, hasPro: true}).filter(s => s.available).map(s => s.id);
    expect(available).toEqual(['basic_captions', 'kinetic_typography']);
    for (const style of ['ai_clean_cut', 'explainer', 'subject_stage', 'kinetic_v2_unknown']) {
      expect(resolveRequestedStyle(style, config)).toMatchObject({error: expect.stringMatching(/style_unavailable|unknown_style/)});
    }
    expect(Object.keys(EDIT_STYLES)).toEqual(expect.arrayContaining(['ai_clean_cut', 'explainer', 'subject_stage']));
  });

  it('the kinetic_v2 alias is the Kinetic style (still startable), subject_stage is not', () => {
    expect(resolveRequestedStyle('kinetic_v2', config)).toMatchObject({style: 'kinetic_typography', tier: 'pro'});
    expect(resolveRequestedStyle('subject_stage', config)).toMatchObject({error: 'style_unavailable'});
  });
});

describe('kinetic_typography flags under the release switch', () => {
  it('release ON: the Kinetic V2 engine and the shutter are on for the job even though the env has them off; RVM / matte / Subject Stage / 3D stay as the env says (off)', () => {
    const {flags, styleKey, pipeline} = run('kinetic_typography', true);
    expect(flags).toMatchObject({kineticEngine: true, matchCutShutter: true, kineticLed: true, kineticEngineMatte: false, subjectStage: false, kineticEngineThreeD: false});
    expect(pipeline).toBe('kinetic_v2');
    expect(styleKey).toContain(':engine');
    expect(styleKey).toMatch(/:engine[a-z0-9]*s/); // the shutter fragment (later letters: c composer, p palette, b AI B-roll asks)
    expect(flags.brollOpportunitiesAi).toBe(true);
  });

  it('release OFF: exactly what it was (the engine flag follows the env, no shutter, no new key fragment)', () => {
    const {flags, styleKey} = run('kinetic_typography', false);
    expect(flags).toMatchObject({kineticEngine: false, matchCutShutter: false});
    expect(styleKey).not.toContain(':engine');
  });

  it('the release switch does not touch any other style', () => {
    for (const style of ['basic_captions', 'ai_clean_cut', 'explainer', 'subject_stage'] as const) {
      expect(run(style, true).flags).toEqual(run(style, false).flags);
      expect(run(style, true).styleKey).toBe(run(style, false).styleKey);
    }
  });
});

describe('kineticFailClosed', () => {
  const kinetic = run('kinetic_typography', true);
  const ok = {release: true, run: kinetic, warnings: [] as string[], hasKineticSpec: true};

  it('a produced Kinetic V2 spec is a success', () => {
    expect(kineticFailClosed(ok)).toBeNull();
  });

  it('no spec: a retryable kinetic_unavailable carrying the reason, never a different edit', () => {
    const failure = kineticFailClosed({...ok, hasKineticSpec: false, warnings: ['kinetic_engine:fallback_failed:boom']});
    expect(failure).toMatchObject({code: 'kinetic_unavailable'});
    expect(failure!.detail).toContain('kinetic_engine');
    expect(failure!.message).not.toMatch(/boom|kinetic_engine/); // nothing internal reaches the end user
  });

  it('footage the engine skipped is footage_unsupported (not retryable by retrying)', () => {
    expect(kineticFailClosed({...ok, hasKineticSpec: false, warnings: ['kinetic_engine:skipped_footage:screen_recording']})).toMatchObject({code: 'footage_unsupported'});
  });

  it('engine flags off: kinetic_unavailable even if some blueprint exists', () => {
    expect(kineticFailClosed({...ok, run: {style: 'kinetic_typography', engineFlags: false}})).toMatchObject({code: 'kinetic_unavailable', detail: 'engine_flags_off'});
  });

  it('release off: a Kinetic job that reaches analysis fails closed (v1_release_off); any other style never fails closed', () => {
    expect(kineticFailClosed({...ok, release: false, hasKineticSpec: false})).toMatchObject({code: 'kinetic_unavailable', detail: 'v1_release_off'});
    expect(kineticFailClosed({...ok, release: false, hasKineticSpec: true})).toMatchObject({code: 'kinetic_unavailable', detail: 'v1_release_off'});
    for (const style of ['basic_captions', 'ai_clean_cut', 'explainer', 'subject_stage'] as const) {
      expect(kineticFailClosed({...ok, run: run(style, true), hasKineticSpec: false})).toBeNull();
    }
  });
});
