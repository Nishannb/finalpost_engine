/**
 * Phase 1.7.1: how long a generated BGM request may be.
 *
 * Product policy (not a provider fact): at most 60 s per generation, and one generation per edited video (bgmLedger.ts).
 * Conceptual rule: generatedDuration = min(60, max(providerMinimum, requiredMusicDuration [+ ending margin])), rounded UP to the provider's step.
 *
 * Provider facts are only what has been observed. The ONLY verified duration for `runware:ace-step@v1.5-base` is 60 s (the 2026-11-03 smoke and the
 * 2026-11-12 Phase 1.6 generation). Minimum, maximum, step and out-of-range behaviour are unknown, so the verified table is {min: 60, max: 60} and every
 * real request is 60 s. `generatedDurationSec` is implemented and tested against hypothetical tables only; it changes nothing live until a table with
 * real limits replaces VERIFIED_BGM_DURATION_CONSTRAINTS (after Runware's documentation and a supervised call verify them).
 *
 * No price is assumed anywhere here: billing follows compute time and is recorded per call from `includeCost`.
 */

/** Product cap per generation. A policy, not a claim about the provider. */
export const PRODUCT_MAX_BGM_SEC = 60;

export type ProviderDurationConstraints = {
  provider: 'runware';
  model: string;
  minSec: number;
  maxSec: number;
  /** Allowed increment; null = unknown (only meaningful when minSec === maxSec). */
  stepSec: number | null;
  evidence: string;
};

/** What has actually been observed. Equal to agents/music_specialist BGM_DURATION_SEC (tested). */
export const VERIFIED_BGM_DURATION_CONSTRAINTS: Readonly<ProviderDurationConstraints> = Object.freeze({
  provider: 'runware',
  model: 'runware:ace-step@v1.5-base',
  minSec: 60,
  maxSec: 60,
  stepSec: null,
  evidence: '60 s accepted twice: live smoke 2026-11-03 (models.py) and Phase 1.6 generation 2026-11-12 (60.000 s WAV). No other duration has been sent.',
});

/**
 * Proposed ending margin: the one Phase 1.6 bed went silent 4.77 s before its requested end. One observation, not a provider characteristic, so the
 * margin is INACTIVE: liveBgmDurationSec ignores it until it is re-measured at a verified shorter duration.
 */
export const ENDING_MARGIN_POLICY: Readonly<{proposedSec: number; active: false; evidence: string}> = Object.freeze({
  proposedSec: 6,
  active: false,
  evidence: 'Phase 1.6 bed (60 s request) silent from 55.23 s: one observation; scaling with requested duration unknown.',
});

export class DurationPolicyError extends Error {
  readonly code: 'invalid_required_duration' | 'invalid_constraints';
  constructor(code: 'invalid_required_duration' | 'invalid_constraints', detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function checkConstraints(c: ProviderDurationConstraints): void {
  const finite = [c.minSec, c.maxSec].every(value => Number.isFinite(value) && value > 0);
  if (!finite || c.minSec > c.maxSec) throw new DurationPolicyError('invalid_constraints', `min ${c.minSec} / max ${c.maxSec}`);
  if (c.stepSec !== null && !(Number.isFinite(c.stepSec) && c.stepSec > 0)) throw new DurationPolicyError('invalid_constraints', `step ${c.stepSec}`);
  // Unknown increments: only a single fixed value can be requested safely.
  if (c.stepSec === null && c.minSec !== c.maxSec) throw new DurationPolicyError('invalid_constraints', 'a duration range needs a known step');
  if (c.minSec > PRODUCT_MAX_BGM_SEC) throw new DurationPolicyError('invalid_constraints', `provider minimum ${c.minSec}s exceeds the ${PRODUCT_MAX_BGM_SEC}s product cap`);
}

/**
 * The duration rule against a given constraint table:
 *   target = required + margin; rounded UP to the step (on the grid starting at minSec); clamped to [minSec, min(60, maxSec)].
 * Pure. Used live only through liveBgmDurationSec (verified table, margin inactive).
 */
export function generatedDurationSec(input: {requiredSec: number; constraints: ProviderDurationConstraints; endingMarginSec?: number}): number {
  const {requiredSec, constraints} = input;
  const margin = input.endingMarginSec ?? 0;
  if (!(Number.isFinite(requiredSec) && requiredSec > 0)) throw new DurationPolicyError('invalid_required_duration', String(requiredSec));
  if (!(Number.isFinite(margin) && margin >= 0)) throw new DurationPolicyError('invalid_required_duration', `margin ${margin}`);
  checkConstraints(constraints);
  const upper = Math.min(PRODUCT_MAX_BGM_SEC, constraints.maxSec);
  const target = Math.max(constraints.minSec, requiredSec + margin);
  if (target >= upper) return round3(upper);
  if (constraints.stepSec === null) return round3(constraints.minSec); // min === max here
  const steps = Math.ceil((target - constraints.minSec) / constraints.stepSec - 1e-9);
  return round3(Math.min(upper, constraints.minSec + steps * constraints.stepSec));
}

/** The duration of a REAL request: the verified table, margin only if the policy were active (it is not). Always 60 today. */
export function liveBgmDurationSec(requiredSec: number): number {
  return generatedDurationSec({
    requiredSec,
    constraints: VERIFIED_BGM_DURATION_CONSTRAINTS,
    endingMarginSec: ENDING_MARGIN_POLICY.active ? ENDING_MARGIN_POLICY.proposedSec : 0,
  });
}
