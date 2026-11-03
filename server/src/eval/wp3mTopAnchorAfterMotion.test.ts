/**
 * WP3M pure tests: the `top` conversion run a second time, after the motion stage, for an unmeasured face (mvp). The pure function is the one from WP3L (imported); analyzeVideo.ts
 * and the motion stage import the logger, `.env` and the SDK path and are read as text. Import graph: stages/layout/unmeasuredSlots.ts (-> lib/provenance.ts -> types/blueprint.ts
 * constants; a type-only import of occupancy.ts). No logger, `.env`, SDK, FFmpeg, Chromium or network; no Claude or Gemini call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {resolveTopAnchors} from '../stages/layout/unmeasuredSlots.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');

type G = {start: number; end: number; text: string; anchor: string};
const g = (start: number, anchor: string, end = start + 2): G => ({start, end, text: `g${start}`, anchor});
const e = (start: number, anchor: string, end = start + 2): G => ({start, end, text: `e${start}`, anchor});
const o = (start: number, layout: string, anchor: string) => ({start, end: start + 2, layout, anchor});

describe('the second pass over a mix of already-converted and still-top elements', () => {
  const first = resolveTopAnchors({motionGraphics: [g(0, 'top'), g(10, 'top')], semanticEmphasis: [e(0, 'top')], overlays: []});
  it('the first pass converted three elements and left none on top', () => {
    expect(first.converted).toBe(3);
    // time order: g0 (0-2) takes the free left; e0 (0-2) finds the left busy and takes the right; g10 (10-12) finds both free and alternates (second alternation: right)
    expect(first.motionGraphics.map(x => x.anchor)).toEqual(['top_left', 'top_right']);
    expect(first.semanticEmphasis.map(x => x.anchor)).toEqual(['top_right']);
  });
  it('a pass over the first pass\'s result changes nothing: same objects, same sides, nothing flipped', () => {
    const again = resolveTopAnchors(first);
    expect(again.converted).toBe(0);
    again.motionGraphics.forEach((item, i) => expect(item).toBe(first.motionGraphics[i]));
    again.semanticEmphasis.forEach((item, i) => expect(item).toBe(first.semanticEmphasis[i]));
  });
  it('a late element still on `top` is converted; the already-converted ones keep the anchor they have (same objects)', () => {
    const late = resolveTopAnchors({motionGraphics: [...first.motionGraphics, g(20, 'top')], semanticEmphasis: first.semanticEmphasis, overlays: []});
    expect(late.converted).toBe(1);
    expect(late.motionGraphics[0]).toBe(first.motionGraphics[0]);
    expect(late.motionGraphics[1]).toBe(first.motionGraphics[1]);
    expect(late.semanticEmphasis[0]).toBe(first.semanticEmphasis[0]);
    expect(['top_left', 'top_right']).toContain(late.motionGraphics[2]!.anchor);
  });
  it('a late `top` at the same time as converted elements joins the side that is free; the existing ones are not moved to make room', () => {
    // first pass: g0 on left (0-2), e0 on right (0-2). A new top at 0-2 finds both busy: it still gets a side, and the two existing anchors are untouched.
    const late = resolveTopAnchors({motionGraphics: [...first.motionGraphics, g(1, 'top', 3)], semanticEmphasis: first.semanticEmphasis, overlays: []});
    expect(late.motionGraphics[0]!.anchor).toBe('top_left');
    expect(late.semanticEmphasis[0]!.anchor).toBe('top_right');
    expect(['top_left', 'top_right']).toContain(late.motionGraphics[2]!.anchor);
  });
  it('with one side occupied at that time by a converted element, the late one takes the other side', () => {
    const onlyLeft = resolveTopAnchors({motionGraphics: [g(0, 'top')], semanticEmphasis: [], overlays: []}); // g0 -> top_left, 0-2
    expect(onlyLeft.motionGraphics[0]!.anchor).toBe('top_left');
    const late = resolveTopAnchors({motionGraphics: onlyLeft.motionGraphics, semanticEmphasis: [e(1, 'top')], overlays: []});
    expect(late.semanticEmphasis[0]!.anchor).toBe('top_right');
    const onlyRight = resolveTopAnchors({motionGraphics: [], semanticEmphasis: [e(0, 'top_right')], overlays: [o(5, 'lockup', 'top')]});
    expect(onlyRight.overlays[0]!.anchor).toBe('top_left'); // free at that time: alternation starts left
    const busyRight = resolveTopAnchors({motionGraphics: [], semanticEmphasis: [e(0, 'top_right')], overlays: [o(1, 'lockup', 'top')]});
    expect(busyRight.overlays[0]!.anchor).toBe('top_left'); // the right is busy at 1-3, so the left
  });
  it('alternation (left first) happens only when both sides are free or both busy', () => {
    const free = resolveTopAnchors({motionGraphics: [g(100, 'top'), g(110, 'top')], semanticEmphasis: [], overlays: [o(120, 'card', 'top')]});
    expect([...free.motionGraphics.map(x => x.anchor), free.overlays[0]!.anchor]).toEqual(['top_left', 'top_right', 'top_left']);
    const one = resolveTopAnchors({motionGraphics: [g(0, 'top_right', 5), g(1, 'top')], semanticEmphasis: [], overlays: []});
    expect(one.motionGraphics[1]!.anchor).toBe('top_left');
  });
  it('overlays that ignore their anchor are not touched in the second pass either', () => {
    const cut = o(0, 'cutaway', 'top');
    const r = resolveTopAnchors({motionGraphics: [], semanticEmphasis: [], overlays: [cut, o(0, 'lockup', 'top')]});
    expect(r.overlays[0]).toBe(cut);
    expect(r.converted).toBe(1);
  });
  it('takes no speaker box and never leaves a `top` anchored element behind', () => {
    expect(resolveTopAnchors.length).toBe(1);
    const r = resolveTopAnchors({motionGraphics: [g(0, 'top'), g(0, 'top'), g(0, 'top')], semanticEmphasis: [e(0, 'top')], overlays: [o(0, 'bubble', 'top')]});
    for (const item of [...r.motionGraphics, ...r.semanticEmphasis, ...r.overlays]) expect(['top_left', 'top_right']).toContain(item.anchor);
  });
});

describe('what the motion stage writes (source text): the premise of this package', () => {
  const stage = read('stages', 'motionDirector', 'index.ts');
  it('its result carries generated graphics (box placements), behind-subject text and notes, and no anchored graphic, emphasis or overlay', () => {
    const type = stage.slice(stage.indexOf('export type MotionGraphicsStageResult = {'), stage.indexOf('/** Same estimate as Remotion'));
    for (const field of ['generatedGraphics', 'director', 'worker', 'geminiCostUsd', 'claudeCostUsd', 'warnings', 'behindSubjectTexts', 'textTreatments']) expect(type).toContain(field);
    expect(type).not.toMatch(/motionGraphics|semanticEmphasis|overlays/);
    expect(stage).not.toMatch(/\.anchor\s*=|anchor:\s*'top'/);
  });
  it('a behind-subject entry has a vertical centre and a width, no anchor; a generated graphic is placed by mode and box', () => {
    const entry = read('stages', 'textTreatment', 'textTreatment.ts');
    const type = entry.slice(entry.indexOf('export type BehindSubjectEntry = {'), entry.indexOf('export type TextTreatmentDecision'));
    expect(type).toContain('centerY: number;');
    expect(type).not.toContain('anchor');
    const types = read('types', 'blueprint.ts');
    expect(types).toMatch(/export type GeneratedGraphic = \{[\s\S]*?placement: GeneratedGraphicPlacement;/);
  });
  it('analyzeVideo writes the anchored arrays only at the known places, and between the stage call and the blueprint only the late pass, the legibility filter and the validator touch them', () => {
    const av = read('pipeline', 'analyzeVideo.ts');
    const writes = [...av.matchAll(/broll\.motionGraphics = ([^;]+);/g)].map(match => match[1]);
    expect(writes).toEqual(['patched.plan.motionGraphics', 'topBand.motionGraphics', 'late.motionGraphics', 'legible.motionGraphics', 'finalized.motionGraphics', 'text.motionGraphics']);
  });
  it('the shared validator can only relocate to a corner, so it cannot introduce `top` after either pass', () => {
    const conflicts = read('lib', 'editConflicts.ts');
    expect(conflicts).toContain("export const KINETIC_ANCHORS = ['top_left', 'top_right', 'bottom_left', 'bottom_right'] as const;");
    expect(conflicts).toContain("export const EMPHASIS_ANCHORS = ['top_left', 'top_right', 'bottom_left', 'bottom_right'] as const;");
  });
});

describe('wiring in analyzeVideo (source text)', () => {
  const av = read('pipeline', 'analyzeVideo.ts');
  const first = av.indexOf('const topBand = resolveTopAnchors({');
  const stageCall = av.indexOf('motion = await runMotionGraphicsStage({');
  const second = av.indexOf('const late = resolveTopAnchors({');
  it('there are exactly two calls: before the motion stage (WP3L) and after it (this package)', () => {
    expect(av.match(/resolveTopAnchors\(/g)).toHaveLength(2);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(stageCall);
    expect(second).toBeGreaterThan(stageCall);
    expect(second).toBeGreaterThan(av.indexOf('timings.motionGraphics = Date.now() - mark;'));
  });
  it('the second call is inside the motion branch, so with the stage off the first conversion is the only one', () => {
    const motionBranch = av.indexOf('if (motionGraphicsOn) {');
    expect(motionBranch).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(motionBranch);
    expect(second).toBeLessThan(av.indexOf('const finalized = finalizeEdits({'));
    // the next top-level statement after the motion branch closes is not another conversion
    expect(av.indexOf('if (occupancy.unmeasuredSlots) {', stageCall)).toBeLessThan(second);
  });
  it('it is gated on the unmeasured mark, reports and ledgers only a real change, and never reads the speaker box', () => {
    const block = av.slice(av.indexOf('if (occupancy.unmeasuredSlots) {', stageCall), av.indexOf('if (boundedClaude) {'));
    expect(block).toContain('if (late.converted > 0) {');
    expect(block).toContain("recordAnchorChanges(ledger, 'kinetic_text', lateKinetic, broll.motionGraphics);");
    expect(block).toContain('warnings.push(`top_anchor_converted_after_motion:${late.converted}`);');
    expect(block).not.toMatch(/occupancy\.speaker|preferredSide|graphicAnchor|overlayAnchor/);
  });
  it('the mark is the WP3H one: mvp and an undetected speaker only; the defaults are unchanged', () => {
    expect(read('stages', 'layout', 'unmeasuredSlots.ts')).toContain("return isMvpLikeProfile(profile) && source === 'fallback';");
    const env = read('config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
