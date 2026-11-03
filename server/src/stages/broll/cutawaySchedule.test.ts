/**
 * Phase 24: pure scheduler rules, outcome classification, parser/fallback observability. No network, no model.
 */
import {describe, expect, it} from 'vitest';

import {env} from '../../config/env.ts';
import {classifyCutawayEntry, summarizeEditOutcomes} from '../../lib/cutawayOutcomes.ts';
import {EditLedger, type LedgerEntry} from '../../lib/editLedger.ts';
import {autoTrimSilence} from '../filters/autoTrim.ts';
import {parseVisualDirectorJson} from './geminiDirector.ts';
import {scheduleCutaways, type ScheduleClip, type ScheduleOptions} from './cutawaySchedule.ts';

const OPTIONS: ScheduleOptions = {minGapSec: 1.5, minClipSec: 1.6, maxRetimeSec: 7, maxDelayPastDirectedSec: 2.5, outputDurationSec: 30, tailGuardSec: 0, fitExtensionMaxSec: 1.0};
const clip = (id: string, start: number, end: number, directedStart = start, assetDurationSec?: number): ScheduleClip => ({id, start, end, directedStart, assetDurationSec});

describe('defaults (nothing changes unless the flag is turned on)', () => {
  it('the scheduling flag is legacy and the Phase 18 flags are unchanged', () => {
    expect(env.CUTAWAY_SCHEDULING).toBe('legacy');
    expect(env.HOOK_TITLE_POLICY).toBe('placeholder');
    expect(env.OCCUPANCY_CONTEXT_V2).toBe(false);
  });
});

describe('adjacent beats (test 1)', () => {
  it('three beats made adjacent by trimming are each accounted for: kept (delayed) or dropped with a named rule, never lost', () => {
    const decisions = scheduleCutaways([clip('a', 2, 5), clip('b', 5.08, 9.5, 5.2), clip('c', 9.58, 14, 9.7)], OPTIONS);
    expect(decisions.map(d => d.id)).toEqual(['a', 'b', 'c']);
    for (const d of decisions) {
      expect(Boolean(d.final) !== Boolean(d.drop)).toBe(true);
    }
    expect(decisions[0]!.final).toEqual({start: 2, end: 5});
    expect(decisions[1]!.final).toEqual({start: 6.502, end: 9.5});
    expect(decisions[1]!.adjustments).toEqual([expect.objectContaining({code: 'delayed_for_spacing', fromStart: 5.08, toStart: 6.502, afterClipId: 'a'})]);
    expect(decisions[2]!.final).toEqual({start: 11.002, end: 14});
    // the gap the legacy rule protects is still there between every kept pair
    const kept = decisions.filter(d => d.final).map(d => d.final!);
    for (let i = 1; i < kept.length; i += 1) {
      expect(kept[i]!.start - kept[i - 1]!.end).toBeGreaterThanOrEqual(1.5 - 1e-9);
    }
  });

  it('an earlier clip is shortened toward the 1.6 s floor only as far as a later beat needs, and the shortening is recorded', () => {
    // gap 3.2: b may start no later than min(directed + 2.5, window end - 1.6) = 12.4, so a must end by 12.4 - 3.2
    const decisions = scheduleCutaways([clip('a', 2, 10.5, 2.2), clip('b', 10.7, 14, 10.5)], {...OPTIONS, minGapSec: 3.2});
    expect(decisions[1]!.final!.start).toBeLessThanOrEqual(12.4 + 1e-9);
    expect(decisions[0]!.final!.end).toBeCloseTo(9.198, 3);
    expect(decisions[0]!.adjustments).toContainEqual(expect.objectContaining({code: 'shortened_for_next_beat', fromEnd: 10.5, nextClipId: 'b'}));
    expect(decisions[0]!.final!.end - decisions[0]!.final!.start).toBeGreaterThanOrEqual(1.6);
    expect(decisions[1]!.final!.start - decisions[0]!.final!.end).toBeGreaterThanOrEqual(3.2 - 1e-9);
  });

  it('a beat that cannot keep the gap and 1.6 s of picture is dropped with the legacy reason code AND the cause', () => {
    const [first, second] = scheduleCutaways([clip('a', 2, 5), clip('b', 5.1, 6.6)], OPTIONS);
    expect(first!.final).toEqual({start: 2, end: 5});
    expect(second!.final).toBeNull();
    expect(second!.drop).toMatchObject({reason: 'clip_within_1.5s_of_previous_clip', cause: 'no_room_after_delay', previousClipId: 'a'});
    expect(second!.drop!.detail).toContain('minimum 1.6s');
  });

  it('a delay past what the Director pointed at is refused (the gate\'s "never shift a cutaway later" principle), not silently applied', () => {
    const decisions = scheduleCutaways([clip('a', 2, 9, 2), clip('b', 3, 20, 3.2)], {...OPTIONS, minGapSec: 3.2});
    expect(decisions[1]!.drop).toMatchObject({cause: 'delay_exceeds_directed_limit', reason: 'clip_within_3.2s_of_previous_clip'});
  });

  it('keeps the planned time next to the final one (the plan is never overwritten)', () => {
    const [, b] = scheduleCutaways([clip('a', 2, 5), clip('b', 5.08, 9.5, 5.2)], OPTIONS);
    expect(b).toMatchObject({directedStart: 5.2, resolved: {start: 5.08, end: 9.5}, final: {start: 6.502, end: 9.5}});
  });

  it('never starts a clip a rounding error inside the gap the editorial gate checks', () => {
    const gate = (previousEnd: number, start: number, minGap: number) => start < previousEnd + minGap;
    const [a, b] = scheduleCutaways([clip('a', 6.625, 10.034, 6.925), clip('b', 10.114, 16.011, 11.296)], {...OPTIONS, minGapSec: 3.2});
    expect(gate(a!.final!.end, b!.final!.start, 3.2)).toBe(false);
  });

  it('is deterministic and independent of input order', () => {
    const input = [clip('c', 9.58, 14, 9.7), clip('a', 2, 5), clip('b', 5.08, 9.5, 5.2)];
    expect(scheduleCutaways(input, OPTIONS)).toEqual(scheduleCutaways([...input].reverse(), OPTIONS));
    expect(scheduleCutaways(input, OPTIONS)).toEqual(scheduleCutaways(input, OPTIONS));
  });
});

