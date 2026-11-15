/**
 * Every top-level blueprint field, deliberately classified. There is no default: a field missing from these tables is UNCLASSIFIED,
 * and buildEventSheet refuses the blueprint (assertFullyClassified). The `satisfies Record<keyof TimelineBlueprint, ...>` makes
 * `tsc --noEmit` fail when the server type gains or loses a field without this table changing too.
 *
 *   included  read by the Event Sheet (role says how: visual events, speech words, narrative availability, or edit facts such as fps).
 *   excluded  a real part of the edit, deliberately not represented, with the reason.
 *   metadata  bookkeeping that describes how the blueprint was produced, not what the edit shows.
 */

import type {TimelineBlueprint} from '../../../types/blueprint.ts';
import type {FieldClass, FieldRole, TimeDomain} from './types.ts';

export type FieldRule = {class: FieldClass; role: FieldRole | null; timeDomain: TimeDomain | 'frames_output' | 'none' | 'word_ids'; reason: string};

const inc = (role: FieldRole, timeDomain: FieldRule['timeDomain'], reason: string): FieldRule => ({class: 'included', role, timeDomain, reason});
const exc = (timeDomain: FieldRule['timeDomain'], reason: string): FieldRule => ({class: 'excluded', role: null, timeDomain, reason});
const meta = (reason: string): FieldRule => ({class: 'metadata', role: null, timeDomain: 'none', reason});

