/**
 * The two Event Sheet identities. Pure. Both contracts are FROZEN constants below; `hash.test.ts` pins a digest of each spec and a golden value,
 * so changing a spec without a new version prefix fails the tests. Never change what an existing prefix means.
 *
 * timingHash (`timing-v1:`)
 *   What a plan can anchor to: the sheet's version, fps, composition length, the effective render-style flags, and every event's id, type,
 *   time, frames, anchor, impact and visibility, plus every speech word's id, text and time. It is computed from the BUILT sheet, so it also
 *   changes when an ownership or visibility rule changes what is drawn. Event attributes (keyword, text) and media are NOT part of it.
 *
 * visualContentHash (`visual-v1:`)
 *   The listed blueprint fields VERBATIM, media references included, plus the effective render-style flags. Covers what is drawn and from
 *   which media, so a different Subject Stage asset, cutaway, B-roll credit or graphic image changes it. It does NOT cover: render-style
 *   appearance fields (caption template, layout style, LUT file), fonts, the content behind a URL (a URL that keeps its name but whose file
 *   changes is the same hash), or anything the renderer derives at render time (prefetch rewrites, `matteMissing`).
 *
 * Why URLs are kept verbatim (Phase 1.1 stripped them): the render prefetch rewrites media URLs only on a COPY of the blueprint
 * (server/src/stages/render/prefetchAssets.ts prefetchBlueprintMedia -> rewriteBlueprintMediaUrls), so a stored blueprint keeps its original
 * URLs and they are stable. Several media have no other identity (subjectStage.spans[].asset.url, subjectStage.cutaways[].assetUrl), and the
 * B-roll `credit` is drawn on screen (components/BRollTrack.tsx). A hash taken of a prefetched copy would differ; hash stored blueprints.
 *
 * Canonical JSON (both): object keys sorted by code unit at every depth; arrays in stored order; -0 -> 0; NaN / +Inf / -Inf -> tagged strings;
 * undefined members dropped (array holes -> null). Representation normalisation (visual only, listed in VISUAL_CONTENT_SPEC_V1): an absent or
 * null array track is [], an absent or null object field is null, and the hook timing fields are replaced by the values the renderer uses.
 */

import {createHash} from 'node:crypto';

import type {EditEventSheet} from './types.ts';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '__NaN__';
    if (value === Infinity) return '__+Inf__';
    if (value === -Infinity) return '__-Inf__';
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => (item === undefined ? null : canonicalize(item)));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item === undefined || typeof item === 'function') continue;
    out[key] = canonicalize(item);
  }
  return out;
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

// ---------------------------------------------------------------------------------------------------------------------------------
// Frozen contracts
// ---------------------------------------------------------------------------------------------------------------------------------

export const TIMING_HASH_SPEC_V1 = Object.freeze({
  prefix: 'timing-v1',
  sheetFields: Object.freeze(['version', 'fps', 'durationSec', 'durationFrames']),
  renderStyleFlags: Object.freeze(['trimEnabled', 'brollEnabled', 'zoomEnabled', 'generatedGraphicsEnabled']),
  eventFields: Object.freeze(['id', 'type', 'time', 'frames', 'anchor', 'impact', 'impactUnavailable', 'visibility']),
  wordFields: Object.freeze(['id', 'text', 'time']),
  /** Events and words are hashed in the sheet's own order (sorted by time, type, id). */
  order: 'sheet_order',
} as const);

