/**
 * Make type readable against the plate it actually sits on (B-roll half,
 * not the talking-head swatch). North-star only.
 */

import type {
  CaptionDirection,
  MotionGraphic,
  SemanticEmphasis,
  VisualOverlay,
} from '../../types/blueprint.ts';
import type {FramePalette} from '../../media/ffmpeg.ts';
import {contrastCaptionWithFootage} from '../broll/captionContrast.ts';

export type PlateSwatch = {
  url: string;
  palette: FramePalette;
};

export function applyPlateContrast(input: {
  caption: CaptionDirection;
  overlays: VisualOverlay[];
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
  speakerPalette?: FramePalette;
  plateByUrl: Map<string, FramePalette>;
}): {
  caption: CaptionDirection;
  overlays: VisualOverlay[];
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
} {
  const splits = input.overlays.filter(
    overlay => overlay.layout === 'split' && Boolean(overlay.assetUrl),
  );
  const caption = contrastCaptionForEdit({
    caption: input.caption,
    splits,
    speakerPalette: input.speakerPalette,
    plateByUrl: input.plateByUrl,
  });

  const overlays = input.overlays.map(overlay => {
    const plate = plateForOverlay(overlay, input.plateByUrl, input.speakerPalette);
    if (!plate || !overlay.overlayText) {
      return overlay;
    }
    const next = readableOnPlate(overlay.accentColor || '#FFFFFF', plate);
    return next === overlay.accentColor ? overlay : {...overlay, accentColor: next};
  });

  const motionGraphics = input.motionGraphics.map(graphic => {
    const plate = plateUnderWindow(
      graphic.start,
      graphic.end,
      splits,
      input.plateByUrl,
      input.speakerPalette,
      graphic.anchor,
    );
    if (!plate) {
      return graphic;
    }
    return {
      ...graphic,
      textColor: readableOnPlate(graphic.textColor, plate),
      accentColor: readableOnPlate(graphic.accentColor, plate, {preferAccent: true}),
    };
  });

  const semanticEmphasis = input.semanticEmphasis.map(item => {
    const plate = plateUnderWindow(
      item.start,
      item.end,
      splits,
      input.plateByUrl,
      input.speakerPalette,
      item.anchor || 'top_right',
    );
    if (!plate) {
      return item;
    }
    const textColor = readableOnPlate(item.textColor || '#FFFFFF', plate);
    const accentColor = readableOnPlate(item.accentColor, plate, {preferAccent: true});
    if (item.treatment === 'color' && plate.luminance >= 0.58) {
      return {
        ...item,
        treatment: 'underline' as const,
        textColor,
        accentColor,
      };
    }
    return {...item, textColor, accentColor};
  });

  return {caption, overlays, motionGraphics, semanticEmphasis};
}

export function contrastCaptionForEdit(input: {
  caption: CaptionDirection;
  splits: VisualOverlay[];
  speakerPalette?: FramePalette;
  plateByUrl: Map<string, FramePalette>;
}): CaptionDirection {
  const covering = longestSplit(input.splits);
  const palette = covering
    ? input.plateByUrl.get(covering.assetUrl) ?? input.speakerPalette
    : input.speakerPalette;
  let caption = input.caption;
  if (palette) {
    caption = contrastCaptionWithFootage(caption, palette);
  }
  if (!covering) {
    return caption;
  }
  // Keep captions on the related-media half, never on the speaker half.
  if (covering.speakerSide === 'top') {
    return {
      ...caption,
      position: 'bottom',
      bottomFrac: Math.min(0.18, caption.bottomFrac || 0.14),
      boxColor:
        palette && palette.luminance >= 0.55
          ? 'rgba(255,255,255,0.86)'
          : 'rgba(8,8,12,0.82)',
    };
  }
  return {
    ...caption,
    position: 'center',
    bottomFrac: 0.5,
    boxColor:
      palette && palette.luminance >= 0.55
        ? 'rgba(255,255,255,0.86)'
        : 'rgba(8,8,12,0.82)',
  };
}

export function readableOnPlate(
  hex: string,
  palette: FramePalette,
  options: {preferAccent?: boolean} = {},
): string {
  const gap = Math.abs(luminance(hex) - palette.luminance);
  if (gap >= 0.32) {
    return hex;
  }
  if (palette.luminance >= 0.58) {
    return options.preferAccent ? '#9A3412' : '#121212';
  }
  if (palette.luminance <= 0.28) {
    return options.preferAccent ? '#FDE68A' : '#FFFFFF';
  }
  return luminance(hex) < 0.45 ? '#FFFFFF' : hex;
}

export function luminance(hex: string): number {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) {
    return 0.5;
  }
  const r = Number.parseInt(raw.slice(0, 2), 16) / 255;
  const g = Number.parseInt(raw.slice(2, 4), 16) / 255;
  const b = Number.parseInt(raw.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function longestSplit(splits: VisualOverlay[]): VisualOverlay | undefined {
  return [...splits].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
}

function plateForOverlay(
  overlay: VisualOverlay,
  plateByUrl: Map<string, FramePalette>,
  speaker?: FramePalette,
): FramePalette | undefined {
  if (overlay.assetUrl && plateByUrl.has(overlay.assetUrl)) {
    return plateByUrl.get(overlay.assetUrl);
  }
  return speaker;
}

function plateUnderWindow(
  start: number,
  end: number,
  splits: VisualOverlay[],
  plateByUrl: Map<string, FramePalette>,
  speaker: FramePalette | undefined,
  anchor: string,
): FramePalette | undefined {
  const split = splits.find(item => start < item.end && end > item.start);
  if (!split) {
    return speaker;
  }
  const onRelatedHalf =
    split.speakerSide === 'top'
      ? anchor.includes('bottom') || anchor === 'center'
      : anchor.includes('top') || anchor === 'center';
  if (onRelatedHalf && split.assetUrl && plateByUrl.has(split.assetUrl)) {
    return plateByUrl.get(split.assetUrl);
  }
  return speaker;
}
