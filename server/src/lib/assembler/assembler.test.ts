import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {occupancyFromSpeaker} from '../../stages/layout/occupancy.ts';
import type {CreativePlan, PerceptionPack, WordRef} from '../../stages/directorV2/types.ts';
import {
  auditPlanVsShipped,
  fromCreativePlan,
  mediaContextFromPack,
  schedule,
  shippedFromRenderTimeline,
  shippedFromScheduled,
  validate,
} from './index.ts';
import {compileCreativePlan} from '../../stages/directorV2/compiler.ts';

const DUMP = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../director-dump-northstar',
);

function word(id: string, text: string, start: number, end: number): WordRef {
  return {id, text, start, end, sentenceId: 's0'};
}

const GABBY_WORDS: WordRef[] = [
  word('w0', "I'm", 0.14, 0.76),
  word('w9', 'online', 2.72, 3.18),
  word('w35', 'build', 9.9, 10.32),
  word('w43', 'trips', 12.32, 12.72),
  word('w44', 'I', 12.72, 13.3),
  word('w53', 'online', 14.76, 15.08),
  word('w65', 'live', 18.86, 19.1),
  word('w73', 'way', 21.68, 21.76),
  word('w81', 'negotiate', 24.46, 25.42),
  word('w87', 'freedom', 27.54, 28.28),
];

function gabbyPack(): PerceptionPack {
  return {
    words: GABBY_WORDS,
    sentences: [],
    storyboard: [],
    occupancySlices: [
      {
        atSec: 1,
        occupancy: occupancyFromSpeaker({x: 0.18, y: 0.16, w: 0.64, h: 0.62}, 'fallback'),
      },
    ],
    audio: {pauses: [], emphasisWordIds: [], energyPeaks: []},
    transcript: "I'm Gabby Beckford",
    outputDurationSec: 28.587,
    language: 'en',
    creatorProfile: '',
    speakerCutoutAvailable: false,
    speakerCutoutNote: 'no mask',
    userAssets: [
      {
        id: 'ub_1',
        description: 'couple silhouette',
        durationSec: 2,
      },
    ],
    requestedEdits: ['inset_reveal', 'depth_overlay', 'cutaway'],
  };
}

function gabbyPlan(): CreativePlan {
  return {
    editThesis: 'emerald lifestyle editorial',
    editThesisParts: {
      look: 'emerald',
      rhythm: 'punchy',
      motionLanguage: 'springs',
      colorStory: 'mint',
      why: 'gabby',
    },
    hookTitle: 'Gabby Beckford | @Packslight',
    hookStyle: 'stack',
    caption: {
      position: 'bottom',
      bottomFrac: 0.16,
      textColor: '#FFFFFF',
      highlightColor: '#F5F5F5',
      boxColor: null,
      template: 'editorial-emphasis',
    },
    preferredLutId: '',
    suggestedLutIds: [],
    elements: [
      {
        id: 'e1',
        beatId: 'b1',
        intent: 'identity',
        kind: 'hook_title',
        wordRange: {startWordId: 'w0', endWordId: 'w9'},
        text: 'GABBY BECKFORD | @PACKSLIGHT',
      },
      {
        id: 'e2',
        beatId: 'b3',
        intent: 'punch-in',
        kind: 'zoom',
        wordRange: {startWordId: 'w35', endWordId: 'w43'},
      },
      {
        id: 'e3',
        beatId: 'b4',
        intent: '1M community',
        kind: 'depth_overlay',
        wordRange: {startWordId: 'w44', endWordId: 'w53'},
        userBrollId: 'ub_1',
      },
      {
        id: 'e4',
        beatId: 'b5',
        intent: 'adventure',
        kind: 'cutaway',
        wordRange: {startWordId: 'w65', endWordId: 'w73'},
        searchKeyword: 'woman solo traveler mountain',
      },
      {
        id: 'e5',
        beatId: 'b6',
        intent: 'salaries',
        kind: 'inset_reveal',
        wordRange: {startWordId: 'w81', endWordId: 'w87'},
        params: {variant: 'motion_graphic'},
      },
    ],
    estimatedCostUsd: 0,
    promptVersion: 'test',
    inputHash: 'test',
    raw: {},
  };
}