export const BLUEPRINT_FIELD_RULES = {
  // Edit facts
  fps: inc('edit_facts', 'none', 'Frame rate of the output clock.'),
  outputDurationSec: inc('edit_facts', 'output', 'Length of the finished edit; the range every event must fall in.'),
  width: inc('edit_facts', 'none', 'Output frame width (hash input; a different frame is a different edit).'),
  height: inc('edit_facts', 'none', 'Output frame height (hash input).'),
  // Speech (output time)
  captionWords: inc('speech', 'output', 'Spoken words in output time; ids w{n} follow the Director v2 convention.'),
  // Visual events (output time)
  keepSegments: inc('events', 'output', 'Splice points: each segment after the first starts with a cut at outputStart (sourceStart/End are shaped-source time and are not used).'),
  zoomTriggers: inc('events', 'output', 'Punch-in windows.'),
  brollClips: inc('events', 'output', 'B-roll cutaways.'),
  depthOverlays: inc('events', 'output', 'Depth overlay clips.'),
  insetReveals: inc('events', 'output', 'Inset reveal clips.'),
  visualOverlays: inc('events', 'output', 'Visual overlays.'),
  transitions: inc('events', 'output', 'Transition anchors (`at`) with their duration.'),
  motionGraphics: inc('events', 'output', 'Motion graphic plates.'),
  mediaContainers: inc('events', 'output', 'Framed media container moments.'),
  frameInsets: inc('events', 'output', 'Frame inset moments.'),
  semanticEmphasis: inc('events', 'output', 'Semantic emphasis pops.'),
  generatedGraphics: inc('events', 'output', 'Generated motion graphics (stable stored ids).'),
  behindSubjectTexts: inc('events', 'output', 'Text behind the subject.'),
  gradeBeats: inc('events', 'output', 'Black-and-white grade beats.'),
  impactFx: inc('events', 'output', 'Flashes, saturation pops, punch-ins and black-and-white spans.'),
  explainerLayoutTrack: inc('events', 'output', 'Explainer layout spans (hard-cut layout changes).'),
  explainerClaimBeats: inc('events', 'output', 'Explainer claim beats (article plate and phrase wipe).'),
  newsroomLayoutTrack: inc('events', 'output', 'Newsroom layout spans. No renderer reads this field (verified: no remotion/src file references it), so every span is excluded as not_rendered.'),
  hookTitle: inc('events', 'output', 'Hook title text; an event only when non-empty (timed by hookStartSec / hookDurationSec).'),
  hookStartSec: inc('events', 'output', 'Hook title start.'),
  hookDurationSec: inc('events', 'output', 'Hook title duration.'),
  openingTreatment: inc('events', 'output', 'Art-directed opening (startSec / durationSec).'),
  kinetic: inc('events', 'frames_output', 'Kinetic typography RenderSpec: events, flashes and gap captions in OUTPUT frames (verified; the type comment saying source frames is stale).'),
  subjectStage: inc('events', 'output', 'Subject Stage spans, accents and cutaways (output seconds per its type).'),
  // Narrative (optional, never parsed in Phase 1.1)
  directorReport: inc('narrative', 'word_ids', 'Only stages.story.output is read, for availability. The rest is director diagnostics.'),

  // Excluded: real parts of the edit, deliberately not represented
  words: exc('shaped_source', 'Active-source words (T1), a different list from captionWords; never index-mapped to it.'),
  transcript: exc('none', 'Plain text; captionWords carries the timed words.'),
  trimExclusions: exc('shaped_source', 'Cut ranges in shaped-source time (T1); the cuts are represented from keepSegments.outputStart.'),
  deliveryShaping: exc('original_source', 'Time remap plus delivery acoustics in ORIGINAL source time (T0); mapping to output is Phase 1 Task 4. Known domain risk H1.'),
  hookSubtitle: exc('none', 'Secondary hook text; the hook event is represented by hookTitle timing.'),
  hookStyle: exc('none', 'Presentation of the hook title, not timing.'),
  hookAnchor: exc('none', 'Screen position of the hook title.'),
  editPalette: exc('none', 'Colours.'),
  captionMuteRanges: exc('output', 'Ranges where ordinary captions are hidden: a presentation rule, not an on-screen event.'),
  subjectForeground: exc('output', 'Person-matte compositing layer spans; not an event.'),
  speakerCutout: exc('none', 'Cutout availability and key colour.'),
  captionDirection: exc('none', 'Caption styling; caption words are represented through captionWords.'),
  legibility: exc('none', 'Legibility instructions.'),
  colorGradeLut: exc('none', 'Colour grade.'),
  suggestedLutIds: exc('none', 'Colour grade suggestions.'),
  preferredLutId: exc('none', 'Colour grade preference.'),
  tracks: exc('output', 'Server-side duplicate of B-roll, overlays, depth overlays and inset reveals (verified on every local blueprint); represented through those fields.'),
  cta: exc('word_ids', 'Word-id anchored; the id scheme for this field was not verified in Phase 1.1, so it is not guessed into output time.'),
  customScenes: exc('word_ids', 'Word-id anchored scene layers; the id scheme was not verified in Phase 1.1.'),
  audioDesign: exc('output', 'The existing audio design. The sheet describes the picture and must not reflect or decide audio.'),
  northStarDesign: exc('none', 'Design tokens.'),
  designTokens: exc('none', 'Design tokens.'),
  originalVideoUrl: exc('none', 'Pre-shaping source location; the renderer draws videoUrl.'),
  videoUrl: exc('none', 'The speaker footage. Not an event; part of visualContentHash (stored blueprints keep it verbatim; only the render copy is prefetched).'),
  sourceHasAudio: exc('none', 'Copied into the sheet as a fact, not an event. Not part of either hash.'),

  // Metadata
  schemaVersion: meta('Blueprint format version.'),
  blueprintId: meta('Identifier; copied into the sheet, not hashed.'),
  createdAt: meta('Wall-clock creation time.'),
  languageCode: meta('Requested language.'),
  detectedLanguage: meta('Detected language.'),
  sourceDurationSec: meta('Length of the source file (shaped-source time); the edit is bounded by outputDurationSec.'),
  editThesis: meta('Director rationale text.'),
  assetBrief: meta('Asset planning report.'),
  editReadiness: meta('Edit readiness report.'),
  evidence: meta('Facts for the offline scorer.'),
  assembler: meta('Assembler report.'),
  stats: meta('Counts, timings, costs and warnings.'),
} as const satisfies Record<keyof TimelineBlueprint, FieldRule>;

/**
 * Keys that appear on stored blueprint JSON but are not fields of the server type. Each is listed explicitly; adding one is a reviewed change.
 */
export const EXTRA_FIELD_RULES: Readonly<Record<string, FieldRule>> = {
  _label: meta('Annotation written by docs/kinetic-runs fixture scripts; not produced by the pipeline.'),
};

export function ruleFor(field: string): FieldRule | null {
  if (Object.prototype.hasOwnProperty.call(BLUEPRINT_FIELD_RULES, field)) return (BLUEPRINT_FIELD_RULES as Record<string, FieldRule>)[field]!;
  if (Object.prototype.hasOwnProperty.call(EXTRA_FIELD_RULES, field)) return EXTRA_FIELD_RULES[field]!;
  return null;
}

export function unclassifiedFields(blueprint: Record<string, unknown>): string[] {
  return Object.keys(blueprint).filter(field => ruleFor(field) === null).sort();
}

