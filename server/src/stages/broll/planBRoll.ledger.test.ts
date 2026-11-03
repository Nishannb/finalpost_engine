/**
 * Replays a SAVED Gemini visual-director response (the hi.mp4 relationship run) through the real
 * planner with stubbed stock, to check the edit ledger end to end. No model is called.
 */
import {describe, expect, it, vi} from 'vitest';

import {outcomeOf} from '../../lib/editLedger.ts';
import {parseVisualDirectorJson} from './geminiDirector.ts';
import {buildTimeline} from '../filters/timeline.ts';
import fixture from './__fixtures__/hi-director-replay.json' with {type: 'json'};
import type {VisualDirection} from './geminiDirector.ts';

const hoisted = vi.hoisted(() => ({extra: {} as Record<string, unknown>}));

vi.mock('./geminiDirector.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('./geminiDirector.ts')>();
  const saved = (await import('./__fixtures__/hi-director-replay.json', {with: {type: 'json'}})).default;
  return {
    ...actual,
    directorConfigured: () => true,
    planVisualDirection: async () => ({...saved.direction, ...hoisted.extra, hookSubtitle: '', estimatedCostUsd: 0, source: 'gemini'}) as unknown as VisualDirection,
  };
});

let nextId = 100;
vi.mock('./stockSearch.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('./stockSearch.ts')>();
  const asset = () => ({assetUrl: `https://stock.invalid/${nextId}.mp4`, provider: 'pexels' as const, providerId: nextId++, width: 1080, height: 1920, durationSec: 12, credit: 'x', creditUrl: ''});
  return {...actual, stockConfigured: () => true, findBRollAsset: async () => asset(), findPhotoAsset: async () => asset(), listBRollAssets: async () => [asset()]};
});

const {planBRoll} = await import('./brollPlanner.ts');

const duration = fixture.outputDurationSec;
const timeline = buildTimeline([{sourceStart: 0, sourceEnd: duration, outputStart: 0}] as never);
const captionWords = fixture.captionWords.map(word => ({...word, sentenceIndex: 0}));

const plan = (requestedEdits: string[] | null = null, extra: Record<string, unknown> = {}) =>
  planBRoll({
    transcript: fixture.transcript,
    sourceDurationSec: duration,
    timeline,
    words: captionWords as never,
    captionWords: captionWords as never,
    requestedEdits,
    ...extra,
  });

