/**
 * Where the art-directed opening sits, as a frame-relative box. One definition shared by the renderer (OpeningTreatment) and, through a parity test,
 * the server's conflict validator, so the validator checks the box that is actually drawn.
 */

export type OpeningBoxInput = {centerY: number; widthFrac: number; heightFrac: number; align: 'left' | 'center' | 'right'};
export type NormBox = {x: number; y: number; w: number; h: number};

const SIDE_PAD = 0.06;

export function openingBox(spec: OpeningBoxInput): NormBox {
  const x = spec.align === 'left' ? SIDE_PAD : spec.align === 'right' ? 1 - SIDE_PAD - spec.widthFrac : (1 - spec.widthFrac) / 2;
  return {x, y: spec.centerY - spec.heightFrac / 2, w: spec.widthFrac, h: spec.heightFrac};
}