export const VISUAL_CONTENT_SPEC_V1 = Object.freeze({
  prefix: 'visual-v1',
  /** Hashed verbatim (after canonical JSON). */
  fields: Object.freeze([
    'videoUrl', 'width', 'height', 'fps', 'outputDurationSec',
    'captionWords', 'keepSegments', 'zoomTriggers', 'brollClips', 'depthOverlays', 'insetReveals', 'visualOverlays', 'transitions',
    'motionGraphics', 'mediaContainers', 'frameInsets', 'semanticEmphasis', 'generatedGraphics', 'behindSubjectTexts', 'gradeBeats',
    'impactFx', 'explainerLayoutTrack', 'explainerClaimBeats', 'hookTitle', 'hookSubtitle', 'hookStyle', 'hookAnchor', 'openingTreatment',
    'kinetic', 'subjectStage', 'subjectForeground', 'speakerCutout', 'captionDirection', 'captionMuteRanges', 'editPalette', 'legibility',
    'colorGradeLut', 'designTokens', 'northStarDesign',
  ]),
  /** Absent or null -> []. */
  arrayFields: Object.freeze([
    'captionWords', 'keepSegments', 'zoomTriggers', 'brollClips', 'depthOverlays', 'insetReveals', 'visualOverlays', 'transitions',
    'motionGraphics', 'mediaContainers', 'frameInsets', 'semanticEmphasis', 'generatedGraphics', 'behindSubjectTexts', 'gradeBeats',
    'explainerLayoutTrack', 'explainerClaimBeats', 'captionMuteRanges',
  ]),
  /** Replaced by the value the renderer uses (ShortVideo.tsx:117-118). */
  hookTiming: Object.freeze({hookDurationSec: 'Math.max(1.2, hookDurationSec || 3)', hookStartSec: 'Math.max(0, hookStartSec || 0)'}),
  renderStyleFlags: Object.freeze(['trimEnabled', 'brollEnabled', 'zoomEnabled', 'generatedGraphicsEnabled']),
  /** Not hashed, on purpose: newsroomLayoutTrack (no renderer reads it), audio, narrative, metadata, shaped-source data. */
  excludedNote: 'newsroomLayoutTrack, audioDesign, directorReport, words, transcript, trimExclusions, deliveryShaping, tracks, cta, customScenes, metadata',
} as const);

/** Digest of a spec object, pinned per prefix in hash.test.ts. */
export const specDigest = (spec: unknown): string => sha256(canonicalJson(spec));

// ---------------------------------------------------------------------------------------------------------------------------------
// Hashes
// ---------------------------------------------------------------------------------------------------------------------------------

type SheetCore = Pick<EditEventSheet, 'version' | 'fps' | 'durationSec' | 'durationFrames' | 'renderStyle' | 'events'> & {speech: {words: EditEventSheet['speech']['words']}};

const pick = (source: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.map(key => [key, source[key] ?? null]));

export function timingHash(sheet: SheetCore): string {
  const spec = TIMING_HASH_SPEC_V1;
  const payload = {
    sheet: pick(sheet as unknown as Record<string, unknown>, spec.sheetFields),
    renderStyle: pick(sheet.renderStyle as unknown as Record<string, unknown>, spec.renderStyleFlags),
    events: sheet.events.map(event => pick(event as unknown as Record<string, unknown>, spec.eventFields)),
    words: sheet.speech.words.map(word => pick(word as unknown as Record<string, unknown>, spec.wordFields)),
  };
  return `${spec.prefix}:${sha256(canonicalJson(payload))}`;
}

export function visualContentHash(blueprint: Record<string, unknown>, renderStyle: Record<string, unknown>): string {
  const spec = VISUAL_CONTENT_SPEC_V1;
  const arrays = new Set<string>(spec.arrayFields);
  const fields: Record<string, unknown> = {};
  for (const field of spec.fields) {
    const value = blueprint[field];
    fields[field] = value === undefined || value === null ? (arrays.has(field) ? [] : null) : value;
  }
  const hook = blueprint as {hookDurationSec?: unknown; hookStartSec?: unknown};
  // Exactly the renderer's expressions (ShortVideo.tsx:117-118), including its coercions.
  const effective = {
    hookDurationSec: Math.max(1.2, (hook.hookDurationSec as number) || 3),
    hookStartSec: Math.max(0, (hook.hookStartSec as number) || 0),
  };
  const payload = {fields, hookTiming: effective, renderStyle: pick(renderStyle, spec.renderStyleFlags)};
  return `${spec.prefix}:${sha256(canonicalJson(payload))}`;
}