export class UnclassifiedBlueprintFieldError extends Error {
  readonly fields: string[];
  constructor(fields: string[]) {
    super(`Blueprint field(s) without an Event Sheet classification: ${fields.join(', ')}. Classify them in audioDirector/eventSheet/fieldCoverage.ts.`);
    this.name = 'UnclassifiedBlueprintFieldError';
    this.fields = fields;
  }
}

export function assertFullyClassified(blueprint: Record<string, unknown>): void {
  const unknown = unclassifiedFields(blueprint);
  if (unknown.length > 0) throw new UnclassifiedBlueprintFieldError(unknown);
}


// ---------------------------------------------------------------------------------------------------------------------------------
// Nested coverage (Phase 1.2)
// ---------------------------------------------------------------------------------------------------------------------------------

export type NestedRule = {class: 'used' | 'excluded' | 'metadata'; reason: string};

const used = (reason: string): NestedRule => ({class: 'used', reason});
const out = (reason: string): NestedRule => ({class: 'excluded', reason});
const md = (reason: string): NestedRule => ({class: 'metadata', reason});
const look = out('Appearance only; no effect on when the event is shown.');

/**
 * Allowed keys of the nested structures that produce visible events. `path` uses `[]` for "every item of the array".
 * Key lists match the Remotion render schemas (renderEventSchema, gapCaptionSchema, impactFxSchema, subjectStageSchema, generatedGraphicSchema,
 * transitionClipSchema, openingTreatmentSchema); `renderModel.parity.test.ts` checks that they still do.
 * Other array tracks (zoomTriggers, brollClips, visualOverlays, ...) are checked at the top level only: their items produce one event each from
 * start / end, and their other keys are appearance or media.
 */
