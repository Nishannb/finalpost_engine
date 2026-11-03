import {describe, expect, it} from 'vitest';

import {validate} from './assembler/legality.ts';
import {
  buildRepairRequest,
  checkRepair,
  diagnosticFromMalformedOutput,
  diagnosticsFromAssemblerRefusals,
  diagnosticsFromLedger,
  FORBIDDEN_REPAIR_ACTIONS,
  planRepair,
  type EditDiagnostic,
  type PlanElementLike,
} from './editDiagnostics.ts';
import {EditLedger} from './editLedger.ts';
import {buildVisualContext} from '../stages/directorV2/visualContext.ts';

const words = Array.from({length: 60}, (_, i) => ({id: `w${i}`, text: `word${i}`, start: i * 0.5, end: i * 0.5 + 0.4}));
const ctx = (mask: boolean) => ({durationSec: 30, words, capabilities: {speakerMask: mask ? 'available' : 'unavailable', occupancySource: 'detected', safeRegions: [], captionBand: {x: 0, y: 0.76, w: 1, h: 0.24}}, candidates: [{assetId: 'ub', source: 'user', description: 'x', durationSec: 8, suitability: 0.9}]}) as never;
const plan = (elements: Array<{id: string; kind: string; from: string; to: string; params?: Record<string, unknown>}>) =>
  ({thesis: 't', captions: {} as never, hookTitle: '', hookStyle: 'x' as never, discardedAssets: [], requestedEdits: [], elements: elements.map(e => ({id: e.id, kind: e.kind, anchor: {startWord: e.from, endWord: e.to}, reason: 'r', params: e.params ?? {}}))}) as never;

describe('diagnostics from assembler refusals: one category per failure class', () => {
  const run = (elements: Parameters<typeof plan>[0], mask = true) => diagnosticsFromAssemblerRefusals(validate(plan(elements), ctx(mask)).refusals);

  it.each([
    ['unsupported edit kind', [{id: 'a', kind: 'custom_scene', from: 'w14', to: 'w18'}], true, 'unknown_kind', 'unsupported_kind', false],
    ['missing required text', [{id: 'a', kind: 'kinetic_text', from: 'w14', to: 'w18', params: {text: ''}}], true, 'text_missing', 'missing_text_or_asset', true],
    ['missing asset', [{id: 'a', kind: 'cutaway', from: 'w14', to: 'w20'}], true, 'asset_missing', 'missing_text_or_asset', true],
    ['missing mask', [{id: 'a', kind: 'cutout', from: 'w14', to: 'w18'}], false, 'needs_speaker_mask', 'missing_prerequisite', false],
    ['out-of-range duration', [{id: 'a', kind: 'transition', from: 'w14', to: 'w24'}], true, 'duration_out_of_range', 'invalid_parameter', true],
    ['timeline conflict', [{id: 'a', kind: 'frame_inset', from: 'w14', to: 'w24'}, {id: 'b', kind: 'media_container', from: 'w16', to: 'w26'}], true, 'overlap_conflict', 'timeline_conflict', true],
  ] as const)('%s', (_name, elements, mask, code, category, repairable) => {
    const found = run(elements as never, mask).find(item => item.code === code)!;
    expect(found).toMatchObject({version: 1, code, category, repairable, stage: 'assembler'});
    expect(found.forbiddenActions).toEqual(FORBIDDEN_REPAIR_ACTIONS);
    expect(found.id).toBe(`assembler:${found.elementId}:${code}`);
  });

  it('a mask or visual prerequisite is never repairable and only allows removal', () => {
    const found = run([{id: 'a', kind: 'cutout', from: 'w14', to: 'w18'}], false)[0]!;
    expect(found.allowedActions).toEqual(['remove']);
  });

  it('is deterministic: same input, same diagnostics', () => {
    const elements = [{id: 'a', kind: 'cutaway', from: 'w14', to: 'w20'}, {id: 'b', kind: 'kinetic_text', from: 'w14', to: 'w18', params: {text: ''}}];
    expect(run(elements)).toEqual(run([...elements].reverse()).sort((x, y) => x.id.localeCompare(y.id)).sort((x, y) => run(elements).findIndex(i => i.id === x.id) - run(elements).findIndex(i => i.id === y.id)));
  });
});

