/**
 * WP8J: the stage-level step that adds transcript seeds (transcriptLibrarySeed.ts) when the motion Director left the library nothing to draw. Orchestration only, and testable without a model:
 * it takes the Director's result (or an empty stand-in after a failure), drops the briefs whose copy is not spoken (the legibility pass would remove them anyway, so they must not count as library
 * hits), counts the grounded briefs the library resolves, and when there are none it seeds, assembles through the same guards a
 * Director brief goes through, and reports each seed as a warning. It never calls a model and never touches the Claude path.
 */
import {assembleDirectedGraphics, type MotionDirectorInput, type MotionDirectorResult} from './motionDirector.ts';
import {resolveLibraryGraphic} from './libraryRegistry.ts';
import {seedLibraryGraphics, type PlateAnchor, type SeedBox} from './transcriptLibrarySeed.ts';

export function addLibrarySeeds(
  director: MotionDirectorResult,
  input: Pick<MotionDirectorInput, 'words' | 'outputDurationSec' | 'occupied' | 'captionBand' | 'contentProfile'> & {lookId?: string | null; speakerBox?: SeedBox; speakerUnknown?: boolean; isCopyGrounded?: (content: Record<string, unknown>) => boolean; explainPlates?: boolean; plateAnchors?: readonly PlateAnchor[]; assetSlotWindows?: ReadonlyArray<{start: number; end: number}>; chapterCards?: ReadonlyArray<{at: number; duration: number; text: string; wordIndex: number}>},
): {director: MotionDirectorResult; warnings: string[]; openPlateId?: string} {
  const warnings: string[] = [];
  // WP8N (the Gate 3 cause): a Director brief whose copy has a word the speaker did not say is removed later by the legibility pass (`legibility:ungrounded_*`), which has nothing to do with the
  // speaker box. Counted as a library hit it also SUPPRESSED the seed, so the edit ended with no graphic at all. In library-only mode it is dropped here, before the count, with a warning.
  // The grounding rule is passed in (analyzeVideo owns the legibility module and hands over the same function its drop site uses), so this module imports neither the legibility nor the matcher module.
  if (input.isCopyGrounded) {
    const isGrounded = input.isCopyGrounded;
    const grounded = director.graphics.filter(graphic => isGrounded(graphic.brief.content));
    for (const graphic of director.graphics) if (!grounded.includes(graphic)) warnings.push(`motion_graphic:ungrounded_brief_dropped:${graphic.brief.id}`);
    director = {...director, graphics: grounded};
  }
  const libraryHits = director.graphics.filter(graphic =>
    resolveLibraryGraphic({goal: graphic.brief.goal, visualDescription: graphic.brief.visualDescription, placement: graphic.brief.placement, content: graphic.brief.content, textTreatment: graphic.brief.textTreatment}) !== null,
  ).length;
  // WP8R: Gate 5 stayed thin because ONE library hit skipped ALL seeds (ref Claude Edit alternates talking-head with many cutaways/pills). Top up to the duration-scaled seed limit instead of all-or-nothing.
  // WP10A: on the explain-plate path the hook title's window is not a hard block: the open plate may take it (and then replaces the hook). Every other plate still stays out of it.
  const hookWindow = input.explainPlates ? input.occupied.find(interval => interval.what === 'hook title') : undefined;
  const baseOccupied = hookWindow ? input.occupied.filter(interval => interval !== hookWindow) : input.occupied;
  const occupied = [...baseOccupied, ...director.graphics.map(graphic => ({start: graphic.start, end: graphic.end, what: 'motion graphic'}))];
  const seed = seedLibraryGraphics({words: input.words, outputDurationSec: input.outputDurationSec, lookId: input.lookId, speakerBox: input.speakerBox, speakerUnknown: input.speakerUnknown, occupied, hookWindow, assetSlotWindows: input.assetSlotWindows, captionBand: input.captionBand, explainPlates: input.explainPlates, anchors: input.plateAnchors, chapterCards: input.chapterCards});
  const room = Math.max(0, seed.limit - libraryHits);
  if (room === 0) {
    if (libraryHits > 0) return {director, warnings};
    warnings.push('motion_graphic:library_seed:none');
    return {director, warnings};
  }
  // WP8P: the content profile's own graphic cap (sparse 1, moderate 2, rich 4) used to cut the seeds a second time. In library-only polish the look's cap / the duration-scaled seed limit rules instead;
  // a profile that asks for NO graphics (`density: none`, cap 0) is still honoured.
  const profile = input.contentProfile && input.contentProfile.policy.maxGraphics > 0 ? {...input.contentProfile, policy: {...input.contentProfile.policy, maxGraphics: Math.max(input.contentProfile.policy.maxGraphics, seed.limit)}} : input.contentProfile;
  const assembleOccupied = hookWindow && !seed.openPlateId ? [...occupied, hookWindow] : occupied;
  const assembled = assembleDirectedGraphics(seed.raw, {words: input.words, outputDurationSec: input.outputDurationSec, occupied: assembleOccupied, maxGraphics: room, captionBand: input.captionBand, contentProfile: profile});
  // Belt and braces: a seed is a substring of the transcript by construction, but if the grounding rule would still remove it, it must not be published (or counted) either.
  const seeds = (input.isCopyGrounded ? assembled.graphics.filter(graphic => input.isCopyGrounded!(graphic.brief.content)) : assembled.graphics).slice(0, room);
  const openPlateId = seed.openPlateId && seeds.some(graphic => graphic.brief.id === seed.openPlateId) ? seed.openPlateId : undefined;
  if (openPlateId) warnings.push('polish_open:thumbnail_plate');
  if (seed.flashCards) warnings.push(`polish_pace:flash_cards:${seed.flashCards}`);
  if (seed.chapterCards) warnings.push(`polish_pace:chapter_cards:${seed.chapterCards}`); // WP33
  const withRecipe = seeds.filter(graphic => typeof (graphic.brief.content as {recipeId?: unknown}).recipeId === 'string').length;
  if (withRecipe > 0) warnings.push(`motion_recipes:used:${withRecipe}`);
  for (const _id of seed.listUpgraded ?? []) warnings.push('motion_graphic:list_upgraded:wiki');
  for (const id of seed.captionClonesSkipped ?? []) warnings.push(`motion_graphic:caption_clone_skipped:${id}`);
  if (seed.pillsCapped) warnings.push('motion_graphic:pills_capped');
  if (seed.skippedForCaptionBand) warnings.push(`motion_graphic:overlay_skipped_caption_band:${seed.skippedForCaptionBand}`);
  if (seed.unplacedAnchors) warnings.push(`explain_plates:anchor_unplaced:${seed.unplacedAnchors}`);
  warnings.push(...seeds.map(graphic => `motion_graphic:library_seed:${seed.compositions[graphic.brief.id] ?? 'unknown'}`));
  if (libraryHits > 0 && seeds.length > 0) warnings.push(`motion_graphic:library_seed_topup:${seeds.length}`);
  warnings.push(...assembled.graphics.filter(graphic => !seeds.includes(graphic)).map(graphic => `motion_seed_ungrounded:${graphic.brief.id}`));
  // WP8U: room > 0 and nothing seeded is NEVER silent (Gate 6: one library hit + an empty top-up logged nothing and hid the failure).
  if (seeds.length === 0) {
    warnings.push('motion_graphic:library_seed:none');
    if (libraryHits > 0) warnings.push('motion_graphic:library_seed_topup:0');
  }
  warnings.push(...assembled.refusals.map(refusal => `motion_seed_refused:${refusal.id}`));
  return {
    director: {...director, graphics: [...director.graphics, ...seeds].sort((a, b) => a.start - b.start), refusals: [...director.refusals, ...assembled.refusals]},
    warnings,
    ...(openPlateId ? {openPlateId} : {}),
  };
}
