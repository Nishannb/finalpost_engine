/**
 * WP8E: the OFFLINE rubric for polish runs. PURE: no env, no logger, no I/O, no model call. It turns the roadmap's human rubric into checks a machine can make from what a run already records
 * (warnings, the final element kinds, the generated graphics and where each came from, the caption plan, the graphics status), so the first authorized polish run (Credit Gate 1) is judged the same
 * way every time. It does NOT judge looks: pacing, taste, caption-over-mouth and "clearly better than raw for social" stay human checks (see the report).
 *
 * The input is a small summary, either written by hand (fixtures) or built from a run with `polishRubricInputFromRun` (the run log / blueprint `stats.warnings`, the Director dump's plan, the
 * blueprint's generated graphics). Checks (each `{id, ok, detail}`; `pass` is all of them):
 *   edit_look_present         a known look id is recorded, or the fallback look was chosen AND warned (`edit_look_fallback:minimal_captions`)
 *   no_matte_kinds_unusable   when a `matte_gate:unusable:*` warning exists, no cutout / depth_overlay element survives
 *   graphics_provenance       every generated graphic says where it came from (`library` or `claude`), by field or by matching `motion_graphic:*` warnings
 *   look_allowlist            every surviving element kind is in the chosen look's allowlist, and the designed graphics do not exceed its cap
 *   captions_present          a caption plan exists (or the look is the explicit minimal one)
 *   library_only_honest       status `library_only` means no Claude provenance and no `motion_graphic:claude` warning (operators are never told Claude ran when it did not)
 *   profile_markers           optional: the polish fingerprint key, the speech-cuts marker and the profile name, each checked only when provided
 */
import {EDIT_LOOK_IDS, EDIT_LOOKS, FALLBACK_LOOK_ID, MATTE_DEPENDENT_KINDS} from '../stages/directorV2/editLooks.ts';

export type RubricGraphic = {id: string; provenance?: 'library' | 'claude'; compositionId?: string};

export type PolishRubricInput = {
  profile?: string;
  editLook?: {id: string; fellBack?: boolean} | null;
  warnings: string[];
  /** The element kinds of the final edit (the Director plan's kinds after the look enforcement). */
  elementKinds: string[];
  generatedGraphics: RubricGraphic[];
  captionPresent: boolean;
  /** The job's graphics status (`off`, `on`, `skipped_budget`, `library_only`), when known. */
  graphicsStatus?: string;
  /** Optional markers; each is checked only when given. */
  speechCutsApplied?: boolean;
  fingerprintKey?: string;
};

export type RubricCheck = {id: string; ok: boolean; detail: string};
export type RubricResult = {pass: boolean; checks: RubricCheck[]};

export const POLISH_FINGERPRINT_KEY = 'edit-profile:polish-v1';

const check = (id: string, ok: boolean, detail: string): RubricCheck => ({id, ok, detail});
const starts = (warnings: readonly string[], prefix: string) => warnings.filter(warning => warning.startsWith(prefix));

