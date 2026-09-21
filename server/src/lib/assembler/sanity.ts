import type {MediaContext, Plan} from './types.ts';

export function sanityCheck(plan: Plan, ctx: MediaContext): string[] {
  const warnings: string[] = [];
  const placed = new Set(
    plan.elements
      .map(element => String(element.params.assetId ?? '').trim())
      .filter(Boolean),
  );
  const discarded = new Set(plan.discardedAssets.map(item => item.assetId));
  for (const candidate of ctx.candidates) {
    if (!placed.has(candidate.assetId) && !discarded.has(candidate.assetId)) {
      warnings.push(
        `sanity:candidate_unresolved:${candidate.assetId} is neither placed nor discarded.`,
      );
    }
  }
  const hook = plan.elements.find(element => element.kind === 'hook_title');
  if (!hook) {
    warnings.push('sanity:hook_missing Director did not place hook_title.');
  }
  const coverage = plan.elements.reduce((sum, element) => {
    void element;
    return sum;
  }, 0);
  void coverage;
  return warnings;
}

export function formatAssemblerTerminal(input: {
  refusals: Array<{elementId: string; code: string; message: string}>;
  log: Array<{code: string; detail: string; elementId?: string}>;
  sanity: string[];
  diff?: {moved: unknown[]; added: unknown[]; dropped: unknown[]};
}): string {
  const lines = ['--- assembler ---'];
  const requested = input.log.filter(entry => entry.code === 'requested_not_placed');
  const overrides = input.log.filter(entry => entry.code.startsWith('override:'));
  const coldOpen = input.log.filter(entry => entry.code === 'cold_open_not_applied');
  const repair = input.log.filter(
    entry => entry.code === 'repair_resolved' || entry.code === 'repair_unresolved',
  );
  if (
    input.refusals.length === 0 &&
    requested.length === 0 &&
    overrides.length === 0 &&
    coldOpen.length === 0
  ) {
    lines.push('No refusals.');
  }
  for (const refusal of input.refusals) {
    lines.push(`refusal ${refusal.code} ${refusal.elementId}: ${refusal.message}`);
  }
  for (const entry of requested) {
    lines.push(`requested_not_placed: ${entry.detail}`);
  }
  for (const entry of overrides) {
    lines.push(`${entry.code}: ${entry.detail}`);
  }
  for (const entry of coldOpen) {
    lines.push(`cold_open_not_applied: ${entry.detail}`);
  }
  for (const entry of repair) {
    lines.push(`${entry.code}: ${entry.detail}`);
  }
  for (const warning of input.sanity) {
    lines.push(warning);
  }
  if (input.diff) {
    lines.push(
      `audit moved=${input.diff.moved.length} added=${input.diff.added.length} dropped=${input.diff.dropped.length}`,
    );
  }
  return lines.join('\n');
}
