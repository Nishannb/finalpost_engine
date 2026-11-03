/**
 * WP53 stage (polish only; the caller gates on the three POLISH_* flags — this module has no env access). Plans visual-backend beats (pure), then per beat:
 *  - riso: reads the cache only (never renders in analyze) and publishes a full-screen library graphic whose props carry `backend`, `scene`, `assetUrl` ('' unless remotion/out/visual-backend-cache/<hash>.mp4 exists).
 *    The picture is the NATIVE library composition for that intent (number -> StatHighlight, versus -> VsClaim, compare -> BeforeAfter, quote / chapter -> BigKineticHeadline); a beat with no safe native fallback is dropped.
 *    Riso chrome / root missing -> `riso:unavailable` + `visual_backend:fallback:<id>`; nothing throws into analyze.
 *  - collage: spec only (`visual_backend:collage:deferred`), no Gemini call, no mp4, no overlay, no stock still.
 *  - anidoodle: skipped unless configured; this WP authors no films, so nothing is placed.
 * Only PUBLISHED, frame-owning beats mute the captions. Silent: no SFX.
 */
import type {MuteRange} from '../../../lib/captionMute.ts';
import type {GeneratedGraphic} from '../../../types/blueprint.ts';
import {publishGraphicSource, toGeneratedGraphic, type MotionWorkerOptions} from '../../../motionWorker/worker.ts';
import {libraryGraphicSource, resolveLibraryGraphic, type LibraryCompositionId} from '../../motionDirector/libraryRegistry.ts';
import type {MotionTemplateSkill, MotionTemplateWord, PolishLaneSkill} from '../motionTemplateCatalog.ts';
import {mapPolishSkillToMotionTemplateSkill} from '../motionTemplateCatalog.ts';
import {prepareAnidoodle, resolveAnidoodleRoot, safeDoodleStyle} from './anidoodleAdapter.ts';
import {collageCacheKey, collageMetaphorOf, prepareCollage} from './collageAdapter.ts';
import {planVisualBackendBeats, type DoodlePayload, type RisoPayload, type VisualBackendBeat, type VisualBackendFlags} from './planVisualBackendBeats.ts';
import {cachedRisoAsset, resolveRisoRoot, risoAvailable, VISUAL_BACKEND_CACHE_DIR} from './risoAdapter.ts';

export const VISUAL_BACKEND_GRAPHIC_ID_PREFIX = 'visual_backend_';

export type VisualBackendPublisher = typeof publishGraphicSource;

export type VisualBackendStageResult = {
  graphics: GeneratedGraphic[];
  beats: VisualBackendBeat[];
  /** Planned ranges (even when a beat fell back / was dropped, the plan ranges are returned for blocking). */
  plannedRanges: Array<{start: number; end: number}>;
  muteRanges: MuteRange[];
  warnings: string[];
};

type Fallback = {composition: LibraryCompositionId; content: Record<string, unknown>};

const unbracket = (text: string) => text.replace(/[\[\]]/g, '');

/** Native library content for a riso beat, built only from DATA that is already grounded. null = no safe fallback. */
export function nativeFallbackFor(beat: VisualBackendBeat): Fallback | null {
  if (beat.payload.kind === 'doodle') {
    // WP54: the procedural Remotion doodle (cut-paper by default) is the usable path with no 48k-file engine
    return {composition: 'DoodleDrawOn', content: {motionTemplateId: 'clip_34_doodle_explain', style: safeDoodleStyle(beat.payload.style), personalized: true}};
  }
  if (beat.payload.kind !== 'riso') return null;
  const data = beat.payload.data as Record<string, any>;
  switch (beat.payload.template) {
    case 'number': {
      const label = String(data.unit || data.say || '').trim();
      if (!label) return null;
      return {composition: 'StatHighlight', content: {value: {to: data.number, ...(data.prefix ? {prefix: data.prefix} : {}), ...(data.suffix ? {suffix: data.suffix} : {})}, label, ...(data.say && data.unit ? {sublabel: String(data.say)} : {})}};
    }
    case 'versus':
      return {composition: 'VsClaim', content: {left: String(data.before?.text ?? ''), right: String(data.after?.text ?? '')}};
    case 'compare': {
      const side = (s: Record<string, any>) => ({label: String(s.label), value: `${s.value} ${s.unit}`});
      return {composition: 'BeforeAfter', content: {before: side(data.before), after: side(data.after), ...(data.title ? {title: String(data.title)} : {})}};
    }
    case 'quote':
      return {composition: 'BigKineticHeadline', content: {lines: unbracket(String(data.quote)).split('\n').filter(Boolean)}};
    case 'title':
      return {composition: 'BigKineticHeadline', content: {lines: [String(data.kicker), String(data.title)].filter(Boolean)}};
    case 'converge': {
      // WP54: many -> few as a card stack (StackedCardDeck): the grounded "from" figure first, the "to" figure last. Labels are the spoken numbers / captions only.
      const from = data.from as {n?: string; cap?: string} | undefined;
      const to = data.to as {n?: string; cap?: string} | undefined;
      const label = (side?: {n?: string; cap?: string}) => `${side?.n ?? ''} ${side?.cap ?? ''}`.replace(/\+$/, '').trim();
      const a = label(from);
      const b = label(to);
      if (!a || !b || a.length > 24 || b.length > 24) return null;
      return {composition: 'StackedCardDeck', content: {motionTemplateId: 'clip_04_stacked_cards', cards: [{label: a}, {label: b}]}};
    }
    default:
      return null;
  }
}