export function evaluatePolishRubric(input: PolishRubricInput): RubricResult {
  const warnings = input.warnings ?? [];
  const lookId = input.editLook?.id ?? '';
  const look = EDIT_LOOKS.find(entry => entry.id === lookId);
  const checks: RubricCheck[] = [];

  // 1. a look was chosen (or the fallback was, and said so)
  const fallbackWarned = warnings.includes(`edit_look_fallback:${FALLBACK_LOOK_ID}`);
  if (look && !input.editLook?.fellBack) checks.push(check('edit_look_present', true, `look ${look.id}`));
  else if (look && look.id === FALLBACK_LOOK_ID && input.editLook?.fellBack && fallbackWarned) checks.push(check('edit_look_present', true, `fallback to ${FALLBACK_LOOK_ID}, warned`));
  else if (look && input.editLook?.fellBack) checks.push(check('edit_look_present', false, `fell back to ${look.id} but edit_look_fallback:${FALLBACK_LOOK_ID} was not warned`));
  else checks.push(check('edit_look_present', false, lookId ? `unknown look "${lookId}" (known: ${EDIT_LOOK_IDS.join(', ')})` : 'no edit look recorded'));

  // 2. no matte-dependent element survives an unusable matte
  const unusable = starts(warnings, 'matte_gate:unusable:');
  const matteKinds = input.elementKinds.filter(kind => (MATTE_DEPENDENT_KINDS as readonly string[]).includes(kind));
  checks.push(
    unusable.length === 0
      ? check('no_matte_kinds_unusable', true, 'the matte gate did not report an unusable matte')
      : check('no_matte_kinds_unusable', matteKinds.length === 0, matteKinds.length === 0 ? `${unusable[0]}; no cutout / depth_overlay kept` : `${unusable[0]} but kept: ${matteKinds.join(', ')}`),
  );

  // 3. every graphic says where it came from
  const libraryWarnings = starts(warnings, 'motion_graphic:library:').filter(warning => !warning.startsWith('motion_graphic:library_miss'));
  const claudeWarnings = warnings.filter(warning => warning === 'motion_graphic:claude');
  if (input.generatedGraphics.length === 0) checks.push(check('graphics_provenance', true, 'no generated graphics'));
  else {
    const byField = input.generatedGraphics.every(graphic => graphic.provenance === 'library' || graphic.provenance === 'claude');
    const byWarnings = libraryWarnings.length + claudeWarnings.length === input.generatedGraphics.length;
    checks.push(check('graphics_provenance', byField || byWarnings, byField ? `${input.generatedGraphics.length} graphic(s) with a provenance field` : byWarnings ? `${libraryWarnings.length} library + ${claudeWarnings.length} claude warning(s) match ${input.generatedGraphics.length} graphic(s)` : `${input.generatedGraphics.length} graphic(s) but ${libraryWarnings.length + claudeWarnings.length} provenance warning(s) and no per-graphic field`));
  }

  // 4. the look's allowlist and graphic cap hold for what survived
  if (!look) checks.push(check('look_allowlist', false, 'no known look to check against'));
  else {
    const allowed = new Set<string>(look.allowedElementKinds);
    const illegal = input.elementKinds.filter(kind => !allowed.has(kind));
    const graphicKinds = new Set<string>(look.graphicKinds);
    const graphics = input.elementKinds.filter(kind => graphicKinds.has(kind)).length;
    const ok = illegal.length === 0 && graphics <= look.maxGraphics;
    checks.push(check('look_allowlist', ok, illegal.length > 0 ? `illegal under ${look.id}: ${[...new Set(illegal)].join(', ')}` : graphics > look.maxGraphics ? `${graphics} designed graphics exceed the ${look.id} cap of ${look.maxGraphics}` : `all ${input.elementKinds.length} kind(s) allowed under ${look.id}; ${graphics}/${look.maxGraphics} designed graphics`));
  }

  // 5. a caption plan exists (the minimal look is the explicit "captions and light zoom only")
  checks.push(check('captions_present', input.captionPresent || lookId === FALLBACK_LOOK_ID, input.captionPresent ? 'caption plan present' : lookId === FALLBACK_LOOK_ID ? 'no caption plan, but the look is the explicit minimal one' : 'no caption plan'));

  // 6. library-only status never co-exists with a Claude provenance
  if (input.graphicsStatus === 'library_only') {
    const claudeSeen = claudeWarnings.length > 0 || input.generatedGraphics.some(graphic => graphic.provenance === 'claude');
    checks.push(check('library_only_honest', !claudeSeen, claudeSeen ? 'status is library_only but a graphic is marked as Claude' : 'library_only and no Claude provenance'));
  } else checks.push(check('library_only_honest', true, `graphics status ${input.graphicsStatus ?? 'not provided'}: not library_only`));

  // 7. optional polish markers, each only when provided
  const problems: string[] = [];
  if (input.profile !== undefined && input.profile !== 'polish') problems.push(`profile is "${input.profile}", expected polish`);
  if (input.fingerprintKey !== undefined && input.fingerprintKey !== POLISH_FINGERPRINT_KEY) problems.push(`fingerprint key "${input.fingerprintKey}", expected ${POLISH_FINGERPRINT_KEY}`);
  if (input.speechCutsApplied === false) problems.push('the speech-cuts stage did not apply');
  checks.push(check('profile_markers', problems.length === 0, problems.length === 0 ? 'provided markers match (or none provided)' : problems.join('; ')));

  return {pass: checks.every(item => item.ok), checks};
}

type RunSummary = {
  warnings?: string[];
  /** The Director v2 plan from the dump (`v2-compiled-direction`.plan): `editLook` and `elements[].kind`. */
  plan?: {editLook?: {id: string; fellBack?: boolean}; elements?: Array<{kind: string}>} | null;
  /** The blueprint's generated graphics (ids only matter), with the provenance this run recorded per id. */
  generatedGraphics?: Array<{id: string}>;
  provenance?: Array<{id: string; source: 'library' | 'claude'; compositionId?: string}>;
  captionWordCount?: number;
  graphicsStatus?: string;
  profile?: string;
  fingerprintKey?: string;
  speechCutsApplied?: boolean;
};

/** Build the rubric input from what a run leaves behind. Missing pieces stay missing (and fail the check that needs them); nothing is guessed. */
export function polishRubricInputFromRun(run: RunSummary): PolishRubricInput {
  const provenanceById = new Map((run.provenance ?? []).map(item => [item.id, item]));
  return {
    profile: run.profile,
    editLook: run.plan?.editLook ?? null,
    warnings: run.warnings ?? [],
    elementKinds: (run.plan?.elements ?? []).map(element => element.kind),
    generatedGraphics: (run.generatedGraphics ?? []).map(graphic => {
      const source = provenanceById.get(graphic.id);
      return {id: graphic.id, ...(source ? {provenance: source.source, ...(source.compositionId ? {compositionId: source.compositionId} : {})} : {})};
    }),
    captionPresent: (run.captionWordCount ?? 0) > 0,
    graphicsStatus: run.graphicsStatus,
    speechCutsApplied: run.speechCutsApplied,
    fingerprintKey: run.fingerprintKey,
  };
}