describe('assembler legality', () => {
  it('refuses unknown kinds and never adds replacements', () => {
    const pack = gabbyPack();
    const ctx = mediaContextFromPack(pack);
    const plan = fromCreativePlan(
      {
        ...gabbyPlan(),
        elements: [
          {
            id: 'e9',
            beatId: 'b1',
            intent: 'legacy',
            kind: 'lockup',
            wordRange: {startWordId: 'w0', endWordId: 'w9'},
            text: 'hello',
          },
        ],
      },
      pack,
    );
    const result = validate(plan, ctx);
    expect(result.plan.elements).toEqual([]);
    expect(result.refusals[0]?.code).toBe('unknown_kind');
  });

  it('refuses depth_overlay without a real mask and does not fill it back', () => {
    const pack = gabbyPack();
    const ctx = mediaContextFromPack(pack);
    const plan = fromCreativePlan(gabbyPlan(), pack);
    const result = validate(plan, ctx);
    expect(result.refusals.some(item => item.elementId === 'e3' && item.code === 'needs_speaker_mask')).toBe(
      true,
    );
    expect(result.plan.elements.some(element => element.id === 'e3')).toBe(false);
    expect(
      result.plan.discardedAssets.some(
        item => item.assetId === 'ub_1' && /needs_speaker_mask/.test(item.reason),
      ),
    ).toBe(true);
    expect(result.log.some(entry => entry.code === 'requested_not_placed' && entry.detail.includes('depth_overlay'))).toBe(
      false,
    );
  });

  it('does not treat zoom as conflicting with inset_reveal', () => {
    const pack = gabbyPack();
    const ctx = mediaContextFromPack(pack);
    const plan = fromCreativePlan(gabbyPlan(), pack);
    const result = validate(plan, ctx);
    expect(result.plan.elements.some(element => element.id === 'e2')).toBe(true);
    expect(result.refusals.some(item => item.elementId === 'e2' && item.code === 'overlap_conflict')).toBe(
      false,
    );
  });

  it('fail-closes a cutaway with no assetId', () => {
    const pack = gabbyPack();
    const ctx = mediaContextFromPack(pack);
    const plan = fromCreativePlan(gabbyPlan(), pack);
    const result = validate(plan, ctx);
    expect(result.refusals.some(item => item.elementId === 'e4' && item.code === 'asset_missing')).toBe(
      true,
    );
  });

  it('logs requested_not_placed when the director omits a requested kind', () => {
    const pack = {...gabbyPack(), requestedEdits: ['zoom', 'depth_overlay']};
    const ctx = mediaContextFromPack(pack);
    const plan = fromCreativePlan(
      {
        ...gabbyPlan(),
        elements: gabbyPlan().elements.filter(element => element.kind !== 'zoom'),
      },
      pack,
    );
    const result = validate(plan, ctx);
    expect(result.log.some(entry => entry.code === 'requested_not_placed' && entry.detail.includes('zoom'))).toBe(
      true,
    );
  });
});