describe('asset duration (tests 3 and 4)', () => {
  it('a short asset is never played past its last frame: the window is cut to the asset (the renderer would loop it otherwise)', () => {
    const [d] = scheduleCutaways([clip('a', 10, 15.9, 10.2, 3)], OPTIONS);
    expect(d!.final).toEqual({start: 10, end: 13});
    expect(d!.adjustments).toEqual([{code: 'trimmed_to_asset_duration', fromEnd: 15.9, toEnd: 13, assetDurationSec: 3}]);
    expect(d!.final!.end - d!.final!.start).toBeLessThanOrEqual(3 + 1e-9);
  });

  it('an asset shorter than the minimum clip length is not capped (kept as the legacy loop) and that is recorded', () => {
    const [d] = scheduleCutaways([clip('a', 10, 13, 10, 1.2)], OPTIONS);
    expect(d!.final).toEqual({start: 10, end: 13});
    expect(d!.adjustments).toEqual([{code: 'asset_shorter_than_min_clip_looped', assetDurationSec: 1.2}]);
  });

  it('a slightly longer asset plays to its last frame when free space exists', () => {
    const [d] = scheduleCutaways([clip('a', 10, 14.2, 10, 5)], OPTIONS);
    expect(d!.final).toEqual({start: 10, end: 15});
    expect(d!.adjustments).toEqual([{code: 'extended_to_asset_end', fromEnd: 14.2, toEnd: 15, assetDurationSec: 5}]);
  });

  it('the extension never takes the gap the next clip needs, never passes the output end, and a refusal is recorded (not hidden)', () => {
    const near = scheduleCutaways([clip('a', 10, 14.2, 10, 5), clip('b', 16, 20, 16)], OPTIONS);
    expect(near[0]!.final).toEqual({start: 10, end: 14.2});
    expect(near[0]!.adjustments).toEqual([{code: 'truncated_to_beat', shownSec: 4.2, assetDurationSec: 5, limit: 'next_clip'}]);
    const atEnd = scheduleCutaways([clip('a', 26, 29.4, 26, 4.3)], OPTIONS);
    expect(atEnd[0]!.final).toEqual({start: 26, end: 29.4});
    expect(atEnd[0]!.adjustments[0]).toMatchObject({code: 'truncated_to_beat', limit: 'output_end'});
  });

  it('a much longer asset is not stretched over the next beat: truncated to the beat and recorded with the cap', () => {
    const [d] = scheduleCutaways([clip('a', 10, 13.4, 10, 5)], OPTIONS);
    expect(d!.final).toEqual({start: 10, end: 13.4});
    expect(d!.adjustments).toEqual([{code: 'truncated_to_beat', shownSec: 3.4, assetDurationSec: 5, limit: 'extension_cap'}]);
  });

  it('a clip with an unknown asset length (stock) is untouched by the asset rules', () => {
    const [d] = scheduleCutaways([clip('a', 10, 18)], OPTIONS);
    expect(d).toMatchObject({final: {start: 10, end: 18}, adjustments: []});
  });
});

