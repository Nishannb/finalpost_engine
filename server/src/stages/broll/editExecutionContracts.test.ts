/**
 * Capability matrix and execution-contract tests for the Phase 10A repairs. Deterministic: no model,
 * no network, no rendering. A passing test here proves the CONTRACT (schema → parser → planner →
 * blueprint → renderer input); it does not prove the edit looks right.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

import {FROZEN_TOOL_KINDS} from '../../lib/assembler/types.ts';
import {validate} from '../../lib/assembler/legality.ts';
import {toVisualDirection} from '../directorV2/compiler.ts';
import {ELEMENT_KINDS} from '../directorV2/schemas.ts';
import type {CompiledElement} from '../directorV2/types.ts';
import type {TransitionClip} from '../../types/blueprint.ts';
import {ensureRequestedEditStyles} from './ensureRequestedEdits.ts';
import {fallbackVisualDirection, type VisualDirection} from './geminiDirector.ts';
import {resolveInsetReveals} from './insetRevealPlanner.ts';
import {layoutRank, resolveLayoutPriority, type LayoutCandidate} from './layoutPriority.ts';
import {speechHoldWindow} from './speechAlign.ts';
import {mergeDirectedTransitions} from './transitionPlan.ts';
import {identityTimeline} from '../filters/timeline.ts';

const here = dirname(fileURLToPath(import.meta.url));
const shortVideo = readFileSync(resolve(here, '../../../../remotion/src/ShortVideo.tsx'), 'utf8');

const el = (kind: string, extra: Partial<CompiledElement> = {}): CompiledElement =>
  ({id: kind, kind, start: 10, end: 14, params: {}, ...extra}) as unknown as CompiledElement;
const compile = (elements: CompiledElement[]): VisualDirection => toVisualDirection({editThesis: 't', hookTitle: '', hookStyle: 'bold', caption: undefined, suggestedLutIds: [], preferredLutId: '', estimatedCostUsd: 0} as never, elements, {} as never);

/**
 * One row per Director v2 element kind: where the compiler puts it, the blueprint key that carries it,
 * and the Remotion component that draws it. `assembler: 'refused'` rows are kinds the v2 assembler still
 * rejects as `unknown_kind` — listed on purpose so a change in either direction fails this test.
 */
const MATRIX: Record<string, {field: keyof VisualDirection | null; blueprint: string | null; renderer: string | null; assembler: 'accepted' | 'refused'}> = {
  hook_title: {field: null, blueprint: 'hook', renderer: 'HookTitle', assembler: 'accepted'},
  cutaway: {field: 'moments', blueprint: 'brollClips', renderer: 'BRollTrack', assembler: 'accepted'},
  split: {field: 'moments', blueprint: 'visualOverlays', renderer: 'SplitStage', assembler: 'accepted'},
  cutout: {field: 'moments', blueprint: 'visualOverlays', renderer: 'CutoutStage', assembler: 'accepted'},
  card: {field: 'moments', blueprint: 'visualOverlays', renderer: 'VisualOverlayTrack', assembler: 'accepted'},
  bubble: {field: 'moments', blueprint: 'visualOverlays', renderer: 'VisualOverlayTrack', assembler: 'accepted'},
  lockup: {field: 'moments', blueprint: 'visualOverlays', renderer: 'VisualOverlayTrack', assembler: 'accepted'},
  kinetic_text: {field: 'motionGraphics', blueprint: 'motionGraphics', renderer: 'MotionGraphicTrack', assembler: 'accepted'},
  counter: {field: 'semanticEmphasis', blueprint: 'semanticEmphasis', renderer: 'SemanticEmphasisTrack', assembler: 'accepted'},
  emphasis: {field: 'semanticEmphasis', blueprint: 'semanticEmphasis', renderer: 'SemanticEmphasisTrack', assembler: 'accepted'},
  zoom: {field: 'zooms', blueprint: 'zoomTriggers', renderer: 'ZoomFrame', assembler: 'accepted'},
  media_container: {field: 'mediaContainers', blueprint: 'mediaContainers', renderer: 'MediaContainerFrame', assembler: 'accepted'},
  transition: {field: 'transitions', blueprint: 'transitions', renderer: 'TransitionTrack', assembler: 'accepted'},
  slideshow: {field: 'moments', blueprint: 'visualOverlays', renderer: 'SplitStage', assembler: 'accepted'},
  frame_inset: {field: 'frameInsets', blueprint: 'frameInsets', renderer: 'FrameInsetFrame', assembler: 'accepted'},
  depth_overlay: {field: 'depthOverlays', blueprint: 'depthOverlays', renderer: 'DepthOverlayTrack', assembler: 'accepted'},
  inset_reveal: {field: 'insetReveals', blueprint: 'insetReveals', renderer: 'InsetRevealTrack', assembler: 'accepted'},
};

