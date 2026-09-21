import {resolveWordRange} from '../../stages/directorV2/perception.ts';
import {TOOL_MANIFESTS} from './manifests.ts';
import {
  ASSET_SUITABILITY_THRESHOLD,
  isFrozenToolKind,
  parsePriority,
  type DecisionLogEntry,
  type MediaContext,
  type Plan,
  type PlanElement,
  type Refusal,
  type ToolKind,
  type Word,
} from './types.ts';

export type ValidateResult = {
  plan: Plan;
  refusals: Refusal[];
  log: DecisionLogEntry[];
};

type Resolved = {start: number; end: number; startIndex: number; endIndex: number};

export function validate(plan: Plan, ctx: MediaContext): ValidateResult {
  const refusals: Refusal[] = [];
  const log: DecisionLogEntry[] = [];
  const kept: PlanElement[] = [];
  const resolved = new Map<string, Resolved>();
  const wordIndex = new Map(ctx.words.map((word, index) => [word.id, index]));

  for (const requested of plan.requestedEdits) {
    if (!plan.elements.some(element => kindMatchesRequest(element.kind, requested))) {
      log.push({
        stage: 'validate',
        code: 'requested_not_placed',
        detail: `Requested ${requested} was not placed by the director.`,
      });
    }
  }

  for (const element of plan.elements) {
    if (!isFrozenToolKind(element.kind)) {
      refusals.push({
        elementId: element.id,
        code: 'unknown_kind',
        message: `Kind ${element.kind} is not in the frozen tool set.`,
      });
      continue;
    }
    const range = resolveRange(element, ctx.words);
    if (!range) {
      refusals.push({
        elementId: element.id,
        code: 'params_invalid',
        message: `Word ids ${element.anchor.startWord}–${element.anchor.endWord} do not resolve.`,
      });
      continue;
    }
    const startIndex = wordIndex.get(element.anchor.startWord);
    const endIndex = wordIndex.get(element.anchor.endWord);
    if (startIndex == null || endIndex == null || startIndex > endIndex) {
      refusals.push({
        elementId: element.id,
        code: 'params_invalid',
        message: `startWord ${element.anchor.startWord} is after endWord ${element.anchor.endWord}.`,
      });
      continue;
    }
    resolved.set(element.id, {...range, startIndex, endIndex});
    kept.push(element);
  }

  const afterSchema: PlanElement[] = [];
  for (const element of kept) {
    const kind = element.kind as ToolKind;
    const manifest = TOOL_MANIFESTS[kind];
    const window = resolved.get(element.id)!;
    if (manifest.requires.speakerMask && ctx.capabilities.speakerMask !== 'available') {
      refusals.push({
        elementId: element.id,
        code: 'needs_speaker_mask',
        message: `${kind} needs a real speaker-mask alpha video.`,
        suggestion: kind === 'depth_overlay' ? 'cutaway' : null,
      });
      continue;
    }
    if (manifest.requires.safeRegion && ctx.capabilities.safeRegions.length === 0) {
      refusals.push({
        elementId: element.id,
        code: 'no_safe_region',
        message: `${kind} needs a safe region; occupancy has none.`,
      });
      continue;
    }
    afterSchema.push(element);
    void window;
  }

  const afterDuration: PlanElement[] = [];
  const countByKind = new Map<string, number>();
  const coverageByKind = new Map<string, number>();
  for (const element of afterSchema) {
    const kind = element.kind as ToolKind;
    const manifest = TOOL_MANIFESTS[kind];
    const window = resolved.get(element.id)!;
    const hold = window.end - window.start;
    if (
      (manifest.minDurationSec != null && hold + 1e-6 < manifest.minDurationSec) ||
      (manifest.maxDurationSec != null && hold - 1e-6 > manifest.maxDurationSec)
    ) {
      refusals.push({
        elementId: element.id,
        code: 'duration_out_of_range',
        message: `${kind} hold ${hold.toFixed(2)}s is outside ${manifest.minDurationSec ?? 0}–${manifest.maxDurationSec ?? '∞'}s.`,
      });
      continue;
    }
    if (manifest.hookGuardSec != null && window.start < manifest.hookGuardSec) {
      refusals.push({
        elementId: element.id,
        code: 'duration_out_of_range',
        message: `${kind} starts at ${window.start.toFixed(2)}s inside the ${manifest.hookGuardSec}s hook guard.`,
      });
      continue;
    }
    if (
      manifest.tailGuardSec != null &&
      window.end > ctx.durationSec - manifest.tailGuardSec + 1e-6
    ) {
      refusals.push({
        elementId: element.id,
        code: 'duration_out_of_range',
        message: `${kind} ends inside the ${manifest.tailGuardSec}s tail guard.`,
      });
      continue;
    }
    const used = (countByKind.get(kind) ?? 0) + 1;
    if (manifest.maxPerVideo != null && used > manifest.maxPerVideo) {
      refusals.push({
        elementId: element.id,
        code: 'coverage_exceeded',
        message: `${kind} exceeds maxPerVideo ${manifest.maxPerVideo}.`,
      });
      continue;
    }
    const coverage = (coverageByKind.get(kind) ?? 0) + hold / Math.max(ctx.durationSec, 0.1);
    if (manifest.maxCoverage != null && coverage > manifest.maxCoverage + 1e-6) {
      refusals.push({
        elementId: element.id,
        code: 'coverage_exceeded',
        message: `${kind} coverage ${(coverage * 100).toFixed(0)}% exceeds ${(manifest.maxCoverage * 100).toFixed(0)}%.`,
      });
      continue;
    }
    countByKind.set(kind, used);
    coverageByKind.set(kind, coverage);
    afterDuration.push(element);
  }

  const afterAssets: PlanElement[] = [];
  const byId = new Map(ctx.candidates.map(item => [item.assetId, item]));
  for (const element of afterDuration) {
    const kind = element.kind as ToolKind;
    const assetId = String(element.params.assetId ?? '').trim();
    if (kind === 'cutaway' || kind === 'depth_overlay') {
      if (!assetId) {
        refusals.push({
          elementId: element.id,
          code: 'asset_missing',
          message: `${kind} has no assetId.`,
        });
        continue;
      }
    }
    if (assetId) {
      const candidate = byId.get(assetId);
      if (!candidate) {
        refusals.push({
          elementId: element.id,
          code: 'asset_missing',
          message: `Asset ${assetId} is not in the candidate list.`,
        });
        continue;
      }
      const score = candidate.suitability ?? ASSET_SUITABILITY_THRESHOLD;
      if (score < ASSET_SUITABILITY_THRESHOLD && !element.reason.trim()) {
        refusals.push({
          elementId: element.id,
          code: 'asset_unsuitable',
          message: `Asset ${assetId} suitability ${score.toFixed(2)} is below ${ASSET_SUITABILITY_THRESHOLD} and has no director reason.`,
        });
        continue;
      }
    }
    afterAssets.push(element);
  }

  const afterCheck: PlanElement[] = [];
  const byKind = new Map<string, PlanElement[]>();
  for (const element of afterAssets) {
    const kind = element.kind as ToolKind;
    const manifest = TOOL_MANIFESTS[kind];
    const window = resolved.get(element.id)!;
    const peers = byKind.get(kind) ?? [];
    if (manifest.minGapSec != null) {
      const tooClose = peers.some(peer => {
        const other = resolved.get(peer.id)!;
        const gap = window.start >= other.end ? window.start - other.end : other.start - window.end;
        return gap < manifest.minGapSec! - 1e-6;
      });
      if (tooClose) {
        refusals.push({
          elementId: element.id,
          code: 'duration_out_of_range',
          message: `${kind} is closer than the ${manifest.minGapSec}s gap.`,
        });
        continue;
      }
    }
    peers.push(element);
    byKind.set(kind, peers);
    afterCheck.push(element);
  }

  const winners = new Set<string>();
  const losers = new Set<string>();
  for (let i = 0; i < afterCheck.length; i += 1) {
    const a = afterCheck[i]!;
    const aKind = a.kind as ToolKind;
    const aManifest = TOOL_MANIFESTS[aKind];
    const aWindow = resolved.get(a.id)!;
    for (let j = i + 1; j < afterCheck.length; j += 1) {
      const b = afterCheck[j]!;
      const bKind = b.kind as ToolKind;
      const bManifest = TOOL_MANIFESTS[bKind];
      if (
        !aManifest.conflictsWith.includes(bKind) &&
        !bManifest.conflictsWith.includes(aKind)
      ) {
        continue;
      }
      const bWindow = resolved.get(b.id)!;
      if (!rangesOverlap(aWindow, bWindow)) {
        continue;
      }
      const winner = pickWinner(a, b, i, j);
      const loser = winner.id === a.id ? b : a;
      losers.add(loser.id);
      winners.add(winner.id);
      refusals.push({
        elementId: loser.id,
        code: 'overlap_conflict',
        message: `${loser.kind} ${loser.id} overlaps ${winner.kind} ${winner.id}.`,
      });
    }
  }

  const finalElements = afterCheck.filter(element => !losers.has(element.id));
  return {
    plan: {
      ...plan,
      elements: finalElements,
      discardedAssets: discardedAfterRefusals(plan, finalElements, refusals),
    },
    refusals,
    log,
  };
}

