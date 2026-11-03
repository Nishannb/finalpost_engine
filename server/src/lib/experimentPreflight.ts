/**
 * Phase 36C: deterministic checks that need no provider call, run before the first paid request. Pure; the runner supplies the facts.
 * Credentials are reported by NAME only (a boolean per key), never by value. It never rejects a creative choice: it checks configuration and inputs.
 */
export type PreflightFacts = {
  keysPresent: Record<string, boolean>;
  caps: {geminiUsd: number; claudeUsd: number; geminiRequests: number; claudeRequests: number; groqRequests: number};
  /** USD per token from the engine's price table for the Claude model, or null when the model is unpriced. */
  claudePricePerToken: {input: number; output: number} | null;
  claudeModel: string;
  source: {exists: boolean; bytes: number; hasAudio: boolean; durationSec: number; maxDurationSec: number};
  requestedEdits: string[];
  /** Gemini requests the pipeline is expected to make at least once (content profile, occupancy, Director, motion Director). */
  minGeminiRequestsNeeded: number;
};

const positive = (value: number) => Number.isFinite(value) && value > 0;

export function preflightExperiment(facts: PreflightFacts): {ok: boolean; problems: string[]} {
  const problems: string[] = [];
  for (const [name, present] of Object.entries(facts.keysPresent)) {
    if (!present) problems.push(`required credential ${name} is not set`);
  }
  if (!facts.source.exists || facts.source.bytes <= 0) problems.push('source video is missing or empty');
  if (facts.source.exists && !facts.source.hasAudio) problems.push('source video has no audio track (the pipeline refuses it before transcription)');
  if (!positive(facts.source.durationSec)) problems.push('source duration is unknown');
  else if (facts.source.durationSec > facts.source.maxDurationSec) problems.push(`source is ${Math.round(facts.source.durationSec)} s; the limit is ${facts.source.maxDurationSec} s`);
  if (facts.requestedEdits.length === 0) problems.push('no edits requested');
  const {caps} = facts;
  for (const [name, value] of Object.entries(caps)) {
    if (!positive(value)) problems.push(`cap ${name} must be a positive finite number (got ${String(value)})`);
  }
  if (positive(caps.geminiRequests) && caps.geminiRequests < facts.minGeminiRequestsNeeded) problems.push(`Gemini request cap ${caps.geminiRequests} is below the ${facts.minGeminiRequestsNeeded} the pipeline needs; the run would be stopped part-way after spending`);
  if (!facts.claudePricePerToken || !positive(facts.claudePricePerToken.input) || !positive(facts.claudePricePerToken.output)) {
    problems.push(`Claude model "${facts.claudeModel}" has no usable price in the engine's table; a cost cannot be reserved before dispatch`);
  }
  return {ok: problems.length === 0, problems};
}

/**
 * Phase 36E: the part of the preflight that needs NOTHING that imports the logger (no price table from the worker, no ffprobe): credential presence, caps, the
 * source being a regular non-empty file, requested edits. Runs BEFORE the output directory is claimed, so a refusal creates and modifies nothing.
 * The full `preflightExperiment` (price, audio, duration) runs after the claim, once logging is directed to the run's own workspace.
 */
export function preflightStatic(facts: {
  keysPresent: Record<string, boolean>;
  caps: PreflightFacts['caps'];
  source: {exists: boolean; isFile: boolean; bytes: number};
  requestedEdits: string[];
  minGeminiRequestsNeeded: number;
}): {ok: boolean; problems: string[]} {
  const problems: string[] = [];
  for (const [name, present] of Object.entries(facts.keysPresent)) {
    if (!present) problems.push(`required credential ${name} is not set`);
  }
  if (!facts.source.exists || !facts.source.isFile || facts.source.bytes <= 0) problems.push('source is missing, not a regular file, or empty');
  if (facts.requestedEdits.length === 0) problems.push('no edits requested');
  for (const [name, value] of Object.entries(facts.caps)) {
    if (!positive(value)) problems.push(`cap ${name} must be a positive finite number (got ${String(value)})`);
  }
  if (positive(facts.caps.geminiRequests) && facts.caps.geminiRequests < facts.minGeminiRequestsNeeded) problems.push(`Gemini request cap ${facts.caps.geminiRequests} is below the ${facts.minGeminiRequestsNeeded} the pipeline needs`);
  return {ok: problems.length === 0, problems};
}
