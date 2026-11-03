import {describe, expect, it} from 'vitest';

import fixture from '../stages/broll/__fixtures__/hi-director-replay.json' with {type: 'json'};
import {outcomeOf} from './editLedger.ts';
import {backfillLedger, type SavedDirectorResponse, type SavedVisualPlan} from './ledgerBackfill.ts';

// The engine plan the same run saved (03-engine-visual-plan.json): 1 cutaway, 2 zooms, no inset reveal.
const savedPlan: SavedVisualPlan = {
  hookTitle: 'The Quietest Moments Speak Loudest',
  zooms: [{timestamp: 22.52, durationSec: 1.2}, {timestamp: 39.24, durationSec: 1.2}],
  clips: [{start: 4.24, end: 12.24, keyword: 'couple quiet sunset'}],
  overlays: [],
  insetReveals: [],
  transitions: [{at: 4.24}],
  motionGraphics: [{start: 13.4, end: 16.48, text: 'True presence opens real connection'}],
  semanticEmphasis: [{start: 13.4, end: 15.8, text: 'true presence'}],
  warnings: ['overlapping_clips_dropped', 'drop:inset_0:overlap'],
};

describe('backfilled ledger for runs saved before the ledger existed', () => {
  const dump = backfillLedger(fixture.direction as unknown as SavedDirectorResponse, savedPlan);
  const byType = (type: string) => dump.edits.filter(entry => entry.type === type);

  it('matches what survived and reports what vanished, without inventing a cause', () => {
    const cutaways = byType('cutaway');
    expect(cutaways.map(outcomeOf)).toEqual(['rendered', 'dropped', 'dropped']);
    expect(cutaways[0]!.final).toEqual({start: 4.24, end: 12.24});
    for (const lost of cutaways.slice(1)) {
      expect(lost.events.at(-1)).toMatchObject({decision: 'dropped', precision: 'stage_warnings'});
      expect(lost.events.at(-1)!.reason).toContain('unknown_cause_not_recorded');
      expect(lost.events.at(-1)!.reason).toContain('overlapping_clips_dropped');
    }
    // The planner's per-item code is exact, and the surviving cutaway occupies the inset's window.
    const inset = byType('inset_reveal')[0]!;
    expect(outcomeOf(inset)).toBe('dropped');
    expect(inset.events.at(-1)).toMatchObject({stage: 'inset_planner', reason: 'overlap', precision: 'exact', conflictsWith: [cutaways[0]!.id]});
    expect(outcomeOf(byType('emphasis')[0]!)).toBe('rendered');
  });

  it('keeps the proposal span and the time shift between Director and plan visible', () => {
    const zoom = byType('zoom').find(entry => entry.proposed.start === 39.82)!;
    expect(zoom.final).toEqual({start: 39.24, end: 40.44});
    expect(dump.summary.proposedByType).toMatchObject({cutaway: 3, zoom: 2, inset_reveal: 1, kinetic_text: 1, emphasis: 1});
    // The 6.3 s zoom fell inside the cutaway and has no counterpart in the plan.
    expect(outcomeOf(byType('zoom').find(entry => entry.proposed.start === 6.3)!)).toBe('dropped');
  });
});