describe('malformed output and ledger-derived diagnostics', () => {
  it('malformed output is repairable only by re-formatting', () => {
    const found = diagnosticFromMalformedOutput(new SyntaxError('Unexpected token } in JSON at position 41'));
    expect(found).toMatchObject({category: 'malformed_output', repairable: true, allowedActions: ['reformat_output'], stage: 'parse', elementId: null});
  });

  it('classifies planner drops: editorial policy, timeline conflict, invalid parameter, missing prerequisite', () => {
    const ledger = new EditLedger();
    const drop = (type: 'zoom' | 'cutaway' | 'frame_inset' | 'depth_overlay', start: number, stage: 'visual_director' | 'editorial_gate' | 'plan_assembly' | 'depth_planner', reason: string, kind: 'drop' | 'reject' = 'drop') => {
      const id = ledger.propose({type, stage: 'visual_director', start, end: start + 2, label: type});
      kind === 'drop' ? ledger.drop(id, stage, reason) : ledger.reject(id, stage, reason);
      return id;
    };
    drop('cutaway', 5, 'visual_director', 'not_in_edit_allowlist', 'reject');
    drop('zoom', 9, 'editorial_gate', 'zoom_blocked_by_cutaway_or_overlay');
    drop('frame_inset', 14, 'plan_assembly', 'shorter_than_3.2s_or_inside_hook_guard');
    drop('depth_overlay', 20, 'depth_planner', 'no_mask');
    const byCode = Object.fromEntries(diagnosticsFromLedger(ledger).map(item => [item.code, item]));
    expect(byCode.not_in_edit_allowlist).toMatchObject({category: 'editorial_policy', repairable: false});
    expect(byCode.zoom_blocked_by_cutaway_or_overlay).toMatchObject({category: 'timeline_conflict', repairable: true});
    expect(byCode['shorter_than_3.2s_or_inside_hook_guard']).toMatchObject({category: 'invalid_parameter', repairable: true});
    expect(byCode.no_mask).toMatchObject({category: 'missing_prerequisite', repairable: false});
  });

  it('an unregistered reason is surfaced as non-repairable engine_limit, never guessed', () => {
    const ledger = new EditLedger();
    const id = ledger.propose({type: 'zoom', stage: 'visual_director', start: 5, end: 7, label: 'zoom'});
    ledger.drop(id, 'editorial_gate', 'because_reasons');
    expect(diagnosticsFromLedger(ledger)[0]).toMatchObject({category: 'engine_limit', repairable: false});
  });

  it('surviving edits produce no diagnostics', () => {
    const ledger = new EditLedger();
    const id = ledger.propose({type: 'zoom', stage: 'visual_director', start: 5, end: 7, label: 'zoom'});
    ledger.accept(id, 'editorial_gate', {to: {start: 5, end: 7}});
    expect(diagnosticsFromLedger(ledger)).toEqual([]);
  });
});

describe('deterministic handling: validate first, repair never silently', () => {
  const ledger = new EditLedger();
  const a = ledger.propose({type: 'zoom', stage: 'visual_director', start: 5, end: 7, label: 'zoom'});
  ledger.drop(a, 'editorial_gate', 'zoom_blocked_by_cutaway_or_overlay');
  const b = ledger.propose({type: 'depth_overlay', stage: 'visual_director', start: 10, end: 14, label: 'd'});
  ledger.drop(b, 'depth_planner', 'no_mask');
  const diagnostics = diagnosticsFromLedger(ledger);

  it('with repair disabled (the default) everything stays a recorded drop and nothing is offered', () => {
    expect(planRepair(diagnostics)).toEqual({toRepair: [], dropped: diagnostics});
  });

  it('even when enabled, prerequisite and policy problems are never offered for repair', () => {
    const plan2 = planRepair(diagnostics, {repairEnabled: true});
    expect(plan2.toRepair.map(item => item.code)).toEqual(['zoom_blocked_by_cutaway_or_overlay']);
    expect(plan2.dropped.map(item => item.code)).toEqual(['no_mask']);
  });

  it('the repair request carries the constraints and only repairable items', () => {
    const request = buildRepairRequest(diagnostics);
    expect(request.forbidden).toEqual(FORBIDDEN_REPAIR_ACTIONS);
    expect(request.diagnostics.map(item => item.code)).toEqual(['zoom_blocked_by_cutaway_or_overlay']);
    expect(JSON.parse(JSON.stringify(request))).toEqual(request);
  });
});

