/**
 * Turn the director thesis into a small design system and paint graphics
 * that still carry the house cyan/yellow defaults.
 */

import type {
  CaptionDirection,
  MotionGraphic,
  SemanticEmphasis,
  VisualOverlay,
} from '../../types/blueprint.ts';
import type {EditThesis} from '../directorV2/types.ts';

export type ThesisTokens = {
  primary: string;
  secondary: string;
  ink: string;
  paper: string;
};

const DEFAULT_ACCENTS = new Set([
  '#22D3EE',
  '#00E5FF',
  '#00FFFF',
  '#FACC15',
  '#FDE68A',
  '#FFFF00',
  '#4DA3FF',
  '#0080FF',
]);

export function tokensFromThesis(
  thesis: string,
  parts?: EditThesis,
): ThesisTokens {
  const blob = `${thesis} ${parts?.look ?? ''} ${parts?.colorStory ?? ''}`.toLowerCase();
  const hexes = `${thesis} ${parts?.colorStory ?? ''}`.match(/#([0-9a-fA-F]{6})/g) ?? [];
  const primary = sanitize(hexes[0]) || pickPrimary(blob);
  const secondary = sanitize(hexes[1]) || pickSecondary(blob, primary);
  return {
    primary,
    secondary,
    ink: /dark|noir|night|black/.test(blob) ? '#F8FAFC' : '#111827',
    paper: /dark|noir|night|black/.test(blob) ? '#0B1220' : '#F7F4EE',
  };
}

export function applyThesisTokens(input: {
  tokens: ThesisTokens;
  caption: CaptionDirection;
  overlays: VisualOverlay[];
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
}): {
  caption: CaptionDirection;
  overlays: VisualOverlay[];
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
} {
  const {tokens} = input;
  return {
    caption: {
      ...input.caption,
      highlightColor: isDefaultAccent(input.caption.highlightColor)
        ? tokens.primary
        : input.caption.highlightColor,
    },
    overlays: input.overlays.map(overlay =>
      isDefaultAccent(overlay.accentColor)
        ? {...overlay, accentColor: tokens.primary}
        : overlay,
    ),
    motionGraphics: input.motionGraphics.map(graphic => ({
      ...graphic,
      accentColor: isDefaultAccent(graphic.accentColor)
        ? graphic.role === 'secondary'
          ? tokens.secondary
          : tokens.primary
        : graphic.accentColor,
      textColor: isDefaultAccent(graphic.textColor) ? tokens.ink : graphic.textColor,
    })),
    semanticEmphasis: input.semanticEmphasis.map(item => ({
      ...item,
      accentColor: isDefaultAccent(item.accentColor) ? tokens.primary : item.accentColor,
    })),
  };
}

export function isDefaultAccent(hex: string | undefined): boolean {
  if (!hex) {
    return true;
  }
  const match = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return Boolean(match && DEFAULT_ACCENTS.has(`#${match[1]!.toUpperCase()}`));
}

function pickPrimary(blob: string): string {
  if (/teal|cyan|ocean|aqua/.test(blob)) {
    return '#0F766E';
  }
  if (/warm|gold|sun|amber|yellow/.test(blob)) {
    return '#C2410C';
  }
  if (/red|urgent|bold/.test(blob)) {
    return '#B91C1C';
  }
  if (/blue|trust|clean/.test(blob)) {
    return '#1D4ED8';
  }
  if (/green/.test(blob)) {
    return '#15803D';
  }
  return '#B45309';
}

function pickSecondary(blob: string, primary: string): string {
  if (primary === '#C2410C' || /warm|gold/.test(blob)) {
    return '#1E3A5F';
  }
  return '#F8FAFC';
}

function sanitize(raw: string | undefined): string | null {
  const match = String(raw ?? '').trim().match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1]!.toUpperCase()}` : null;
}
