/**
 * Per-video art direction: the content profile's theme expressed through the
 * renderer's EXISTING theme channel (`blueprint.northStarDesign`), which the
 * hook title, kinetic text, emphasis, captions, inset reveal and card overlays
 * already read. No new renderer coupling; `harmonizeEdits` then aligns the
 * colours the Director chose with that palette while keeping hierarchy
 * (primary vs secondary roles) and legibility over the actual footage.
 *
 * Nothing here is a genre template: pacing and mood from the profile pick the
 * motion preset and type, and every colour is contrast-checked.
 */

import {isDirectorColor, provenanceOf, stampProvenance} from '../../lib/provenance.ts';
import type {
  CaptionDirection,
  FrameInset,
  MediaContainerMoment,
  MotionGraphic,
  DesignTokens,
  SemanticEmphasis,
} from '../../types/blueprint.ts';
import {contrastRatio, hexLuminance, type ContentProfile, type ProfileContentType, type VisualMood} from './contentProfile.ts';

const NORTH_STAR_CONTENT_TYPE: Record<ProfileContentType, DesignTokens['contentType']> = {
  relationship_emotional: 'story',
  personal_story: 'story',
  motivational: 'opinion',
  educational_tips: 'educational_tips',
  tutorial: 'tutorial',
  sales_pitch: 'sales_pitch',
  opinion: 'opinion',
  announcement: 'announcement',
  testimonial: 'testimonial',
  comedy: 'comedy',
  other: 'other',
};

const DISPLAY_FONT: Record<VisualMood, DesignTokens['displayFont']> = {
  warm_intimate: 'playfair',
  calm_cool: 'space_grotesk',
  bold_energetic: 'bebas',
  clean_light: 'space_grotesk',
  dark_cinematic: 'oswald',
  earthy_natural: 'playfair',
  soft_pastel: 'playfair',
  tech_sharp: 'space_grotesk',
};

const SOFT_MOODS = new Set<VisualMood>(['warm_intimate', 'soft_pastel', 'earthy_natural', 'calm_cool']);
const FILLED_SHAPES = new Set<MotionGraphic['shape']>(['pill', 'bar', 'block', 'bubble']);

const WHITE = '#FFFFFF';
const BLACK = '#111111';

/** Colour that reads on `background`: the preferred one if it already does, else the better of white/black. */
export function readableOn(background: string, ...preferred: Array<string | undefined>): string {
  for (const color of preferred) {
    if (color && /^#[0-9a-fA-F]{6}$/.test(color) && contrastRatio(color, background) >= 4.5) {
      return color;
    }
  }
  return contrastRatio(WHITE, background) >= contrastRatio(BLACK, background) ? WHITE : BLACK;
}

/** Contrast of a colour against the footage's average luminance (0–1). */
function contrastWithFootage(color: string, footageLuminance: number): number {
  const a = hexLuminance(color);
  return (Math.max(a, footageLuminance) + 0.05) / (Math.min(a, footageLuminance) + 0.05);
}

/**
 * Colour for type drawn straight over the footage. The renderer gives that type a dark soft shadow, so it
 * must be LIGHT: dark type would sit on its own shadow and vanish over dark hair or clothing. A colour that
 * is already legible against the footage is kept; otherwise the lighter of the theme ink and white is used.
 */
function onFootage(color: string, footageLuminance: number, ...fallbacks: string[]): string {
  if (hexLuminance(color) >= 0.35 && contrastWithFootage(color, footageLuminance) >= 3) {
    return color;
  }
  return [...fallbacks, WHITE].filter(candidate => hexLuminance(candidate) >= 0.5).sort((x, y) => contrastWithFootage(y, footageLuminance) - contrastWithFootage(x, footageLuminance))[0] ?? WHITE;
}

export function designFromProfile(profile: ContentProfile): DesignTokens {
  const {theme} = profile;
  const backgroundIsDark = hexLuminance(theme.background) <= hexLuminance(theme.text);
  // Plates are always dark, ink always light, so type stays readable on plates and over footage alike.
  const surface = backgroundIsDark ? theme.background : theme.text;
  const ink = backgroundIsDark ? theme.text : theme.background;
  const primary = [theme.accent, theme.primary, ink].find(color => contrastRatio(color, surface) >= 3) ?? ink;
  const secondary = [theme.secondary, theme.primary, ink].find(color => contrastRatio(color, surface) >= 3) ?? ink;
  const motionPreset: DesignTokens['motionPreset'] =
    profile.pacing === 'slow' ? 'editorial' : profile.pacing === 'fast' ? 'kinetic' : profile.structure === 'enumerated' ? 'modular' : 'documentary';
  return stampProvenance({
    enabled: true,
    contentType: NORTH_STAR_CONTENT_TYPE[profile.contentType],
    displayFont: DISPLAY_FONT[profile.mood],
    primaryColor: primary,
    secondaryColor: secondary,
    inkColor: ink,
    surfaceColor: surface,
    motionPreset,
    cornerRadius: SOFT_MOODS.has(profile.mood) ? 22 : 10,
    density: profile.density === 'rich' ? 'expressive' : profile.density === 'moderate' ? 'balanced' : 'restrained',
  }, designProvenance(profile));
}

/**
 * Where each design token came from. Everything here is derived from the content profile (`profile`), unless the profile itself
 * substituted a neutral value for something the classifier did not supply (`default`) or is a deterministic fallback (`fallback`).
 * The palette, font and corner radius all follow the mood; the motion preset follows pacing and structure.
 */