describe('assembler audit (Gabby)', () => {
  it('ships a faithful scheduled timeline: added and moved are empty', () => {
    const pack = gabbyPack();
    const ctx = mediaContextFromPack(pack);
    const draft = fromCreativePlan(gabbyPlan(), pack);
    const result = validate(draft, ctx);
    const scheduled = schedule(result.plan, ctx);
    const diff = auditPlanVsShipped({
      plan: draft,
      shipped: shippedFromScheduled(scheduled),
      scheduled,
      refusals: result.refusals,
      log: result.log,
    });
    expect(diff.added).toEqual([]);
    expect(diff.moved).toEqual([]);
    expect(diff.dropped.length).toBe(result.refusals.length);
    expect(result.refusals.some(item => item.elementId === 'e3' && item.code === 'needs_speaker_mask')).toBe(
      true,
    );
    expect(result.refusals.some(item => item.elementId === 'e4' && item.code === 'asset_missing')).toBe(
      true,
    );
    expect(result.plan.elements.some(element => element.id === 'e2')).toBe(true);
    expect(diff.dropped.some(item => item.id === 'e2')).toBe(false);
    for (const element of result.plan.elements) {
      const shipped = scheduled.elements.find(item => item.id === element.id);
      expect(shipped?.anchor).toEqual(element.anchor);
      expect(shipped?.params.anchor).toEqual(element.params.anchor);
    }
  });

  it('detects historical north-star dump defects as added and moved', () => {
    const pack = gabbyPack();
    const ctx = mediaContextFromPack(pack);
    const draft = fromCreativePlan(gabbyPlan(), pack);
    const result = validate(draft, ctx);
    const scheduled = schedule(result.plan, ctx);
    const dump = JSON.parse(
      readFileSync(path.join(DUMP, '04-blueprint-applied.json'), 'utf8'),
    ) as {
      hookTitle: string;
      hookStartSec: number;
      hookDurationSec: number;
      zooms: Array<{timestamp: number; durationSec?: number}>;
      brollClips: Array<{start: number; end: number}>;
      depthOverlays: Array<{start: number; end: number}>;
      insetReveals: Array<{start: number; end: number}>;
    };
    const diff = auditPlanVsShipped({
      plan: draft,
      shipped: shippedFromRenderTimeline({
        hookTitle: dump.hookTitle,
        hookStartSec: dump.hookStartSec,
        hookDurationSec: dump.hookDurationSec,
        zooms: dump.zooms,
        brollClips: dump.brollClips,
        depthOverlays: dump.depthOverlays,
        insetReveals: dump.insetReveals,
      }),
      scheduled,
      refusals: result.refusals,
      log: [],
    });
    expect(dump.brollClips.some(clip => clip.start < 4)).toBe(true);
    expect(dump.zooms).toEqual([]);
    expect(dump.depthOverlays.some(clip => clip.start === 8.6)).toBe(true);
    expect(diff.added.length).toBeGreaterThan(0);
    expect(diff.moved.length).toBeGreaterThan(0);
    expect(diff.added.some(item => item.kind === 'cutaway' && item.start < 4)).toBe(true);
    expect(diff.added.some(item => item.kind === 'depth_overlay')).toBe(true);
  });

  it('sends Gabby refusals to repair and does not reassign ub_1 without a director pass', async () => {
    const pack = gabbyPack();
    const compiled = await compileCreativePlan({
      pack,
      plan: gabbyPlan(),
      noRepair: true,
    });
    expect(compiled.assembler.repairUnresolved).toBeGreaterThan(0);
    expect(compiled.assembler.refusals.some(item => item.elementId === 'e3' && item.code === 'needs_speaker_mask')).toBe(
      true,
    );
    expect(compiled.assembler.refusals.some(item => item.elementId === 'e4' && item.code === 'asset_missing')).toBe(
      true,
    );
    expect(compiled.assembler.plan.discardedAssets.some(item => item.assetId === 'ub_1')).toBe(true);
    expect(compiled.plan.elements.some(element => element.userBrollId === 'ub_1' && element.kind === 'cutaway')).toBe(
      false,
    );
  });

  it('logs cold_open_not_applied instead of reordering', async () => {
    const pack = gabbyPack();
    const compiled = await compileCreativePlan({
      pack,
      plan: {
        ...gabbyPlan(),
        coldOpen: {
          use: true,
          sourceStartWordId: 'w44',
          sourceEndWordId: 'w53',
          howItReturns: 'hard cut back to w0',
        },
      },
      noRepair: true,
    });
    expect(compiled.assembler.log.some(entry => entry.code === 'cold_open_not_applied')).toBe(true);
    const hook = compiled.assembler.scheduled.find(element => element.id === 'e1');
    expect(hook?.anchor).toEqual({startWord: 'w0', endWord: 'w9'});
  });
});
