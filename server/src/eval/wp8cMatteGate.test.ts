/**
 * WP8C tests: the server matte gate (lib/matteGate.ts) and its wiring. Pure tests of every reason, the Edit Look fixture with the gate's answer, source-text pins for analyzeVideo / the planner /
 * the Director, and pins that the compositor (remotion) stays fail-closed. No FFmpeg, no network, no model call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {decideMatteGate, MIN_MATTE_CONFIDENCE, matteGateWarning, TEXT_BEHIND_SKIPPED_WARNING} from '../lib/matteGate.ts';
import {occupancyFromSpeaker} from '../stages/layout/occupancy.ts';
import {parseCreativePlan} from '../stages/directorV2/creativeDirector.ts';
import {EDIT_LOOKS, editLookWarnings, enforceEditLook, MATTE_DEPENDENT_KINDS} from '../stages/directorV2/editLooks.ts';
import {audioFacts} from '../stages/directorV2/perception.ts';
import type {PerceptionPack, WordRef} from '../stages/directorV2/types.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(REPO, ...parts), 'utf8');
const measured = {source: 'vision' as const};

describe('the gate: every reason', () => {
  it('measured speaker + keyable cutout -> usable, ok', () => {
    expect(decideMatteGate({occupancy: measured, cutout: {available: true}})).toEqual({usable: true, reason: 'ok'});
  });
  it('an occupancy flagged unmeasured -> unusable (checked before everything else)', () => {
    expect(decideMatteGate({occupancy: {source: 'fallback', unmeasured: true}, cutout: {available: true}})).toEqual({usable: false, reason: 'unmeasured'});
    expect(decideMatteGate({occupancy: {source: 'vision', unmeasured: true}, cutout: {available: false}})).toEqual({usable: false, reason: 'unmeasured'});
  });
  it('the silent default / fallback box -> unusable, even with a cutout', () => {
    expect(decideMatteGate({occupancy: {source: 'fallback'}, cutout: {available: true}})).toEqual({usable: false, reason: 'fallback_box'});
  });
  it('no keyable cutout -> unusable, no_mask', () => {
    expect(decideMatteGate({occupancy: measured, cutout: {available: false}})).toEqual({usable: false, reason: 'no_mask'});
  });
  it('a given confidence below the floor -> unusable; at or above, or absent, -> ignored', () => {
    expect(decideMatteGate({occupancy: measured, cutout: {available: true}, confidence: MIN_MATTE_CONFIDENCE - 0.01})).toEqual({usable: false, reason: 'low_confidence'});
    expect(decideMatteGate({occupancy: measured, cutout: {available: true}, confidence: Number.NaN})).toEqual({usable: false, reason: 'low_confidence'});
    expect(decideMatteGate({occupancy: measured, cutout: {available: true}, confidence: MIN_MATTE_CONFIDENCE}).usable).toBe(true);
    expect(decideMatteGate({occupancy: measured, cutout: {available: true}, confidence: 0.99}).usable).toBe(true);
    expect(decideMatteGate({occupancy: measured, cutout: {available: true}}).usable).toBe(true);
  });
  it('final phase: an attempted extraction with no video -> extract_failed; with a video -> ok; not attempted -> the planning answer stands', () => {
    const base = {occupancy: measured, cutout: {available: true}};
    expect(decideMatteGate({...base, extract: {attempted: true}})).toEqual({usable: false, reason: 'extract_failed'});
    expect(decideMatteGate({...base, extract: {attempted: true, videoUrl: '   '}})).toEqual({usable: false, reason: 'extract_failed'});
    expect(decideMatteGate({...base, extract: {attempted: true, videoUrl: 'https://x/cut.webm'}})).toEqual({usable: true, reason: 'ok'});
    expect(decideMatteGate({...base, extract: {attempted: false}})).toEqual({usable: true, reason: 'ok'});
  });
  it('an earlier unusable reason is never rescued by a video URL (the gate never invents a matte)', () => {
    const withVideo = {extract: {attempted: true, videoUrl: 'https://x/cut.webm'}};
    expect(decideMatteGate({occupancy: {source: 'fallback'}, cutout: {available: true}, ...withVideo}).usable).toBe(false);
    expect(decideMatteGate({occupancy: measured, cutout: {available: false}, ...withVideo}).usable).toBe(false);
  });
  it('warnings: matte_gate:ok / matte_gate:unusable:<reason>; the text-behind warning name is fixed', () => {
    expect(matteGateWarning({usable: true, reason: 'ok'})).toBe('matte_gate:ok');
    expect(matteGateWarning({usable: false, reason: 'fallback_box'})).toBe('matte_gate:unusable:fallback_box');
    expect(TEXT_BEHIND_SKIPPED_WARNING).toBe('text_behind_skipped:no_matte');
  });
  it('the module is pure: no imports, env, logger, network or file access', () => {
    const module_ = read('server/src/lib/matteGate.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(module_).not.toMatch(/^import /m);
    for (const word of ['process.env', 'fetch(', 'logger', 'readFile', 'spawn']) expect(module_).not.toContain(word);
  });
});

describe('fixture: talking_head with the gate\'s answer', () => {
  const talking = EDIT_LOOKS.find(look => look.id === 'talking_head')!;
  const elements = ['zoom', 'cutout', 'depth_overlay', 'kinetic_text', 'lockup', 'emphasis'].map((kind, index) => ({id: `e${index + 1}`, kind}));
  it('an unusable gate strips cutout and depth_overlay; zoom, kinetic text, lockup and emphasis remain', () => {
    for (const input of [
      {occupancy: {source: 'fallback' as const}, cutout: {available: true}},
      {occupancy: {source: 'vision' as const, unmeasured: true}, cutout: {available: true}},
      {occupancy: measured, cutout: {available: false}},
    ]) {
      const gate = decideMatteGate(input);
      const result = enforceEditLook(elements, talking, {matteUsable: gate.usable});
      expect(result.kept.map(item => item.kind), gate.reason).toEqual(['zoom', 'kinetic_text', 'lockup', 'emphasis']);
      expect(result.dropped.map(drop => [drop.kind, drop.reason])).toEqual([['cutout', 'matte_not_usable'], ['depth_overlay', 'matte_not_usable']]);
    }
  });
  it('a usable gate keeps them (within the look\'s graphic cap)', () => {
    const gate = decideMatteGate({occupancy: measured, cutout: {available: true}});
    const result = enforceEditLook(elements, talking, {matteUsable: gate.usable});
    // WP8P: the talking_head cap is 5 (was 2), so depth_overlay + kinetic_text + lockup (3 graphics) all fit.
    expect(result.kept.map(item => item.kind)).toEqual(['zoom', 'cutout', 'depth_overlay', 'kinetic_text', 'lockup', 'emphasis']);
    expect(result.dropped).toEqual([]);
  });
  it('the matte-dependent kinds are still exactly cutout and depth_overlay (not duplicated here)', () => {
    expect([...MATTE_DEPENDENT_KINDS]).toEqual(['cutout', 'depth_overlay']);
  });
});

const words: WordRef[] = [
  {id: 'w0', text: 'This', start: 1, end: 1.2, sentenceId: 's0'},
  {id: 'w1', text: 'hoodie', start: 1.3, end: 1.7, sentenceId: 's0'},
  {id: 'w2', text: 'sold', start: 1.8, end: 2.1, sentenceId: 's0'},
  {id: 'w3', text: 'out', start: 2.2, end: 2.5, sentenceId: 's0'},
];
const pack = (speakerCutoutAvailable: boolean): PerceptionPack => ({
  words,
  sentences: [{id: 's0', wordIds: words.map(word => word.id), start: 1, end: 2.5, text: 'This hoodie sold out'}],
  storyboard: [],
  occupancySlices: [{atSec: 2, occupancy: occupancyFromSpeaker({x: 0.2, y: 0.18, w: 0.55, h: 0.64}, 'vision')}],
  audio: audioFacts(words),
  transcript: 'This hoodie sold out',
  outputDurationSec: 12,
  language: 'en',
  creatorProfile: '',
  speakerCutoutAvailable,
  speakerCutoutNote: '',
  userAssets: [],
});
const director = (kinds: string[]) => ({
  edit_look: 'talking_head',
  edit_thesis: {look: 'x', rhythm: 'x', motion_language: 'x', color_story: 'x', why: 'x'},
  cold_open: {use: false},
  caption_style: {template: 'clean', position: 'bottom'},
  elements: kinds.map((kind, index) => ({id: `e${index + 1}`, beat_id: 'b1', intent: 'x', kind, start_word_id: 'w1', end_word_id: 'w2', text: 'sold out'})),
  cta: {start_word_id: 'w3', end_word_id: 'w3', keyword: 'sold', suggested: false},
});

describe('through the real parser: the gate\'s answer wins over the pack flag', () => {
  const meta = (matteUsable: boolean | undefined) => ({promptVersion: 'x', inputHash: '', editLooks: {matteUsable}});
  it('gate unusable strips the cutout even if the pack says an alpha video exists', () => {
    const plan = parseCreativePlan(director(['zoom', 'cutout']), 0, pack(true), undefined, meta(false));
    expect(plan.elements.map(item => item.kind)).toEqual(['zoom']);
    // WP8W: an unusable matte moves the matte-built look to explainer_cutaway, where the cutout is simply not an allowed kind.
    expect(plan.editLook).toMatchObject({id: 'explainer_cutaway', matteUsable: false, matteFallbackFrom: 'talking_head'});
    expect(editLookWarnings(plan.editLook!)).toContain('edit_look_matte_fallback:talking_head->explainer_cutaway');
    expect(editLookWarnings(plan.editLook!)).toContain('edit_look_drop:cutout:kind_not_in_look');
  });
  it('gate usable keeps the cutout even though the pack (no alpha video yet at planning time) says false', () => {
    const plan = parseCreativePlan(director(['zoom', 'cutout']), 0, pack(false), undefined, meta(true));
    expect(plan.elements.map(item => item.kind)).toEqual(['zoom', 'cutout']);
    expect(plan.editLook).toMatchObject({matteUsable: true, dropped: []});
  });
  it('no gate given -> the WP8B behaviour (the pack flag)', () => {
    expect(parseCreativePlan(director(['zoom', 'cutout']), 0, pack(true), undefined, meta(undefined)).elements.map(item => item.kind)).toEqual(['zoom', 'cutout']);
    expect(parseCreativePlan(director(['zoom', 'cutout']), 0, pack(false), undefined, meta(undefined)).elements.map(item => item.kind)).toEqual(['zoom']);
  });
  it('a repair carries the first plan\'s gate answer', () => {
    const creative = read('server/src/stages/directorV2/creativeDirector.ts');
    expect(creative).toContain('editLooks: fixedLookId ? {lookId: fixedLookId, matteUsable: previous.editLook?.matteUsable} : undefined,');
  });
});

describe('analyzeVideo and the planner (source text)', () => {
  const analyze = read('server/src/pipeline/analyzeVideo.ts');
  const planner = read('server/src/stages/broll/brollPlanner.ts');
  it('the planning gate is computed from the measured occupancy and the keyable cutout, reported on the mvp-like profiles, and passed to the planner only on polish', () => {
    expect(analyze).toContain("const matteOccupancy = {source: occupancy.source, unmeasured: Boolean(occupancy.unmeasuredSlots)};");
    expect(analyze).toContain('const planningMatte = decideMatteGate({occupancy: matteOccupancy, cutout: {available: speakerCutout.available}});');
    expect(analyze).toContain('if (mvpLike) warnings.push(matteGateWarning(planningMatte));');
    expect(analyze).toContain('matteUsable: polishPath ? planningMatte.usable : undefined,');
    expect(analyze.indexOf('const planningMatte =')).toBeLessThan(analyze.indexOf('broll = await planBRoll({'));
    expect(analyze.indexOf('markUnmeasuredFace(occupancy, input.editProfile)')).toBeLessThan(analyze.indexOf('const planningMatte ='));
  });
  it('Phase C: planning availability is keyable OR RVM configured (a provided cutout wins), and the planning gate sees it', () => {
    expect(analyze).toContain('available: speakerKeyable || rvmObtainable,');
    expect(analyze).toContain('const rvmObtainable = !speakerKeyable && subjectMatteConfigured();');
    expect(analyze.indexOf('available: speakerKeyable || rvmObtainable,')).toBeLessThan(analyze.indexOf('const planningMatte ='));
    // between planning and finalize the gates use the EXPECTED matte, not an asset that does not exist yet
    expect(analyze).toContain('const matteExpected = () => Boolean(resolvedCutout.available);');
    expect(analyze.match(/matteUsable: matteExpected\(\),/g)!.length).toBe(2);
    expect(analyze).toContain('subjectMatteUsable: matteExpected(),');
    expect(analyze).not.toContain('await extractSpeakerCutout({\n            inputPath: activeSourcePath,\n            outputPath: cutPath,'); // the early inline extraction is gone
  });
  it('Phase C: the asset is obtained AFTER the motion Director and the opening and BEFORE finalizeEdits; the final gate runs after it and says so only when it differs; depth / text-behind without a matte are reported as skipped', () => {
    expect(analyze).toContain('extract: {attempted: Boolean(outcome?.attempted), videoUrl: resolvedCutout.videoUrl}');
    expect(analyze).toContain('if (mvpLike && finalMatte.reason !== planningMatteReason) warnings.push(matteGateWarning(finalMatte));');
    expect(analyze).toContain('if (mvpLike && reconciled.textBehindSkipped) warnings.push(TEXT_BEHIND_SKIPPED_WARNING);');
    const obtain = analyze.indexOf('obtainPersonMatte({');
    expect(obtain).toBeGreaterThan(analyze.indexOf('motion = await runMotionGraphicsStage('));
    expect(obtain).toBeGreaterThan(analyze.indexOf('openingBehindSubject = resolved.behindSubject;'));
    expect(obtain).toBeLessThan(analyze.indexOf('const finalMatte ='));
    expect(analyze.indexOf('const finalMatte =')).toBeLessThan(analyze.indexOf('const finalized = finalizeEdits('));
    expect(analyze).toContain('const reconciled = reconcileDirectorElements({');
  });
  it('Phase C: only polish extends the extraction trigger to depth overlays; a cutout overlay always triggers it; the videoUrl guards on depth overlays stay in finalize and the blueprint', () => {
    expect(analyze).toContain('depthOverlays: polishPath ? broll.depthOverlays ?? [] : [], // a depth overlay alone only triggers an extraction on polish (as before)');
    expect(analyze).toContain("cutoutOverlays: broll.overlays.filter(overlay => overlay.layout === 'cutout'),");
    expect(analyze.match(/depthOverlays: resolvedCutout\.videoUrl\s*\?/g)!.length).toBeGreaterThanOrEqual(2); // finalizeEdits input + the blueprint
  });
  it('the planner tells the Director the gate\'s answer (and keeps the old signal when none is given); it is threaded to runDirectorV2', () => {
    expect(planner).toContain('speakerCutoutAvailable: input.matteUsable ?? Boolean(input.speakerCutout?.videoUrl),');
    expect(planner).toContain('matteUsable: input.matteUsable,');
    expect(planner).toContain("'not available (no usable matte). Do not emit cutout or depth_overlay.'");
    expect(read('server/src/stages/directorV2/runDirectorV2.ts')).toContain(
      '{editLooks: input.editLooks, matteUsable: input.matteUsable, lookBias: input.lookBias, kineticTypePrompt: input.kineticType?.prompt}',
    ); // WP8P lookBias + kinetic type prompt threaded with the matte gate
  });
  it('cuts-only is untouched: the gate code sits in the visual (non-captions-only) branch, after the captions-only branch ends', () => {
    expect(analyze.indexOf('const planningMatte =')).toBeGreaterThan(analyze.indexOf('const userBrollAssets = await describeUserBrollAssets('));
  });
});

describe('the compositor stays fail-closed (source text)', () => {
  it('decideTextBehindSubject falls back without a mask, with an unusable matte, or when text would cover the face', () => {
    const masks = read('remotion/src/motion/masks.ts');
    for (const part of [
      'if (!input.maskAvailable) {\n    return {mode: \'fallback\', fallback: \'shape_clip_panel\', reason: \'no_foreground_matte\'};',
      'if (!input.matteUsable) {\n    return {mode: \'fallback\', fallback: \'shape_clip_panel\', reason: \'matte_unusable\'};',
      "reason: 'text_would_cover_face'",
      "return {mode: 'behind_subject', basis: 'alpha_video'};",
    ]) expect(masks).toContain(part);
  });
  it('TextBehindSubjectTrack draws nothing without an alpha video and a usable keyed cutout, and never uses the occupancy ellipse', () => {
    const track = read('remotion/src/components/TextBehindSubjectTrack.tsx');
    expect(track).toContain("resolveSubjectMask(context, providers).kind === 'alpha_video' && keyedCutoutIsUsable(context.speakerCutout)");
    expect(track.replace(/\s*\n\s*\*\s*/g, ' ')).toContain('Otherwise this track draws nothing');
    expect(track).toContain('return <>{talkingHead}</>;');
    expect(track.replace(/\s*\n\s*\*\s*/g, ' ')).toContain('is NOT a matte and is never used here');
  });
  it('the server gate is no looser than the compositor: it cannot return usable without a keyable cutout (no_mask) or a video after an attempted extraction', () => {
    const gate = read('server/src/lib/matteGate.ts');
    expect(gate).toContain("if (!input.cutout.available) return {usable: false, reason: 'no_mask'};");
    expect(gate).toContain("if (input.extract?.attempted && !input.extract.videoUrl?.trim()) return {usable: false, reason: 'extract_failed'};");
  });
});
