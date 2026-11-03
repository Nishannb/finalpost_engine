/**
 * WP4P pure tests: row 6 of the offline scorer also reads a media container's canvasTitle and an inset reveal's graphic text / data.label (motion_graphic variant only), with the shared
 * matcher. The scorer imports renderIntegrity (-> errors -> billingGuard) and groundedText; the writer functions come from the pure stages/broll/legibility.ts. No logger, `.env`, SDK, FFmpeg,
 * Chromium, network or model call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {groundCanvasTitles, groundInsetText} from '../stages/broll/legibility.ts';
import {scoreRubric} from './rubricScorer.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');

type Json = Record<string, unknown>;
const TRANSCRIPT = 'Today I use Premiere Pro and After Effects to cut my videos, it saves time.';
const container = (canvasTitle: unknown) => ({start: 2, end: 6, mode: 'card', canvasColor: '#102030', canvasTitle, canvasTitleColor: '#ffffff', scale: 0.62, cornerRadius: 24, transitionSec: 0.4});
const reveal = (graphic: Json | undefined, variant = 'motion_graphic') => ({type: 'inset_reveal', start: 3, end: 7, params: {insetScale: 0.6, variant, ...(graphic ? {graphic: {templateId: 'stat_callout', enterOffset: 0.2, exitOffset: 0.2, ...graphic}} : {})}});
const bp = (over: Json = {}): Json => ({width: 1080, height: 1920, outputDurationSec: 30, hookTitle: 'Totally invented hook', motionGraphics: [], semanticEmphasis: [], generatedGraphics: [], visualOverlays: [], behindSubjectTexts: [], brollClips: [], mediaContainers: [], insetReveals: [], ...over});
const row6 = (blueprint: Json, transcript: string | null = TRANSCRIPT) => scoreRubric({blueprint, ...(transcript === null ? {} : {transcript})}).rows.find(item => item.row === 6)!;
const check = (r: ReturnType<typeof row6>, id: string) => r.checks.find(item => item.id === id)!;

describe('canvas title', () => {
  it('an unspoken title fails, with the path, the text and the missing words', () => {
    const r = row6(bp({mediaContainers: [container('Recommended Software')]}));
    const c = check(r, 'canvas_title_in_transcript');
    expect(c.status).toBe('fail');
    expect(c.evidence).toEqual([
      {path: 'mediaContainers[0].canvasTitle', value: 'Recommended Software'},
      {path: 'mediaContainers[0].wordsNotInTranscript', value: ['recommended', 'software']},
    ]);
    expect(r.status).toBe('fail');
  });
  it('a spoken title passes; an empty, blank, missing or non-string title passes (nothing is claimed)', () => {
    for (const title of ['Premiere Pro', 'save time', 'After Effects!', '', '   ', undefined, 42, null]) {
      const c = check(row6(bp({mediaContainers: [container(title)]})), 'canvas_title_in_transcript');
      expect(c.status, String(title)).toBe('pass');
    }
  });
  it('no containers passes', () => {
    expect(check(row6(bp()), 'canvas_title_in_transcript').status).toBe('pass');
    expect(check(row6(bp({mediaContainers: undefined})), 'canvas_title_in_transcript').status).toBe('pass');
  });
});

describe('inset graphic text', () => {
  it('an unspoken text fails (motion_graphic variant)', () => {
    const c = check(row6(bp({insetReveals: [reveal({templateId: 'keyword_title', text: 'Master your feelings'})]})), 'inset_text_in_transcript');
    expect(c.status).toBe('fail');
    expect(c.evidence![0]).toEqual({path: 'insetReveals[0].params.graphic.text', value: 'Master your feelings'});
    expect(c.evidence![1]).toMatchObject({path: 'insetReveals[0].params.graphic.textWordsNotInTranscript'});
  });
  it('an unspoken data.label fails, and a numeric label is read as text', () => {
    const c = check(row6(bp({insetReveals: [reveal({text: 'time', data: {label: 'Recommended'}})]})), 'inset_text_in_transcript');
    expect(c.status).toBe('fail');
    expect(c.evidence![0]).toEqual({path: 'insetReveals[0].params.graphic.data.label', value: 'Recommended'});
    expect(check(row6(bp({insetReveals: [reveal({text: '', data: {label: 5}})]})), 'inset_text_in_transcript').status).toBe('fail');
  });
  it('spoken text and label pass; empty fields pass; a graphic with no text or data passes', () => {
    for (const graphic of [{text: 'Premiere Pro', data: {label: 'time'}}, {text: ''}, {text: '', data: {label: ''}}, {data: {value: 3}}, {text: '   '}, {}]) {
      expect(check(row6(bp({insetReveals: [reveal(graphic)]})), 'inset_text_in_transcript').status, JSON.stringify(graphic)).toBe('pass');
    }
  });
  it('a reveal with no graphic passes', () => {
    expect(check(row6(bp({insetReveals: [reveal(undefined)]})), 'inset_text_in_transcript').status).toBe('pass');
  });
  it('any other variant is not scored, even with an unspoken graphic text', () => {
    for (const variant of ['plain', 'video_inset', '', 'MOTION_GRAPHIC']) {
      expect(check(row6(bp({insetReveals: [reveal({text: 'Zebra', data: {label: 'Giraffe'}}, variant)]})), 'inset_text_in_transcript').status, variant).toBe('pass');
    }
  });
});

describe('what stays as it was', () => {
  it('the hook is not scored: an invented hook title and opening text still leave row 6 passing', () => {
    expect(row6(bp({hookTitle: 'Recommended Software', openingTreatment: {text: 'Totally invented opening', kind: 'plain'}})).status).toBe('pass');
  });
  it('no transcript (absent, null or blank) leaves row 6 not_checked, a single check, even with unspoken canvas and inset text', () => {
    const blueprint = bp({mediaContainers: [container('Zebra')], insetReveals: [reveal({text: 'Giraffe'})]});
    for (const transcript of [null, '', '   ']) {
      const r = row6(blueprint, transcript);
      expect(r.status).toBe('not_checked');
      expect(r.checks).toHaveLength(1);
      expect(r.checks[0]!.id).toBe('graphic_text_in_transcript');
    }
  });
  it('the blueprint\'s own transcript field is not read', () => {
    const r = row6(bp({transcript: 'zebra giraffe recommended', mediaContainers: [container('Zebra')]}));
    expect(check(r, 'canvas_title_in_transcript').status).toBe('fail');
    expect(read('eval', 'rubricScorer.ts')).not.toMatch(/get\(bp, 'transcript'\)|blueprint\.transcript|\.transcript\b[^;]*blueprint/);
  });
  it('the other row 6 checks and the three undecidable items are as before', () => {
    const ids = row6(bp()).checks.map(item => item.id);
    expect(ids).toEqual(['motion_graphic_text_in_transcript', 'emphasis_text_in_transcript', 'generated_graphic_text_in_transcript', 'overlay_text_in_transcript', 'behind_subject_text_in_transcript', 'canvas_title_in_transcript', 'inset_text_in_transcript', 'pixel_quality', 'layout_repetition', 'paraphrase_fairness']);
    for (const id of ['pixel_quality', 'layout_repetition', 'paraphrase_fairness']) expect(check(row6(bp()), id).status).toBe('not_checked');
  });
  it('the other rows are untouched: the row list and notScored are as they were', () => {
    const report = scoreRubric({blueprint: bp(), transcript: TRANSCRIPT});
    expect(report.rows.map(item => item.row)).toEqual([1, 2, 3, 4, 5, 6, 9]);
    expect(report.notScored).toEqual([7, 8, 10]);
  });
  it('every failing check is reported independently', () => {
    const r = row6(bp({mediaContainers: [container('Zebra')], insetReveals: [reveal({text: 'Giraffe'})], motionGraphics: [{text: 'Platypus'}]}));
    expect(r.checks.filter(item => item.status === 'fail').map(item => item.id)).toEqual(['motion_graphic_text_in_transcript', 'canvas_title_in_transcript', 'inset_text_in_transcript']);
  });
});

describe('the writer and the scorer agree', () => {
  it('an unspoken canvas title and inset text fail the scorer; after groundCanvasTitles and groundInsetText the same checks pass', () => {
    const blueprint = bp({
      mediaContainers: [container('Recommended Software'), container('Premiere Pro')],
      insetReveals: [reveal({text: 'Master your feelings', data: {label: 'Recommended'}}), reveal({text: 'time', data: {label: 'After Effects'}})],
    });
    const before = row6(blueprint);
    expect(check(before, 'canvas_title_in_transcript').status).toBe('fail');
    expect(check(before, 'inset_text_in_transcript').status).toBe('fail');

    const canvasTitles = groundCanvasTitles(blueprint.mediaContainers as Array<{canvasTitle?: string}>, TRANSCRIPT);
    const insetText = groundInsetText(blueprint.insetReveals as Array<{params?: {variant?: string; graphic?: {text?: string; data?: Record<string, string | number>}}}>, TRANSCRIPT);
    const after = row6({...blueprint, mediaContainers: canvasTitles.containers, insetReveals: insetText.insetReveals});
    expect(check(after, 'canvas_title_in_transcript').status).toBe('pass');
    expect(check(after, 'inset_text_in_transcript').status).toBe('pass');
    expect(after.status).toBe('pass');
  });
  it('the writer keeps what was spoken, so the scorer has something to pass on', () => {
    const containers = groundCanvasTitles([container('Premiere Pro')] as Array<{canvasTitle?: string}>, TRANSCRIPT).containers;
    expect(containers[0]!.canvasTitle).toBe('Premiere Pro');
  });
});

describe('the scorer source (text)', () => {
  const scorer = read('eval', 'rubricScorer.ts');
  it('uses the shared matcher through the existing grounding helper, with no matching code of its own', () => {
    expect(scorer).toContain("grounding('canvas_title_in_transcript', 'canvas title', 'mediaContainers', canvas);");
    expect(scorer).toContain("grounding('inset_text_in_transcript', 'inset graphic', 'insetReveals[motion_graphic]', inset);");
    expect(scorer).toContain("if (get(reveal, 'params.variant') !== 'motion_graphic') return;");
    const block = scorer.slice(scorer.indexOf('// WP4P:'), scorer.indexOf("// Not decidable from text"));
    expect(block).not.toMatch(/toLowerCase|normalize\(|\.split\(|new Set\(|\\p\{L\}/);
  });
  it('the scorer does not import the writer', () => {
    expect([...scorer.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]).sort()).not.toContain('../stages/broll/legibility.ts');
  });
  it('the defaults are untouched', () => {
    const env = read('config', 'env.ts');
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