describe('planBRoll edit ledger (saved Director response, stubbed stock)', () => {
  it('registers every proposal with a stable id and gives each a final disposition', async () => {
    const result = await plan();
    const ledger = result.ledger!;
    const dump = ledger.toJSON();
    expect(dump.summary.proposedByType).toMatchObject({cutaway: 3, zoom: 2, inset_reveal: 1, kinetic_text: 1, emphasis: 1, hook_title: 1});
    // Deterministic ids: type @ proposed output start (ms) # content hash.
    expect(ledger.entries().map(entry => entry.id)).toEqual(expect.arrayContaining([expect.stringMatching(/^cutaway@20720#[0-9a-f]{6}$/), expect.stringMatching(/^inset_reveal@8380#[0-9a-f]{6}$/)]));
    const again = (await plan()).ledger!;
    expect(again.entries().map(entry => entry.id)).toEqual(ledger.entries().map(entry => entry.id));
    // Nothing is left as a bare proposal.
    expect(dump.edits.filter(entry => outcomeOf(entry) === 'proposed_only')).toEqual([]);
  });

  it('keeps each cutaway at the moment the Director asked for it instead of collapsing them onto the start (regression)', async () => {
    const result = await plan();
    const ledger = result.ledger!;
    const [first, second, third] = ledger.entries().filter(entry => entry.type === 'cutaway');
    // Before the fix every cutaway window began at 0 s (continuous speech = one "burst"), was pushed to the hook guard (≈4.2 s)
    // and the later cutaways were then dropped as overlaps. Now each stays within a few seconds of the requested time.
    expect(first!.proposed.start).toBeCloseTo(20.72, 2);
    expect(first!.final!.start).toBeGreaterThan(20);
    expect(Math.abs(first!.final!.start - first!.proposed.start)).toBeLessThanOrEqual(7);
    expect(third!.final!.start).toBeGreaterThan(30);
    expect(Math.abs(third!.final!.start - third!.proposed.start)).toBeLessThanOrEqual(7);
    expect(result.clips.map(clip => clip.start)).toEqual([first!.final!.start, third!.final!.start]);
    // The second really overlaps the first (8 s hold), and the ledger names that rule and the winner.
    expect(outcomeOf(second!)).toBe('dropped');
    expect(second!.events.at(-1)).toMatchObject({stage: 'plan_assembly', reason: 'clip_within_1.5s_of_previous_clip', conflictsWith: [first!.id], precision: 'exact'});
    // The earlier inset reveal is no longer lost to a cutaway that had been dragged on top of it.
    const inset = ledger.entries().find(entry => entry.type === 'inset_reveal')!;
    expect(inset.events.filter(event => event.decision === 'dropped')).toEqual([]);
    expect(result.insetReveals).toHaveLength(1);
    // The zoom at 6.3 s is untouched; the one at 39.8 s is inside a cutaway and the gate says so.
    const blocked = ledger.entries().find(entry => entry.type === 'zoom' && entry.proposed.start > 30)!;
    expect(blocked.events.at(-1)).toMatchObject({stage: 'editorial_gate', decision: 'dropped', reason: 'zoom_blocked_by_cutaway_or_overlay'});
  });

  it('never loses an edit without a stage and a reason', async () => {
    const ledger = (await plan()).ledger!;
    for (const entry of ledger.entries().filter(item => ['dropped', 'rejected'].includes(outcomeOf(item)))) {
      expect(entry.events.at(-1)!.stage).toBeTruthy();
      expect(entry.events.at(-1)!.reason).toBeTruthy();
    }
  });

  it('rejects toolkits the request did not allow, and puts frame_inset on the plan and dumps', async () => {
    const result = await plan(['captions', 'zoom']);
    const ledger = result.ledger!;
    const lost = ledger.entries().filter(entry => outcomeOf(entry) === 'rejected' && entry.events.at(-1)!.reason === 'not_in_edit_allowlist');
    expect(lost.map(entry => entry.type).sort()).toEqual(expect.arrayContaining(['cutaway', 'emphasis', 'inset_reveal', 'kinetic_text']));
    expect(result.frameInsets).toEqual([]);
    expect(result.ledger!.entries().every(entry => entry.events[0]!.decision === 'proposed')).toBe(true);
  });

  it('carries frame_inset from the Director response through the ledger, the plan and the parser', async () => {
    const response = JSON.stringify({topic: 't', hook_title: 'Hook words here', frame_insets: [{start: 20, end: 24.5, scale: 0.5, margin_color: '#2A1620', corner_radius: 20, transition_sec: 0.8}]});
    const parsed = parseVisualDirectorJson(response, duration, fixture.transcript);
    expect(parsed.frameInsets).toEqual([expect.objectContaining({start: 20, end: 24.5, scale: 0.7, marginColor: '#2A1620'})]);
    hoisted.extra = {frameInsets: parsed.frameInsets};
    try {
      const result = await plan();
      expect(result.frameInsets).toHaveLength(1);
      const entry = result.ledger!.entries().find(item => item.type === 'frame_inset')!;
      expect(entry.proposed).toEqual({start: 20, end: 24.5});
      expect(entry.events.map(event => [event.stage, event.decision])).toEqual([
        ['visual_director', 'proposed'],
        ['plan_assembly', 'accepted'],
      ]);
    } finally {
      hoisted.extra = {};
    }
  });

  it('shows depth_overlay is dropped at planning for want of a subject mask, with the exact reason', async () => {
    hoisted.extra = {depthOverlays: [{start: 20, end: 24, assetId: '', direction: 'up', reason: 'a reference image behind the speaker', searchKeyword: 'city skyline', queries: ['city skyline'], opacity: 0.75}]};
    try {
      const result = await plan(null, {speakerCutout: {available: false, keyColor: '#000000', similarity: 0.12, blend: 0.06}});
      const entry = result.ledger!.entries().find(item => item.type === 'depth_overlay')!;
      expect(entry.prerequisites).toEqual([{name: 'subject_mask_available', satisfied: false}]);
      expect(result.depthOverlays).toEqual([]);
      expect(outcomeOf(entry)).toBe('dropped');
      expect(entry.events.at(-1)).toMatchObject({stage: 'depth_planner', reason: 'no_mask', precision: 'exact'});
    } finally {
      hoisted.extra = {};
    }
  });

  it('passes the profile context flag through to the Director stage', async () => {
    const withBlock = (await plan(null, {contentProfileBlock: 'CONTENT PROFILE\n- art direction (warm intimate): accent #FFB88C'})).ledger!;
    expect(withBlock.toJSON().stageContext.visual_director).toEqual({profile: true, theme: true});
    expect((await plan()).ledger!.toJSON().stageContext.visual_director).toEqual({profile: false, theme: false});
  });

  describe('execution contracts (Phase 10A)', () => {
    const inset = fixture.direction.insetReveals[0]!;
    const only = (extra: Record<string, unknown>) => ({moments: [], zooms: [], insetReveals: [], motionGraphics: [], semanticEmphasis: [], mediaContainers: [], frameInsets: [], depthOverlays: [], ...extra});
    const withDirection = async (extra: Record<string, unknown>, run: () => Promise<void>) => {
      hoisted.extra = extra;
      try {
        await run();
      } finally {
        hoisted.extra = {};
      }
    };
    const frame = (start: number, end: number) => ({start, end, scale: 0.86, marginColor: '#222222', cornerRadius: 18, transitionSec: 0.9});

    it('maps frame insets to OUTPUT time before the inset planner sees them (trimmed timeline)', async () => {
      // Source 10–50 s is kept, so source time T is output time T-10. The frame inset sits at source 30–35 (output 20–25).
      // The inset reveal at source 40–44 is output 30–34 and does NOT touch it. The old code compared the reveal's
      // output span with the frame inset's SOURCE span (30–35) and wrongly dropped the reveal.
      const trimmed = buildTimeline([{sourceStart: 10, sourceEnd: 50, outputStart: 0}] as never);
      await withDirection(only({frameInsets: [frame(30, 35)], insetReveals: [{...inset, start: 40, end: 44}]}), async () => {
        const result = await planBRoll({transcript: fixture.transcript, sourceDurationSec: 50, timeline: trimmed, words: captionWords as never, captionWords: captionWords as never, requestedEdits: null});
        expect(result.frameInsets.map(item => [item.start, item.end])).toEqual([[20, 25]]);
        // The planner snaps the reveal to word boundaries, so allow a fraction of a second around output 30–34.
        expect(result.insetReveals).toHaveLength(1);
        expect(Math.abs(result.insetReveals[0]!.start - 30)).toBeLessThan(0.5);
        const ledger = result.ledger!;
        expect(ledger.entries().find(entry => entry.type === 'frame_inset')!.final).toEqual({start: 20, end: 25});
        expect(ledger.entries().find(entry => entry.type === 'inset_reveal')!.events.some(event => event.decision === 'dropped')).toBe(false);
      });
    });

    it('and still resolves a real output-time overlap, by priority, with the winner named', async () => {
      const trimmed = buildTimeline([{sourceStart: 10, sourceEnd: 50, outputStart: 0}] as never);
      // Reveal asked for first (source 28–32 → output 18–22), frame inset second (source 30–35 → output 20–25).
      await withDirection(only({frameInsets: [frame(30, 35)], insetReveals: [{...inset, start: 28, end: 32}]}), async () => {
        const result = await planBRoll({transcript: fixture.transcript, sourceDurationSec: 50, timeline: trimmed, words: captionWords as never, captionWords: captionWords as never, requestedEdits: null});
        const ledger = result.ledger!;
        const lostFrame = ledger.entries().find(entry => entry.type === 'frame_inset')!;
        const keptReveal = ledger.entries().find(entry => entry.type === 'inset_reveal')!;
        expect(result.insetReveals).toHaveLength(1);
        expect(result.frameInsets).toEqual([]);
        expect(lostFrame.events.at(-1)).toMatchObject({stage: 'plan_assembly', decision: 'dropped', reason: 'overlaps_inset_reveal_equal_rank_directed_earlier', conflictsWith: [keptReveal.id], precision: 'exact'});
      });
    });

    it('does not let a cutaway automatically beat a frame inset the Director asked for earlier', async () => {
      // Frame inset asked at 18–24 s; the first cutaway at 20.7 s lands on 23.6–31.6 s. The earlier request wins.
      await withDirection({frameInsets: [frame(18, 24)], insetReveals: []}, async () => {
        const result = await plan();
        const ledger = result.ledger!;
        const cut = ledger.entries().find(entry => entry.type === 'cutaway')!;
        const framed = ledger.entries().find(entry => entry.type === 'frame_inset')!;
        expect(result.frameInsets.map(item => item.start)).toEqual([18]);
        expect(cut.events.at(-1)).toMatchObject({stage: 'plan_assembly', decision: 'dropped', reason: 'overlaps_frame_inset_equal_rank_directed_earlier', conflictsWith: [framed.id]});
        expect(result.clips.map(clip => clip.start)).toEqual([37.58]);
        // The cut's transition goes with it; the surviving cut keeps its own.
        expect(result.transitions.map(transition => transition.at)).toEqual([37.58]);
      });
    });

    it('keeps a frame inset and a cutaway together when they do not overlap', async () => {
      await withDirection({frameInsets: [frame(8, 12)], insetReveals: []}, async () => {
        const result = await plan();
        expect(result.frameInsets.map(item => item.start)).toEqual([8]);
        expect(result.clips).toHaveLength(2);
      });
    });

    it('merges a Director transition with the engine one at the same cut and records rejected ones', async () => {
      await withDirection({transitions: [{start: 23.7, end: 24.1, style: 'film burn'}, {start: 10, end: 13, style: 'ink'}]}, async () => {
        const result = await plan();
        const ledger = result.ledger!;
        expect(result.transitions.map(transition => transition.at)).toEqual([23.7, 37.58]);
        const directedOk = ledger.entries().find(entry => entry.type === 'transition' && entry.source === 'visual_director' && entry.proposed.start === 23.7)!;
        const directedBad = ledger.entries().find(entry => entry.type === 'transition' && entry.source === 'visual_director' && entry.proposed.start === 10)!;
        const engineSuperseded = ledger.entries().find(entry => entry.type === 'transition' && entry.source === 'plan_assembly' && entry.proposed.start === 23.62)!;
        expect(outcomeOf(directedOk)).toBe('accepted_not_rendered');
        expect(directedBad.events.at(-1)).toMatchObject({decision: 'rejected', reason: 'transition_duration_3s_outside_0.2_0.8s'});
        expect(engineSuperseded.events.at(-1)).toMatchObject({decision: 'dropped', reason: 'superseded_by_director_transition', conflictsWith: [directedOk.id]});
      });
    });

    it('records a frame inset in the hook zone at the one place that enforces the guard (parse no longer drops it silently)', async () => {
      const parsed = parseVisualDirectorJson(JSON.stringify({topic: 't', hook_title: 'Hook words here', frame_insets: [{start: 2.5, end: 7}], media_containers: [{start: 3.2, end: 8}]}), duration, fixture.transcript);
      expect(parsed.frameInsets).toHaveLength(1);
      expect(parsed.mediaContainers).toHaveLength(1);
      await withDirection(only({frameInsets: parsed.frameInsets, mediaContainers: parsed.mediaContainers}), async () => {
        const result = await plan();
        expect(result.frameInsets).toEqual([]);
        expect(result.mediaContainers).toEqual([]);
        for (const type of ['frame_inset', 'media_container'] as const) {
          const entry = result.ledger!.entries().find(item => item.type === type)!;
          expect(entry.events.at(-1)).toMatchObject({stage: 'plan_assembly', decision: 'dropped', precision: 'exact'});
          expect(entry.events.at(-1)!.reason).toMatch(/inside_hook_guard/);
        }
      });
    });

    it('aligns Director v2 moments against output-time words on a trimmed timeline (resolveMoment v2 path)', async () => {
      // Source 10–50 s is kept: output t = source t - 10. Output-time words carry the keyword at 20.0 s.
      const outputWords = Array.from({length: 38}, (_, i) => ({text: i === 20 ? 'sunset' : `w${i}`, start: i, end: i + 0.4, sentenceIndex: 0}));
      const sourceWords = outputWords.map(word => ({...word, start: word.start + 10, end: word.end + 10}));
      const trimmed = buildTimeline([{sourceStart: 10, sourceEnd: 48, outputStart: 0}] as never);
      const moment = {timestamp: 20.2, searchKeyword: 'sunset', media: 'video', layout: 'cutaway', anchor: 'top_right', overlayText: '', textStyle: 'outline', accentColor: '#FFFFFF', visualWeight: 'accent', queries: ['sunset']};
      await withDirection(only({moments: [moment]}), async () => {
        const result = await planBRoll({transcript: 'sunset', sourceDurationSec: 38, timeline: trimmed, words: sourceWords as never, captionWords: outputWords as never, requestedEdits: null, directorV2: true});
        expect(result.clips).toHaveLength(1);
        expect(Math.abs(result.clips[0]!.start - 20)).toBeLessThan(0.5);
        const entry = result.ledger!.entries().find(item => item.type === 'cutaway')!;
        expect(entry.proposed.start).toBeCloseTo(20.2, 2);
        expect(Math.abs(entry.final!.start - 20.2)).toBeLessThan(0.5);
      });
    });

    it('marks transitions renderGenerated only when GENERATED_TRANSITIONS_ENABLED is on (default off keeps legacy output)', async () => {
      const { env } = await import('../../config/env.ts');
      const off = await plan();
      expect(env.GENERATED_TRANSITIONS_ENABLED).toBe(false);
      expect(off.transitions.length).toBeGreaterThan(0);
      expect(off.transitions.every(transition => !('renderGenerated' in transition))).toBe(true);
      (env as { GENERATED_TRANSITIONS_ENABLED: boolean }).GENERATED_TRANSITIONS_ENABLED = true;
      try {
        const on = await plan();
        expect(on.transitions.map(transition => transition.at)).toEqual(off.transitions.map(transition => transition.at));
        expect(on.transitions.every(transition => transition.renderGenerated === true)).toBe(true);
      } finally {
        (env as { GENERATED_TRANSITIONS_ENABLED: boolean }).GENERATED_TRANSITIONS_ENABLED = false;
      }
    });

    it('refuses a placement that would land on a different spoken moment instead of moving it', async () => {
      // 7.6 s of unbroken speech ending at the keyword; the old window began at the start of the run, 7.4 s earlier.
      const words = [
        ...Array.from({length: 20}, (_, i) => ({text: `pre${i}`, start: i * 1.5, end: i * 1.5 + 0.4, sentenceIndex: 0})),
        ...Array.from({length: 16}, (_, i) => ({text: i === 14 ? 'ocean' : `run${i}`, start: 30 + i * 0.48, end: 30 + i * 0.48 + 0.46, sentenceIndex: 0})),
      ];
      const duration = 40;
      const line = buildTimeline([{sourceStart: 0, sourceEnd: duration, outputStart: 0}] as never);
      await withDirection(only({moments: [{timestamp: 37.3, searchKeyword: 'ocean', media: 'video', layout: 'cutaway', anchor: 'top_right', overlayText: '', textStyle: 'outline', accentColor: '#FFFFFF', visualWeight: 'accent', queries: ['ocean']}]}), async () => {
        const result = await planBRoll({transcript: 'ocean', sourceDurationSec: duration, timeline: line, words: words as never, captionWords: words as never, requestedEdits: null});
        const entry = result.ledger!.entries().find(item => item.type === 'cutaway')!;
        expect(result.clips).toEqual([]);
        expect(entry.events.at(-1)).toMatchObject({stage: 'moment_planner', decision: 'rejected'});
        expect(result.warnings.some(warning => warning.startsWith('moment_refused:ocean:placement_'))).toBe(true);
        expect(result.warnings.some(warning => warning.startsWith('no_match:'))).toBe(false);
        expect(entry.events.at(-1)!.reason).toMatch(/^placement_30s_is_\d+(\.\d+)?s_from_directed_37\.3s_limit_7s$/);
      });
    });
  });
});
