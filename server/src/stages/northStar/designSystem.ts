import type {
  MotionGraphic,
  NorthStarDesign,
  SemanticEmphasis,
} from '../../types/blueprint.ts';
import type {
  EditThesis,
  PerceptionPack,
  StoryAnalysis,
  StoryBeat,
} from '../directorV2/types.ts';
import type {ThesisTokens} from './thesisTokens.ts';

export function buildNorthStarDesign(input: {
  story?: StoryAnalysis;
  thesis?: EditThesis;
  tokens: ThesisTokens;
}): NorthStarDesign {
  const contentType = input.story?.contentType ?? 'other';
  const blob = [
    input.story?.tone,
    input.thesis?.look,
    input.thesis?.motionLanguage,
    input.thesis?.colorStory,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (contentType === 'story' || contentType === 'testimonial') {
    return {
      enabled: true,
      contentType,
      displayFont: 'playfair',
      primaryColor: input.tokens.primary,
      secondaryColor: input.tokens.secondary,
      inkColor: input.tokens.ink,
      surfaceColor: input.tokens.paper,
      motionPreset: contentType === 'testimonial' ? 'editorial' : 'kinetic',
      cornerRadius: 18,
      density: 'expressive',
    };
  }
  if (contentType === 'educational_tips' || contentType === 'tutorial') {
    return {
      enabled: true,
      contentType,
      displayFont: 'space_grotesk',
      primaryColor: input.tokens.primary,
      secondaryColor: input.tokens.secondary,
      inkColor: input.tokens.ink,
      surfaceColor: input.tokens.paper,
      motionPreset: 'kinetic',
      cornerRadius: 14,
      density: 'expressive',
    };
  }
  if (contentType === 'sales_pitch' || contentType === 'announcement') {
    return {
      enabled: true,
      contentType,
      displayFont: 'oswald',
      primaryColor: input.tokens.primary,
      secondaryColor: input.tokens.secondary,
      inkColor: input.tokens.ink,
      surfaceColor: input.tokens.paper,
      motionPreset: 'kinetic',
      cornerRadius: 10,
      density: 'expressive',
    };
  }
  return {
    enabled: true,
    contentType,
    displayFont: /calm|reflective|warm/.test(blob) ? 'playfair' : 'bebas',
    primaryColor: input.tokens.primary,
    secondaryColor: input.tokens.secondary,
    inkColor: input.tokens.ink,
    surfaceColor: input.tokens.paper,
    motionPreset: /calm|reflective|warm/.test(blob) ? 'editorial' : 'kinetic',
    cornerRadius: /minimal|clean|editorial/.test(blob) ? 8 : 16,
    density: 'expressive',
  };
}

/**
 * Propose transcript-faithful motion design for empty high-value beats.
 * Suggestions go to Repair; this function does not add elements after Validate.
 */
export function promoteMotionDesign(input: {
  pack?: PerceptionPack;
  story?: StoryAnalysis;
  design: NorthStarDesign;
  existing: MotionGraphic[];
  emphasis: SemanticEmphasis[];
}): {
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
  suggestions: string[];
} {
  if (!input.pack || !input.story) {
    return {
      motionGraphics: input.existing,
      semanticEmphasis: input.emphasis,
      suggestions: [],
    };
  }
  const suggestions: string[] = [];
  const maxAdded =
    input.design.density === 'restrained'
      ? Math.max(4, Math.floor(input.pack.outputDurationSec / 7))
      : Math.max(7, Math.floor(input.pack.outputDurationSec / 4.2));
  let added = 0;

  for (const beat of rankedBeats(input.story.beats)) {
    if (added >= maxAdded) {
      break;
    }
    if (beat.visualPotential === 'none' && beat.role === 'story') {
      continue;
    }
    const range = beatRange(beat, input.pack);
    if (!range || overlapsBusy(range.start, range.end, input.existing, input.emphasis)) {
      continue;
    }
    const text = clipBeatText(beatText(beat, input.pack), 6);
    if (!text) {
      continue;
    }
    const role = beat.importance >= 4 ? 'primary' : 'secondary';
    suggestions.push(
      `motion_graphic ${beat.id} "${text}" ${range.start.toFixed(2)}-${range.end.toFixed(2)} ${role}`,
    );
    added += 1;
  }

  return {
    motionGraphics: input.existing,
    semanticEmphasis: input.emphasis,
    suggestions,
  };
}

function rankedBeats(beats: StoryBeat[]): StoryBeat[] {
  return [...beats].sort(
    (a, b) =>
      Number(b.role === 'payoff' || b.role === 'claim' || b.role === 'list_item') -
        Number(a.role === 'payoff' || a.role === 'claim' || a.role === 'list_item') ||
      b.importance - a.importance ||
      a.energy - b.energy,
  );
}

function beatRange(
  beat: StoryBeat,
  pack: PerceptionPack,
): {start: number; end: number} | null {
  const start = pack.words.find(word => word.id === beat.startWordId);
  const end = pack.words.find(word => word.id === beat.endWordId);
  if (!start || !end) {
    return null;
  }
  const hold = Math.max(2.4, Math.min(6.5, end.end - start.start + 0.55));
  return {
    start: Math.max(0, start.start - 0.08),
    end: Math.min(pack.outputDurationSec, start.start + hold),
  };
}

function beatText(beat: StoryBeat, pack: PerceptionPack): string {
  const start = pack.words.findIndex(word => word.id === beat.startWordId);
  const end = pack.words.findIndex(word => word.id === beat.endWordId);
  if (start < 0 || end < start) {
    return '';
  }
  const words = pack.words
    .slice(start, Math.min(end + 1, start + 8))
    .map(word => word.text.replace(/[^\p{L}\p{N}'’-]/gu, ''))
    .filter(Boolean);
  return words.join(' ').trim();
}

function clipBeatText(text: string, maxWords: number): string {
  return text.split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ').trim();
}

function overlapsBusy(
  start: number,
  end: number,
  graphics: MotionGraphic[],
  emphasis: SemanticEmphasis[],
): boolean {
  return (
    graphics.some(item => start < item.end + 0.04 && end > item.start - 0.04) ||
    emphasis.some(item => start < item.end + 0.04 && end > item.start - 0.04)
  );
}