function discardedAfterRefusals(
  plan: Plan,
  kept: PlanElement[],
  refusals: Refusal[],
): Array<{assetId: string; reason: string}> {
  const keptIds = new Set(
    kept
      .map(element => String(element.params.assetId ?? '').trim())
      .filter(Boolean),
  );
  const discarded = [...plan.discardedAssets];
  const already = new Set(discarded.map(item => item.assetId));
  const refusalById = new Map(refusals.map(item => [item.elementId, item]));
  for (const element of plan.elements) {
    const assetId = String(element.params.assetId ?? '').trim();
    if (!assetId || keptIds.has(assetId) || already.has(assetId)) {
      continue;
    }
    const refusal = refusalById.get(element.id);
    discarded.push({
      assetId,
      reason: refusal
        ? `Removed with ${element.id} (${refusal.code}): ${refusal.message}`
        : `Director placed ${assetId} on ${element.id}, which did not ship.`,
    });
    already.add(assetId);
  }
  return discarded;
}

function resolveRange(element: PlanElement, words: Word[]) {
  return resolveWordRange(
    words.map(word => ({
      id: word.id,
      text: word.text,
      start: word.start,
      end: word.end,
      sentenceId: 's0',
    })),
    element.anchor.startWord,
    element.anchor.endWord,
    Number(element.params.preRollMs ?? 0) || 0,
    Number(element.params.postRollMs ?? 0) || 0,
  );
}

function rangesOverlap(
  a: {start: number; end: number},
  b: {start: number; end: number},
): boolean {
  return a.start < b.end && b.start < a.end;
}

function pickWinner(
  a: PlanElement,
  b: PlanElement,
  aIndex: number,
  bIndex: number,
): PlanElement {
  const aPriority = parsePriority(a.priority);
  const bPriority = parsePriority(b.priority);
  if (aPriority != null && bPriority != null && aPriority !== bPriority) {
    return aPriority > bPriority ? a : b;
  }
  if (aPriority != null && bPriority == null) {
    return a;
  }
  if (bPriority != null && aPriority == null) {
    return b;
  }
  return aIndex <= bIndex ? a : b;
}

function kindMatchesRequest(kind: string, requested: string): boolean {
  if (kind === requested) {
    return true;
  }
  if (requested === 'broll' || requested === 'b-roll') {
    return kind === 'cutaway';
  }
  return false;
}
