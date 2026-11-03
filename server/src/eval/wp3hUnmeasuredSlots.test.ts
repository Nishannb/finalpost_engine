/**
 * WP3H pure tests: an undetected speaker (occupancy source `fallback`) must not remove every legal slot on the mvp profile. The real slot candidates are read out of occupancy.ts's
 * source text (that module imports the logger and `.env`, so it is never imported); the pure decision module is imported. Import graph: stages/layout/unmeasuredSlots.ts (a type-only import of occupancy.ts) and, for the parity check only,
 * stages/broll/legibility.ts (-> contrast, provenance, types, colorRoles). No logger, `.env`, SDK, FFmpeg, Chromium or network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {HOOK} from '../stages/broll/legibility.ts';
import {
  markUnmeasuredFace,
  UNMEASURED_CAPTION_BAND,
  UNMEASURED_SAFE_FRAME,
  UNMEASURED_TOP_INSET,
  unmeasuredPolicyApplies,
  usableSlotsWithUnmeasuredFace,
} from '../stages/layout/unmeasuredSlots.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');

type Rect = {x: number; y: number; w: number; h: number};
type Slot = {id: string; rect: Rect; size: 'accent' | 'hero'; kind: string};

// ---- the real candidates, from the source of legalSlots ------------------------------------------------------------------------------------------------------------
const occupancySource = read('stages', 'layout', 'occupancy.ts');
const body = occupancySource.slice(occupancySource.indexOf('export function legalSlots'), occupancySource.indexOf('export function describeOccupancyForDirector'));
const CANDIDATES: Slot[] = [...body.matchAll(/id: '([a-z_]+)',\s*anchor: '[a-z_]+',\s*rect: \{x: ([\d.]+), y: ([\d.]+), w: ([\d.]+), h: ([\d.]+)\},\s*size: '(accent|hero)',\s*kind: '([a-z]+)'/g)].map(m => ({
  id: m[1]!, rect: {x: Number(m[2]), y: Number(m[3]), w: Number(m[4]), h: Number(m[5])}, size: m[6] as 'accent' | 'hero', kind: m[7]!,
}));

const DEFAULT_BOX: Rect = {x: 0.18, y: 0.16, w: 0.64, h: 0.62}; // the conservative default analyzeVideo/occupancy.ts use for an undetected speaker
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inflate = (r: Rect, p: number): Rect => ({x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p});
/** A replica of the legacy filter (a test below pins its two conditions to the real source text). */
const legacyFilter = (slots: Slot[], speaker: Rect) => slots.filter(slot => slot.size === 'hero' || (overlap(slot.rect, UNMEASURED_CAPTION_BAND) === 0 && overlap(slot.rect, inflate(speaker, 0.04)) < 0.025));

describe('the defect, reproduced from the real candidates', () => {
  it('the candidate list was read from the source (10 slots: 8 accent, 2 hero)', () => {
    expect(CANDIDATES.map(slot => slot.id)).toEqual(['card_tr', 'card_tl', 'emph_tr', 'emph_tl', 'pip_br', 'pip_bl', 'pip_tr', 'pip_tl', 'hero_left', 'hero_right']);
    expect(CANDIDATES.filter(slot => slot.size === 'accent')).toHaveLength(8);
  });
  it('the legacy filter, given the default box, leaves no accent slot (the Phase 34 "no legal slots")', () => {
    expect(legacyFilter(CANDIDATES, DEFAULT_BOX).filter(slot => slot.size === 'accent')).toEqual([]);
  });
  it('the legacy filter conditions are what the replica says (source text)', () => {
    expect(body).toContain('const paddedSpeaker = inflate(occupancy.speaker, 0.04);');
    expect(body).toContain('if (rectsOverlap(slot.rect, CAPTION_BAND)) {');
    expect(body).toContain('return overlapArea(slot.rect, paddedSpeaker) < 0.025;');
  });
  it('a measured face still removes the slots it sits on (legacy, unchanged): a face at the left leaves the right-hand slots', () => {
    const left: Rect = {x: 0.02, y: 0.2, w: 0.4, h: 0.5};
    const kept = legacyFilter(CANDIDATES, left).filter(slot => slot.size === 'accent').map(slot => slot.id);
    expect(kept).toEqual(expect.arrayContaining(['card_tr', 'emph_tr', 'pip_tr', 'pip_br']));
    expect(kept).not.toContain('card_tl');
  });
});