describe('capability matrix: Director kind → assembler → compiler → renderer', () => {
  it('has a row for every Director element kind (a new kind must be added here deliberately)', () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...ELEMENT_KINDS].sort());
  });

  it('the assembler accepts every Director kind, and refuses with a precise reason when a prerequisite is missing', () => {
    const words = Array.from({length: 60}, (_, i) => ({id: `w${i}`, text: `word${i}`, start: i * 0.5, end: i * 0.5 + 0.4}));
    const ctxWith = (speakerMask: 'available' | 'unavailable') => ({durationSec: 30, words, capabilities: {speakerMask, occupancySource: 'detected', safeRegions: [], captionBand: {x: 0, y: 0.76, w: 1, h: 0.24}}, candidates: [{assetId: 'ub', source: 'user', description: 'x', durationSec: 8, suitability: 0.9}]}) as never;
    const planOf = (kind: string, params: Record<string, unknown> = {}, from = 'w14', to = 'w26') => ({thesis: 't', captions: {} as never, hookTitle: '', hookStyle: 'x' as never, discardedAssets: [], requestedEdits: [], elements: [{id: 'a', kind, anchor: {startWord: from, endWord: to}, reason: 'r', params}]}) as never;
    // Window w14–w26 is ~6 s. Each kind gets params that satisfy its own prerequisites.
    const params: Record<string, Record<string, unknown>> = {
      cutaway: {assetId: 'ub'}, depth_overlay: {assetId: 'ub'},
      kinetic_text: {text: 'Words'}, counter: {text: '3'}, emphasis: {text: 'Words'}, lockup: {text: 'Words'}, bubble: {text: 'Words'},
    };
    const narrow: Record<string, [string, string]> = {transition: ['w14', 'w15'], zoom: ['w14', 'w18'], counter: ['w14', 'w18'], emphasis: ['w14', 'w18'], kinetic_text: ['w14', 'w18'], bubble: ['w14', 'w18'], lockup: ['w14', 'w18'], card: ['w14', 'w18'], cutout: ['w14', 'w18']};
    for (const kind of ELEMENT_KINDS) {
      const [from, to] = narrow[kind] ?? ['w14', 'w26'];
      const refused = validate(planOf(kind, params[kind] ?? {}, from, to), ctxWith('available')).refusals.map(r => `${r.code}:${r.message}`);
      expect(refused.filter(r => r.startsWith('unknown_kind')), kind).toEqual([]);
      expect(MATRIX[kind]!.assembler).toBe('accepted');
      expect((FROZEN_TOOL_KINDS as readonly string[]).includes(kind), kind).toBe(true);
    }
    // Prerequisites are refused accurately rather than dropped silently.
    expect(validate(planOf('cutout', {}, 'w14', 'w18'), ctxWith('unavailable')).refusals[0]).toMatchObject({code: 'needs_speaker_mask'});
    for (const kind of ['kinetic_text', 'counter', 'emphasis', 'lockup', 'bubble']) {
      expect(validate(planOf(kind, {text: '  '}, 'w14', 'w18'), ctxWith('available')).refusals[0], kind).toMatchObject({code: 'text_missing', message: expect.stringMatching(/no on-screen text/)});
    }
  });

  it('chooses the same conflict winner whatever order the plan lists the elements in', () => {
    const words = Array.from({length: 60}, (_, i) => ({id: `w${i}`, text: `word${i}`, start: i * 0.5, end: i * 0.5 + 0.4}));
    const ctx = {durationSec: 30, words, capabilities: {speakerMask: 'unavailable', occupancySource: 'detected', safeRegions: [], captionBand: {x: 0, y: 0.76, w: 1, h: 0.24}}, candidates: []} as never;
    const element = (id: string, kind: string, from: string, to: string) => ({id, kind, anchor: {startWord: from, endWord: to}, reason: 'r', params: {}});
    const base = {thesis: 't', captions: {} as never, hookTitle: '', hookStyle: 'x' as never, discardedAssets: [], requestedEdits: []};
    const frame = element('frame', 'frame_inset', 'w14', 'w24'); // 7.0–12.4
    const box = element('box', 'media_container', 'w20', 'w30'); // 10.0–15.4, asked for later
    const survivors = (elements: unknown[]) => validate({...base, elements} as never, ctx).plan.elements.map(e => e.id).sort();
    expect(survivors([frame, box])).toEqual(['frame']);
    expect(survivors([box, frame])).toEqual(['frame']);
  });

  it('every accepted kind compiles into a VisualDirection field (nothing is accepted and then discarded)', () => {
    for (const kind of ELEMENT_KINDS) {
      const row = MATRIX[kind]!;
      if (!row.field) {
        continue;
      }
      const params = kind === 'media_container' ? {containerMode: 'card'} : {};
      const direction = compile([el(kind, {params, text: 'Words here', overlayText: 'Words here', searchKeyword: 'sunset', layout: kind === 'cutaway' || kind === 'split' || kind === 'cutout' ? kind : undefined} as never)]);
      const bucket = (direction[row.field] ?? []) as unknown[];
      expect(bucket.length, `${kind} → ${String(row.field)}`).toBeGreaterThan(0);
    }
  });

  it('every renderer in the matrix is mounted by ShortVideo.tsx', () => {
    for (const [kind, row] of Object.entries(MATRIX)) {
      if (row.renderer) {
        expect(shortVideo, `${kind} → ${row.renderer}`).toContain(`<${row.renderer}`);
      }
    }
  });
});

