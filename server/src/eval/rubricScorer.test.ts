/**
 * WP3A pure tests of the offline rubric scorer. Import graph: rubricScorer.ts -> lib/renderIntegrity.ts -> lib/errors.ts -> lib/billingGuard.ts (node:async_hooks only); the
 * experimentVerdict import in the scorer is type-only and erased. Fixtures are inline or the two trimmed copies under eval/fixtures (read with readFileSync). The CLI and the
 * wired source files are read as text. No logger, `.env`, SDK, FFmpeg, Chromium or network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {captionBand, readPlannerGap, SAFE_FRAME, scoreRubric, type ScoreInput} from './rubricScorer.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const read = (...parts: string[]) => readFileSync(resolve(...parts), 'utf8');

type Json = Record<string, unknown>;
const bp = (over: Json = {}): Json => ({
  width: 1080, height: 1920, outputDurationSec: 30, hookTitle: 'Never do these three things', captionDirection: {position: 'bottom', bottomFrac: 0.18},
  brollClips: [], visualOverlays: [], depthOverlays: [], insetReveals: [], transitions: [], stats: {warnings: []}, ...over,
});
const fit = (over: Json = {}) => ({version: 1, hook: {sizeFrac: 0.075, widthFrac: 0.88, topFrac: 0.06, heightFrac: 0.12, lines: 2, clearBand: true, shortened: false, ...over}, captions: {avoidSplitFace: true}});
const clip = (start: number, end: number, providerId = 1, over: Json = {}) => ({start, end, provider: 'user', providerId, assetUrl: `https://cdn.example/u${providerId}.mp4`, ...over});
const row = (report: ReturnType<typeof scoreRubric>, n: number) => report.rows.find(item => item.row === n)!;
const checkOf = (report: ReturnType<typeof scoreRubric>, n: number, id: string) => row(report, n).checks.find(item => item.id === id)!;
const score = (blueprint: Json, extra: Partial<ScoreInput> = {}) => scoreRubric({blueprint, ...extra});

describe('row 1: hook', () => {
  it('a non-empty title passes; the box is not checked on a legacy blueprint, and the row says it is incomplete', () => {
    const r = score(bp());
    expect(checkOf(r, 1, 'hook_title_present').status).toBe('pass');
    expect(checkOf(r, 1, 'hook_box_in_frame').status).toBe('not_checked');
    expect(checkOf(r, 1, 'hook_clear_band').status).toBe('not_checked');
    expect(row(r, 1)).toMatchObject({status: 'pass', complete: false});
  });
  it('an empty title fails unless the optional-hook policy is recorded on the blueprint', () => {
    expect(checkOf(score(bp({hookTitle: ''})), 1, 'hook_title_present').status).toBe('fail');
    expect(checkOf(score(bp({hookTitle: '   '})), 1, 'hook_title_present').status).toBe('fail');
    expect(checkOf(score(bp({hookTitle: ''})), 1, 'hook_title_present').evidence.length).toBeGreaterThan(0);
    for (const over of [{hookTitlePolicy: 'optional'}, {hookPolicy: 'optional'}, {stats: {hookTitlePolicy: 'optional'}}, {stats: {warnings: ['hook_title_policy:optional']}}]) {
      const c = checkOf(score(bp({hookTitle: '', ...over})), 1, 'hook_title_present');
      expect(c.status, JSON.stringify(over)).toBe('pass');
    }
    expect(checkOf(score(bp({hookTitle: '', hookTitlePolicy: 'placeholder'})), 1, 'hook_title_present').status).toBe('fail');
  });
  it('a fitted box inside the frame with a clear band passes', () => {
    const r = score(bp({legibility: fit()}), {ledger: {edits: [{type: 'hook_title', final: {start: 0, end: 3}}]}});
    expect(checkOf(r, 1, 'hook_box_in_frame').status).toBe('pass');
    expect(checkOf(r, 1, 'hook_clear_band').status).toBe('pass');
    expect(row(r, 1)).toMatchObject({status: 'pass', complete: true});
  });
  it('clearBand false fails; a box that leaves the frame fails; an unrecorded clearBand is not checked', () => {
    expect(checkOf(score(bp({legibility: fit({clearBand: false})})), 1, 'hook_clear_band').status).toBe('fail');
    expect(row(score(bp({legibility: fit({clearBand: false})})), 1).status).toBe('fail');
    expect(checkOf(score(bp({legibility: fit({topFrac: 0.95, heightFrac: 0.2})})), 1, 'hook_box_in_frame').status).toBe('fail');
    expect(checkOf(score(bp({legibility: fit({widthFrac: 1.2})})), 1, 'hook_box_in_frame').status).toBe('fail');
    expect(checkOf(score(bp({legibility: fit({clearBand: undefined})})), 1, 'hook_clear_band').status).toBe('not_checked');
  });
  it('a hook field with missing numbers counts as absent (not a crash, not a pass)', () => {
    expect(checkOf(score(bp({legibility: {version: 1, hook: {widthFrac: 0.88}}})), 1, 'hook_box_in_frame').status).toBe('not_checked');
  });
  it('uses the ledger when present: a dropped hook entry fails, a surviving one passes, none is not checked', () => {
    const ledger = (final: unknown) => ({edits: [{type: 'hook_title', final}]});
    expect(checkOf(score(bp(), {ledger: ledger({start: 0, end: 3})}), 1, 'ledger_hook_title_survived').status).toBe('pass');
    expect(checkOf(score(bp(), {ledger: ledger(null)}), 1, 'ledger_hook_title_survived').status).toBe('fail');
    expect(checkOf(score(bp(), {ledger: {edits: []}}), 1, 'ledger_hook_title_survived').status).toBe('not_checked');
    expect(checkOf(score(bp()), 1, 'ledger_hook_title_survived').status).toBe('not_checked');
  });
  it('a rejected opening is reported as evidence but does not change the row', () => {
    const r = score(bp({stats: {warnings: ['opening_rejected:too_wide']}}));
    expect(row(r, 1).status).toBe('pass');
    expect(JSON.stringify(checkOf(r, 1, 'hook_title_present').evidence)).toContain('opening_rejected:too_wide');
  });
});

describe('row 2: pacing', () => {
  it('is not checked when no gap is recorded anywhere and the caller gave none', () => {
    const r = score(bp({brollClips: [clip(1, 2), clip(2.5, 4)]}));
    expect(row(r, 2)).toMatchObject({status: 'not_checked', complete: false});
  });
  it('reads the gap from the blueprint edit outcomes, the ledger, or a top-level field; the smallest recorded value wins', () => {
    const outcomes = {stats: {editOutcomes: {cutaways: [{adjustments: [{code: 'delayed_for_spacing', gapSec: 4.5}]}, {adjustments: [{gapSec: 3.2}]}]}}};
    expect(readPlannerGap(bp(outcomes), undefined)?.value).toBe(3.2);
    expect(readPlannerGap(bp(), {edits: [{events: [{gapSec: 2}]}]})?.value).toBe(2);
    expect(readPlannerGap(bp({plannerMinGapSec: 1.5}), undefined)?.value).toBe(1.5);
    expect(readPlannerGap(bp(), {stageContext: {}, edits: []})).toBeUndefined();
    expect(readPlannerGap(bp({plannerMinGapSec: 0}), undefined)).toBeUndefined();
  });
  it('fails two media placements closer than the recorded gap, with the pair as evidence; passes when spaced', () => {
    const near = score(bp({plannerMinGapSec: 4.5, brollClips: [clip(1, 4), clip(5, 7)]}));
    expect(checkOf(near, 2, 'min_gap_between_media_edits').status).toBe('fail');
    expect(JSON.stringify(checkOf(near, 2, 'min_gap_between_media_edits').evidence)).toContain('brollClips[1]');
    expect(checkOf(score(bp({plannerMinGapSec: 4.5, brollClips: [clip(1, 4), clip(9, 11)]})), 2, 'min_gap_between_media_edits').status).toBe('pass');
  });
  it('counts overlays that carry media, not text overlays, and treats an overlap as a violation', () => {
    const overlay = (start: number, end: number, assetUrl: string) => ({start, end, layout: 'lockup', assetUrl});
    expect(checkOf(score(bp({plannerMinGapSec: 4.5, brollClips: [clip(1, 4)], visualOverlays: [overlay(4.5, 6, '')]})), 2, 'min_gap_between_media_edits').status).toBe('pass');
    expect(checkOf(score(bp({plannerMinGapSec: 4.5, brollClips: [clip(1, 4)], visualOverlays: [overlay(4.5, 6, 'https://cdn.example/a.png')]})), 2, 'min_gap_between_media_edits').status).toBe('fail');
    expect(checkOf(score(bp({plannerMinGapSec: 1, brollClips: [clip(1, 5), clip(3, 6)]})), 2, 'min_gap_between_media_edits').status).toBe('fail');
  });
  it('uses the caller gap only when nothing is recorded, and says which source it used', () => {
    const viaCaller = checkOf(score(bp({brollClips: [clip(1, 2), clip(2.5, 4)]}), {callerMinGapSec: 1.5}), 2, 'min_gap_between_media_edits');
    expect(viaCaller.status).toBe('fail');
    expect(JSON.stringify(viaCaller.evidence)).toContain('"gapSource","value":"caller"'.replace('"gapSource","value"', '"path":"gapSource","value"'));
    const recordedWins = checkOf(score(bp({plannerMinGapSec: 0.5, brollClips: [clip(1, 2), clip(2.6, 4)]}), {callerMinGapSec: 9}), 2, 'min_gap_between_media_edits');
    expect(recordedWins.status).toBe('pass');
  });
});

describe('row 4: B-roll ids and stock', () => {
  const ids = ['ub_1', 'ub_2'];
  it('without a supplied-id list the row is not checked (stock is observed as information only)', () => {
    const r = score(bp({brollClips: [clip(1, 3, 1, {provider: 'pexels'})]}));
    expect(row(r, 4)).toMatchObject({status: 'not_checked', complete: false});
    expect(JSON.stringify(row(r, 4).checks[0]!.evidence)).toContain('observedStockPlacements(info)');
  });
  it('passes creator placements whose ub_<providerId> is supplied, including slides', () => {
    const r = score(bp({brollClips: [clip(1, 3, 1)], visualOverlays: [{start: 8, end: 12, layout: 'cutaway', treatment: 'slideshow', ...clip(8, 12, 2), slides: [clip(8, 10, 1), clip(10, 12, 2)]}]}), {suppliedIds: ids});
    expect(row(r, 4).status).toBe('pass');
    expect(checkOf(r, 4, 'placed_ids_in_supplied').status).toBe('pass');
  });
  it('fails a stock provider, a stock host under a creator provider, and a stock slide', () => {
    expect(checkOf(score(bp({brollClips: [clip(1, 3, 1, {provider: 'pexels'})]}), {suppliedIds: ids}), 4, 'no_stock_url').status).toBe('fail');
    expect(checkOf(score(bp({brollClips: [clip(1, 3, 1, {provider: 'pixabay'})]}), {suppliedIds: ids}), 4, 'no_stock_url').status).toBe('fail');
    expect(checkOf(score(bp({brollClips: [clip(1, 3, 1, {assetUrl: 'https://videos.pexels.com/x.mp4'})]}), {suppliedIds: ids}), 4, 'no_stock_url').status).toBe('fail');
    const slide = score(bp({visualOverlays: [{start: 1, end: 5, ...clip(1, 5, 1), slides: [clip(1, 3, 1), clip(3, 5, 2, {provider: 'pixabay'})]}]}), {suppliedIds: ids});
    expect(checkOf(slide, 4, 'no_stock_url').status).toBe('fail');
    expect(JSON.stringify(checkOf(slide, 4, 'no_stock_url').evidence)).toContain('slides[1]');
  });
  it('fails an invented or unsupplied id and a non-numeric providerId', () => {
    expect(checkOf(score(bp({brollClips: [clip(1, 3, 9)]}), {suppliedIds: ids}), 4, 'placed_ids_in_supplied').status).toBe('fail');
    expect(checkOf(score(bp({brollClips: [clip(1, 3, 1, {providerId: 'x'})]}), {suppliedIds: ids}), 4, 'placed_ids_in_supplied').status).toBe('fail');
    expect(checkOf(score(bp({brollClips: [clip(1, 3, 1, {providerId: undefined})]}), {suppliedIds: ids}), 4, 'placed_ids_in_supplied').status).toBe('fail');
  });
  it('ignores engine-made overlays without media and fails an unrecognised provider that carries a URL', () => {
    expect(row(score(bp({visualOverlays: [{start: 1, end: 3, layout: 'lockup', assetUrl: '', provider: 'generated', providerId: 0}]}), {suppliedIds: ids}), 4).status).toBe('pass');
    expect(checkOf(score(bp({brollClips: [clip(1, 3, 1, {provider: 'somewhere'})]}), {suppliedIds: ids}), 4, 'no_unrecognised_provider').status).toBe('fail');
  });
  it('checks transitions and depth overlays too', () => {
    expect(checkOf(score(bp({transitions: [{at: 3, duration: 0.5, assetUrl: 'https://cdn.pixabay.com/t.mp4', provider: 'pixabay', providerId: 5}]}), {suppliedIds: ids}), 4, 'no_stock_url').status).toBe('fail');
    expect(checkOf(score(bp({depthOverlays: [{start: 1, end: 3, provider: 'user', providerId: 7, assetUrl: 'https://cdn.example/u7.png'}]}), {suppliedIds: ids}), 4, 'placed_ids_in_supplied').status).toBe('fail');
  });
  it('checks URLs against a supplied-URL list when given, and says it did not when absent', () => {
    expect(checkOf(score(bp({brollClips: [clip(1, 3, 1)]}), {suppliedIds: ids, suppliedUrls: ['https://cdn.example/u1.mp4']}), 4, 'placed_urls_in_supplied').status).toBe('pass');
    expect(checkOf(score(bp({brollClips: [clip(1, 3, 1)]}), {suppliedIds: ids, suppliedUrls: ['https://cdn.example/other.mp4']}), 4, 'placed_urls_in_supplied').status).toBe('fail');
    expect(checkOf(score(bp({brollClips: [clip(1, 3, 1)]}), {suppliedIds: ids}), 4, 'placed_urls_in_supplied').status).toBe('not_checked');
  });
  it('an edit with no placed B-roll and a supplied list passes the id and stock checks', () => {
    const r = score(bp(), {suppliedIds: []});
    expect(checkOf(r, 4, 'placed_ids_in_supplied').status).toBe('pass');
    expect(checkOf(r, 4, 'no_stock_url').status).toBe('pass');
  });
});

describe('row 5: composition and safe area', () => {
  it('passes the canvas and a normal caption band; reports what needs pixels as not checked', () => {
    const r = score(bp());
    expect(checkOf(r, 5, 'canvas_1080x1920').status).toBe('pass');
    expect(checkOf(r, 5, 'caption_band_in_safe_area').status).toBe('pass');
    expect(checkOf(r, 5, 'face_inside_speaker_half_and_no_cropping').status).toBe('not_checked');
    expect(row(r, 5)).toMatchObject({status: 'pass', complete: false});
  });
  it('fails a wrong canvas and a caption band outside the safe frame', () => {
    expect(checkOf(score(bp({width: 720, height: 1280})), 5, 'canvas_1080x1920').status).toBe('fail');
    expect(checkOf(score(bp({captionDirection: {position: 'bottom', bottomFrac: 0.01}})), 5, 'caption_band_in_safe_area').status).toBe('fail');
    expect(checkOf(score(bp({captionDirection: undefined})), 5, 'caption_band_in_safe_area').status).toBe('not_checked');
  });
  it('uses the legibility hook box: safe area and caption-band overlap', () => {
    expect(checkOf(score(bp({legibility: fit()})), 5, 'hook_box_in_safe_area').status).toBe('pass');
    expect(checkOf(score(bp({legibility: fit()})), 5, 'hook_clear_of_caption_band').status).toBe('pass');
    expect(checkOf(score(bp({legibility: fit({topFrac: 0.02})})), 5, 'hook_box_in_safe_area').status).toBe('fail');
    expect(checkOf(score(bp({legibility: fit(), captionDirection: {position: 'top', bottomFrac: 0.18}})), 5, 'hook_clear_of_caption_band').status).toBe('fail');
    expect(checkOf(score(bp({legibility: fit(), captionDirection: {position: 'center', bottomFrac: 0.18}})), 5, 'hook_clear_of_caption_band').status).toBe('pass');
  });
  it('split overlays: valid or absent speakerSide passes; an invalid side fails; no split is not checked', () => {
    const split = (speakerSide?: unknown) => ({start: 5, end: 9, layout: 'split', assetUrl: 'https://cdn.example/a.mp4', ...(speakerSide === undefined ? {} : {speakerSide})});
    expect(checkOf(score(bp({visualOverlays: [split('top')]})), 5, 'split_is_top_bottom').status).toBe('pass');
    expect(checkOf(score(bp({visualOverlays: [split()]})), 5, 'split_is_top_bottom').status).toBe('pass');
    expect(checkOf(score(bp({visualOverlays: [split('left')]})), 5, 'split_is_top_bottom').status).toBe('fail');
    expect(checkOf(score(bp()), 5, 'split_is_top_bottom').status).toBe('not_checked');
  });
});

describe('row 9: render integrity (only with an inspection file)', () => {
  const good = {path: 'x.mp4', exists: true, bytes: 2_000_000, probe: {width: 1080, height: 1920, durationSec: 30.1, fps: 30, hasAudio: true}, decode: {ok: true, videoFrames: 900, decodedSec: 30, errors: []}};
  it('is not checked, never a pass, without an inspection', () => {
    expect(row(score(bp()), 9)).toMatchObject({status: 'not_checked', complete: false});
  });
  it('passes a good inspection; audio stays not checked unless the caller says the source had audio', () => {
    const r = score(bp(), {inspection: good});
    expect(row(r, 9).status).toBe('pass');
    expect(checkOf(r, 9, 'audio_present').status).toBe('not_checked');
    expect(row(score(bp(), {inspection: good, expectAudio: true}), 9)).toMatchObject({status: 'pass', complete: true});
  });
  it('fails a short, undecoded, wrong-size, missing or silent output with the failed check named', () => {
    const ids = (inspection: unknown, extra: Partial<ScoreInput> = {}) => row(score(bp(), {inspection, ...extra}), 9).checks.filter(c => c.status === 'fail').map(c => c.id);
    expect(ids({...good, probe: {...good.probe, durationSec: 12}})).toEqual(['duration_mismatch']);
    expect(ids({...good, decode: undefined})).toEqual(['output_not_decoded']);
    expect(ids({...good, decode: {ok: false, videoFrames: 10, decodedSec: 1, errors: ['x']}})).toEqual(['output_corrupt']);
    expect(ids({...good, probe: {...good.probe, width: 720, height: 1280}})).toEqual(['dimensions_mismatch']);
    expect(ids({path: 'x', exists: false, bytes: 0})).toEqual(['output_missing']);
    expect(ids({...good, probe: {...good.probe, hasAudio: false}}, {expectAudio: true})).toEqual(['audio_missing']);
  });
  it('treats a malformed inspection, or a blueprint without dimensions, as not checked rather than as a verdict', () => {
    expect(row(score(bp(), {inspection: {hello: 1}}), 9).status).toBe('not_checked');
    expect(row(score(bp(), {inspection: 'oops'}), 9).status).toBe('not_checked');
    expect(row(score(bp({width: undefined}), {inspection: good}), 9).status).toBe('not_checked');
  });
});

describe('report shape and purity', () => {
  it('is plain JSON, lists the rows it scored and the ones it did not, and counts statuses', () => {
    const r = score(bp({legibility: fit()}), {suppliedIds: ['ub_1'], inspection: {path: 'x', exists: false, bytes: 0}});
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(r.rows.map(item => item.row)).toEqual([1, 2, 3, 4, 5, 6, 9]); // row 3 (captions) was added in WP3P, row 6 in WP3Q
    expect(r.notScored).toEqual([7, 8, 10]);
    expect(r.summary.pass + r.summary.fail + r.summary.not_checked).toBe(7);
    expect(r.inputs).toEqual({blueprint: true, ledger: false, inspection: true, suppliedIds: true, callerMinGapSec: false, transcript: false});
    for (const item of r.rows) for (const c of item.checks) expect(['pass', 'fail', 'not_checked']).toContain(c.status);
  });
  it('does not modify its inputs (deep-frozen inputs do not throw)', () => {
    const deepFreeze = <T,>(value: T): T => {
      if (typeof value === 'object' && value !== null) {
        Object.values(value as object).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };
    const input = deepFreeze({blueprint: bp({brollClips: [clip(1, 3, 1)], plannerMinGapSec: 1, legibility: fit()}), ledger: {edits: [{type: 'hook_title', final: {start: 0, end: 3}}]}, inspection: {path: 'x', exists: true, bytes: 20000, probe: {width: 1080, height: 1920, durationSec: 30, fps: 30, hasAudio: true}, decode: {ok: true, videoFrames: 900, decodedSec: 30, errors: []}}, suppliedIds: ['ub_1']});
    expect(() => scoreRubric(input as unknown as ScoreInput)).not.toThrow();
  });
  it('survives hostile shapes without throwing', () => {
    for (const blueprint of [{}, [], null, 'x', 7, {brollClips: 'no', visualOverlays: [null, 3, 'a'], stats: 5, legibility: 'x', captionDirection: []}]) {
      expect(() => scoreRubric({blueprint, ledger: [], inspection: [], suppliedIds: [], suppliedUrls: []})).not.toThrow();
    }
  });
});

describe('stored examples (trimmed copies under eval/fixtures; the originals are not touched)', () => {
  const blueprint = JSON.parse(read(HERE, 'fixtures', 'wp3a-phase34-blueprint.trimmed.json')) as Json;
  const ledger = JSON.parse(read(HERE, 'fixtures', 'wp3a-phase34-ledger.json')) as Json;
  it('the Phase 34 legacy blueprint: hook title passes, legibility-dependent checks are not checked, pacing and B-roll are not checked, row 9 is not checked', () => {
    const r = score(blueprint, {ledger});
    expect(r.rows.map(item => [item.row, item.status])).toEqual([[1, 'pass'], [2, 'not_checked'], [3, 'not_checked'], [4, 'not_checked'], [5, 'pass'], [6, 'not_checked'], [9, 'not_checked']]);
    expect(row(r, 1).complete).toBe(false);
    expect(checkOf(r, 1, 'hook_box_in_frame').status).toBe('not_checked');
    expect(checkOf(r, 5, 'caption_band_in_safe_area').status).toBe('pass');
  });
  it('with the supplied list the Phase 34 edit (no B-roll, text overlays only) passes row 4', () => {
    expect(row(score(blueprint, {ledger, suppliedIds: []}), 4).status).toBe('pass');
  });
});

describe('what the scorer imports and mirrors (source text)', () => {
  it('the scorer and the CLI import nothing that can run FFmpeg, spawn, write, call a provider or log', () => {
    const scorer = read(HERE, 'rubricScorer.ts');
    const cli = read(SRC, 'scripts', 'scoreRubric.ts');
    const imports = (text: string) => [...text.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]);
    expect(imports(scorer).sort()).toEqual(['../lib/renderIntegrity.ts', '../pipeline/experimentVerdict.ts', '../stages/broll/groundedText.ts']);
    expect(scorer).toContain("import type {OutputFacts} from '../pipeline/experimentVerdict.ts';");
    expect(imports(cli).sort()).toEqual(['../eval/rubricScorer.ts', 'node:fs']);
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const text of [code(scorer), code(cli)]) expect(text).not.toMatch(/child_process|spawn|ffprobe|ffmpeg|fetch\(|logger|writeFile|appendFile|createWriteStream|process\.env|anthropic|gemini|groq/i);
    expect(code(cli)).not.toMatch(/\bwrite(File|Sync)\b/);
  });
  it('mirrors the safe frame and the caption band of the code it describes', () => {
    expect(read(SRC, 'lib', 'editConflicts.ts')).toContain(`const SAFE_FRAME: NormRect = {x: ${SAFE_FRAME.x}, y: ${SAFE_FRAME.y}, w: ${SAFE_FRAME.w}, h: ${SAFE_FRAME.h}};`);
    const placement = read(SRC, '..', '..', 'remotion', 'src', 'generated', 'placement.ts');
    expect(placement).toContain('const band = canvasHeight * 0.13;');
    expect(placement).toContain('return {top: canvasHeight * 0.12, bottom: canvasHeight * 0.12 + band};');
    expect(captionBand('top', 0.2)).toEqual({top: 0.12, bottom: 0.25});
    expect(captionBand('bottom', 0.2).bottom).toBeCloseTo(0.8, 9);
    expect(captionBand('center', 0.2).top).toBeCloseTo(0.435, 9);
  });
});
