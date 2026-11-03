/**
 * WP19: PREFER MEDIA over a text-only open. PURE. When the creator uploaded labeled assets (or KLIPY stickers were planned) and a leave-the-face OPEN is only a text plate (OpenPlate / StampTitle / FullscreenStatement
 * with no picture under it), a media beat could cover that window: the edit should open on the object, not on a headline. This is a soft pressure: it reports the windows (`polish_aesthetic:prefer_media:<start>-<end>`),
 * it never removes a graphic.
 */
export const TEXT_PLATE_COMPOSITIONS: ReadonlySet<string> = new Set(['OpenPlate', 'StampTitle', 'FullscreenStatement']);
/** The "open" of an edit: graphics starting in the first seconds. */
export const OPEN_WINDOW_SEC = 8;

type Range = {start: number; end: number};
export type OpenGraphicLike = Range & {compositionId?: string; mode: string};

const overlaps = (a: Range, b: Range) => a.start < b.end && a.end > b.start;

/**
 * Text-only opens that a planned media beat could cover: a full / split-screen text-plate graphic that starts inside the open window and has no media under it (`mediaUnder`: clips, cutaways, containers, ImageRun) while at least one
 * available media beat (`mediaBeats`: bound labeled-asset overlays, KLIPY overlays) starts inside the window too.
 */
export function textOnlyOpensWithMediaAvailable(input: {graphics: readonly OpenGraphicLike[]; mediaBeats: readonly Range[]; mediaUnder: readonly Range[]; openWindowSec?: number}): Range[] {
  const limit = input.openWindowSec ?? OPEN_WINDOW_SEC;
  const beats = input.mediaBeats.filter(beat => beat.start < limit + 4);
  if (beats.length === 0) return [];
  return input.graphics
    .filter(graphic => (graphic.mode === 'full_screen' || graphic.mode === 'split_screen') && graphic.start < limit && TEXT_PLATE_COMPOSITIONS.has(graphic.compositionId ?? ''))
    .filter(graphic => !input.mediaUnder.some(media => overlaps(media, graphic)))
    .map(graphic => ({start: graphic.start, end: graphic.end}));
}

export const preferMediaWarnings = (windows: readonly Range[]): string[] => windows.map(window => `polish_aesthetic:prefer_media:${window.start.toFixed(1)}-${window.end.toFixed(1)}`);