describe('zoom scale through the v2 compiler', () => {
  it('carries an explicit zoom_scale on the directed zoom', () => {
    expect(compile([el('zoom', {params: {zoomScale: 1.4}})]).zooms).toEqual([{timestamp: 10, durationSec: 4, scale: 1.4}]);
  });
  it('carries focus_x / focus_y as written (range is checked when the zoom is resolved)', () => {
    expect(compile([el('zoom', {params: {focusX: 0.7, focusY: 0.2}})]).zooms[0]!.focus).toEqual({x: 0.7, y: 0.2});
    expect(compile([el('zoom', {params: {focusX: 0.7}})]).zooms[0]!.focus).toEqual({x: 0.7, y: Number.NaN});
    expect(compile([el('zoom')]).zooms[0]!.focus).toBeUndefined();
  });
  it('leaves scale off when the Director gave none (legacy default applies later)', () => {
    expect(compile([el('zoom')]).zooms).toEqual([{timestamp: 10, durationSec: 4}]);
  });
});

describe('transition compilation and merge', () => {
  const engine = (at: number): TransitionClip => ({at, duration: 0.38, keyword: 'film burn', assetUrl: '', blend: 'screen', provider: 'generated', providerId: 0, width: 1080, height: 1920, credit: '', creditUrl: ''});

  it('compiles a v2 transition into the direction instead of discarding it', () => {
    expect(compile([el('transition', {start: 12, end: 12.5, params: {transitionStyle: 'film burn'}})]).transitions).toEqual([{start: 12, end: 12.5, style: 'film burn'}]);
  });

  it('a valid Director transition reaches the blueprint transition list and keeps its time', () => {
    const merged = mergeDirectedTransitions({engine: [], directed: [{start: 12, end: 12.5, style: 'ink wipe please'}], outputDurationSec: 40});
    expect(merged.transitions).toHaveLength(1);
    expect(merged.transitions[0]).toMatchObject({at: 12, duration: 0.5, keyword: 'ink splash', provider: 'generated'});
    expect(shortVideo).toContain('<TransitionTrack clips={blueprint.transitions}');
  });

  it('records an unrecognised style and falls back to an existing keyword (no new styles)', () => {
    const merged = mergeDirectedTransitions({engine: [], directed: [{start: 12, end: 12.5, style: 'swirly'}], outputDurationSec: 40});
    expect(merged.directed[0]!.note).toMatch(/not_recognised/);
    expect(['light leak overlay', 'film burn', 'ink splash', 'smoke overlay', 'fire overlay', 'paper wipe', 'glitch overlay']).toContain(merged.transitions[0]!.keyword);
  });

  it('replaces the engine transition at the same cut instead of stacking two', () => {
    const merged = mergeDirectedTransitions({engine: [engine(12.1), engine(30)], directed: [{start: 12, end: 12.4}], outputDurationSec: 40});
    expect(merged.transitions.map(t => t.at)).toEqual([12, 30]);
    expect(merged.superseded).toHaveLength(1);
    expect(merged.superseded[0]!.engine.at).toBe(12.1);
  });

  it.each([
    [{start: 12, end: 11}, 'transition_invalid_interval'],
    [{start: Number.NaN, end: 12}, 'transition_invalid_interval'],
    [{start: -1, end: -0.5}, 'transition_outside_video'],
    [{start: 39.9, end: 40.5}, 'transition_outside_video'],
    [{start: 10, end: 10.1}, 'transition_duration_0.1s_outside_0.2_0.8s'],
    [{start: 10, end: 12}, 'transition_duration_2s_outside_0.2_0.8s'],
  ])('rejects %j with the reason %s', (directed, reason) => {
    const merged = mergeDirectedTransitions({engine: [], directed: [directed], outputDurationSec: 40});
    expect(merged.transitions).toEqual([]);
    expect(merged.directed[0]!.rejected).toBe(reason);
  });

  it('treats an engine transition at the cut as the same one when the Director transition ends at that cut', () => {
    // Director sweep 4.5–4.95 s leading into a cut at 5.0 s; the engine put its own at the cut.
    const merged = mergeDirectedTransitions({engine: [engine(5.0)], directed: [{start: 4.5, end: 4.95}], outputDurationSec: 40});
    expect(merged.transitions.map(t => t.at)).toEqual([4.5]);
    expect(merged.superseded).toHaveLength(1);
    // A different cut far away is untouched.
    expect(mergeDirectedTransitions({engine: [engine(9.0)], directed: [{start: 4.5, end: 4.95}], outputDurationSec: 40}).transitions.map(t => t.at)).toEqual([4.5, 9]);
  });

  it('rejects a second Director transition at the same cut', () => {
    const merged = mergeDirectedTransitions({engine: [], directed: [{start: 12, end: 12.4}, {start: 12.2, end: 12.6}], outputDurationSec: 40});
    expect(merged.transitions).toHaveLength(1);
    expect(merged.directed[1]!.rejected).toBe('duplicate_director_transition');
  });
});

