import {describe, expect, it} from 'vitest';

import {EditLedger, outcomeOf, stableEditId, summarizeLedger} from './editLedger.ts';

describe('edit ledger ids', () => {
  it('are stable for the same proposal and differ when type, start or content differ', () => {
    expect(stableEditId('emphasis', 13.4, 'True Presence')).toBe(stableEditId('emphasis', 13.4, 'true presence'));
    expect(stableEditId('emphasis', 13.4, 'x')).not.toBe(stableEditId('kinetic_text', 13.4, 'x'));
    expect(stableEditId('emphasis', 13.4, 'x')).not.toBe(stableEditId('emphasis', 13.5, 'x'));
    expect(stableEditId('emphasis', 13.4, 'x')).toMatch(/^emphasis@13400#[0-9a-f]{6}$/);
  });

  it('suffixes a collision instead of overwriting', () => {
    const ledger = new EditLedger();
    const a = ledger.propose({type: 'zoom', stage: 'visual_director', start: 5, end: 6.2});
    const b = ledger.propose({type: 'zoom', stage: 'visual_director', start: 5, end: 6.2});
    expect(b).toBe(`${a}-2`);
    expect(ledger.entries()).toHaveLength(2);
  });
});

describe('edit ledger lifecycle', () => {
  const lifecycle = () => {
    const ledger = new EditLedger();
    const id = ledger.propose({type: 'emphasis', stage: 'visual_director', start: 13.98, end: 16.38, label: 'True Presence', reason: 'key phrase'});
    return {ledger, id};
  };

  it('records proposed → accepted (with a change) → rendered on one entry', () => {
    const {ledger, id} = lifecycle();
    ledger.accept(id, 'plan_assembly', {from: {start: 13.98, end: 16.38}, to: {start: 13.4, end: 15.8}});
    ledger.rendered(id, 'SemanticEmphasisTrack');
    const entry = ledger.get(id)!;
    expect(entry.events.map(event => [event.stage, event.decision])).toEqual([
      ['visual_director', 'proposed'],
      ['plan_assembly', 'accepted'],
      ['renderer', 'rendered'],
    ]);
    expect(entry.final).toEqual({start: 13.4, end: 15.8});
    expect(entry.proposed).toEqual({start: 13.98, end: 16.38});
    expect(outcomeOf(entry)).toBe('rendered');
  });

  it('distinguishes the five ways an edit can fail to appear', () => {
    const ledger = new EditLedger();
    const make = (label: string) => ledger.propose({type: 'inset_reveal', stage: 'visual_director', start: 20, end: 25, label});
    const failed = make('a');
    ledger.reject(failed, 'inset_planner', 'too_short');
    const dropped = make('b');
    ledger.accept(dropped, 'inset_planner');
    ledger.drop(dropped, 'plan_assembly', 'overlap', {conflictsWith: ['cutaway@4240#abc']});
    const stuck = make('c');
    ledger.accept(stuck, 'inset_planner');
    const noop = make('d');
    ledger.accept(noop, 'inset_planner');
    ledger.rendered(noop, 'DepthOverlayTrack', 'noop', 'no_mask');
    const fine = make('e');
    ledger.accept(fine, 'inset_planner');
    ledger.rendered(fine, 'InsetRevealTrack');
    expect([failed, dropped, stuck, noop, fine].map(id => outcomeOf(ledger.get(id)!))).toEqual([
      'rejected',
      'dropped',
      'accepted_not_rendered',
      'rendered_not_apparent',
      'rendered',
    ]);
    expect(ledger.get(dropped)!.events.at(-1)).toMatchObject({decision: 'dropped', reason: 'overlap', conflictsWith: ['cutaway@4240#abc'], precision: 'exact'});
    expect(ledger.get(dropped)!.final).toBeNull();
  });

  it('refuses events for an unknown id', () => {
    expect(() => new EditLedger().drop('nope', 'blueprint', 'x')).toThrow(/unknown edit id/);
  });
});

describe('edit ledger summary', () => {
  it('counts by type, reason, renderer and conflict class, and carries context flags', () => {
    const ledger = new EditLedger();
    ledger.setProfile({present: true, contentType: 'relationship_emotional'});
    ledger.noteStageContext('visual_director', {profile: true, theme: false});
    ledger.noteTrackTheme('SemanticEmphasisTrack', true);
    const a = ledger.propose({type: 'emphasis', stage: 'visual_director', start: 1, end: 2, label: 'a'});
    const b = ledger.propose({type: 'emphasis', stage: 'visual_director', start: 5, end: 6, label: 'b'});
    const c = ledger.propose({type: 'cutaway', stage: 'visual_director', start: 9, end: 12, label: 'c'});
    ledger.accept(a, 'conflict_validator', {reason: 'spatial_text_overlap', conflictsWith: ['x'], to: {start: 1, end: 1.5}});
    ledger.rendered(a, 'SemanticEmphasisTrack');
    ledger.drop(b, 'conflict_validator', 'temporal_occluded_by_fullscreen');
    ledger.drop(c, 'editorial_gate', 'overlapping_clips_dropped', {precision: 'stage_warnings'});
    const dump = ledger.toJSON();
    expect(dump.summary.proposedByType).toEqual({emphasis: 2, cutaway: 1});
    expect(dump.summary.acceptedByType).toEqual({emphasis: 1});
    expect(dump.summary.lostByTypeAndReason).toEqual({emphasis: {temporal_occluded_by_fullscreen: 1}, cutaway: {overlapping_clips_dropped: 1}});
    expect(dump.summary.reachedRendererByTrack).toEqual({SemanticEmphasisTrack: 1});
    expect(dump.summary.conflicts).toEqual({temporal: 0 + 1, spatial: 1});
    expect(dump.summary.profilePresent).toBe(true);
    expect(dump.summary.trackTheme).toEqual({SemanticEmphasisTrack: true});
    expect(dump.stageContext.visual_director).toEqual({profile: true, theme: false});
    expect(summarizeLedger(ledger.entries()).outcomes.dropped).toBe(2);
  });
});