describe('usableSlotsWithUnmeasuredFace', () => {
  const kept = usableSlotsWithUnmeasuredFace(CANDIDATES);
  const accent = kept.filter(slot => slot.size === 'accent');
  it('keeps slots (it no longer wipes them all): six accent slots and both hero slots', () => {
    expect(accent.map(slot => slot.id)).toEqual(['emph_tr', 'emph_tl', 'pip_br', 'pip_bl', 'pip_tr', 'pip_tl']);
    expect(kept.filter(slot => slot.size === 'hero').map(slot => slot.id)).toEqual(['hero_left', 'hero_right']);
  });
  it('removes only what is known to be unusable: the card slots start at y 0.055, above the 0.06 top inset the mvp hook uses', () => {
    const removed = CANDIDATES.filter(slot => !kept.includes(slot)).map(slot => slot.id);
    expect(removed).toEqual(['card_tr', 'card_tl']);
    expect(UNMEASURED_TOP_INSET).toBe(HOOK.topFrac);
    expect(HOOK.topFrac).toBe(0.06);
  });
  it('every kept accent slot is outside the caption band, below the top inset and inside the safe frame', () => {
    for (const slot of accent) {
      expect(overlap(slot.rect, UNMEASURED_CAPTION_BAND), slot.id).toBe(0);
      expect(slot.rect.y, slot.id).toBeGreaterThanOrEqual(UNMEASURED_TOP_INSET);
      expect(slot.rect.x, slot.id).toBeGreaterThanOrEqual(UNMEASURED_SAFE_FRAME.x);
      expect(slot.rect.x + slot.rect.w, slot.id).toBeLessThanOrEqual(UNMEASURED_SAFE_FRAME.x + UNMEASURED_SAFE_FRAME.w + 1e-9);
      expect(slot.rect.y + slot.rect.h, slot.id).toBeLessThanOrEqual(UNMEASURED_SAFE_FRAME.y + UNMEASURED_SAFE_FRAME.h + 1e-9);
    }
  });
  it('a slot that does hit the caption band, the top inset or the safe frame is removed', () => {
    const probe = (rect: Rect): Slot => ({id: 'p', rect, size: 'accent', kind: 'card'});
    expect(usableSlotsWithUnmeasuredFace([probe({x: 0.1, y: 0.7, w: 0.2, h: 0.1})])).toEqual([]); // reaches y 0.8, into the caption band
    expect(usableSlotsWithUnmeasuredFace([probe({x: 0.1, y: 0.05, w: 0.2, h: 0.1})])).toEqual([]); // starts above the top inset
    expect(usableSlotsWithUnmeasuredFace([probe({x: 0.8, y: 0.2, w: 0.2, h: 0.1})])).toEqual([]); // leaves the right edge of the safe frame
    expect(usableSlotsWithUnmeasuredFace([probe({x: 0.1, y: 0.2, w: 0.2, h: 0.1})])).toHaveLength(1);
  });
  it('invents nothing: the decision takes no speaker box, keeps the slot objects as they are, in order', () => {
    expect(usableSlotsWithUnmeasuredFace.length).toBe(1);
    for (const slot of kept) expect(CANDIDATES).toContain(slot);
    expect(kept.map(slot => slot.id)).toEqual(CANDIDATES.filter(slot => kept.includes(slot)).map(slot => slot.id));
    expect(usableSlotsWithUnmeasuredFace([])).toEqual([]);
  });
  it('places nothing at the centre: no kept accent slot covers the middle of the frame', () => {
    const centre: Rect = {x: 0.4, y: 0.4, w: 0.2, h: 0.2};
    for (const slot of accent) expect(overlap(slot.rect, centre), slot.id).toBe(0);
  });
});

describe('when the policy applies', () => {
  it('only for the mvp profile and an undetected speaker', () => {
    expect(unmeasuredPolicyApplies('fallback', 'mvp')).toBe(true);
    expect(unmeasuredPolicyApplies('vision', 'mvp')).toBe(false);
    expect(unmeasuredPolicyApplies('fallback', 'legacy')).toBe(false);
    expect(unmeasuredPolicyApplies('fallback', undefined)).toBe(false);
    expect(unmeasuredPolicyApplies('vision', 'legacy')).toBe(false);
  });
  const occupancy = (source: 'vision' | 'fallback') => ({speaker: DEFAULT_BOX, preferredSide: 'right' as const, graphicAnchor: 'top_right' as const, overlayAnchor: 'top_right' as const, source});
  it('mvp + fallback: the occupancy is marked and the warning occupancy_unmeasured is recorded; the original is not mutated and its box is not moved', () => {
    const original = occupancy('fallback');
    const result = markUnmeasuredFace(original, 'mvp');
    expect(result.warnings).toEqual(['occupancy_unmeasured']);
    expect(result.occupancy.unmeasuredSlots).toBe(true);
    expect(result.occupancy.speaker).toEqual(DEFAULT_BOX);
    expect(result.occupancy.source).toBe('fallback');
    expect('unmeasuredSlots' in original).toBe(false);
  });
  it('a measured face (mvp or legacy) and legacy + fallback return the same object, unmarked, with no warning', () => {
    for (const [source, profile] of [['vision', 'mvp'], ['vision', 'legacy'], ['fallback', 'legacy'], ['fallback', undefined]] as const) {
      const input = occupancy(source);
      const result = markUnmeasuredFace(input, profile as 'legacy' | 'mvp' | undefined);
      expect(result.occupancy, `${source}/${profile}`).toBe(input);
      expect(result.warnings).toEqual([]);
      expect('unmeasuredSlots' in result.occupancy).toBe(false);
    }
  });
});