describe('guard on a repair result (offline; the repair itself is not implemented)', () => {
  const before: PlanElementLike[] = [
    {id: 'z1', kind: 'zoom', start: 5, end: 7, params: {scale: 1.4}},
    {id: 'k1', kind: 'kinetic_text', start: 10, end: 14, params: {text: 'Hello there'}},
    {id: 'c1', kind: 'cutaway', start: 20, end: 26, params: {assetId: 'ub'}},
  ];
  const flagged = (ids: string[]): EditDiagnostic[] => ids.map(id => ({version: 1, id: `x:${id}:overlap_conflict`, elementId: id, kind: null, stage: 'assembler', code: 'overlap_conflict', category: 'timeline_conflict', message: 'm', repairable: true, allowedActions: ['retime', 'remove'], forbiddenActions: FORBIDDEN_REPAIR_ACTIONS}));
  const context = buildVisualContext({durationSec: 40, keepSegments: [], storyboardOutputSec: [], occupancy: [{outputSec: 6, occupancy: {speaker: {x: 0.3, y: 0.2, w: 0.4, h: 0.5}, source: 'vision'}}]});

  it('accepts a retime of a flagged edit and nothing else', () => {
    const after = before.map(item => (item.id === 'z1' ? {...item, start: 8, end: 10} : item));
    expect(checkRepair({before, after, diagnostics: flagged(['z1'])})).toMatchObject({accepted: true, violations: []});
  });

  it('rejects an added edit', () => {
    const after = [...before, {id: 'new', kind: 'emphasis', start: 30, end: 32}];
    expect(checkRepair({before, after, diagnostics: flagged(['z1'])}).violations).toEqual([expect.objectContaining({code: 'added_edit', elementId: 'new'})]);
  });

  it('rejects a changed kind and a changed unflagged edit', () => {
    const after = before.map(item => (item.id === 'z1' ? {...item, kind: 'frame_inset'} : item.id === 'k1' ? {...item, params: {text: 'Changed'}} : item));
    const codes = checkRepair({before, after, diagnostics: flagged(['z1'])}).violations.map(item => item.code).sort();
    expect(codes).toEqual(['kind_changed', 'unflagged_edit_changed']);
  });

  it('rejects an invented focus: no visual context, or a focus outside the observed subject', () => {
    const withFocus = (focus: {x: number; y: number}) => before.map(item => (item.id === 'z1' ? {...item, focus} : item));
    expect(checkRepair({before, after: withFocus({x: 0.5, y: 0.4}), diagnostics: flagged(['z1'])}).violations).toEqual([expect.objectContaining({code: 'focus_without_evidence'})]);
    expect(checkRepair({before, after: withFocus({x: 0.95, y: 0.95}), diagnostics: flagged(['z1']), visualContext: context}).violations).toEqual([expect.objectContaining({code: 'focus_without_evidence'})]);
    // supported by an observation near the window: allowed
    expect(checkRepair({before, after: withFocus({x: 0.5, y: 0.4}), diagnostics: flagged(['z1']), visualContext: context}).accepted).toBe(true);
  });

  it('rejects a repair that makes an optional edit required', () => {
    const result = checkRepair({before, after: before, diagnostics: [], requiredBefore: ['cutaway'], requiredAfter: ['cutaway', 'zoom']});
    expect(result.violations).toEqual([expect.objectContaining({code: 'required_list_grew'})]);
  });

  it('reports diagnostics that remain after re-validation as unresolved (the caller drops those edits)', () => {
    const still = flagged(['z1']);
    const result = checkRepair({before, after: before, diagnostics: flagged(['z1']), revalidated: still});
    expect(result.accepted).toBe(true);
    expect(result.unresolved.map(item => item.elementId)).toEqual(['z1']);
    expect(checkRepair({before, after: before.filter(item => item.id !== 'z1'), diagnostics: flagged(['z1']), revalidated: still}).unresolved).toEqual([]);
  });
});
