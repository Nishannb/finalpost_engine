/**
 * WP3K pure tests: with an unmeasured face (mvp), placement derives no side and no anchor from the default box. The decisions are pure helpers in
 * stages/layout/unmeasuredSlots.ts (imported). slotCompositor.ts and layoutCritique.ts import the logger, `.env` and the HTTP client, so their wiring is read as text; no layout test
 * is run. Import graph: unmeasuredSlots.ts (a type-only import of occupancy.ts, erased). No logger, `.env`, SDK, FFmpeg, Chromium or network; no Gemini call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {composerGraphicAnchorIsUnsafe, directorAnchorOrNeutral, UNMEASURED_NEUTRAL_ANCHOR} from '../stages/layout/unmeasuredSlots.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const ANCHORS = ['center', 'top', 'bottom', 'top_left', 'top_right', 'bottom_left', 'bottom_right'];

describe('why the occupancy\'s own side and anchors cannot be used for an unmeasured face', () => {
  const occupancy = read('stages', 'layout', 'occupancy.ts');
  it('they are computed from the box\'s left and right gaps, and the default box has EQUAL gaps: the side is decided by floating-point rounding, not by anything about the speaker', () => {
    expect(occupancy).toContain("const preferredSide: 'left' | 'right' = rightGap >= leftGap ? 'right' : 'left';");
    expect(occupancy).toContain("preferredSide === 'right' ? 'top_right' : 'top_left';");
    const box = {x: 0.18, w: 0.64}; // the default box
    const leftGap = box.x;
    const rightGap = 1 - (box.x + box.w);
    expect(Math.abs(rightGap - leftGap)).toBeLessThan(1e-12); // a tie in exact arithmetic
    // 1 - (0.18 + 0.64) is 0.17999999999999994 in IEEE-754 doubles, just under 0.18, so the tie-break lands on LEFT / top_left (an earlier report said right / top_right: that was wrong)
    expect(rightGap >= leftGap).toBe(false);
  });
});

describe('the anchor decision', () => {
  it('the neutral anchor is the top safe area, centred, and a valid anchor of both vocabularies', () => {
    expect(UNMEASURED_NEUTRAL_ANCHOR).toBe('top');
    const types = read('types', 'blueprint.ts');
    expect(types.slice(types.indexOf('export const VISUAL_ANCHORS'), types.indexOf('export type VisualAnchor'))).toContain("'top',");
    expect(types.slice(types.indexOf('export const MOTION_ANCHORS'), types.indexOf('export type MotionAnchor'))).toContain("'top',");
    expect(UNMEASURED_NEUTRAL_ANCHOR).not.toMatch(/left|right/);
  });
  it('the Director\'s own anchor is kept, whatever it is; the neutral one only when it gave none', () => {
    for (const anchor of ANCHORS) expect(directorAnchorOrNeutral(anchor), anchor).toBe(anchor);
    for (const missing of [undefined, null, '' as const]) expect(directorAnchorOrNeutral(missing), String(missing)).toBe('top');
  });
  it('nothing is rewritten as "unsafe" for an unmeasured face: centre, top and bottom stay', () => {
    for (const anchor of [...ANCHORS, '']) expect(composerGraphicAnchorIsUnsafe({boxIsFace: false, anchor}), anchor).toBe(false);
  });
  it('a measured face keeps today\'s rule exactly: centre, top and bottom are rewritten', () => {
    for (const anchor of [...ANCHORS, '']) expect(composerGraphicAnchorIsUnsafe({boxIsFace: true, anchor}), anchor).toBe(anchor === 'center' || anchor === 'top' || anchor === 'bottom');
  });
});

describe('slotCompositor.ts (source text)', () => {
  const composer = read('stages', 'layout', 'slotCompositor.ts');
  it('the three anchors an unmeasured face uses are the neutral one, not the occupancy\'s', () => {
    expect(composer).toContain('const graphicAnchor: MotionAnchor = boxIsFace ? legalGraphicAnchor(input.occupancy) : UNMEASURED_NEUTRAL_ANCHOR;');
    expect(composer).toContain('const overlayAnchor: VisualAnchor = boxIsFace ? toVisualAnchor(graphicAnchor) : UNMEASURED_NEUTRAL_ANCHOR;');
    expect(composer).toContain('hookAnchor: boxIsFace ? legalHookAnchor(input.occupancy) : UNMEASURED_NEUTRAL_ANCHOR,');
  });
  it('toVisualAnchor would turn the neutral top into top_right, so it is never applied to it', () => {
    expect(composer.slice(composer.indexOf('function toVisualAnchor'))).toContain("if (anchor === 'center' || anchor === 'top') {\n    return 'top_right';");
    expect(composer.match(/toVisualAnchor\(/g)).toHaveLength(2); // the definition and the guarded call
  });
  it('the occupancy\'s derived side and anchors are read nowhere in the compositor without the face guard', () => {
    expect(composer).not.toMatch(/input\.occupancy\.(graphicAnchor|overlayAnchor|preferredSide)/);
    const reads = [...composer.matchAll(/occupancy\.(graphicAnchor|overlayAnchor|preferredSide)/g)];
    expect(reads).toHaveLength(1);
    expect(composer).toContain("const preferred = boxCountsAsFace(occupancy) ? (occupancy.preferredSide === 'right' ? 'bottom_left' : 'bottom_right') : null;");
    expect(composer).toContain('const match = (preferred ? pip.find(slot => slot.anchor === preferred) : undefined) || pip[0];');
  });
  it('overlays keep the Director\'s anchor when the face is unmeasured at all four rewrite sites', () => {
    expect(composer).toContain("const unsafe = boxIsFace && (overlay.anchor === 'top' || overlay.anchor === 'bottom'); // WP3K");
    expect(composer).toContain('anchor: boxIsFace ? anchor : directorAnchorOrNeutral(overlay.anchor),');
    expect(composer).toContain("const unsafe = boxIsFace && (overlay.anchor === 'top' || overlay.anchor === 'bottom');\n      return {\n        ...overlay,\n        textStyle: 'stack',");
    expect(composer).toContain("anchor: boxIsFace && overlay.anchor === 'top' ? 'bottom_right' : overlay.anchor,");
    expect(composer).toContain('remapOverlays(input.overlays, overlayAnchor, mediaContainers, boxIsFace)');
  });
  it('emphasis keeps every anchor it has; one with none gets the neutral anchor, with no alternating sides', () => {
    expect(composer).toContain('const unsafe = boxIsFace ? !item.anchor || item.anchor === \'top\' || item.anchor === \'bottom\' : !item.anchor;');
    expect(composer).toContain('anchor: unsafe ? (boxIsFace ? (index % 2 === 0 ? anchor : oppositeVisual(anchor)) : anchor) : item.anchor,');
    expect(composer).toContain('remapEmphasis(\n      input.semanticEmphasis ?? [],\n      overlayAnchor,\n      boxIsFace,');
  });
  it('the legacy branch of each expression is the original one, and the defaults of the new parameters keep other callers unchanged', () => {
    expect(composer).toContain('boxIsFace = true,');
    expect(composer.match(/boxIsFace = true,/g)).toHaveLength(3); // remapMotionGraphics, remapOverlays, remapEmphasis
    expect(composer).toContain('legalGraphicAnchor(input.occupancy) :');
    expect(composer).toContain('legalHookAnchor(input.occupancy) :');
  });
});

describe('layoutCritique.ts (source text)', () => {
  const critique = read('stages', 'layout', 'layoutCritique.ts');
  it('the caption-band fix for overlays and the graphic target use the neutral anchor when unmeasured, the old derivation otherwise', () => {
    expect(critique).toContain("const safeGraphic: Occupancy['graphicAnchor'] = boxIsFace ? occupancy.graphicAnchor : UNMEASURED_NEUTRAL_ANCHOR;");
    expect(critique).toContain("const topAnchor: VisualAnchor = !boxIsFace ? UNMEASURED_NEUTRAL_ANCHOR : occupancy.preferredSide === 'right' ? 'top_right' : 'top_left';");
  });
  it('the WP3I/WP3J decisions are still wired (no graphic or emphasis moved for the box, hook anchor kept, vision skipped)', () => {
    expect(critique).toContain('const hookAnchor = boxIsFace ? legalHookAnchor(occupancy) : plan.hookAnchor;');
    expect(critique).toContain('if (!graphicNeedsMove({boxIsFace');
    expect(critique).toContain('if (!visionCritiqueMayRun(input.occupancy)) {');
  });
});

describe('what is not touched (source text)', () => {
  it('the conflict validator, the hook fit and caption placement, and the defaults', () => {
    expect(read('lib', 'editConflicts.ts')).not.toMatch(/unmeasuredSlots|boxCountsAsFace|UNMEASURED_NEUTRAL_ANCHOR/);
    const av = read('pipeline', 'analyzeVideo.ts');
    expect(av).toContain('const unmeasured = markUnmeasuredFace(occupancy, input.editProfile);');
    expect(av).toContain('layoutHookAnchor = patched.plan.hookAnchor;'); // the neutral hook anchor reaches the blueprint through the critique's plan
    const env = read('config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