describe('explicit layout priority', () => {
  type Item = {name: string};
  const cand = (name: string, kind: LayoutCandidate<Item>['kind'], start: number, end: number, directedStart = start, userSupplied = false): LayoutCandidate<Item> => ({item: {name}, kind, start, end, directedStart, userSupplied});
  const lost = (list: LayoutCandidate<Item>[]) => resolveLayoutPriority(list).map(loss => `${loss.item.name}<${loss.winner.name}:${loss.reason}`);

  it('ranks user footage above matched layouts above full-frame treatments', () => {
    expect(layoutRank('cutaway', true)).toBe(4);
    expect(layoutRank('split', true)).toBe(4);
    expect(layoutRank('split', false)).toBe(3);
    expect(layoutRank('cutout', false)).toBe(3);
    expect(layoutRank('cutaway', false)).toBe(2);
    expect(layoutRank('frame_inset', false)).toBe(2);
    expect(layoutRank('media_container', false)).toBe(2);
    expect(layoutRank('inset_reveal', false)).toBe(2);
  });

  it('does not automatically prefer a cutaway over a frame inset or an inset reveal (equal rank: earlier directed wins)', () => {
    expect(lost([cand('cut', 'cutaway', 10, 18, 20), cand('frame', 'frame_inset', 8, 12, 8)])).toEqual(['cut<frame:overlaps_frame_inset_equal_rank_directed_earlier']);
    expect(lost([cand('cut', 'cutaway', 10, 18, 9), cand('frame', 'frame_inset', 8, 12, 12)])).toEqual(['frame<cut:overlaps_cutaway_equal_rank_directed_earlier']);
    expect(lost([cand('cut', 'cutaway', 10, 18, 30), cand('reveal', 'inset_reveal', 8, 12, 8)])).toEqual(['cut<reveal:overlaps_inset_reveal_equal_rank_directed_earlier']);
  });

  it('is independent of array order', () => {
    const a = cand('cut', 'cutaway', 10, 18, 20);
    const b = cand('frame', 'frame_inset', 8, 12, 8);
    const c = cand('box', 'media_container', 11, 14, 11);
    expect(lost([a, b, c]).sort()).toEqual(lost([c, b, a]).sort());
    expect(lost([b, a, c]).sort()).toEqual(lost([a, c, b]).sort());
  });

  it('a higher rank wins regardless of timing; user footage beats everything', () => {
    expect(lost([cand('split', 'split', 10, 16, 30), cand('frame', 'frame_inset', 8, 12, 8)])).toEqual(['frame<split:overlaps_split_rank_2_below_rank_3']);
    expect(lost([cand('mine', 'cutaway', 10, 16, 30, true), cand('split', 'split', 8, 12, 8)])).toEqual(['split<mine:overlaps_cutaway_rank_3_below_rank_4']);
  });

  it('keeps compatible edits together and drops nothing that does not overlap', () => {
    expect(lost([cand('cut', 'cutaway', 10, 14), cand('frame', 'frame_inset', 14, 18), cand('reveal', 'inset_reveal', 20, 24), cand('box', 'media_container', 30, 34)])).toEqual([]);
  });

  it('breaks a same-moment tie by length, then kind', () => {
    expect(lost([cand('short', 'frame_inset', 10, 13, 10), cand('long', 'media_container', 10, 16, 10)])).toEqual(['short<long:overlaps_media_container_equal_rank_directed_same_time_longer_or_first']);
  });
});

