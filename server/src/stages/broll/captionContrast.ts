/**
 * Tune caption *colors* so type stays legible on this footage.
 *
 * Honor the director's template and position. Recolor text/highlight when the
 * chosen pair would vanish on the talking-head or on an inset caption plate.
 */

import type {CaptionDirection} from '../../types/blueprint.ts';
import type {FramePalette} from '../../media/ffmpeg.ts';

const KARAOKE_GOLD = '#F5B942';
const DARK_TYPE = '#111111';
const LIGHT_TYPE = '#FFFFFF';

export function contrastCaptionWithFootage(
  caption: CaptionDirection,
  palette: FramePalette,
): CaptionDirection {
  if (caption.animation === 'highlight') {
    return {
      ...caption,
      textColor: LIGHT_TYPE,
      highlightColor: KARAOKE_GOLD,
      boxColor: null,
    };
  }
  const bright = palette.luminance >= 0.4;
  const dark = palette.luminance <= 0.28;
  const teal =
    palette.g > 0.32 &&
    palette.b > 0.28 &&
    palette.g + palette.b > palette.r * 1.8;
  const warm = palette.r > palette.b + 0.08 && palette.r > 0.4;

  const wantsBox = caption.boxColor != null || caption.template === 'box';
  let textColor = caption.textColor;
  let highlightColor = caption.highlightColor;
  let boxColor = caption.boxColor;

  if (bright) {
    // Light walls / pale inset docks: dark type. Never cyan-on-cream.
    textColor = DARK_TYPE;
    highlightColor = karaokeSafeHighlight(
      caption.template,
      teal ? '#C2410C' : warm ? '#C2410C' : '#B45309',
    );
    if (wantsBox) {
      boxColor = boxColor ?? '#F7F4EE';
      textColor = isLight(boxColor) ? DARK_TYPE : LIGHT_TYPE;
    }
  } else if (dark) {
    textColor = LIGHT_TYPE;
    highlightColor = karaokeSafeHighlight(
      caption.template,
      warm ? '#FFB703' : caption.highlightColor,
    );
    if (boxColor && isDark(boxColor) && caption.template !== 'box') {
      boxColor = null;
    }
  } else if (teal && wantsBox) {
    textColor = '#FFF8E8';
    highlightColor = karaokeSafeHighlight(caption.template, '#F5C518');
    boxColor = boxColor ?? '#0B2424';
  } else {
    // Mid talking-head: keep a readable pair. Do not lift everything to white
    // (that is what made type vanish on Gabby's wall + pale inset plate).
    if (luminance(textColor) > 0.72 && palette.luminance >= 0.36) {
      textColor = DARK_TYPE;
    } else if (luminance(textColor) < 0.28 && palette.luminance <= 0.34) {
      textColor = LIGHT_TYPE;
    }
    highlightColor = karaokeSafeHighlight(
      caption.template,
      caption.highlightColor,
    );
  }

  if (tooClose(textColor, highlightColor)) {
    highlightColor =
      caption.template === 'karaoke'
        ? KARAOKE_GOLD
        : luminance(textColor) > 0.5
          ? '#B45309'
          : '#F5C518';
  }

  return {
    ...caption,
    textColor,
    highlightColor,
    boxColor,
  };
}

function karaokeSafeHighlight(
  template: CaptionDirection['template'],
  fallback: string,
): string {
  if (template === 'karaoke') {
    return KARAOKE_GOLD;
  }
  return highlightForTemplate(template, fallback);
}

function highlightForTemplate(
  template: CaptionDirection['template'],
  fallback: string,
): string {
  if (template === 'mrbeast') {
    return '#FFB703';
  }
  if (template === 'bounce') {
    return '#5CFFC0';
  }
  if (template === 'minimal' || template === 'classic' || template === 'weight-shift' || template === 'basic') {
    return '#B45309';
  }
  if (template === 'box' || template === 'grape' || template === 'moving-pill' || template === 'soft-ai') {
    return '#FFFFFF';
  }
  if (template === 'hormozi' || template === 'gaming-stream') {
    return '#F5B942';
  }
  if (template === 'beast') {
    return '#FF6600';
  }
  return fallback || '#F5C518';
}

function luminance(hex: string): number {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) {
    return 0.5;
  }
  const r = Number.parseInt(raw.slice(0, 2), 16) / 255;
  const g = Number.parseInt(raw.slice(2, 4), 16) / 255;
  const b = Number.parseInt(raw.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isLight(hex: string): boolean {
  return luminance(hex) >= 0.55;
}

function isDark(hex: string): boolean {
  return luminance(hex) <= 0.28;
}

function tooClose(a: string, b: string): boolean {
  return Math.abs(luminance(a) - luminance(b)) < 0.18;
}
