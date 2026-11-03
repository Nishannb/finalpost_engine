/**
 * Repair-loop CONTRACT (prepared, inactive). Turns validation outcomes into structured diagnostics that a future repair
 * step could receive, and defines — as code — what a repair is allowed to change.
 *
 * Nothing here calls a model, and nothing in the pipeline invokes a repair from these types today: every diagnostic is
 * handled by `planRepair` as "drop with the reason" unless repair is explicitly enabled (it never is yet).
 *
 * Rules a repair can never break (enforced by `checkRepair`, tested offline):
 *  1. It cannot ADD an edit. Only flagged edits may change; unflagged edits stay byte-identical.
 *  2. It cannot change an edit's kind (that would be a new edit).
 *  3. It cannot supply visual evidence: a zoom `focus` is accepted only if `evaluateFocus` accepts it against the same
 *     visual context the original plan was validated with; no context, no focus.
 *  4. It cannot turn an optional edit into a required one (the required list may not grow).
 *  5. It does not bypass validation: the repaired plan must go through the same validators; `checkRepair` reports
 *     which diagnostics are still unresolved so the caller can drop those edits.
 */

import type {Refusal} from './assembler/types.ts';
import {classifyReason, type ReasonCategory} from './reasonRegistry.ts';
import type {EditLedger} from './editLedger.ts';
import {evaluateFocus, type VisualContext} from '../stages/directorV2/visualContext.ts';

export type DiagnosticCategory = ReasonCategory;

export type RepairAction = 'remove' | 'fix_parameter' | 'retime' | 'supply_text_from_transcript' | 'supply_listed_asset' | 'reformat_output';

export const FORBIDDEN_REPAIR_ACTIONS = ['add_edit', 'change_kind', 'invent_visual_evidence', 'set_focus_without_evidence', 'bypass_conflict_validation', 'make_optional_edit_required', 'change_unflagged_edit'] as const;

export type EditDiagnostic = {
  version: 1;
  /** Stable: same input → same id. */
  id: string;
  elementId: string | null;
  kind: string | null;
  /** Where the problem was found. */
  stage: string;
  code: string;
  category: DiagnosticCategory;
  message: string;
  repairable: boolean;
  allowedActions: RepairAction[];
  forbiddenActions: readonly string[];
  evidence?: {span?: {start: number; end: number}; conflictsWith?: string[]};
};

/** What a repair may do for each category. Prerequisites that cannot be created by editing (a mask, a frame) are never repairable. */
export const CATEGORY_POLICY: Record<DiagnosticCategory, {repairable: boolean; actions: RepairAction[]}> = {
  malformed_output: {repairable: true, actions: ['reformat_output']},
  unsupported_kind: {repairable: false, actions: ['remove']},
  missing_text_or_asset: {repairable: true, actions: ['supply_text_from_transcript', 'supply_listed_asset', 'remove']},
  missing_prerequisite: {repairable: false, actions: ['remove']},
  invalid_parameter: {repairable: true, actions: ['fix_parameter', 'retime', 'remove']},
  timeline_conflict: {repairable: true, actions: ['retime', 'remove']},
  editorial_policy: {repairable: false, actions: ['remove']},
  engine_limit: {repairable: false, actions: ['remove']},
};

const make = (input: {stage: string; code: string; message: string; elementId?: string | null; kind?: string | null; category: DiagnosticCategory; evidence?: EditDiagnostic['evidence']}): EditDiagnostic => ({
  version: 1,
  id: `${input.stage}:${input.elementId ?? 'plan'}:${input.code}`,
  elementId: input.elementId ?? null,
  kind: input.kind ?? null,
  stage: input.stage,
  code: input.code,
  category: input.category,
  message: input.message,
  repairable: CATEGORY_POLICY[input.category].repairable,
  allowedActions: [...CATEGORY_POLICY[input.category].actions],
  forbiddenActions: FORBIDDEN_REPAIR_ACTIONS,
  ...(input.evidence ? {evidence: input.evidence} : {}),
});

/** The model's output could not be parsed at all. */
export function diagnosticFromMalformedOutput(error: unknown): EditDiagnostic {
  return make({stage: 'parse', code: 'malformed_output', message: String((error as Error)?.message ?? error).slice(0, 300), category: 'malformed_output'});
}

/** v2 assembler refusals (`validate()`), by code. */
export function diagnosticsFromAssemblerRefusals(refusals: Refusal[], kindOf: (elementId: string) => string | null = () => null): EditDiagnostic[] {
  return refusals.map(refusal => {
    const known = classifyReason(refusal.code);
    return make({
      stage: 'assembler',
      code: refusal.code,
      message: refusal.message,
      elementId: refusal.elementId,
      kind: kindOf(refusal.elementId),
      // An unknown code is itself a defect: surface it as non-repairable engine_limit rather than guessing a category.
      category: known.registered && known.category ? known.category : 'engine_limit',
    });
  });
}

