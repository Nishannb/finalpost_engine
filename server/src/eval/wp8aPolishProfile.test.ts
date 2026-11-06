/**
 * WP8A tests: the `polish` profile = Stage A (the cuts speech path) THEN Stage B (the mvp visual editor). Pure tests of the profile helpers and the pure modules that share the mvp behaviours,
 * plus source-text tests of the analyzeVideo split (it imports the logger, so it is read, not imported). No FFmpeg, no network, no model call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {geminiBudgetUnconfiguredWarning} from '../lib/geminiEditBudget.ts';
import {
  analyzeOverridesFor,
  decideClaudeBound,
  forcesVisualsOff,
  isMvpLikeProfile,
  normalizeEditProfile,
  PRODUCT_EDIT_PROFILES,
  profileFingerprintKey,
  runsSpeechCuts,
  unrecognizedEditProfile,
} from '../lib/productEditProfile.ts';
import {unmeasuredPolicyApplies} from '../stages/layout/unmeasuredSlots.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(REPO, ...parts), 'utf8');
const analyze = read('server/src/pipeline/analyzeVideo.ts');

describe('the polish name and the default', () => {
  it('the exact string polish selects polish; the list names it', () => {
    expect(normalizeEditProfile('polish')).toBe('polish');
    expect([...PRODUCT_EDIT_PROFILES]).toEqual(['legacy', 'mvp', 'cuts', 'polish']);
  });
  it('the default is unchanged: unset, empty and anything unrecognized (including wrong-case polish) still resolve to cuts', () => {
    for (const raw of [undefined, null, '', 'Polish', 'POLISH', ' polish', 'polish ', 'polish2', 'polsh', 42]) expect(normalizeEditProfile(raw), String(raw)).toBe('cuts');
    expect(normalizeEditProfile('cuts')).toBe('cuts');
    expect(normalizeEditProfile('mvp')).toBe('mvp');
    expect(normalizeEditProfile('legacy')).toBe('legacy');
    expect(read('server/src/config/env.ts')).toContain("PRODUCT_EDIT_PROFILE: str('cuts'),");
  });
  it('polish is valid (not reported); a wrong-case polish is reported as unrecognized', () => {
    expect(unrecognizedEditProfile('polish')).toBeNull();
    expect(unrecognizedEditProfile('Polish')).toBe('Polish');
    expect(unrecognizedEditProfile('polsh')).toBe('polsh');
  });
});

describe('what polish adds and shares', () => {
  it('fingerprint: its own key; the others are unchanged', () => {
    expect(profileFingerprintKey('polish')).toBe('edit-profile:polish-v1');
    expect(profileFingerprintKey('cuts')).toBe('edit-profile:cuts-v1');
    expect(profileFingerprintKey('mvp')).toBe('edit-profile:mvp-v1');
    expect(profileFingerprintKey('legacy')).toBe('');
    expect(new Set(PRODUCT_EDIT_PROFILES.map(profileFingerprintKey)).size).toBe(PRODUCT_EDIT_PROFILES.length);
  });
  it('analyze overrides: polish gets exactly the mvp overrides (whole-video Director input, opening direction, creator-B-roll-only); cuts none', () => {
    expect(analyzeOverridesFor('polish')).toEqual({directorVideoInput: true, openingDirection: true, userBrollOnly: true});
    expect(analyzeOverridesFor('polish')).toEqual(analyzeOverridesFor('mvp'));
    expect(analyzeOverridesFor('cuts')).toEqual({});
    expect(analyzeOverridesFor('legacy')).toEqual({});
  });
  it('the three switches: polish is speech-cuts AND mvp-like AND not visuals-off', () => {
    const table = PRODUCT_EDIT_PROFILES.map(p => [p, runsSpeechCuts(p), isMvpLikeProfile(p), forcesVisualsOff(p)]);
    expect(table).toEqual([
      ['legacy', false, false, false],
      ['mvp', false, true, false],
      ['cuts', true, false, true],
      ['polish', true, true, false],
    ]);
  });
  it('the mandatory Claude bound for generated graphics applies to polish exactly as to mvp (unset cap = graphics disabled, fail closed)', () => {
    const base = {graphicsOn: true, callerSuppliedGenerator: false, capUsd: 0, maxRequests: 0, maxTokensPerCall: 0, defaultMaxRequests: 6};
    expect(decideClaudeBound({...base, profile: 'polish'})).toEqual({action: 'disabled', reason: 'claude_budget_unconfigured'});
    expect(decideClaudeBound({...base, profile: 'mvp'})).toEqual({action: 'disabled', reason: 'claude_budget_unconfigured'});
    expect(decideClaudeBound({...base, profile: 'cuts'}).action).toBe('unbounded');
    expect(decideClaudeBound({...base, profile: 'polish', capUsd: 0.5}).action).toBe('bounded');
    expect(decideClaudeBound({...base, profile: 'polish', graphicsOn: false}).action).toBe('unbounded'); // graphics off (the default flag) needs no bound
  });
  it('the Gemini-uncapped warning and the unmeasured-face policy treat polish like mvp, and not like cuts', () => {
    expect(geminiBudgetUnconfiguredWarning('polish', 0)).toBe(geminiBudgetUnconfiguredWarning('mvp', 0));
    expect(geminiBudgetUnconfiguredWarning('polish', 0)).not.toBeNull();
    expect(geminiBudgetUnconfiguredWarning('cuts', 0)).toBeNull();
    expect(geminiBudgetUnconfiguredWarning('polish', 10)).toBeNull();
    expect(unmeasuredPolicyApplies('fallback', 'polish')).toBe(true);
    expect(unmeasuredPolicyApplies('fallback', 'cuts')).toBe(false);
    expect(unmeasuredPolicyApplies('vision', 'polish')).toBe(false);
  });
});

describe('analyzeVideo: the cuts / polish split (source text)', () => {
  it('four switches, each computed once from the profile string, and no leftover cutsPath', () => {
    for (const line of [
      "const speechCutsOn = input.editProfile === 'cuts' || input.editProfile === 'polish';",
      "const cutsOnlyVisualsOff = input.editProfile === 'cuts';",
      "const polishPath = input.editProfile === 'polish';",
      "const mvpLike = input.editProfile === 'mvp' || input.editProfile === 'polish';",
    ]) {
      expect(analyze).toContain(line);
      expect(analyze.split(line).length - 1, line).toBe(1);
    }
    expect(analyze).not.toMatch(/\bcutsPath\b/);
  });
  it('visual stages are forced off by cutsOnlyVisualsOff only: polish keeps visualEditsOn, the motion flag and (explicit) delivery shaping', () => {
    expect(analyze).toContain('const visualEditsOn = !cutsOnlyVisualsOff && visualToolkitsRequested(requestedEdits);');
    expect(analyze).toContain('const motionGraphicsRequested = !cutsOnlyVisualsOff && (input.generatedGraphicsEnabled ?? flags.motionGraphics);');
    expect(analyze).toContain('const deliveryDenied = input.forceDeliveryShaping === false || cutsOnlyVisualsOff;');
    expect(analyze).toContain("if (cutsOnlyVisualsOff) {\n      warnings.push('delivery_shaping_skipped:cuts_profile');");
    expect(analyze).not.toMatch(/visualEditsOn = [^;]*speechCutsOn/);
    expect(analyze).not.toMatch(/motionGraphicsRequested = [^;]*speechCutsOn/);
    expect(analyze).not.toMatch(/deliveryDenied = [^;]*(speechCutsOn|polishPath)/);
  });
  it('polish does not take the cuts captions-only skip: captionsOnly still follows visualEditsOn, so a polish run with edits requested reaches the Director branch', () => {
    expect(analyze).toContain('const captionsOnly = !visualEditsOn;');
    const elseBlock = analyze.slice(analyze.indexOf('} else {\n      const userBrollAssets = await describeUserBrollAssets('), analyze.indexOf('// --- Stage C2: generated motion graphics (opt-in)'));
    expect(elseBlock).toContain('planBRoll(');
    expect(elseBlock).toContain('if (mvpLike) {\n        userAssetIdByUrl');
  });
  it('Stage A (speech cuts) is keyed on speechCutsOn: denoise, forced trim, aggressive backchannel, AI keep-plan, retake gate and cap, debug dump', () => {
    for (const part of [
      'if (speechCutsOn && env.CUTS_DENOISE_ENABLED) {',
      '(captionsOnly && !teleprompterClean && !speechCutsOn) ||',
      '!teleprompterClean && !speechCutsOn);',
      'aggressiveBackchannel: speechCutsOn,',
      'if (speechCutsOn && env.CUTS_AI_KEEP_PLAN && env.GEMINI_API_KEY) {',
      "if ((input.editProfile === 'mvp' && !captionsOnly) || teleprompterClean || speechCutsOn) {",
      '...(speechCutsOn ? {maxRemovalFrac: CUTS_RETAKE_MAX_REMOVAL, wholeVideo: true} : {}),',
      'if (speechCutsOn || env.CUTS_DEBUG) {',
    ]) expect(analyze, part).toContain(part);
  });
  it('the automatic delivery pass does not run on polish (it would replace the Stage A trim); an explicit one does, with a warning', () => {
    expect(analyze).toContain('if (deliveryAllowed && (deliveryExplicit || (env.DELIVERY_SHAPING_AUTO && !polishPath))) {');
    expect(analyze).toContain("if (polishPath && deliveryShaping) {\n      warnings.push('polish_stage_a_trim_skipped:delivery_shaped');");
    expect(analyze.indexOf('polish_stage_a_trim_skipped')).toBeLessThan(analyze.indexOf('if (skipSilenceTrim) {'));
  });
  it('every mvp-only behaviour follows mvpLike (so polish gets it): strict-director rethrow, user-B-roll ids, legibility, evidence, source audio flag', () => {
    for (const part of [
      'if (input.strictAiDirection || !mvpLike) {',
      'if (mvpLike && !captionsOnly) {',
      'if (mvpLike && userAssetIdByUrl) {',
      '...(mvpLike && broll.evidence ?',
      '...(mvpLike || speechCutsOn ? {sourceHasAudio', // WP8I: also on the shipping profiles
    ]) expect(analyze, part).toContain(part);
    expect(analyze).toContain('geminiBudgetUnconfiguredWarning(input.editProfile, env.GEMINI_EDIT_MAX_REQUESTS)');
    expect(analyze).toContain("profile: input.editProfile ?? 'legacy',");
    // the only place the literal 'mvp' remains is the WP6A gate (mvp stays gated by captionsOnly) and the mvpLike definition
    const literal = [...analyze.matchAll(/editProfile (?:===|!==) 'mvp'/g)].length;
    expect(literal).toBe(2);
  });
  it('the shared pure modules use the shared helper instead of a literal profile string', () => {
    expect(read('server/src/lib/geminiEditBudget.ts')).toContain('isMvpLikeProfile(profile)');
    expect(read('server/src/stages/filters/autoZoom.ts')).toContain('!isMvpLikeProfile(context.profile)');
    expect(read('server/src/stages/layout/unmeasuredSlots.ts')).toContain('return isMvpLikeProfile(profile) && source === ');
  });
});

describe('documentation surface (source text)', () => {
  it('the profile header, env.ts, the CLI help and both example files say polish = cuts Stage A then mvp Stage B, opt-in, never the default', () => {
    const header = read('server/src/lib/productEditProfile.ts');
    for (const part of ['polish            WP8A', 'Stage A THEN Stage B', 'The default stays `cuts`; polish is never the default']) expect(header).toContain(part);
    expect(read('server/src/config/env.ts')).toContain('`polish` (WP8A) is an opt-in that runs the cuts speech path THEN the mvp visual editor');
    const first = read('server/src/scripts/firstVideo.ts');
    expect(first).toContain('PRODUCT_EDIT_PROFILE=polish is an opt-in: the cuts speech path (Stage A) THEN the mvp visual editor (Stage B), never the default');
    for (const file of ['.env.example', '.env.production.example']) {
      const text = read(file);
      const line = text.split('\n').find(l => l.startsWith('# PRODUCT_EDIT_PROFILE=polish ')) ?? '';
      expect(line, file).toMatch(/Stage A/);
      expect(line, file).toMatch(/Stage B/);
      expect(line, file).toMatch(/Not the default; cuts stays the default/);
      expect(text, file).not.toMatch(/^PRODUCT_EDIT_PROFILE=/m);
    }
  });
  it('both callers warn with polish in the list of valid values', () => {
    for (const file of ['server/src/pipeline/analysisRunner.ts', 'server/src/scripts/firstVideo.ts']) expect(read(file)).toContain('PRODUCT_EDIT_PROFILE is not legacy, mvp, cuts or polish; using the default (cuts)');
  });
  it('the call inventory names polish beside cuts for the keep-plan call', () => {
    expect(read('server/src/eval/callInventory.ts')).toContain('editProfile=cuts or polish with CUTS_AI_KEEP_PLAN');
  });
});
