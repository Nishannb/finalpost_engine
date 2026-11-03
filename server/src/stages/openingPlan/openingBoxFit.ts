/**
 * WP4S: the box the renderer actually draws for an art-directed opening, kept inside the frame's safe span. Pure: no imports at all (no logger, no ffmpeg, no network).
 *
 * `remotion/src/lib/openingGeometry.ts` `openingBox` draws a left-aligned opening at x = 0.06, a right-aligned one at x = 1 - 0.06 - width, and a centered one at x = (1 - width) / 2. The planner used
 * to face-check and measure a CENTERED box whatever the alignment, so a right-aligned opening could sit on the face (and, ending at x = 0.94, run under the platform button rail that starts at
 * x = 0.86) after the centered check had passed, and a tall opening could start above the top 6% platform UI band.
 *
 * `drawnOpeningBox` repeats that formula (a parity test compares it with `openingBox` for left, center and right). `fitOpeningBox` then keeps the drawn box inside x >= 0.06, x + w <= 0.86 and
 * y >= 0.06 using only boxes the renderer CAN draw (the renderer has no free x position, only left / center / right):
 *   - a width that fits keeps its width; the box slides to the nearest drawable position that fits: the requested alignment if it already fits, else center, else left;
 *   - only when the width cannot fit even left-aligned (w > 0.80) is the width shrunk, to the widest that fits (0.80, left-aligned);
 *   - a box whose top is above 0.06 slides down to y = 0.06.
 * Every change is returned as a short correction string.
 */
export type OpeningAlign = 'left' | 'center' | 'right';
export type OpeningBoxInput = {centerY: number; widthFrac: number; heightFrac: number; align: OpeningAlign};
export type NormBox = {x: number; y: number; w: number; h: number};

/** Left / right padding of the drawn opening (the renderer's own constant). */
export const OPENING_SIDE_PAD = 0.06;
/** Where the platform button rail starts (PLATFORM_RAIL.x in lib/editConflicts.ts; a test ties the two). */
export const OPENING_RAIL_X = 0.86;
/** The top band the platform UI occupies. */
export const OPENING_TOP_UI = 0.06;

const round = (value: number) => Math.round(value * 1e6) / 1e6;
const f2 = (value: number) => value.toFixed(2);

/** The box `openingBox` draws, before any fitting (the same arithmetic as the renderer). */
export function drawnOpeningBox(spec: OpeningBoxInput): NormBox {
  const x = spec.align === 'left' ? OPENING_SIDE_PAD : spec.align === 'right' ? 1 - OPENING_SIDE_PAD - spec.widthFrac : (1 - spec.widthFrac) / 2;
  return {x, y: spec.centerY - spec.heightFrac / 2, w: spec.widthFrac, h: spec.heightFrac};
}

const fitsAcross = (box: NormBox) => box.x >= OPENING_SIDE_PAD - 1e-9 && box.x + box.w <= OPENING_RAIL_X + 1e-9;

export function fitOpeningBox(input: OpeningBoxInput): {centerY: number; widthFrac: number; heightFrac: number; align: OpeningAlign; box: NormBox; corrections: string[]} {
  const corrections: string[] = [];
  let {align, widthFrac} = input;
  let box = drawnOpeningBox({...input});
  if (!fitsAcross(box)) {
    const widest = round(OPENING_RAIL_X - OPENING_SIDE_PAD); // left-aligned: x = 0.06, right edge at the rail
    const was = align;
    if (widthFrac <= widest + 1e-9) {
      // Keep the width; slide to the nearest drawable position that fits.
      const order: OpeningAlign[] = ['center', 'left'];
      align = order.find(candidate => fitsAcross(drawnOpeningBox({...input, align: candidate}))) ?? 'left';
      corrections.push(`opening box: align ${was} -> ${align} (the drawn box ended at x ${f2(box.x + box.w)}, past the platform rail at ${OPENING_RAIL_X})`);
    } else {
      widthFrac = widest;
      align = 'left';
      corrections.push(`opening box: width ${f2(input.widthFrac)} -> ${f2(widthFrac)}, align ${was} -> left (it cannot fit between x ${OPENING_SIDE_PAD} and the platform rail at ${OPENING_RAIL_X})`);
    }
    box = drawnOpeningBox({...input, widthFrac, align});
  }
  let centerY = input.centerY;
  if (box.y < OPENING_TOP_UI - 1e-9) {
    centerY = round(OPENING_TOP_UI + input.heightFrac / 2);
    corrections.push(`opening box: center_y ${f2(input.centerY)} -> ${f2(centerY)} (the top was above the platform UI band at ${OPENING_TOP_UI})`);
    box = drawnOpeningBox({centerY, widthFrac, heightFrac: input.heightFrac, align});
  }
  return {centerY, widthFrac, heightFrac: input.heightFrac, align, box, corrections};
}