describe('parity with the code it mirrors (source text)', () => {
  it('the top inset is the mvp hook\'s, and the module does not import the legibility module', () => {
    expect(UNMEASURED_TOP_INSET).toBe(HOOK.topFrac);
    expect([...read('stages', 'layout', 'unmeasuredSlots.ts').matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]).sort()).toEqual(['../../lib/productEditProfile.ts', '../../lib/provenance.ts', './occupancy.ts']); // WP8A: the shared mvp-like profile helper // WP3L added the provenance helper (pure) for rebuilt elements
  });
  it('the caption band and the safe frame are the same numbers', () => {
    expect(occupancySource).toContain(`export const CAPTION_BAND: NormRect = {x: ${UNMEASURED_CAPTION_BAND.x}, y: ${UNMEASURED_CAPTION_BAND.y}, w: ${UNMEASURED_CAPTION_BAND.w}, h: ${UNMEASURED_CAPTION_BAND.h}};`);
    const f = UNMEASURED_SAFE_FRAME;
    expect(read('lib', 'editConflicts.ts')).toContain(`const SAFE_FRAME: NormRect = {x: ${f.x}, y: ${f.y}, w: ${f.w}, h: ${f.h}};`);
  });
});

describe('wiring (source text; occupancy.ts and analyzeVideo.ts import the logger)', () => {
  const av = read('pipeline', 'analyzeVideo.ts');
  it('legalSlots takes the new branch only for a marked, undetected occupancy, before the unchanged legacy filter', () => {
    const branch = occupancySource.indexOf("if (occupancy.unmeasuredSlots && occupancy.source === 'fallback') {");
    expect(branch).toBeGreaterThan(occupancySource.indexOf('export function legalSlots'));
    expect(branch).toBeLessThan(occupancySource.indexOf('return candidates.filter(slot => {'));
    expect(occupancySource).toContain('return usableSlotsWithUnmeasuredFace(candidates);');
    expect(occupancySource).toContain('unmeasuredSlots?: true;');
  });
  it('the Director is told the speaker is UNKNOWN and given no box when the policy is on; the legacy prompt lines are untouched', () => {
    expect(occupancySource).toContain("const unmeasured = Boolean(occupancy.unmeasuredSlots) && occupancy.source === 'fallback'; // WP3H (mvp only)");
    expect(occupancySource).toContain("'speaker position UNKNOWN: detection failed. No speaker box is given and none should be assumed.'");
    expect(occupancySource).toContain("'FRAME_OCCUPANCY (9:16 fractions). Never cover the speaker box with graphics, cards, titles, or emphasis.'");
    expect(occupancySource).toContain('`speaker_box: x=${fmt(speaker.x)} y=${fmt(speaker.y)} w=${fmt(speaker.w)} h=${fmt(speaker.h)} source=${occupancy.source}`');
  });
  it('analyzeVideo marks the measured occupancy once, with the profile, inside the visual-edit branch (not caption-only), and records the warning', () => {
    expect(av.match(/markUnmeasuredFace\(/g)).toHaveLength(1);
    expect(av).toContain('const unmeasured = markUnmeasuredFace(occupancy, input.editProfile);');
    expect(av).toContain('warnings.push(...unmeasured.warnings);');
    expect(av.indexOf('markUnmeasuredFace(occupancy')).toBeGreaterThan(av.indexOf('await describeUserBrollAssets('));
    expect(av.indexOf('markUnmeasuredFace(occupancy')).toBeGreaterThan(av.indexOf('occupancy = await measureOccupancy({'));
    expect(av.indexOf('markUnmeasuredFace(occupancy')).toBeLessThan(av.indexOf('broll = await planBRoll({'));
  });
  it('the hook and caption placement of WP2B are not touched: the hook constants and the legibility call are as before', () => {
    expect(HOOK.defaultClearBottomFrac).toBe(0.22);
    expect(HOOK.topFrac).toBe(0.06);
    expect(av).toContain('speakerSource: occupancy.source,');
    expect(av).toContain('speakerTopFrac: occupancy.speaker.y,');
  });
  it('the defaults are unchanged', () => {
    const env = read('config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
