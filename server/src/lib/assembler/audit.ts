import type {
  DecisionLogEntry,
  DiffReport,
  ElementDiff,
  Plan,
  Refusal,
  ScheduledElement,
} from './types.ts';

const FRAME_SEC = 1 / 30;

export function auditPlanVsShipped(input: {
  plan: Plan;
  shipped: Array<{id: string; kind: string; start: number; end: number}>;
  scheduled: ScheduledElement[] | {elements: ScheduledElement[]};
  refusals: Refusal[];
  log: DecisionLogEntry[];
}): DiffReport {
  const scheduled = scheduledList(input.scheduled);
  const refusalById = new Map(input.refusals.map(item => [item.elementId, item]));
  const planned = input.plan.elements.map(element => toDiff(element));
  const scheduledById = new Map(scheduled.map(element => [element.id, element]));
  const shippedByKey = input.shipped.map(item => ({
    ...item,
    key: `${item.kind}:${item.start.toFixed(3)}:${item.end.toFixed(3)}`,
  }));
  const matches: ElementDiff[] = [];
  const moved: ElementDiff[] = [];
  const dropped: DiffReport['dropped'] = [];
  const usedShipped = new Set<number>();

  for (const element of input.plan.elements) {
    const scheduled = scheduledById.get(element.id);
    const plannedDiff = toDiff(element, scheduled);
    if (!scheduled) {
      const refusal = refusalById.get(element.id) ?? {
        elementId: element.id,
        code: 'params_invalid' as const,
        message: 'Dropped without a recorded refusal.',
      };
      dropped.push({...plannedDiff, refusal});
      continue;
    }
    const hit = shippedByKey.findIndex(
      (item, index) =>
        !usedShipped.has(index) &&
        item.kind === element.kind &&
        withinFrame(item.start, scheduled.resolved.start) &&
        withinFrame(item.end, scheduled.resolved.end),
    );
    if (hit >= 0) {
      usedShipped.add(hit);
      matches.push(plannedDiff);
      continue;
    }
    const sameKind = shippedByKey.findIndex(
      (item, index) => !usedShipped.has(index) && item.kind === element.kind,
    );
    if (sameKind >= 0) {
      usedShipped.add(sameKind);
      moved.push({
        ...plannedDiff,
        start: shippedByKey[sameKind]!.start,
        end: shippedByKey[sameKind]!.end,
      });
      continue;
    }
    const refusal = refusalById.get(element.id) ?? {
      elementId: element.id,
      code: 'params_invalid' as const,
      message: 'Planned element did not ship.',
    };
    dropped.push({...plannedDiff, refusal});
  }

  const added: ElementDiff[] = shippedByKey
    .filter((_, index) => !usedShipped.has(index))
    .map(item => ({
      id: item.id,
      kind: item.kind,
      start: item.start,
      end: item.end,
    }));

  return {
    planned: planned.length,
    shipped: input.shipped.length,
    matches,
    moved,
    dropped,
    added,
    overrides: input.log.filter(entry => entry.code.startsWith('override:')),
  };
}

export function shippedFromScheduled(
  scheduled: ScheduledElement[] | {elements: ScheduledElement[]},
): Array<{
  id: string;
  kind: string;
  start: number;
  end: number;
}> {
  return scheduledList(scheduled).map(element => ({
    id: element.id,
    kind: element.kind,
    start: element.resolved.start,
    end: element.resolved.end,
  }));
}

export function shippedFromRenderTimeline(input: {
  hookTitle?: string;
  hookStartSec?: number;
  hookDurationSec?: number;
  zooms?: Array<{timestamp?: number; start?: number; durationSec?: number; end?: number}>;
  clips?: Array<{start: number; end: number}>;
  brollClips?: Array<{start: number; end: number}>;
  depthOverlays?: Array<{start: number; end: number}>;
  insetReveals?: Array<{start: number; end: number}>;
  motionGraphics?: Array<{start: number; end: number}>;
}): Array<{id: string; kind: string; start: number; end: number}> {
  const shipped: Array<{id: string; kind: string; start: number; end: number}> = [];
  const hookStart = input.hookStartSec ?? 0;
  const hookEnd = hookStart + (input.hookDurationSec ?? 0);
  if (input.hookTitle?.trim() && hookEnd > hookStart) {
    shipped.push({id: 'render-hook', kind: 'hook_title', start: hookStart, end: hookEnd});
  }
  for (const [index, zoom] of (input.zooms ?? []).entries()) {
    const start = zoom.start ?? zoom.timestamp ?? 0;
    const end = zoom.end ?? start + (zoom.durationSec ?? 0);
    shipped.push({id: `render-zoom-${index}`, kind: 'zoom', start, end});
  }
  for (const [index, clip] of [...(input.clips ?? []), ...(input.brollClips ?? [])].entries()) {
    shipped.push({id: `render-cutaway-${index}`, kind: 'cutaway', start: clip.start, end: clip.end});
  }
  for (const [index, clip] of (input.depthOverlays ?? []).entries()) {
    shipped.push({
      id: `render-depth-${index}`,
      kind: 'depth_overlay',
      start: clip.start,
      end: clip.end,
    });
  }
  for (const [index, clip] of (input.insetReveals ?? []).entries()) {
    shipped.push({
      id: `render-inset-${index}`,
      kind: 'inset_reveal',
      start: clip.start,
      end: clip.end,
    });
  }
  for (const [index, clip] of (input.motionGraphics ?? []).entries()) {
    shipped.push({
      id: `render-motion-${index}`,
      kind: 'motion_graphic',
      start: clip.start,
      end: clip.end,
    });
  }
  return shipped;
}

export function reauditFinalTimeline(input: {
  draftPlan: Plan;
  scheduled: ScheduledElement[] | {elements: ScheduledElement[]};
  refusals: Refusal[];
  log: DecisionLogEntry[];
  render: Parameters<typeof shippedFromRenderTimeline>[0];
}): DiffReport {
  return auditPlanVsShipped({
    plan: input.draftPlan,
    shipped: shippedFromRenderTimeline(input.render),
    scheduled: input.scheduled,
    refusals: input.refusals,
    log: input.log,
  });
}

function scheduledList(
  scheduled: ScheduledElement[] | {elements: ScheduledElement[]},
): ScheduledElement[] {
  return Array.isArray(scheduled) ? scheduled : scheduled.elements;
}

function toDiff(element: {id: string; kind: string; anchor: {startWord: string; endWord: string}}, scheduled?: ScheduledElement): ElementDiff {
  return {
    id: element.id,
    kind: element.kind,
    startWord: element.anchor.startWord,
    endWord: element.anchor.endWord,
    start: scheduled?.resolved.start,
    end: scheduled?.resolved.end,
  };
}

function withinFrame(a: number, b: number): boolean {
  return Math.abs(a - b) <= FRAME_SEC + 1e-6;
}
