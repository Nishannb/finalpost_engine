/**
 * WP3J pure tests: with no measured face (mvp, marked unmeasured) a centred graphic stays, the Gemini layout critique is not called, and the compositor compares nothing with the
 * default box. The decisions are pure predicates in stages/layout/unmeasuredSlots.ts (imported). layoutCritique.ts and slotCompositor.ts import the logger, `.env` and the HTTP
 * client, so their wiring (and the order of the skip before any file read or request) is proved by reading their source; no layout test is run. Import graph: unmeasuredSlots.ts
 * (a type-only import of occupancy.ts, erased). No logger, `.env`, SDK, FFmpeg, Chromium or network; no Gemini call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {
  boxCountsAsFace,
  composerGraphicAnchorIsUnsafe,
  graphicNeedsMove,
  pipSlotBlockedByBox,
  pipSlotClearOfBox,
  topCaptionAllowed,
  visionCritiqueMayRun,
} from '../stages/layout/unmeasuredSlots.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const OVERLAPS = [0, 0.01, 0.0399999, 0.04, 0.0400001, 0.3, 1, Number.NaN, Number.POSITIVE_INFINITY];
const ANCHORS = ['center', 'top', 'bottom', 'top_left', 'top_right', 'bottom_left', 'bottom_right', ''];

describe('1. a centred graphic stays where it is when the face is unmeasured', () => {
  it('the layout critique never moves a graphic for an unmeasured face: any anchor, any overlap', () => {
    for (const overlapWithBox of OVERLAPS) for (const anchor of ANCHORS) expect(graphicNeedsMove({boxIsFace: false, overlapWithBox, anchor}), `${overlapWithBox}/${anchor}`).toBe(false);
  });
  it('a measured face still uses the existing rule: centre, or an overlap above 0.03, moves it', () => {
    for (const overlapWithBox of OVERLAPS) {
      for (const anchor of ANCHORS) expect(graphicNeedsMove({boxIsFace: true, overlapWithBox, anchor}), `${overlapWithBox}/${anchor}`).toBe(!(overlapWithBox <= 0.03 && anchor !== 'center'));
    }
    expect(graphicNeedsMove({boxIsFace: true, overlapWithBox: 0, anchor: 'center'})).toBe(true);
  });
  it('the compositor, which runs first, no longer rewrites a centred graphic when the face is unmeasured (WP3K: top and bottom are no longer rewritten either)', () => {
    for (const anchor of ANCHORS) expect(composerGraphicAnchorIsUnsafe({boxIsFace: false, anchor}), anchor).toBe(false);
  });
  it('with a face the compositor rule is the legacy one: centre, top and bottom are unsafe', () => {
    for (const anchor of ANCHORS) expect(composerGraphicAnchorIsUnsafe({boxIsFace: true, anchor}), anchor).toBe(anchor === 'center' || anchor === 'top' || anchor === 'bottom');
  });
});

describe('2. the Gemini layout critique is skipped when the face is unmeasured', () => {
  it('may run only for a measured face or an unmarked occupancy', () => {
    expect(visionCritiqueMayRun({source: 'vision'})).toBe(true);
    expect(visionCritiqueMayRun({source: 'vision', unmeasuredSlots: true})).toBe(true);
    expect(visionCritiqueMayRun({source: 'fallback'})).toBe(true); // legacy: an unmarked fallback box behaves as before
    expect(visionCritiqueMayRun({source: 'fallback', unmeasuredSlots: true})).toBe(false);
    for (const occupancy of [{source: 'vision' as const}, {source: 'fallback' as const}, {source: 'fallback' as const, unmeasuredSlots: true as const}]) {
      expect(visionCritiqueMayRun(occupancy)).toBe(boxCountsAsFace(occupancy));
    }
  });
  const critique = read('stages', 'layout', 'layoutCritique.ts');
  const visionStart = critique.indexOf('async function critiqueLayoutWithVision');
  const vision = critique.slice(visionStart, visionStart + 4000);
  it('the guard is the first statement: before the key check, the still is read, and the request is built or sent', () => {
    const guard = vision.indexOf('if (!visionCritiqueMayRun(input.occupancy)) {');
    expect(guard).toBeGreaterThan(0);
    expect(vision.slice(guard, guard + 80)).toContain('return null;');
    expect(guard).toBeLessThan(vision.indexOf('env.GEMINI_API_KEY'));
    expect(guard).toBeLessThan(vision.indexOf('fs.readFile'));
    expect(guard).toBeLessThan(vision.indexOf('requestJson<'));
    expect(guard).toBeLessThan(vision.indexOf('speaker: input.occupancy.speaker'));
  });
  it('this is the only place the file sends a request, and a null result leaves the geometric plan with no cost and no vision patches', () => {
    expect(critique.match(/requestJson</g)).toHaveLength(1);
    const run = critique.slice(critique.indexOf('export async function critiqueAndPatchLayout'));
    expect(run).toContain('if (!vision) {');
    expect(run).toContain("source: 'geometric',");
    expect(run).toContain('estimatedCostUsd: 0,');
    expect(run.indexOf('applyVisionPatches(')).toBeGreaterThan(run.indexOf('if (!vision) {'));
  });
  it('the critique label is the one the Gemini request cap knows, so a skipped call spends no slot (nothing reaches the chokepoint)', () => {
    expect(critique).toContain("label: 'Gemini layout critique'");
  });
});

describe('3. the compositor compares nothing with the default box when the face is unmeasured', () => {
  it('pip slots: the box blocks nothing and rejects nothing; with a face the legacy 0.04 tests hold (NaN included)', () => {
    for (const overlapWithBox of OVERLAPS) {
      expect(pipSlotBlockedByBox({boxIsFace: true, overlapWithBox}), String(overlapWithBox)).toBe(overlapWithBox > 0.04);
      expect(pipSlotClearOfBox({boxIsFace: true, overlapWithBox}), String(overlapWithBox)).toBe(overlapWithBox < 0.04);
      expect(pipSlotBlockedByBox({boxIsFace: false, overlapWithBox})).toBe(false);
      expect(pipSlotClearOfBox({boxIsFace: false, overlapWithBox})).toBe(true);
    }
  });
  it('a top caption: with a face the legacy `y > 0.3`; unmeasured never (the same result the default box gave, without reading it)', () => {
    for (const speakerY of [0, 0.16, 0.3, 0.30001, 0.9]) {
      expect(topCaptionAllowed({boxIsFace: true, speakerY})).toBe(speakerY > 0.3);
      expect(topCaptionAllowed({boxIsFace: false, speakerY})).toBe(false);
    }
  });
  const composer = read('stages', 'layout', 'slotCompositor.ts');
  it('composeBeautifulLayout takes the flag once and uses the box-free choices when it is false', () => {
    expect(composer).toContain('const boxIsFace = boxCountsAsFace(input.occupancy);');
    // WP3K replaced the unmeasured branches (formerly the occupancy's own graphicAnchor / overlayAnchor) with the neutral anchor
    expect(composer).toContain('const graphicAnchor: MotionAnchor = boxIsFace ? legalGraphicAnchor(input.occupancy) : UNMEASURED_NEUTRAL_ANCHOR;');
    expect(composer).toContain('hookAnchor: boxIsFace ? legalHookAnchor(input.occupancy) : UNMEASURED_NEUTRAL_ANCHOR,');
    expect(composer).toContain('remapMotionGraphics(input.motionGraphics, graphicAnchor, boxIsFace)');
  });
  it('the two box-comparing helpers are only called when the box counts as a face', () => {
    expect(composer.match(/legalGraphicAnchor\(/g)).toHaveLength(1);
    expect(composer.match(/legalHookAnchor\(/g)).toHaveLength(1);
    expect(composer).toContain('boxIsFace ? legalGraphicAnchor(');
    expect(composer).toContain('boxIsFace ? legalHookAnchor(');
  });
  it('the graphic rewrite and the pip choice use the predicates; no raw box comparison is left', () => {
    expect(composer).toContain('const unsafe = composerGraphicAnchorIsUnsafe({boxIsFace, anchor: graphic.anchor});');
    expect(composer).toContain('pipSlotBlockedByBox({boxIsFace, overlapWithBox: overlapArea(match.rect, occupancy.speaker)})');
    expect(composer).toContain('pipSlotClearOfBox({boxIsFace, overlapWithBox: overlapArea(slot.rect, occupancy.speaker)})');
    expect(composer).not.toMatch(/overlapArea\([^)]*occupancy\.speaker\)\s*(>|<)\s*0\.04/);
    expect(composer).not.toMatch(/graphic\.anchor === 'center'/);
    expect(composer).toContain('boxIsFace = true,'); // a caller that passes no flag keeps the legacy rule
    expect(composer).toContain('topCaptionAllowed({boxIsFace: boxCountsAsFace(occupancy), speakerY: occupancy.speaker.y})');
  });
});

describe('what is not changed (source text)', () => {
  it('the WP3I decisions in the layout critique are still wired, and the conflict validator is untouched', () => {
    const critique = read('stages', 'layout', 'layoutCritique.ts');
    expect(critique.match(/const boxIsFace = boxCountsAsFace\(occupancy\);/g)).toHaveLength(2);
    expect(critique).toContain('const hookAnchor = boxIsFace ? legalHookAnchor(occupancy) : plan.hookAnchor;');
    const conflicts = read('lib', 'editConflicts.ts');
    expect(conflicts).toContain("blocking: context.speaker.source === 'vision', geometry:");
    expect(conflicts).not.toMatch(/unmeasuredSlots|boxCountsAsFace|visionCritiqueMayRun/);
  });
  it('the mark is set only for mvp + fallback, before the composer and the critique, and only in the visual-edit branch (never caption-only)', () => {
    const av = read('pipeline', 'analyzeVideo.ts');
    const mark = av.indexOf('markUnmeasuredFace(occupancy');
    expect(mark).toBeGreaterThan(av.indexOf('await describeUserBrollAssets('));
    expect(mark).toBeLessThan(av.indexOf(': composeBeautifulLayout({'));
    expect(mark).toBeLessThan(av.indexOf('await critiqueAndPatchLayout({'));
    expect(read('stages', 'layout', 'unmeasuredSlots.ts')).toContain("return isMvpLikeProfile(profile) && source === 'fallback';");
  });
  it('the defaults are unchanged', () => {
    const env = read('config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