describe('outcome classification (tests 6, 7, 8)', () => {
  const entry = (events: Array<Record<string, unknown>>, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
    id: 'cutaway@1000#abcdef', type: 'cutaway', source: 'visual_director', label: 'x', proposed: {start: 1, end: 1}, final: null, prerequisites: [], events: [{stage: 'visual_director', decision: 'proposed'}, ...events] as never, ...extra,
  });
  it.each([
    ['moment_planner', 'rejected', 'stock_disabled_or_unconfigured', 'asset_unavailable_or_unconfigured'],
    ['moment_planner', 'rejected', 'no_stock_video', 'asset_not_found'],
    ['moment_planner', 'rejected', 'no_asset_match', 'asset_not_found'],
    ['moment_planner', 'rejected', 'stock_lookup_failed', 'asset_unavailable_or_unconfigured'],
    ['plan_assembly', 'dropped', 'clip_within_1.5s_of_previous_clip', 'rejected_by_scheduling_rule'],
    ['moment_planner', 'rejected', 'speech_locked_moment_within_2.6s_of_previous', 'rejected_by_scheduling_rule'],
    ['moment_planner', 'rejected', 'hold_window_too_short', 'rejected_technical_constraint'],
    ['moment_planner', 'rejected', 'placement_9s_is_8s_from_directed_1s_limit_7s', 'rejected_technical_constraint'],
    ['visual_director', 'rejected', 'not_in_edit_allowlist', 'rejected_by_request_policy'],
    ['editorial_gate', 'dropped', 'some_unregistered_rule', 'dropped_unexpectedly'],
  ])('%s %s %s -> %s', (stage, decision, reason, outcome) => {
    const result = classifyCutawayEntry(entry([{stage, decision, reason, cause: 'c'}]));
    expect(result).toMatchObject({outcome, reason, stage, finalSpan: null, cause: 'c', evidence: 'pipeline_ledger'});
  });

  it('a cutaway with no recorded fate is unknown, never success', () => {
    expect(classifyCutawayEntry(entry([])).outcome).toBe('unknown_insufficient_evidence');
  });

  it('a missing asset can never be classified as in the blueprint, even if a later stage accepted something', () => {
    const lost = entry([{stage: 'moment_planner', decision: 'rejected', reason: 'no_stock_video'}, {stage: 'plan_assembly', decision: 'accepted', change: {to: {start: 1, end: 3}}}], {final: {start: 1, end: 3}});
    expect(classifyCutawayEntry(lost).outcome).toBe('asset_not_found');
  });

  it('an accepted cutaway is only "in the blueprint": as planned, or with modified timing when moved or adjusted', () => {
    const asPlanned = entry([{stage: 'moment_planner', decision: 'accepted'}], {final: {start: 1.2, end: 4}});
    expect(classifyCutawayEntry(asPlanned).outcome).toBe('in_blueprint_as_planned');
    const moved = entry([{stage: 'moment_planner', decision: 'accepted'}], {final: {start: 3, end: 6}});
    expect(classifyCutawayEntry(moved).outcome).toBe('in_blueprint_modified_timing');
    const delayed = entry([{stage: 'plan_assembly', decision: 'accepted', reason: 'cutaway_schedule:delayed_for_spacing,truncated_to_beat'}], {final: {start: 1.1, end: 4}});
    expect(classifyCutawayEntry(delayed)).toMatchObject({outcome: 'in_blueprint_modified_timing', adjustments: ['delayed_for_spacing', 'truncated_to_beat']});
    const noop = entry([{stage: 'renderer', decision: 'rendered', visibility: 'noop', reason: 'nothing_drawn'}], {final: {start: 1, end: 3}});
    expect(classifyCutawayEntry(noop)).toMatchObject({outcome: 'dropped_unexpectedly', stage: 'renderer'});
  });

  it('the report counts every cutaway and carries the parse and fallback facts that precede the ledger', () => {
    const ledger = new EditLedger();
    const id = ledger.propose({type: 'cutaway', stage: 'visual_director', start: 1, end: 1, label: 'a'});
    ledger.reject(id, 'moment_planner', 'stock_disabled_or_unconfigured', {cause: 'stock_disabled:user_assets_supplied'});
    ledger.propose({type: 'zoom', stage: 'visual_director', start: 5, end: 6, label: 'zoom'});
    const report = summarizeEditOutcomes(ledger.entries(), {scheduling: 'legacy', parseRejections: [{kind: 'zoom', index: 2, timestamp: 34.2, label: 'zoom', code: 'zoom_less_than_8s_after_previous_kept_zoom', detail: 'd'}], fallbackSubstitutions: ['zooms'], directorFallbackReason: null});
    expect(report.cutaways).toHaveLength(1);
    expect(report.counts).toEqual({asset_unavailable_or_unconfigured: 1});
    expect(report.cutaways[0]).toMatchObject({cause: 'stock_disabled:user_assets_supplied'});
    expect(report.evidence).toBe('pipeline_ledger_not_rendered_frames');
    expect(report.directorParseRejections).toHaveLength(1);
    expect(report.fallbackSubstitutions).toEqual(['zooms']);
  });
});

