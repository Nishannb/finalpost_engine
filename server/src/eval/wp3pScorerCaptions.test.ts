/**
 * WP3P pure tests: row 3 (captions) of the offline scorer, from the blueprint only. Inline fixtures; the WP3A legacy fixture is read with readFileSync. Import graph: rubricScorer.ts
 * (-> lib/renderIntegrity.ts -> lib/errors.ts -> lib/billingGuard.ts) and, to build a realistic blueprint, stages/broll/legibility.ts (-> contrast, provenance, types, colorRoles).
 * No logger, `.env`, SDK, FFmpeg, Chromium or network; no pixel is sampled and nothing is probed.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {applyLegibility} from '../stages/broll/legibility.ts';
import type {CaptionDirection} from '../types/blueprint.ts';
import {ONE_WORD_TEMPLATES, scoreRubric} from './rubricScorer.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(resolve(...parts), 'utf8');

type Json = Record<string, unknown>;
const captions = (over: Json = {}) => ({avoidSplitFace: true, splitBoxColor: 'rgba(11,11,15,0.82)', splitTextColor: '#FFFFFF', splitHighlightColor: '#FFD700', splitPlateColor: '#0B0B0F', ...over});
// pass legibility = null for a blueprint without the field (undefined would select the default)
const bp = (direction: Json = {}, legibility: unknown = {version: 1, captions: captions()}, over: Json = {}): Json => ({
  width: 1080, height: 1920, outputDurationSec: 30, hookTitle: 'x', visualOverlays: [], brollClips: [],
  captionDirection: {position: 'bottom', bottomFrac: 0.18, template: 'classic', fontScale: 1.2, ...direction}, ...(legibility === null ? {} : {legibility}), ...over,
});
const row3 = (blueprint: Json) => scoreRubric({blueprint}).rows.find(item => item.row === 3)!;
const check = (r: ReturnType<typeof row3>, id: string) => r.checks.find(item => item.id === id)!;
const split = {start: 5, end: 9, layout: 'split', assetUrl: 'https://cdn.example/a.mp4', speakerSide: 'bottom'};

describe('no legibility.captions: not checked, never failed', () => {
  it('a blueprint without the field (legacy) gives not_checked, whatever its captions look like', () => {
    for (const direction of [{}, {template: 'simple-one-word', fontScale: 0.5, position: 'top'}]) {
      const r = row3(bp(direction, null));
      expect(r).toMatchObject({status: 'not_checked', complete: false});
      expect(r.checks.map(c => c.id)).toEqual(['caption_legibility_fields']);
    }
  });
  it('a legibility object that has only the hook is the same: not_checked', () => {
    expect(row3(bp({template: 'simple-one-word'}, {version: 1, hook: {widthFrac: 0.88}})).status).toBe('not_checked');
    expect(row3(bp({}, 'not an object')).status).toBe('not_checked');
  });
  it('the stored Phase 34 legacy example (no legibility) is not_checked for row 3', () => {
    const legacy = JSON.parse(read(HERE, 'fixtures', 'wp3a-phase34-blueprint.trimmed.json')) as Json;
    expect('legibility' in legacy).toBe(false);
    expect(row3(legacy).status).toBe('not_checked');
  });
});

describe('with legibility.captions the four launch checks apply', () => {
  it('a legible caption passes the four checks; the row passes but is incomplete (three items cannot be checked)', () => {
    const r = row3(bp());
    expect(r.status).toBe('pass');
    expect(r.complete).toBe(false);
    for (const id of ['caption_template_not_one_word', 'font_scale_at_least_1', 'position_not_top_or_center', 'split_captions_avoid_face']) expect(check(r, id).status, id).toBe('pass');
  });

  it('every one-word template fails the row; other templates (package themes included) pass', () => {
    for (const template of ['simple-one-word', 'simple-one-word-theme', 'kinetic-slam']) {
      const r = row3(bp({template}));
      expect(r.status, template).toBe('fail');
      expect(check(r, 'caption_template_not_one_word').status).toBe('fail');
    }
    for (const template of ['classic', 'karaoke', 'hormozi', 'kinetic-01', 'karaoke-theme', 'grape-theme']) expect(check(row3(bp({template})), 'caption_template_not_one_word').status, template).toBe('pass');
    expect(check(row3(bp({template: undefined})), 'caption_template_not_one_word').status).toBe('not_checked');
  });

  it('fontScale below 1 fails; 1 and above pass; absent means the template\'s own size and passes; a non-number is not_checked', () => {
    for (const fontScale of [0.99, 0.7, 0, -1]) expect(check(row3(bp({fontScale})), 'font_scale_at_least_1').status, String(fontScale)).toBe('fail');
    for (const fontScale of [1, 1.2, 1.4, 2]) expect(check(row3(bp({fontScale})), 'font_scale_at_least_1').status, String(fontScale)).toBe('pass');
    const absent = check(row3(bp({fontScale: undefined})), 'font_scale_at_least_1');
    expect(absent.status).toBe('pass');
    expect(absent.evidence).toEqual([{path: 'captionDirection.fontScale', value: null}]);
    expect(check(row3(bp({fontScale: 'big'})), 'font_scale_at_least_1').status).toBe('not_checked');
    expect(row3(bp({fontScale: 'big'})).status).toBe('pass'); // not failed for a field it cannot read
  });

  it('top and center positions fail; bottom and lower_third pass; absent is not_checked', () => {
    for (const position of ['top', 'center']) {
      const r = row3(bp({position}));
      expect(r.status, position).toBe('fail');
      expect(check(r, 'position_not_top_or_center').evidence).toEqual([{path: 'captionDirection.position', value: position}]);
    }
    for (const position of ['bottom', 'lower_third']) expect(check(row3(bp({position})), 'position_not_top_or_center').status, position).toBe('pass');
    expect(check(row3(bp({position: undefined})), 'position_not_top_or_center').status).toBe('not_checked');
  });

  it('a B-roll split with avoidSplitFace not true fails; with it true passes; no split passes without a claim about splits', () => {
    const withSplit = (avoidSplitFace: unknown) => bp({}, {version: 1, captions: captions({avoidSplitFace})}, {visualOverlays: [split]});
    expect(check(row3(withSplit(true)), 'split_captions_avoid_face').status).toBe('pass');
    for (const value of [false, undefined, 'true', 1, null]) {
      const r = row3(withSplit(value));
      expect(r.status, String(value)).toBe('fail');
      expect(check(r, 'split_captions_avoid_face').status).toBe('fail');
    }
    expect(check(row3(bp({}, {version: 1, captions: captions({avoidSplitFace: false})})), 'split_captions_avoid_face').status).toBe('pass'); // no split present
    expect(check(row3(bp()), 'split_captions_avoid_face').detail).toContain('nothing to keep captions off');
  });

  it('only a B-roll split counts: other overlay layouts do not', () => {
    const r = row3(bp({}, {version: 1, captions: captions({avoidSplitFace: false})}, {visualOverlays: [{start: 1, end: 3, layout: 'cutaway'}, {start: 4, end: 6, layout: 'card'}]}));
    expect(check(r, 'split_captions_avoid_face').status).toBe('pass');
  });

  it('several failures are all reported', () => {
    const r = row3(bp({template: 'simple-one-word', fontScale: 0.8, position: 'center'}, {version: 1, captions: captions({avoidSplitFace: false})}, {visualOverlays: [split]}));
    expect(r.checks.filter(c => c.status === 'fail').map(c => c.id).sort()).toEqual(['caption_template_not_one_word', 'font_scale_at_least_1', 'position_not_top_or_center', 'split_captions_avoid_face']);
  });
});

describe('the three items that need pixels or timings are never passed', () => {
  const ids = ['contrast_vs_footage', 'glyph_height_px', 'word_timing_error'];
  it('they are not_checked, name why, and say the basis was the blueprint only, however good the captions are', () => {
    for (const blueprint of [bp(), bp({template: 'simple-one-word', fontScale: 0.5, position: 'top'})]) {
      const r = row3(blueprint);
      for (const id of ids) {
        const c = check(r, id);
        expect(c.status, id).toBe('not_checked');
        expect(c.evidence).toEqual([{path: 'basis', value: 'blueprint only'}]);
        expect(c.detail).toMatch(/pixels|rendered|footage|measured|computed/);
      }
      expect(r.complete).toBe(false);
    }
  });
  it('a row that passes all four fields still reports status pass only for what it checked: those ids are never in a pass check', () => {
    const r = row3(bp());
    expect(r.checks.filter(c => c.status === 'pass').map(c => c.id)).not.toEqual(expect.arrayContaining(ids));
    expect(r.checks.filter(c => ids.includes(c.id) && c.status === 'pass')).toEqual([]);
  });
});

describe('what the legibility writer produces passes the checker', () => {
  const direct: CaptionDirection = {position: 'center', bottomFrac: 0.05, textColor: '#FFFFFF', highlightColor: '#B45309', boxColor: null, template: 'simple-one-word', fontScale: 0.8};
  it('the raw Director caption would fail three checks; after applyLegibility the same blueprint shape passes them', () => {
    const written = applyLegibility({hookTitle: 'STOP', canvasWidth: 1080, canvasHeight: 1920, caption: direct, motionGraphics: [], semanticEmphasis: [], transcript: 'stop'});
    const base = {width: 1080, height: 1920, outputDurationSec: 30, hookTitle: 'STOP', visualOverlays: [split]};
    const before = row3({...base, captionDirection: direct, legibility: written.legibility});
    expect(before.checks.filter(c => c.status === 'fail').map(c => c.id).sort()).toEqual(['caption_template_not_one_word', 'font_scale_at_least_1', 'position_not_top_or_center']);
    const after = row3({...base, captionDirection: written.caption, legibility: written.legibility});
    expect(after.status).toBe('pass');
    expect(after.checks.filter(c => c.status === 'fail')).toEqual([]);
    expect(check(after, 'split_captions_avoid_face').status).toBe('pass');
  });
});

describe('scope (source text)', () => {
  const scorer = read(HERE, 'rubricScorer.ts');
  it('the one-word set is the writer\'s set', () => {
    const legibility = read(HERE, '..', 'stages', 'broll', 'legibility.ts');
    const literal = /ONE_WORD_CAPTION_TEMPLATES: ReadonlySet<string> = new Set\(\[([^\]]+)\]\)/.exec(legibility)![1]!;
    const writerSet = new Set([...literal.matchAll(/'([^']+)'/g)].map(match => match[1]));
    expect(new Set(ONE_WORD_TEMPLATES)).toEqual(writerSet);
  });
  it('the scorer still imports only what it did, reads no pixel and runs no probe, and neither the renderer nor the writer mentions it', () => {
    expect([...scorer.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]).sort()).toEqual(['../lib/renderIntegrity.ts', '../pipeline/experimentVerdict.ts', '../stages/broll/groundedText.ts']);
    const code = scorer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/ffprobe|ffmpeg|child_process|spawn|sharp|getImageData|readFile/i);
    for (const path of [['..', 'stages', 'broll', 'legibility.ts'], ['..', '..', '..', 'remotion', 'src', 'ShortVideo.tsx'], ['..', '..', '..', 'remotion', 'src', 'lib', 'captionSplit.ts']]) {
      expect(read(HERE, ...path), path.join('/')).not.toMatch(/rubricScorer|scoreRubric/);
    }
  });
  it('the report lists row 3 as scored and no longer as not scored', () => {
    const r = scoreRubric({blueprint: bp()});
    expect(r.rows.map(item => item.row)).toEqual([1, 2, 3, 4, 5, 6, 9]); // row 6 was added in WP3Q
    expect(r.notScored).toEqual([7, 8, 10]);
  });
  it('the defaults are unchanged', () => {
    const env = read(HERE, '..', 'config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
