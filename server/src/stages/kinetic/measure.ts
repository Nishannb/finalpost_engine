/** Font measurement shared by the legacy solver (layout.ts) and the playbook solver (playbook.ts). */
import {HERO_LINE_HEIGHT_EM, glyphAdvanceEm, heroAdvanceEm} from '../broll/heroSweep.ts';
import {antonAdvanceEm, archivoBlackAdvanceEm, pacificoAdvanceEm, playfairAdvanceEm} from './fontAdvances.ts';
import type {FontKey} from './schema.ts';

// ---------------------------------------------------------------------------------------------------------------- font measurement

export type FontMetric = {adv: (ch: string) => number; lineEm: number; factor: number; family: string};
const WEIGHT_FACTOR = (w: number): number => (w >= 900 ? 1 : w >= 800 ? 0.99 : w >= 700 ? 0.97 : w >= 600 ? 0.94 : w >= 500 ? 0.9 : 0.86);
/** Inter-900 advances scaled per face (conservative: the planner may over-estimate width, never under). Bebas uses its own measured table. */
export const FONT_METRICS: Record<FontKey, FontMetric> = {
  bebas: {adv: heroAdvanceEm, lineEm: HERO_LINE_HEIGHT_EM, factor: 1, family: 'bebas'},
  inter: {adv: glyphAdvanceEm, lineEm: 1.0, factor: 1, family: 'inter'},
  spaceGrotesk: {adv: glyphAdvanceEm, lineEm: 1.0, factor: 0.97, family: 'spaceGrotesk'},
  shrikhand: {adv: glyphAdvanceEm, lineEm: 1.2, factor: 1.0, family: 'shrikhand'},
  poppins: {adv: glyphAdvanceEm, lineEm: 1.05, factor: 1.05, family: 'poppins'},
  playfair: {adv: playfairAdvanceEm, lineEm: 1.1, factor: 1, family: 'playfair'},
  playfairItalic: {adv: playfairAdvanceEm, lineEm: 1.1, factor: 1, family: 'playfair'},
  // per-video pairings: vendored OFL faces measured from their own glyph tables (fontAdvances.ts)
  anton: {adv: antonAdvanceEm, lineEm: 0.95, factor: 1, family: 'anton'},
  archivoBlack: {adv: archivoBlackAdvanceEm, lineEm: 1.0, factor: 1, family: 'archivoBlack'},
  pacifico: {adv: pacificoAdvanceEm, lineEm: 1.4, factor: 1, family: 'pacifico'},
};
/** faces that carry their own advance table (no Inter weight scaling) */
const OWN_TABLE: ReadonlySet<FontKey> = new Set<FontKey>(['bebas', 'playfair', 'playfairItalic', 'shrikhand', 'anton', 'archivoBlack', 'pacifico']);
export function textWidthEm(text: string, font: FontKey, weight: number, uppercase: boolean, letterSpacingEm: number): number {
  const m = FONT_METRICS[font];
  const wf = OWN_TABLE.has(font) ? 1 : WEIGHT_FACTOR(weight) * m.factor;
  const t = uppercase ? text.toUpperCase() : text;
  return (Array.from(t).reduce((s, ch) => s + m.adv(ch) * wf, 0) + letterSpacingEm * Array.from(t).length) * 1.03;
}

