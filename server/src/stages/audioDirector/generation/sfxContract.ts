/**
 * The SFX provider contract, verified against Runware's PUBLIC documentation on 2026-11-14 (no provider request was made). It is the only thing
 * that lets a LIVE transport generate SFX (runware.ts runGenerationJob `sfxContract`); without it a live SFX job is refused exactly as before.
 *
 * Sources (read 2026-11-14):
 *   - https://runware.ai/docs/models/mirelo-sfx-1-5  model `mirelo:1@1`, taskType `audioInference`, text-only via positivePrompt (2..3000 chars),
 *     duration 1..10 s (float, default 10), outputFormat MP3 (default) | WAV | FLAC | OGG, audioSettings forbidden with WAV, outputType URL,
 *     numberResults 1..4 DEFAULT 1, deliveryMethod sync (continues async past 120 s), includeCost -> `cost` (USD) in the response; response
 *     fields taskUUID, audioUUID, audioURL, seed, cost. Price: "$0.00025 per second of generated audio" (example: 6 s text-to-audio = $0.0015).
 *   - https://runware.ai/blog/your-ai-video-pipeline-is-silent-heres-the-fix  "$0.01 per second of output audio per sample"; "Mirelo is a
 *     commercial API with clear usage rights"; 2-4 samples per call (video-to-audio).
 *   - https://runware.ai/terms  section 2: "As between you and Runware, you own your Outputs"; Partner Models "permit you to use Outputs generated
 *     using those Partner Models for commercial purposes"; where a Model Licence conflicts, the Model Licence governs.
 *
 * Price: the two published figures differ 40x. The model documentation (consistent with its own example) is the expected price; the blog figure is
 * the CAP: every pre-payment check uses capUsdPerSecond x the billed provider duration (whole seconds, >= 1 s) x 1 result. The real cost is only ever
 * the provider-reported `cost`.
 *
 * Rights: commercial use is documented for Partner Models, and Runware describes Mirelo as commercial with clear usage rights, but no page names
 * Mirelo as a Partner Model or shows its Model Licence. `rightsConfirmed` therefore stays false here; assets are ingested with cleared: false and the
 * compiler refuses them (rights_not_cleared) until the product owner confirms the licence (MIRELO_USAGE_CONFIRMED below).
 */

export const VERIFIED_SFX_CONTRACT = Object.freeze({
  id: 'runware_mirelo_sfx_1_5_docs_2026_11_14',
  model: 'mirelo:1@1',
  taskType: 'audioInference',
  durationSec: Object.freeze({min: 1, max: 10}),
  outputFormat: 'WAV',
  numberResultsDefault: 1,
  expectedUsdPerSecond: 0.00025,
  capUsdPerSecond: 0.01,
  rightsConfirmed: false,
});
export type VerifiedSfxContract = typeof VERIFIED_SFX_CONTRACT;

/** Upper-bound cost of generating these provider durations (whole seconds), one result each. */
export const sfxCapUsd = (providerSeconds: readonly number[], contract: VerifiedSfxContract = VERIFIED_SFX_CONTRACT): number =>
  Math.round(providerSeconds.reduce((sum, sec) => sum + sec, 0) * contract.capUsdPerSecond * 1e6) / 1e6;
export const sfxExpectedUsd = (providerSeconds: readonly number[], contract: VerifiedSfxContract = VERIFIED_SFX_CONTRACT): number =>
  Math.round(providerSeconds.reduce((sum, sec) => sum + sec, 0) * contract.expectedUsdPerSecond * 1e6) / 1e6;

/** Usage for Mirelo assets: NOT cleared until the product owner confirms the Model Licence (then pass MIRELO_USAGE_CONFIRMED). */
export const MIRELO_USAGE_UNCONFIRMED = Object.freeze({
  cleared: false,
  licence: 'Runware mirelo:1@1 output. Runware Terms s.2: you own Outputs; commercial use documented for Partner Models; Mirelo Model Licence not yet confirmed',
  restriction: 'not placed in renders until the product owner confirms the Mirelo Model Licence',
});
export const MIRELO_USAGE_CONFIRMED = Object.freeze({
  cleared: true,
  licence: 'Runware mirelo:1@1 output (AI-generated). Runware Terms s.2: you own Outputs; commercial use confirmed by the product owner',
  restriction: 'none beyond the Runware Terms and the Mirelo Model Licence',
});

/** AUDIO_DIRECTOR_SFX_RIGHTS=mirelo_commercial_confirmed is the product owner's recorded confirmation (an operator setting; never inferred). */
export const sfxRightsConfirmed = (env: NodeJS.ProcessEnv = process.env): boolean => (env.AUDIO_DIRECTOR_SFX_RIGHTS ?? '').trim() === 'mirelo_commercial_confirmed';
