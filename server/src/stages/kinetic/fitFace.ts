/**
 * Phase 4.9: context-aware font fit for ONE word that is wider than the usable safe width at its readability floor. Pure; widths come from the measured advance tables (measure.ts), the fonts are the shipped inventory
 * (remotion/public/fonts). The size never changes (the floor is never lowered); only the FACE may, and only within the design language of the face the pair chose:
 *   editorial serif (Playfair, Playfair italic)  -> no condensed serif ships, so NO face change: the caller keeps the serif and changes the composition instead (an emphasis line at the support scale, see playbook.ts)
 *   bold display (Anton, Bebas, Shrikhand, Archivo Black) -> Anton, then Bebas for capitalised words (condensed display faces)
 *   modern sans (Poppins, Inter, Space Grotesk)  -> Inter, then Space Grotesk (narrower sans of the same register), then Bebas for capitalised words, then Anton for heavy weights
 *   script (Pacifico)                             -> Shrikhand (the other expressive display face)
 * A word that fits keeps its face. Returns null when no compatible face fits.
 */
import {textWidthEm} from './measure.ts';
import type {FontKey} from './schema.ts';

export type FaceCategory = 'editorialSerif' | 'boldDisplay' | 'modernSans' | 'script' | 'other';
export function faceCategory(font: FontKey): FaceCategory {
  if (font === 'playfair' || font === 'playfairItalic') return 'editorialSerif';
  if (font === 'anton' || font === 'bebas' || font === 'shrikhand' || font === 'archivoBlack') return 'boldDisplay';
  if (font === 'poppins' || font === 'inter' || font === 'spaceGrotesk') return 'modernSans';
  if (font === 'pacifico') return 'script';
  return 'other';
}
/** weights each face ships (remotion/public/fonts): a substitute keeps the closest available weight */
const WEIGHTS: Partial<Record<FontKey, number[]>> = {anton: [400], bebas: [400], shrikhand: [400], archivoBlack: [400], pacifico: [400], inter: [300, 400, 500, 600, 700, 800, 900], spaceGrotesk: [500, 700], poppins: [300, 500, 600, 700, 800, 900]};
const nearestWeight = (font: FontKey, w: number) => { const ws = WEIGHTS[font] ?? [w]; return ws.reduce((b, x) => (Math.abs(x - w) < Math.abs(b - w) ? x : b), ws[0]!); };
export function fitCandidates(font: FontKey, upper: boolean, weight: number): FontKey[] {
  switch (faceCategory(font)) {
    case 'editorialSerif': return [];
    case 'boldDisplay': return (['anton', ...(upper ? ['bebas'] : [])] as FontKey[]).filter(f => f !== font);
    case 'modernSans': return (['inter', 'spaceGrotesk', ...(upper ? ['bebas'] : []), ...(weight >= 700 ? ['anton'] : [])] as FontKey[]).filter(f => f !== font);
    case 'script': return ['shrikhand'];
    default: return [];
  }
}
export type FaceSpec = {font: FontKey; weight: number; upper: boolean; italic: boolean; ls: number};
/** width (px) of `text` in `face` at `px` */
export const widthAt = (text: string, face: FaceSpec, px: number) => textWidthEm(face.upper ? text.toUpperCase() : text, face.font, face.weight, face.upper, face.ls) * px;
/** null = the original face fits (keep it) or nothing compatible fits; otherwise the substitute face */
export function chooseFitFace(text: string, face: FaceSpec, floorPx: number, usableW: number): {face: FaceSpec; fits: true} | {face: null; fits: boolean} {
  if (widthAt(text, face, floorPx) <= usableW) return {face: null, fits: true};
  for (const font of fitCandidates(face.font, face.upper, face.weight)) {
    if (font === 'bebas' && !face.upper) continue; // Bebas is a caps face: never used to change the case of a lower-case word
    const f: FaceSpec = {font, weight: nearestWeight(font, face.weight), upper: face.upper, italic: false, ls: font === 'anton' || font === 'bebas' ? 0.01 : face.ls};
    if (widthAt(text, f, floorPx) <= usableW) return {face: f, fits: true};
  }
  return {face: null, fits: false};
}
