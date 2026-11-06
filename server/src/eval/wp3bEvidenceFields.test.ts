/**
 * WP3B pure tests: the three facts the scorer could not read (planner gap, hook policy, supplied asset id) and the scorer reading them.
 * Import graph: rubricScorer.ts (-> lib/renderIntegrity.ts -> lib/errors.ts -> lib/billingGuard.ts), stages/broll/userBrollContract.ts (no imports), stages/broll/editorialGate.ts
 * (type-only imports). The wired modules (brollPlanner, analyzeVideo) import the logger and are checked by reading their source. Inline fixtures only; no logger, `.env`, SDK,
 * FFmpeg, Chromium or network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {cutawayMinGapSec} from '../stages/broll/editorialGate.ts';
import {stampUserBrollIds, userBrollIdByUrl} from '../stages/broll/userBrollContract.ts';
import {scoreRubric, type ScoreInput} from './rubricScorer.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const read = (...parts: string[]) => readFileSync(resolve(...parts), 'utf8');
type Json = Record<string, unknown>;

const bp = (over: Json = {}): Json => ({
  width: 1080, height: 1920, outputDurationSec: 30, hookTitle: 'Never do these three things', captionDirection: {position: 'bottom', bottomFrac: 0.18},
  brollClips: [], visualOverlays: [], depthOverlays: [], insetReveals: [], transitions: [], stats: {warnings: []}, ...over,
});
const evidence = (over: Json = {}) => ({version: 1, plannerMinGapSec: 4.5, plannerMinGapAppliesTo: 'cutaway_clips', hookTitlePolicy: 'placeholder', ...over});
const clip = (start: number, end: number, id: number, over: Json = {}) => ({start, end, provider: 'user', providerId: id, assetUrl: `https://cdn.example/u${id}.mp4`, ...over});
const rowOf = (r: ReturnType<typeof scoreRubric>, n: number) => r.rows.find(item => item.row === n)!;
const checkOf = (r: ReturnType<typeof scoreRubric>, n: number, id: string) => rowOf(r, n).checks.find(item => item.id === id)!;
const score = (blueprint: Json, extra: Partial<ScoreInput> = {}) => scoreRubric({blueprint, ...extra});

describe('fact 1: the planner gap', () => {
  it('the recorded value is the gate\'s own function of list mode (4.5 s, or 3.2 s in list mode)', () => {
    expect(cutawayMinGapSec(false)).toBe(4.5);
    expect(cutawayMinGapSec(true)).toBe(3.2);
    expect(cutawayMinGapSec(undefined)).toBe(4.5);
  });
  it('the scorer reads evidence.plannerMinGapSec with no --min-gap-sec, and the row is complete', () => {
    const near = score(bp({evidence: evidence(), brollClips: [clip(1, 4, 1), clip(5, 7, 2)]}));
    expect(checkOf(near, 2, 'min_gap_between_media_edits').status).toBe('fail');
    expect(JSON.stringify(checkOf(near, 2, 'min_gap_between_media_edits').evidence)).toContain('evidence.plannerMinGapSec');
    const spaced = score(bp({evidence: evidence(), brollClips: [clip(1, 4, 1), clip(9, 11, 2)]}));
    expect(rowOf(spaced, 2)).toMatchObject({status: 'pass', complete: true});
    expect(spaced.inputs.callerMinGapSec).toBe(false);
  });
  it('applies the cutaway gap to cutaway clips only, as the gate does (a nearby text/media overlay is not compared)', () => {
    const overlay = {start: 4.2, end: 6, layout: 'card', assetUrl: 'https://cdn.example/a.png', provider: 'user', providerId: 3};
    const r = score(bp({evidence: evidence(), brollClips: [clip(1, 4, 1)], visualOverlays: [overlay]}));
    expect(checkOf(r, 2, 'min_gap_between_media_edits').status).toBe('pass');
    expect(JSON.stringify(checkOf(r, 2, 'min_gap_between_media_edits').evidence)).toContain('cutaway_clips');
  });
  it('list mode records 3.2 s and the scorer uses it', () => {
    const r = score(bp({evidence: evidence({plannerMinGapSec: 3.2}), brollClips: [clip(1, 4, 1), clip(7.5, 9, 2)]}));
    expect(checkOf(r, 2, 'min_gap_between_media_edits').status).toBe('pass');
    expect(checkOf(score(bp({evidence: evidence({plannerMinGapSec: 3.2}), brollClips: [clip(1, 4, 1), clip(7, 9, 2)]})), 2, 'min_gap_between_media_edits').status).toBe('fail');
  });
  it('the evidence value wins over a gap found elsewhere and over the caller; an unusable value is ignored (old not_checked behaviour)', () => {
    const clips = [clip(1, 4, 1), clip(5.6, 7, 2)];
    expect(checkOf(score(bp({evidence: evidence({plannerMinGapSec: 1.5}), plannerMinGapSec: 9, brollClips: clips}), {callerMinGapSec: 9}), 2, 'min_gap_between_media_edits').status).toBe('pass');
    for (const bad of [0, -1, 'x', null]) {
      expect(rowOf(score(bp({evidence: evidence({plannerMinGapSec: bad}), brollClips: clips})), 2).status, String(bad)).toBe('not_checked');
    }
    expect(rowOf(score(bp({brollClips: clips})), 2).status).toBe('not_checked');
  });
});

describe('fact 2: the hook policy', () => {
  it('an empty title under a recorded optional policy passes row 1', () => {
    const r = score(bp({hookTitle: '', evidence: evidence({hookTitlePolicy: 'optional'})}));
    expect(checkOf(r, 1, 'hook_title_present').status).toBe('pass');
    expect(JSON.stringify(checkOf(r, 1, 'hook_title_present').evidence)).toContain('evidence.hookTitlePolicy');
  });
  it('an empty title under a recorded placeholder policy fails; a title passes under either policy', () => {
    expect(checkOf(score(bp({hookTitle: '', evidence: evidence({hookTitlePolicy: 'placeholder'})})), 1, 'hook_title_present').status).toBe('fail');
    for (const hookTitlePolicy of ['placeholder', 'optional']) expect(checkOf(score(bp({evidence: evidence({hookTitlePolicy})})), 1, 'hook_title_present').status).toBe('pass');
  });
  it('without evidence the old behaviour holds: an empty title fails, and the older field spellings still work', () => {
    expect(checkOf(score(bp({hookTitle: ''})), 1, 'hook_title_present').status).toBe('fail');
    expect(checkOf(score(bp({hookTitle: '', hookTitlePolicy: 'optional'})), 1, 'hook_title_present').status).toBe('pass');
  });
});

describe('fact 3: the supplied asset id', () => {
  const ids = ['ub_1', 'ub_2'];
  const placed = (userBrollId: string | undefined, providerId: number, over: Json = {}) => ({...clip(1, 3, providerId), ...(userBrollId ? {userBrollId} : {}), ...over});

  it('prefers the recorded id: it passes even where providerId alone would not match', () => {
    const r = score(bp({evidence: evidence(), brollClips: [placed('ub_2', 9)]}), {suppliedIds: ids});
    expect(checkOf(r, 4, 'placed_ids_in_supplied').status).toBe('pass');
    expect(JSON.stringify(checkOf(r, 4, 'placed_ids_in_supplied').evidence)).toContain('recorded');
  });
  it('a recorded id that was not supplied fails, even if providerId would match a supplied one', () => {
    const r = score(bp({evidence: evidence(), brollClips: [placed('ub_7', 1)]}), {suppliedIds: ids});
    const c = checkOf(r, 4, 'placed_ids_in_supplied');
    expect(c.status).toBe('fail');
    expect(JSON.stringify(c.evidence)).toContain('ub_7');
  });
  it('on a WP3B blueprint (evidence present) a creator placement with no recorded id fails instead of being reconstructed', () => {
    const r = score(bp({evidence: evidence(), brollClips: [placed(undefined, 1)]}), {suppliedIds: ids});
    expect(checkOf(r, 4, 'placed_ids_in_supplied').status).toBe('fail');
    expect(JSON.stringify(checkOf(r, 4, 'placed_ids_in_supplied').evidence)).toContain('"value":"missing"');
  });
  it('an older blueprint (no evidence, no recorded id) still reconstructs ub_<providerId> as before', () => {
    expect(checkOf(score(bp({brollClips: [placed(undefined, 1)]}), {suppliedIds: ids}), 4, 'placed_ids_in_supplied').status).toBe('pass');
    expect(checkOf(score(bp({brollClips: [placed(undefined, 9)]}), {suppliedIds: ids}), 4, 'placed_ids_in_supplied').status).toBe('fail');
  });
  it('slides and depth overlays are read the same way; stock and unsupplied ids still fail row 4', () => {
    const overlay = {start: 6, end: 10, layout: 'cutaway', treatment: 'slideshow', ...placed('ub_1', 1), slides: [placed('ub_1', 1), placed('ub_2', 2)]};
    expect(rowOf(score(bp({evidence: evidence(), visualOverlays: [overlay]}), {suppliedIds: ids}), 4).status).toBe('pass');
    const badSlide = {...overlay, slides: [placed('ub_1', 1), placed('ub_5', 5)]};
    expect(checkOf(score(bp({evidence: evidence(), visualOverlays: [badSlide]}), {suppliedIds: ids}), 4, 'placed_ids_in_supplied').status).toBe('fail');
    expect(checkOf(score(bp({evidence: evidence(), depthOverlays: [{start: 1, end: 3, ...placed('ub_8', 8)}]}), {suppliedIds: ids}), 4, 'placed_ids_in_supplied').status).toBe('fail');
    expect(checkOf(score(bp({evidence: evidence(), brollClips: [placed('ub_1', 1, {provider: 'pexels'})]}), {suppliedIds: ids}), 4, 'no_stock_url').status).toBe('fail');
    expect(checkOf(score(bp({evidence: evidence(), brollClips: [placed('ub_1', 1, {assetUrl: 'https://videos.pexels.com/x.mp4'})]}), {suppliedIds: ids}), 4, 'no_stock_url').status).toBe('fail');
  });
  it('without a supplied-id list row 4 is still not checked', () => {
    expect(rowOf(score(bp({evidence: evidence(), brollClips: [placed('ub_1', 1)]})), 4).status).toBe('not_checked');
  });
});

describe('stampUserBrollIds (recording only)', () => {
  const assets = [{id: 'ub_1', url: 'https://cdn.example/u1.mp4'}, {id: 'ub_2', url: 'https://cdn.example/u2.mp4'}];
  const build = () => ({
    clips: [clip(1, 3, 1) as Json, {start: 4, end: 6, provider: 'pexels', providerId: 77, assetUrl: 'https://videos.pexels.com/s.mp4'} as Json],
    overlays: [{start: 8, end: 12, layout: 'cutaway', provider: 'user', providerId: 2, assetUrl: 'https://cdn.example/u2.mp4', slides: [clip(8, 10, 1) as Json, clip(10, 12, 2) as Json]} as Json,
      {start: 14, end: 16, layout: 'lockup', provider: 'generated', providerId: 0, assetUrl: ''} as Json],
    depthOverlays: [{start: 20, end: 22, provider: 'user', assetUrl: 'https://cdn.example/u1.mp4'} as Json, {start: 24, end: 26, provider: 'user', assetUrl: 'https://cdn.example/other.mp4'} as Json],
  });

  it('stamps supplied creator items only (clips, overlays, slides, depth overlays), counts the unmatched, never touches stock or generated', () => {
    const edit = build();
    const result = stampUserBrollIds({...(edit as never), idByUrl: userBrollIdByUrl(assets)});
    expect(result).toEqual({stamped: 5, unmatched: 1});
    expect(edit.clips[0]!.userBrollId).toBe('ub_1');
    expect(edit.clips[1]!.userBrollId).toBeUndefined();
    expect(edit.overlays[0]!.userBrollId).toBe('ub_2');
    expect((edit.overlays[0]!.slides as Json[]).map(s => s.userBrollId)).toEqual(['ub_1', 'ub_2']);
    expect(edit.overlays[1]!.userBrollId).toBeUndefined();
    expect(edit.depthOverlays.map(d => d.userBrollId)).toEqual(['ub_1', undefined]);
  });
  it('adds only that one property: every other field, every time and every object identity is unchanged', () => {
    const edit = build();
    const before = JSON.parse(JSON.stringify(edit));
    const identities = [...edit.clips, ...edit.overlays, ...edit.depthOverlays];
    stampUserBrollIds({...(edit as never), idByUrl: userBrollIdByUrl(assets)});
    const strip = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, v) => (key === 'userBrollId' ? undefined : v)));
    expect(strip(edit)).toEqual(before);
    expect([...edit.clips, ...edit.overlays, ...edit.depthOverlays].every((item, i) => item === identities[i])).toBe(true);
  });
  it('is idempotent, and the first asset wins for a repeated URL', () => {
    const edit = build();
    const map = userBrollIdByUrl([...assets, {id: 'ub_3', url: 'https://cdn.example/u1.mp4'}]);
    expect(map.get('https://cdn.example/u1.mp4')).toBe('ub_1');
    const first = stampUserBrollIds({...(edit as never), idByUrl: map});
    const second = stampUserBrollIds({...(edit as never), idByUrl: map});
    expect(second).toEqual(first);
  });
  it('an edit with nothing placed stays untouched', () => {
    const empty = {clips: [], overlays: [], depthOverlays: []};
    expect(stampUserBrollIds({...empty, idByUrl: userBrollIdByUrl(assets)})).toEqual({stamped: 0, unmatched: 0});
  });
});

describe('a stamped mvp-shaped blueprint scores rows 1, 2 and 4 completely with no extra flags', () => {
  it('end to end on synthetic data', () => {
    const edit = {clips: [clip(2, 5, 1) as Json], overlays: [] as Json[], depthOverlays: [] as Json[]};
    stampUserBrollIds({...(edit as never), idByUrl: userBrollIdByUrl([{id: 'ub_1', url: 'https://cdn.example/u1.mp4'}])});
    const blueprint = bp({hookTitle: '', brollClips: edit.clips, evidence: evidence({hookTitlePolicy: 'optional', plannerMinGapSec: 3.2})});
    const r = score(blueprint, {suppliedIds: ['ub_1']});
    expect([1, 2, 4].map(n => [n, rowOf(r, n).status, rowOf(r, n).complete])).toEqual([[1, 'pass', false], [2, 'pass', true], [4, 'pass', false]]);
    // row 1 and 4 stay incomplete only because the hook box (no legibility on this fixture) and the URL list are not supplied
    expect(rowOf(r, 1).checks.filter(c => c.status === 'not_checked').map(c => c.id).sort()).toEqual(['hook_box_in_frame', 'hook_clear_band', 'ledger_hook_title_survived']);
    expect(rowOf(r, 4).checks.filter(c => c.status === 'not_checked').map(c => c.id)).toEqual(['placed_urls_in_supplied']);
  });
});

describe('legacy blueprints keep their shape (source text; the wired modules import the logger)', () => {
  const planner = read(SRC, 'stages', 'broll', 'brollPlanner.ts');
  const av = read(SRC, 'pipeline', 'analyzeVideo.ts');
  it('the planner records evidence only under the creator-B-roll-only contract, from the gate\'s own function and the live policy', () => {
    expect(planner).toContain('...(input.userBrollOnly\n      ? {evidence: {version: 1 as const, plannerMinGapSec: cutawayMinGapSec(cutawayListMode), plannerMinGapAppliesTo: \'cutaway_clips\' as const, hookTitlePolicy: jobFlag(\'hookTitlePolicy\', env.HOOK_TITLE_POLICY)}}\n      : {}),'); // the job's setting (EffectiveFlags), env outside a job
    expect(planner).toContain('const cutawayListMode = listBeatsFromTranscript(input.transcript).length >= 2;');
    expect(planner).toContain('listMode: cutawayListMode,');
    expect(planner.match(/listBeatsFromTranscript\(input\.transcript\)\.length >= 2/g)?.length).toBe(2); // the const, and the unchanged scheduler argument
  });
  it('analyzeVideo stamps ids and writes evidence only for the mvp profile', () => {
    expect(av).toContain("if (mvpLike) {\n        userAssetIdByUrl = userBrollIdByUrl(userBrollAssets);");
    expect(av).toContain("if (mvpLike && userAssetIdByUrl) {");
    expect(av).toContain("...(mvpLike && broll.evidence ? {evidence: broll.evidence} : {}),");
    expect(av.indexOf('stampUserBrollIds({')).toBeLessThan(av.indexOf('const blueprint: TimelineBlueprint = {'));
  });
  it('the new fields are optional in the server types and the Remotion schema, and nothing in the renderer reads them', () => {
    const types = read(SRC, 'types', 'blueprint.ts');
    expect(types.match(/userBrollId\?: string;/g)?.length).toBe(3);
    expect(types).toContain('evidence?: ScorerEvidence;');
    expect(read(SRC, 'lib', 'depthOverlay.ts')).toContain('userBrollId?: string;');
    const schema = read(SRC, '..', '..', 'remotion', 'src', 'blueprintSchema.ts');
    expect(schema.match(/userBrollId: z\.string\(\)\.optional\(\),/g)?.length).toBe(4);
    expect(schema).toMatch(/evidence: z\s*\.object\(\{[\s\S]*?\}\)\s*\.optional\(\),/);
    for (const file of ['ShortVideo.tsx', 'components/HookTitle.tsx', 'components/VisualOverlayTrack.tsx', 'components/VideoTrack.tsx', 'components/DepthOverlayTrack.tsx', 'components/SlideshowPlate.tsx']) {
      let text = '';
      try {
        text = read(SRC, '..', '..', 'remotion', 'src', file);
      } catch {
        continue;
      }
      expect(text, file).not.toMatch(/userBrollId|\.evidence\b|plannerMinGapSec/);
    }
  });
  it('the profile default and the other flags are unchanged', () => {
    const env = read(SRC, 'config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