function designProvenance(profile: ContentProfile): Record<string, 'profile' | 'default' | 'fallback'> {
  if (profile.source === 'fallback') {
    return Object.fromEntries(DESIGN_TOKEN_FIELDS.map(field => [field, 'fallback' as const]));
  }
  const of = (...fields: string[]): 'profile' | 'default' => (fields.every(field => provenanceOf(profile, field) === 'profile') ? 'profile' : 'default');
  const mood = of('mood');
  return {
    contentType: of('contentType'),
    displayFont: mood,
    primaryColor: mood,
    secondaryColor: mood,
    inkColor: mood,
    surfaceColor: mood,
    motionPreset: of('pacing', 'structure'),
    cornerRadius: mood,
    density: of('density'),
  };
}

const DESIGN_TOKEN_FIELDS = ['contentType', 'displayFont', 'primaryColor', 'secondaryColor', 'inkColor', 'surfaceColor', 'motionPreset', 'cornerRadius', 'density'] as const;

/** Lines for the visual Director: the palette and how to use it. */
export function artDirectionLines(profile: ContentProfile): string[] {
  const design = designFromProfile(profile);
  return [
    `- art direction (${profile.mood.replace('_', ' ')}): accent ${design.primaryColor}, secondary ${design.secondaryColor}, plate ${design.surfaceColor}, ink ${design.inkColor}; motion feel: ${design.motionPreset}`,
    '- use these (or close tints) for accent_color, highlight_color, canvas_color and margin colours; do not invent unrelated colours. Text drawn straight over the footage must still contrast the footage, so prefer the ink colour for it.',
  ];
}

export type HarmonizeInput = {
  design: DesignTokens;
  footageLuminance: number;
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
  frameInsets: FrameInset[];
  mediaContainers: MediaContainerMoment[];
  caption: CaptionDirection;
  /** A creator's own caption style guide wins over the profile. */
  captionLocked: boolean;
};

export type HarmonizeResult = Omit<HarmonizeInput, 'design' | 'footageLuminance' | 'captionLocked'> & {
  changed: {motionGraphics: number; semanticEmphasis: number; frameInsets: number; mediaContainers: number; caption: boolean};
};

/**
 * Phase 29 (Step 1b): a colour the Director explicitly wrote for these fields is kept; only `director` provenance on a usable 6-digit hex
 * protects a value. Profile-, default- and fallback-origin values, and values with no provenance at all (unknown), are harmonised exactly
 * as before. Protected fields: frame-inset margin, media-container canvas, kinetic-text accent, emphasis accent. Text colours stay derived
 * (legibility on the final background), and captions are out of scope.
 */
export function harmonizeEdits(input: HarmonizeInput): HarmonizeResult {
  const {design, footageLuminance} = input;
  const accentFor = (role: MotionGraphic['role'] | SemanticEmphasis['weight']) => (role === 'primary' ? design.primaryColor : design.secondaryColor);
  let kineticChanged = 0;
  let emphasisChanged = 0;

  const motionGraphics = input.motionGraphics.map(graphic => {
    const accentColor = isDirectorColor(graphic, 'accentColor') ? graphic.accentColor : accentFor(graphic.role);
    const textColor = FILLED_SHAPES.has(graphic.shape)
      ? readableOn(accentColor, graphic.textColor, design.inkColor)
      : onFootage(graphic.textColor, footageLuminance, design.inkColor);
    if (accentColor !== graphic.accentColor || textColor !== graphic.textColor) {
      kineticChanged += 1;
    }
    return {...graphic, accentColor, textColor};
  });

  const semanticEmphasis = input.semanticEmphasis.map(item => {
    const accentColor = isDirectorColor(item, 'accentColor') ? item.accentColor : accentFor(item.weight);
    // `color` emphasis draws the word in the accent straight over the footage.
    const textColor = item.treatment === 'color' ? onFootage(accentColor, footageLuminance, design.inkColor) : item.textColor;
    const next = {...item, accentColor, ...(textColor && textColor !== accentColor ? {textColor} : {})};
    if (next.accentColor !== item.accentColor || next.textColor !== item.textColor) {
      emphasisChanged += 1;
    }
    return next;
  });

  let framesProtected = 0;
  const frameInsets = input.frameInsets.map(inset => {
    if (isDirectorColor(inset, 'marginColor')) {
      framesProtected += 1;
      return inset;
    }
    return {...inset, marginColor: design.surfaceColor};
  });
  const mediaContainers = input.mediaContainers.map(container => {
    const keepCanvas = isDirectorColor(container, 'canvasColor');
    const canvasColor = keepCanvas ? container.canvasColor : design.surfaceColor;
    // The title must read on the canvas that is actually drawn. A Director title colour is offered as the preferred colour only together
    // with a Director canvas, and is used only if it reaches the readability threshold (the same rule the kinetic text colour follows).
    const preferredTitle = keepCanvas && isDirectorColor(container, 'canvasTitleColor') ? container.canvasTitleColor : undefined;
    return {
      ...container,
      canvasColor,
      ...(container.canvasTitle ? {canvasTitleColor: readableOn(canvasColor, preferredTitle, design.inkColor)} : {}),
    };
  });

  // Captions keep the footage-contrast pass the pipeline already ran; only the highlight adopts the accent, and only when it still reads.
  const highlight = design.primaryColor;
  const adoptHighlight = !input.captionLocked && contrastWithFootage(highlight, footageLuminance) >= 3 && input.caption.highlightColor !== highlight;
  const caption = adoptHighlight ? {...input.caption, highlightColor: highlight} : input.caption;

  return {
    motionGraphics,
    semanticEmphasis,
    frameInsets,
    mediaContainers,
    caption,
    changed: {
      motionGraphics: kineticChanged,
      semanticEmphasis: emphasisChanged,
      frameInsets: input.frameInsets.length - framesProtected,
      mediaContainers: input.mediaContainers.length,
      caption: adoptHighlight,
    },
  };
}