/** Planner/validator drops and rejections recorded on the ledger (the v1 path has no assembler). */
export function diagnosticsFromLedger(ledger: EditLedger): EditDiagnostic[] {
  const out: EditDiagnostic[] = [];
  for (const entry of ledger.entries()) {
    const last = entry.events.at(-1);
    if (!last || (last.decision !== 'dropped' && last.decision !== 'rejected')) {
      continue;
    }
    const known = classifyReason(last.reason);
    out.push(
      make({
        stage: last.stage,
        code: last.reason ?? 'unspecified',
        message: `${entry.type} ${last.decision} by ${last.stage}: ${last.reason ?? 'no reason recorded'}`,
        elementId: entry.id,
        kind: entry.type,
        category: known.registered && known.category ? known.category : 'engine_limit',
        evidence: {span: entry.proposed, ...(last.conflictsWith?.length ? {conflictsWith: last.conflictsWith} : {})},
      }),
    );
  }
  return out;
}

/**
 * Deterministic handling. With repair disabled (the only mode that exists today) nothing is sent anywhere: every
 * diagnostic stays a recorded drop. With it enabled, only repairable ones are offered, and policy-level and
 * prerequisite problems are never offered (they cannot be fixed by editing).
 */
export function planRepair(diagnostics: EditDiagnostic[], options: {repairEnabled: boolean} = {repairEnabled: false}): {toRepair: EditDiagnostic[]; dropped: EditDiagnostic[]} {
  if (!options.repairEnabled) {
    return {toRepair: [], dropped: [...diagnostics]};
  }
  return {toRepair: diagnostics.filter(item => item.repairable), dropped: diagnostics.filter(item => !item.repairable)};
}

/** Payload a future repair call would receive. Pure data; contains the constraints, never the permission to bypass them. */
export function buildRepairRequest(diagnostics: EditDiagnostic[]) {
  return {
    version: 1 as const,
    instructions: 'Change only the listed elements. Do not add elements, change kinds, add visual evidence, or change anything not listed.',
    forbidden: FORBIDDEN_REPAIR_ACTIONS,
    diagnostics: diagnostics.filter(item => item.repairable),
  };
}

// ---- guard on a repair RESULT ---------------------------------------------------------------------------------------

export type PlanElementLike = {id: string; kind: string; start?: number; end?: number; params?: Record<string, unknown>; focus?: {x: number; y: number}};

export type RepairViolation = {code: 'added_edit' | 'kind_changed' | 'unflagged_edit_changed' | 'focus_without_evidence' | 'required_list_grew'; elementId: string | null; detail: string};

export type RepairCheck = {violations: RepairViolation[]; unresolved: EditDiagnostic[]; accepted: boolean};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function checkRepair(input: {
  before: PlanElementLike[];
  after: PlanElementLike[];
  diagnostics: EditDiagnostic[];
  /** Same context the original plan was validated against; null when none was ever available. */
  visualContext?: VisualContext | null;
  requiredBefore?: string[];
  requiredAfter?: string[];
  /** Diagnostics produced by re-running the SAME validators on `after`. */
  revalidated?: EditDiagnostic[];
}): RepairCheck {
  const violations: RepairViolation[] = [];
  const flagged = new Set(input.diagnostics.map(item => item.elementId).filter((id): id is string => id !== null));
  const before = new Map(input.before.map(element => [element.id, element]));
  for (const element of input.after) {
    const previous = before.get(element.id);
    if (!previous) {
      violations.push({code: 'added_edit', elementId: element.id, detail: `${element.kind} ${element.id} did not exist before the repair`});
      continue;
    }
    if (previous.kind !== element.kind) {
      violations.push({code: 'kind_changed', elementId: element.id, detail: `${previous.kind} became ${element.kind}`});
    }
    if (!flagged.has(element.id) && !same(previous, element)) {
      violations.push({code: 'unflagged_edit_changed', elementId: element.id, detail: `${element.id} was not flagged but changed`});
    }
    const focus = element.focus ?? (element.params?.focus as {x: number; y: number} | undefined);
    const previousFocus = previous.focus ?? (previous.params?.focus as {x: number; y: number} | undefined);
    if (focus && !same(focus, previousFocus)) {
      const window = {start: element.start ?? 0, end: element.end ?? element.start ?? 0};
      const decision = evaluateFocus(input.visualContext, window, focus);
      if (!decision.ok) {
        violations.push({code: 'focus_without_evidence', elementId: element.id, detail: `focus ${JSON.stringify(focus)} refused: ${decision.reason}`});
      }
    }
  }
  const required = new Set(input.requiredBefore ?? []);
  for (const id of input.requiredAfter ?? []) {
    if (!required.has(id)) {
      violations.push({code: 'required_list_grew', elementId: null, detail: `${id} became required`});
    }
  }
  const stillThere = new Set(input.after.map(element => element.id));
  const unresolved = (input.revalidated ?? []).filter(item => item.elementId === null || stillThere.has(item.elementId));
  return {violations, unresolved, accepted: violations.length === 0};
}