describe('speech-aligned hold windows', () => {
  /** Continuous speech: every gap is under the 0.48 s that joins words into one "burst". */
  const continuous = Array.from({length: 80}, (_, i) => ({text: i === 50 ? 'ocean' : `w${i}`, start: i * 0.5, end: i * 0.5 + 0.45}));

  it('anchors the window on the aligned word instead of the start of the video (regression)', () => {
    const window = speechHoldWindow({words: continuous as never, atSec: 25, phrase: 'ocean', fallbackSec: 2.2, maxSec: 8});
    expect(window.start).toBeGreaterThanOrEqual(24.5);
    expect(window.start).toBeLessThanOrEqual(25);
    expect(window.end - window.start).toBeLessThanOrEqual(8 + 1e-6);
  });

  it('is unchanged for speech with real pauses (the burst start is still used)', () => {
    const paused = [
      {text: 'one', start: 0, end: 0.4},
      {text: 'two', start: 0.5, end: 0.9},
      {text: 'ocean', start: 3, end: 3.4},
      {text: 'tide', start: 3.5, end: 3.9},
    ];
    expect(speechHoldWindow({words: paused as never, atSec: 3.1, phrase: 'ocean', fallbackSec: 2.2, maxSec: 8}).start).toBe(3);
  });
});

describe('frame inset / media container time base into the inset planner', () => {
  const reveal = {start: 20, end: 24, variant: 'simple' as const, reason: 'r'};
  const base = {directed: [reveal], timeline: identityTimeline(60), clips: [], overlays: [], depthOverlays: [], alreadyOutput: true};

  it('blocks an inset reveal that overlaps an OUTPUT-time frame inset (legacy behaviour)', () => {
    const result = resolveInsetReveals({...base, frameInsets: [{start: 21, end: 25}]});
    expect(result.clips).toEqual([]);
    expect(result.warnings.join()).toMatch(/drop:inset_0/);
  });

  it('leaves overlap with frame insets / containers / cutaways to the priority resolver when priorityManaged', () => {
    const result = resolveInsetReveals({...base, frameInsets: [{start: 21, end: 25}], mediaContainers: [{start: 21, end: 25}], priorityManaged: true});
    expect(result.clips).toHaveLength(1);
  });
});

describe('ensureRequestedEditStyles recognises every placed kind', () => {
  const empty = () => {
    const direction = fallbackVisualDirection({transcript: 'I have a community of about a million plus online.', sourceDurationSec: 24, momentCount: 1});
    return {...direction, moments: [], insetReveals: [], depthOverlays: [], zooms: [], semanticEmphasis: [], motionGraphics: [], frameInsets: [], mediaContainers: [], transitions: []};
  };
  const run = (direction: VisualDirection, ids: string[]) => ensureRequestedEditStyles({direction, allowed: new Set(ids), words: [], durationSec: 24}).warnings;

  it('flags frame_inset / media_container / transition as not placed when absent', () => {
    expect(run(empty(), ['frame_inset', 'media_container', 'transition']).sort()).toEqual(['requested_not_placed:frame_inset', 'requested_not_placed:media_container', 'requested_not_placed:transition']);
  });

  it('does not flag them when the Director placed them (the old placedKinds ignored these)', () => {
    const direction = {
      ...empty(),
      frameInsets: [{start: 5, end: 9, scale: 0.86, marginColor: '#000000', cornerRadius: 18, transitionSec: 0.9}],
      mediaContainers: [{start: 12, end: 16, mode: 'card', canvasColor: '#111111', cornerRadius: 28, scale: 0.72, transitionSec: 0.85}],
      transitions: [{start: 10, end: 10.4}],
    } as unknown as VisualDirection;
    expect(run(direction, ['frame_inset', 'media_container', 'transition'])).toEqual([]);
  });
});
