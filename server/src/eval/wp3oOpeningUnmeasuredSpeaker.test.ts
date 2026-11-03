/**
 * WP3O pure tests: the opening resolver on the unmeasured path. resolveOpening itself is imported and run (stages/openingPlan/openingPlan.ts imports only zod, the text-treatment module and
 * colorRoles, which import no logger, `.env` or SDK); its measurement callback is a stub. analyzeVideo.ts imports the logger and is read as text. No logger, `.env`, SDK, FFmpeg, Chromium,
 * network, Gemini or Claude call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {resolveOpening, type ResolveInput} from '../stages/openingPlan/openingPlan.ts';
import {speakerForMotion} from '../stages/layout/unmeasuredSlots.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');

const DEFAULT_BOX = {x: 0.18, y: 0.16, w: 0.64, h: 0.62};
const TRANSCRIPT = 'Stay calm under pressure. Most managers panic when a deadline moves. Here is how to keep your head and decide fast.';
const plan = (treatment: string, over: Record<string, unknown> = {}) => ({
  central_promise: 'Stay calm under pressure', audience: 'managers', angle: 'calm beats panic',
  evidence: [{time_sec: 1, what: 'the opening line'}, {time_sec: 30, what: 'the closing advice'}],
  concept: 'calm focus', hook_wording: 'Stay calm', wording_source: 'spoken', source_frame_time_sec: 1, treatment,
  placement: {center_y: 0.3, width_frac: 0.8, align: 'center'}, frame0: 'a calm title', animation: 'a settle', why_this_design: 'it matches the tone', ...over,
});
const colors = {identity: 'calm blue', footage_notes: '', roles: {primary_text: '#FFFFFF', secondary_text: '#CBD5E1', accent: '#38BDF8', graphic_background: '#0B1220', panel: '#0B1220', highlight: '#FACC15', data: '#38BDF8'}};
const darkFootage = async () => ({p10: 0.02, p50: 0.04, p90: 0.07, meanRgb: {r: 15, g: 15, b: 20}, spread: 0.01});
const input = (treatment: string, extra: Partial<ResolveInput> = {}, planOver: Record<string, unknown> = {}): ResolveInput => ({
  plan: plan(treatment, planOver), colorDirection: colors, transcript: TRANSCRIPT, durationSec: 40, hookDurationSec: 3, matteUsable: true, measure: darkFootage, ...extra,
});

describe('a behind-subject opening with an unknown speaker', () => {
  it('is delivered as the existing layered panel, with the note speaker_unmeasured, and no behind-subject placement', async () => {
    const r = await resolveOpening(input('behind_subject', {speakerUnknown: true}));
    expect(r.report.accepted).toBe(true);
    expect(r.report.delivered).toBe('layered');
    expect(r.report.requested).toBe('behind_subject');
    expect(r.behindSubject).toBeUndefined();
    expect(r.spec?.kind).toBe('layered');
    expect(r.report.fallbacks.join(' ')).toContain('speaker_unmeasured');
  });
  it('a default box passed by mistake is ignored: same result, and the opening is not moved off a "face"', async () => {
    const r = await resolveOpening(input('behind_subject', {speakerUnknown: true, speakerBox: DEFAULT_BOX}));
    expect(r.report.delivered).toBe('layered');
    expect(r.behindSubject).toBeUndefined();
    expect(r.report.placement?.centerY).toBe(0.3);
    expect(r.report.corrections.join(' ')).not.toContain('kept off the face');
  });
  it('with no matte the earlier reason still comes first (the same order as the motion stage)', async () => {
    const r = await resolveOpening(input('behind_subject', {speakerUnknown: true, matteUsable: false}));
    expect(r.report.fallbacks.join(' ')).toContain('no_foreground_matte');
    expect(r.behindSubject).toBeUndefined();
  });
});

describe('a measured speaker and the legacy profile are unchanged', () => {
  it('a real box that leaves the text visible still places it behind the subject', async () => {
    const r = await resolveOpening(input('behind_subject', {speakerBox: {x: 0.3, y: 0.55, w: 0.4, h: 0.4}}));
    expect(r.report.delivered).toBe('behind_subject');
    expect(r.behindSubject?.centerY).toBe(0.3);
    expect(r.spec).toBeNull();
  });
  it('no box and no flag keeps the old "no constraint" meaning', async () => {
    expect((await resolveOpening(input('behind_subject'))).report.delivered).toBe('behind_subject');
    expect((await resolveOpening(input('behind_subject', {speakerUnknown: false}))).report.delivered).toBe('behind_subject');
  });
  it('a real box that hides the text still downgrades for the old reason', async () => {
    const r = await resolveOpening(input('behind_subject', {speakerBox: {x: 0, y: 0.2, w: 1, h: 0.2}})); // hides the text band; leaves room above for the panel
    expect(r.report.delivered).toBe('layered');
    expect(r.report.fallbacks.join(' ')).toContain('text_mostly_hidden_');
  });
});

describe('face avoidance uses only a measured box', () => {
  it('with the default box the opening still avoids the "face" (WP4S: the band above it now starts at the 6% UI line, so this plan is refused rather than shrunk to y 0.04)', async () => {
    const r = await resolveOpening(input('plain', {speakerBox: DEFAULT_BOX}));
    expect(r.report.accepted).toBe(false);
    expect(r.report.rejection).toBe('no_clear_band_above_the_face');
  });
  it('with an unknown speaker the opening is placed where the plan asked (still clear of the caption band), with no face-based correction', async () => {
    const r = await resolveOpening(input('plain', {speakerUnknown: true}));
    expect(r.report.accepted).toBe(true);
    expect(r.report.placement).toEqual({centerY: 0.3, widthFrac: 0.8, heightFrac: 0.18});
    expect(r.report.corrections.join(' ')).not.toMatch(/face/);
  });
  it('the caption-band clamp still applies without a speaker', async () => {
    const r = await resolveOpening(input('plain', {speakerUnknown: true}, {placement: {center_y: 0.85, width_frac: 0.8, align: 'center'}}));
    expect(r.report.corrections.join(' ')).toContain('kept out of the caption band');
    expect(r.report.placement!.centerY).toBeLessThan(0.7);
  });
  it('a measured box still rejects an opening that has no clear band above the face', async () => {
    const r = await resolveOpening(input('plain', {speakerBox: {x: 0.2, y: 0.08, w: 0.6, h: 0.8}}, {placement: {center_y: 0.2, width_frac: 0.8, align: 'center'}}));
    expect(r.report.accepted).toBe(false);
    expect(r.report.rejection).toBe('no_clear_band_above_the_face');
  });
  it('other treatments are delivered as asked either way', async () => {
    for (const treatment of ['curved', 'layered']) {
      expect((await resolveOpening(input(treatment, {speakerUnknown: true}))).report.delivered).toBe(treatment);
    }
  });
});

describe('what the call sites pass (source text; analyzeVideo imports the logger)', () => {
  const av = read('pipeline', 'analyzeVideo.ts');
  it('both resolveOpening calls take the speaker through the same helper as the motion stage', () => {
    const calls = [...av.matchAll(/await resolveOpening\(\{[\s\S]*?\}\);/g)].map(match => match[0]);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toContain('...speakerForMotion(occupancy),');
      expect(call).not.toContain('speakerBox: occupancy.speaker');
    }
    expect(av).not.toContain('speakerBox: occupancy.speaker');
    expect(av.match(/\.\.\.speakerForMotion\(occupancy\),/g)).toHaveLength(3); // the two openings and the motion stage
  });
  it('the helper gives the real box for a face and "unknown" with no box otherwise (so the resolver gets exactly one of them)', () => {
    const face = speakerForMotion({speaker: DEFAULT_BOX, source: 'vision'}) as {speakerBox: unknown};
    expect(face.speakerBox).toBe(DEFAULT_BOX);
    expect(speakerForMotion({speaker: DEFAULT_BOX, source: 'fallback', unmeasuredSlots: true})).toEqual({speakerUnknown: true});
  });
  it('the resolver forwards the flag and ignores a box when it is set; the validator and the defaults are unchanged', () => {
    const resolver = read('stages', 'openingPlan', 'openingPlan.ts');
    expect(resolver).toContain('const speaker = input.speakerUnknown ? undefined : input.speakerBox;');
    expect(resolver).toContain('...(input.speakerUnknown ? {speakerUnknown: true} : {}), start: 0,');
    expect(read('lib', 'editConflicts.ts')).not.toMatch(/speakerUnknown|speakerForMotion/);
    const env = read('config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