describe('a Director instruction dropped by parsing is recorded as such (test 8)', () => {
  const reply = JSON.stringify({
    hook_title: 'A Hook Title Here',
    moments: [
      {timestamp: 5, search_keyword: 'city', layout: 'cutaway', media: 'video'},
      {timestamp: 'x', search_keyword: 'bad time', layout: 'cutaway', media: 'video'},
      {timestamp: 99, search_keyword: 'after the end', layout: 'cutaway', media: 'video'},
      {timestamp: 8, search_keyword: 'sunset beach', layout: 'cutaway', media: 'video'},
    ],
    zooms: [{timestamp: 2.3, duration: 1.4}, {timestamp: 10, duration: 1.4}, {timestamp: 14, duration: 1.4}, {timestamp: 29.5, duration: 1.4}],
  });
  const parsed = parseVisualDirectorJson(reply, 30, 'hello world');
  it('names each discarded item with a machine code and the numbers behind it', () => {
    const codes = (parsed.parseRejections ?? []).map(item => `${item.kind}:${item.index}:${item.code}`);
    expect(codes).toEqual(expect.arrayContaining([
      'moment:1:moment_missing_keyword_or_timestamp', 'moment:2:moment_timestamp_outside_video',
      'zoom:0:zoom_before_3.5s', 'zoom:2:zoom_less_than_8s_after_previous_kept_zoom', 'zoom:3:zoom_within_0.8s_of_end',
    ]));
    expect(parsed.parseRejections!.find(item => item.code === 'zoom_less_than_8s_after_previous_kept_zoom')!.detail).toContain('minimum 8s');
    expect(parsed.zooms.map(zoom => zoom.timestamp)).toEqual([10]);
    expect(parsed.moments.map(moment => moment.timestamp)).not.toContain(99);
    expect(parsed.moments.map(moment => moment.searchKeyword)).toContain('sunset beach');
  });
  it('a clean reply carries no rejection key at all (existing shapes are unchanged)', () => {
    const clean = parseVisualDirectorJson(JSON.stringify({hook_title: 'A Hook Title Here', moments: [{timestamp: 5, search_keyword: 'sunset beach', layout: 'cutaway', media: 'video'}], zooms: [{timestamp: 10, duration: 1.4}]}), 30, 't');
    expect('parseRejections' in clean).toBe(false);
  });
});

describe('existing trim behaviour for the 1.3, 0.7 and 2.0 second pauses (test 10)', () => {
  const words: Array<{text: string; start: number; end: number}> = [];
  let t = 0.5;
  const speak = (n: number) => {
    for (let i = 0; i < n; i += 1) {
      words.push({text: `w${words.length}`, start: t, end: t + 0.3});
      t += 0.38;
    }
  };
  const pause = (sec: number) => {
    t = words.at(-1)!.end + sec;
  };
  speak(8); pause(0.35); speak(8); pause(1.3); speak(8); pause(0.7); speak(8); pause(2.0); speak(6);
  const end = words.at(-1)!.end + 0.6;
  const result = autoTrimSilence(words, {thresholdSec: env.SILENCE_THRESHOLD_SEC, paddingSec: env.SILENCE_PADDING_SEC, sourceDurationSec: end, removeFillers: true});
  it('cuts exactly the pauses above the threshold, keeps the 0.35 s one, and keeps 0.08 s of padding on each side', () => {
    // the first range is the lead-in silence and the last the tail; the pauses are the ranges between
    const gaps = result.trimExclusions.filter(range => range.start > 0 && range.end < end - 0.01);
    expect(gaps).toHaveLength(3);
    expect(gaps.map(range => Math.round((range.end - range.start + 0.16) * 100) / 100)).toEqual([1.3, 0.7, 2.0]);
    expect(result.trimExclusions.some(range => Math.abs(range.end - range.start + 0.16 - 0.35) < 0.02)).toBe(false);
  });
});
