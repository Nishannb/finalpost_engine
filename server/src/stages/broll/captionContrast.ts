/**
 * Tune caption *colors* so type stays legible on this footage.
 *
 * Never override the director's template, position, or box decision —
 * those are creative choices. Only nudge text/highlight (and, as a last
 * resort on washed-out walls, add a soft box when the director already
 * asked for one or picked the `box` template).
 */

import type {CaptionDirection} from '../../types/blueprint.ts';
import type {FramePalette} from '../../media/ffmpeg.ts';

export function contrastCaptionWithFootage(
  caption: CaptionDirection,
  palette: FramePalette,
): CaptionDirection {
  const bright = palette.luminance >= 0.58;
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
    // Light walls: dark type reads; keep outlined templates box-free unless
    // the director already chose a pill.
    textColor = wantsBox ? '#141414' : '#121212';
    highlightColor = teal
      ? '#0B6E6A'
      : warm
        ? '#C2410C'
        : highlightForTemplate(caption.template, '#1D4ED8');
    if (wantsBox) {
      boxColor = boxColor && !isLight(boxColor) ? '#F7F4EE' : boxColor ?? '#F7F4EE';
      textColor = '#141414';
    }
  } else if (dark) {
    textColor = '#FFFFFF';
    highlightColor = warm
      ? '#FFB703'
      : highlightForTemplate(caption.template, caption.highlightColor);
    // Dark footage + dark pill kills contrast — drop the box unless template is box.
    if (boxColor && isDark(boxColor) && caption.template !== 'box') {
      boxColor = null;
    }
  } else if (teal && wantsBox) {
    textColor = '#FFF8E8';
    highlightColor = '#F5C518';
    boxColor = boxColor ?? '#0B2424';
  } else {
    // Mid luminance talking-head: preserve director box (including none).
    // Only lift pale text to white so outlines stay readable.
    if (luminance(textColor) < 0.45) {
      textColor = '#FFFFFF';
    }
    highlightColor = highlightForTemplate(
      caption.template,
      caption.highlightColor,
    );
  }

  return {
    ...caption,
    textColor,
    highlightColor,
    boxColor,
  };
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
  if (template === 'karaoke') {
    return '#7DD3FC';
  }
  if (template === 'minimal' || template === 'classic') {
    return '#FDE68A';
  }
  if (template === 'box') {
    return '#FFFFFF';
  }
  if (template === 'hormozi') {
    return '#00E5FF';
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