export async function runVisualBackendStage(input: {
  polishSkill: PolishLaneSkill;
  skillOverride?: MotionTemplateSkill;
  words: readonly MotionTemplateWord[];
  durationSec: number;
  flags: VisualBackendFlags;
  blockedRanges?: ReadonlyArray<{start: number; end: number}>;
  accent?: string;
  ground?: string;
  ink?: string;
  risoRoot?: string;
  anidoodleRoot?: string;
  cacheDir?: string;
  /** Write the collage metaphor JSON next to the cache (default true). */
  writeSpecs?: boolean;
  publish?: Pick<MotionWorkerOptions, 'upload' | 'runtimeCheck' | 'captionBottomFrac' | 'artifactsDir'> & {publisher?: VisualBackendPublisher};
}): Promise<VisualBackendStageResult> {
  const skill = input.skillOverride ?? mapPolishSkillToMotionTemplateSkill(input.polishSkill);
  const cacheDir = input.cacheDir ?? VISUAL_BACKEND_CACHE_DIR;
  const plan = planVisualBackendBeats({
    skill,
    durationSec: input.durationSec,
    words: input.words,
    flags: input.flags,
    anidoodleConfigured: resolveAnidoodleRoot(input.anidoodleRoot) !== null,
    blockedRanges: input.blockedRanges,
    accent: input.accent,
    ground: input.ground,
    ink: input.ink,
  });
  const warnings = [...plan.warnings];
  const graphics: GeneratedGraphic[] = [];
  const muteRanges: MuteRange[] = [];
  const plannedRanges: Array<{start: number; end: number}> = [];
  const publisher = input.publish?.publisher ?? publishGraphicSource;
  const risoReady = risoAvailable(input.risoRoot) && resolveRisoRoot(input.risoRoot) !== null;

  for (const [index, beat] of plan.beats.entries()) {
    if (beat.backend === 'collage_gbro') {
      const collage = prepareCollage(beat, {cacheDir, write: input.writeSpecs ?? true});
      const metaphor = collageMetaphorOf(beat);
      warnings.push(collage.ok ? `visual_backend:collage:cached:${metaphor ? collageCacheKey(metaphor) : 'unknown'}` : 'visual_backend:collage:deferred');
      continue; // fail closed: nothing placed until a clip exists AND a video-graphic path plays it
    }
    if (beat.backend === 'anidoodle') {
      // WP54: engine films are not authored in analyze; the native DoodleDrawOn is the picture (engine root only changes the warning)
      const result = prepareAnidoodle({flagOn: input.flags.anidoodle, root: input.anidoodleRoot});
      warnings.push(result.reason === 'anidoodle:unconfigured' ? 'visual_backend:anidoodle:engine_unconfigured' : 'visual_backend:anidoodle:engine_deferred');
      warnings.push('visual_backend:anidoodle:native_doodle');
      const doodle = nativeFallbackFor(beat);
      const hit = doodle ? resolveLibraryGraphic({goal: `Visual backend (${beat.templateId}) native doodle`, visualDescription: 'DoodleDrawOn: procedural draw-on diagram; silent', placement: 'full_screen', content: {...doodle.content, ...(input.accent ? {accent: input.accent} : {})}}) : null;
      if (!doodle || !hit || hit.compositionId !== doodle.composition) {
        warnings.push(`visual_backend:dropped:${beat.templateId}:no_fallback`);
        continue;
      }
      const brief = {
        id: `${VISUAL_BACKEND_GRAPHIC_ID_PREFIX}${index + 1}`,
        goal: `Visual backend (${beat.templateId}, ${beat.scene.toolkit}) for the ${beat.intent} beat`,
        visualDescription: 'DoodleDrawOn: native cut-paper draw-on explain diagram; silent',
        placement: 'full_screen' as const,
        durationSeconds: Math.max(0.5, Math.min(60, beat.end - beat.start)),
        content: {...doodle.content, ...(input.accent ? {accent: input.accent} : {})},
      };
      try {
        const published = await publisher(brief, libraryGraphicSource(hit), {upload: input.publish?.upload, runtimeCheck: input.publish?.runtimeCheck, captionBottomFrac: input.publish?.captionBottomFrac, artifactsDir: input.publish?.artifactsDir});
        const graphic = toGeneratedGraphic(published, {start: beat.start, end: beat.end});
        graphics.push({...graphic, props: {...(graphic.props ?? {}), backend: 'native', scene: beat.scene, assetUrl: '', doodleStyle: safeDoodleStyle((beat.payload as DoodlePayload).style)}});
        plannedRanges.push({start: beat.start, end: beat.end});
        if (beat.muteCaptions) muteRanges.push({startSec: beat.start, endSec: beat.end});
      } catch {
        warnings.push(`visual_backend:publish_failed:${beat.templateId}`);
      }
      continue;
    }
    const payload = beat.payload as RisoPayload;
    warnings.push(`visual_backend:riso:${payload.template}`);
    if (!risoReady) warnings.push('visual_backend:riso:unavailable');
    const fallback = nativeFallbackFor(beat);
    if (!fallback) {
      warnings.push(`visual_backend:dropped:${beat.templateId}:no_fallback`);
      continue;
    }
    const brief = {
      id: `${VISUAL_BACKEND_GRAPHIC_ID_PREFIX}${index + 1}`,
      goal: `Visual backend (${beat.templateId}, ${beat.scene.toolkit}) for the ${beat.intent} beat`,
      visualDescription: `${fallback.composition}: native render of a riso ${payload.template} beat; silent, edit-palette accent`,
      placement: 'full_screen' as const,
      durationSeconds: Math.max(0.5, Math.min(60, beat.end - beat.start)),
      content: {...fallback.content, ...(input.accent ? {accent: input.accent} : {})},
    };
    const hit = resolveLibraryGraphic({goal: brief.goal, visualDescription: brief.visualDescription, placement: brief.placement, content: brief.content});
    if (!hit || hit.compositionId !== fallback.composition) {
      warnings.push(`visual_backend:dropped:${beat.templateId}:no_fallback`);
      continue;
    }
    try {
      const result = await publisher(brief, libraryGraphicSource(hit), {upload: input.publish?.upload, runtimeCheck: input.publish?.runtimeCheck, captionBottomFrac: input.publish?.captionBottomFrac, artifactsDir: input.publish?.artifactsDir});
      const graphic = toGeneratedGraphic(result, {start: beat.start, end: beat.end});
      // WP54: a cached mp4 is played by GeneratedGraphicTrack whenever it exists (no Chrome needed at analyze time); without one the native composition draws
      const cached = cachedRisoAsset(beat, cacheDir);
      graphics.push({
        ...graphic,
        props: {...(graphic.props ?? {}), backend: cached || risoReady ? 'riso' : 'native', scene: beat.scene, assetUrl: cached, risoTemplate: payload.template},
      });
      plannedRanges.push({start: beat.start, end: beat.end});
      if (!cached && !risoReady) warnings.push(`visual_backend:fallback:${beat.templateId}`);
      if (cached) warnings.push(`visual_backend:riso:mounted:${beat.templateId}`);
      if (beat.muteCaptions) muteRanges.push({startSec: beat.start, endSec: beat.end});
    } catch {
      warnings.push(`visual_backend:publish_failed:${beat.templateId}`);
    }
  }
  return {graphics, beats: plan.beats, plannedRanges, muteRanges, warnings};
}
