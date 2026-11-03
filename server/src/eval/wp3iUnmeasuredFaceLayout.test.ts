/**
 * WP3I pure tests: the layout critique must not treat the default (fallback) box as a face when the occupancy is marked unmeasured (mvp). The decisions live in pure predicates in
 * stages/layout/unmeasuredSlots.ts (imported); layoutCritique.ts imports the logger, `.env` and the HTTP client, so its wiring is read as text and the layout suite is not run.
 * Import graph: unmeasuredSlots.ts (a type-only import of occupancy.ts, erased). No logger, `.env`, SDK, FFmpeg, Chromium or network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {boxCountsAsFace, boxOverlapIsIssue, emphasisNeedsMove, graphicNeedsMove} from '../stages/layout/unmeasuredSlots.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');

const OVERLAPS = [0, 0.001, 0.0299999, 0.03, 0.0300001, 0.05, 0.2, 0.5, 1, Number.NaN, Number.POSITIVE_INFINITY];
const ANCHORS = ['center', 'top', 'top_left', 'top_right', 'bottom', 'bottom_left', 'bottom_right', ''];

describe('when the box counts as a face', () => {
  it('only a measured face, or any occupancy not marked unmeasured, counts; a marked fallback does not', () => {
    expect(boxCountsAsFace({source: 'vision'})).toBe(true);
    expect(boxCountsAsFace({source: 'vision', unmeasuredSlots: true})).toBe(true); // a mark on a measured face is ignored
    expect(boxCountsAsFace({source: 'fallback'})).toBe(true); // legacy: an unmarked fallback box behaves exactly as before
    expect(boxCountsAsFace({source: 'fallback', unmeasuredSlots: true})).toBe(false);
  });
});

describe('a face, measured or legacy: the decisions are exactly the old expressions', () => {
  it('graphics: moved unless overlap <= 0.03 and not centred (including NaN and Infinity)', () => {
    for (const overlapWithBox of OVERLAPS) {
      for (const anchor of ANCHORS) {
        const legacyMoves = !(overlapWithBox <= 0.03 && anchor !== 'center');
        expect(graphicNeedsMove({boxIsFace: true, overlapWithBox, anchor}), `${overlapWithBox}/${anchor}`).toBe(legacyMoves);
      }
    }
  });
  it('emphasis: moved unless overlap <= 0.03', () => {
    for (const overlapWithBox of OVERLAPS) expect(emphasisNeedsMove({boxIsFace: true, overlapWithBox}), String(overlapWithBox)).toBe(!(overlapWithBox <= 0.03));
  });
  it('issues: raised when overlap is above the threshold, for both thresholds the critique uses', () => {
    for (const overlapWithBox of OVERLAPS) {
      for (const threshold of [0.02, 0.03]) expect(boxOverlapIsIssue({boxIsFace: true, overlapWithBox, threshold}), `${overlapWithBox}/${threshold}`).toBe(overlapWithBox > threshold);
    }
  });
});

describe('an unmeasured face: the box is no reason to move or flag anything', () => {
  it('no graphic is re-anchored, however large the overlap and whatever the anchor (WP3J: a centred one stays too; WP3I had kept the centre rule)', () => {
    for (const overlapWithBox of OVERLAPS) {
      for (const anchor of ANCHORS) {
        expect(graphicNeedsMove({boxIsFace: false, overlapWithBox, anchor}), `${overlapWithBox}/${anchor}`).toBe(false);
      }
    }
  });
  it('no emphasis is re-anchored for overlapping the box', () => {
    for (const overlapWithBox of OVERLAPS) expect(emphasisNeedsMove({boxIsFace: false, overlapWithBox})).toBe(false);
  });
  it('the box raises no hook, graphic or emphasis issue', () => {
    for (const overlapWithBox of OVERLAPS) {
      for (const threshold of [0.02, 0.03]) expect(boxOverlapIsIssue({boxIsFace: false, overlapWithBox, threshold})).toBe(false);
    }
  });
  it('the corner anchors the Director chose survive where the legacy rule would have moved them (a graphic at top_left over a box that overlaps it by 0.2)', () => {
    expect(graphicNeedsMove({boxIsFace: true, overlapWithBox: 0.2, anchor: 'top_left'})).toBe(true);
    expect(graphicNeedsMove({boxIsFace: false, overlapWithBox: 0.2, anchor: 'top_left'})).toBe(false);
    expect(emphasisNeedsMove({boxIsFace: true, overlapWithBox: 0.2})).toBe(true);
    expect(emphasisNeedsMove({boxIsFace: false, overlapWithBox: 0.2})).toBe(false);
  });
});

describe('wiring in layoutCritique.ts (source text)', () => {
  const critique = read('stages', 'layout', 'layoutCritique.ts');
  const issues = critique.slice(critique.indexOf('export function findLayoutIssues'), critique.indexOf('export function applyGeometricPatches'));
  const patches = critique.slice(critique.indexOf('export function applyGeometricPatches'), critique.indexOf('export async function critiqueAndPatchLayout'));
  it('both functions compute the flag from the occupancy and use only the predicates for the face decisions', () => {
    expect(critique.match(/const boxIsFace = boxCountsAsFace\(occupancy\);/g)).toHaveLength(2);
    expect(issues.match(/boxOverlapIsIssue\(/g)).toHaveLength(3);
    expect(patches).toContain('if (!graphicNeedsMove({boxIsFace, overlapWithBox: overlapArea(rect, occupancy.speaker), anchor: graphic.anchor})) {');
    expect(patches).toContain('if (!emphasisNeedsMove({boxIsFace, overlapWithBox: overlapArea(rect, occupancy.speaker)})) {');
  });
  it('no raw comparison of an anchor rectangle with the speaker box is left in either function', () => {
    for (const text of [issues, patches]) {
      expect(text).not.toMatch(/overlapArea\([^)]*(paddedSpeaker|occupancy\.speaker)\)\s*(>|<=)\s*0\.0/);
    }
  });
  it('the hook corner is chosen from the default box only when the box counts as a face; otherwise the plan\'s own anchor stays', () => {
    expect(patches).toContain('const hookAnchor = boxIsFace ? legalHookAnchor(occupancy) : plan.hookAnchor;');
  });
  it('what does not depend on a face is untouched: the caption-band fixes, pip slots, and provenance carry', () => {
    expect(patches).toContain('const pipSlots = legalSlots(occupancy).filter(slot => slot.kind === \'pip\');');
    expect(patches).toContain('rectsOverlap(rect, CAPTION_BAND, 0.01)');
    expect(patches).toContain('carryProvenance(graphic, {...graphic, anchor: safeGraphic})');
    expect(patches).toContain('carryProvenance(item, {...item, anchor: toVisual(safeGraphic)})');
    expect(critique).toContain('const geometric = applyGeometricPatches(input.occupancy, input.plan);');
  });
  it('the unmeasured mark reaches the critique: analyzeVideo passes the same marked occupancy, only inside the visual-edit branch', () => {
    const av = read('pipeline', 'analyzeVideo.ts');
    const call = av.indexOf('critiqueAndPatchLayout(');
    expect(call).toBeGreaterThan(av.indexOf('markUnmeasuredFace(occupancy'));
    expect(av.slice(call, call + 400)).toMatch(/occupancy[,\s]/);
    expect(av.indexOf('markUnmeasuredFace(occupancy')).toBeGreaterThan(av.indexOf('await describeUserBrollAssets('));
  });
  it('the conflict validator is not changed: a fallback face is still non-blocking there', () => {
    const conflicts = read('lib', 'editConflicts.ts');
    expect(conflicts).toContain("blocking: false, geometry: context.speaker.source === 'vision' ? 'measured' : 'fallback'");
    expect(conflicts).toContain("blocking: context.speaker.source === 'vision', geometry:");
    expect(conflicts).not.toMatch(/unmeasuredSlots|boxCountsAsFace/);
  });
  it('the defaults are unchanged', () => {
    const env = read('config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