export const NESTED_KEY_RULES: Readonly<Record<string, Readonly<Record<string, NestedRule>>>> = {
  kinetic: {
    events: used('Kinetic lockups.'),
    captions: used('Gap captions.'),
    fps: used('Checked against the blueprint fps.'),
    durationInFrames: used('Checked against the output clock.'),
    shots: out('Solver camera-shot spans (one per kinetic run in every local blueprint); the footage cuts are keepSegments, so shots are not events.'),
    version: md('Spec version.'),
    seed: md('Solver seed.'),
    width: md('Frame size (same as the blueprint).'),
    height: md('Frame size (same as the blueprint).'),
    safeRect: look,
    noMatte: look,
    fontPair: look,
    planSource: md('Where the plan came from.'),
  },
  'kinetic.events[]': {
    id: used('Stored id; the event id derives from it.'),
    inFrame: used('First drawn frame.'),
    outFrame: used('Last drawn frame (INCLUSIVE in KineticTrack).'),
    fps: used('Must equal the blueprint fps.'),
    flash: used('Light-leak flash (its own event).'),
    wordRange: used('Caption-word range (attribute).'),
    lines: used('On-screen text (attribute).'),
    preset: used('Attribute.'),
    presetResolved: used('Attribute.'),
    layering: used('Attribute.'),
    style: used('Attribute.'),
    exit: used('Attribute.'),
    shotId: md('Solver shot reference.'),
    keyframes: out('Block pose per frame. An arrival frame could be derived from it, but no renderer rule defines one; not used for impact in Phase 1.2.'),
    anchor: look, material: look, perspectivePx: look, block: look, shadow: look, depthBlurPx: look, tint: look, pose: look, zone: look, hold: look,
    matchCut: look,
    occlusionFraction: md('Solver diagnostic.'),
    safeProof: md('Solver diagnostic.'),
    persistAcrossCut: look,
    notes: md('Solver notes.'),
  },
  'kinetic.events[].flash': {
    startFrame: used('First flash frame (absolute).'),
    opacities: used('Opacity per frame from startFrame; drawn when > 0.001 (KineticTrack LightLeak).'),
    color: used('Attribute.'),
  },
  'kinetic.captions[]': {
    inFrame: used('First drawn frame.'),
    outFrame: used('First frame NOT drawn (EXCLUSIVE in KineticTrack).'),
    wordIdx: used('Attribute.'),
    text: used('Attribute.'),
    cx: look, cy: look, w: look, h: look, fontPx: look, font: look, weight: look, color: look, strokeColor: look, anim: look, exit: look,
    keyframes: out('Scale / opacity samples; not used for impact.'),
  },
  impactFx: {flashes: used('Overexpose flashes.'), satPops: used('Saturation pops.'), punchIns: used('Punch-ins.'), bwSpans: used('Black-and-white spans.')},
  'impactFx.flashes[]': {startSec: used('Start (frame = round(startSec * fps)).'), frames: used('Length in frames.'), reason: used('Attribute.')},
  'impactFx.satPops[]': {startSec: used('Start.'), frames: used('Length in frames.')},
  'impactFx.punchIns[]': {startSec: used('Start.'), endSec: used('End.'), rampFrames: used('Attribute.'), scale: used('Attribute.')},
  'impactFx.bwSpans[]': {startSec: used('Start.'), endSec: used('End.')},
  subjectStage: {
    spans: used('Stage spans.'),
    accents: used('Stage accents.'),
    cutaways: used('Stage cutaways.'),
    matteUrl: used('Decides whether the stage can draw (stageCompositing).'),
    matteMissing: used('Degraded render.'),
    matteIntervals: used('Limits where person-dependent elements draw; recorded as a visibility condition, not resolved per span.'),
    version: md('Payload version.'),
    styleId: md('Style id.'),
    bg: look, look, subject: out('Measured subject geometry used by the design.'),
  },
  'subjectStage.spans[]': {
    start: used('Start.'), end: used('End.'), stage: used('Attribute.'), enter: used('Attribute.'),
    asset: out('Media shown; part of visualContentHash, not an event.'),
    opacity: look, motion: look, placement: look, wash: look, design: look,
  },
  'subjectStage.spans[].asset': {url: out('Media identity (visualContentHash).'), kind: look, nativeKind: look, text: look, lines: look},
  'subjectStage.accents[]': {
    start: used('Start.'), end: used('End.'), kind: used('Attribute.'), slot: used('Attribute.'), lines: look,
    lineStarts: out('Per-line reveal offsets inside one accent. Not split into separate events in Phase 1.2.'),
  },
  'subjectStage.cutaways[]': {
    start: used('Start.'), end: used('End.'), mediaKind: used('Attribute.'), enter: used('Attribute.'), exit: used('Attribute.'),
    assetUrl: out('Media identity (visualContentHash).'), credit: out('Credit text (visualContentHash).'),
  },
  'generatedGraphics[]': {
    id: used('Stored id.'), start: used('Start.'), end: used('End.'), placement: used('placement.mode attribute.'), props: used('props.recipeId attribute.'),
    module: out('Compiled graphic module (url + sha256; visualContentHash).'), brief: md('Planning brief.'),
  },
  'transitions[]': {
    at: used('Anchor.'), duration: used('Window length.'), keyword: used('Procedural style / attribute.'), assetUrl: used('Drawability (asset presence).'),
    renderGenerated: used('Drawability.'), blend: used('Attribute.'), provider: used('Attribute.'),
    providerId: out('Media identity (visualContentHash).'), width: look, height: look, credit: out('Credit (visualContentHash).'), creditUrl: out('Credit link.'),
  },
  openingTreatment: {
    startSec: used('Start (schema default 0).'), durationSec: used('Length (schema default 3).'), kind: used('Attribute.'), text: used('Attribute.'),
    lines: look, textReveal: look, curve: look, accentReveal: look, centerY: look, widthFrac: look, heightFrac: look, align: look, font: look, weight: look,
    textColor: look, accentColor: look, strokeColor: look, panel: look, plan: md('Planning record.'),
  },
};

/** Every `path.key` found in the blueprint under NESTED_KEY_RULES that has no rule. Malformed containers are left to the extractors. */
export function unclassifiedNestedKeys(blueprint: Record<string, unknown>): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, path: string) => {
    const rules = NESTED_KEY_RULES[path];
    if (!rules) return;
    const items = path.endsWith('[]') ? (Array.isArray(value) ? value : []) : [value];
    for (const item of items) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
      for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
        if (!Object.prototype.hasOwnProperty.call(rules, key)) {
          found.add(`${path}.${key}`);
          continue;
        }
        visit(child, `${path}.${key}`);
        visit(child, `${path}.${key}[]`);
      }
    }
  };
  for (const root of ['kinetic', 'impactFx', 'subjectStage', 'openingTreatment']) visit(blueprint[root], root);
  for (const root of ['generatedGraphics', 'transitions']) visit(blueprint[root], `${root}[]`);
  return [...found].sort();
}

export function assertNestedClassified(blueprint: Record<string, unknown>): void {
  const unknown = unclassifiedNestedKeys(blueprint);
  if (unknown.length > 0) throw new UnclassifiedBlueprintFieldError(unknown);
}
