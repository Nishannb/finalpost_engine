/**
 * V1: the user's selected CaptionKit preset -> a Kinetic visual identity (fonts, colours, case, outline, shadow).
 *
 * Pure, deterministic, no I/O. Kinetic keeps ownership of motion, timing, layout, positioning, dynamic font scaling, punch-ins,
 * transitions and the Match Cut composition: nothing here reads a preset's size, position, animation, mode or layout.
 *
 * Every property that cannot be carried over exactly is listed in `limitations` (with the deliberate fallback), so nothing is ignored silently.
 */
import type {BrandConfig, FontKey} from './schema.ts';

export type PresetLike = {
  id: string;
  font: {family: string; weight?: number; size?: number; case?: string; spacing?: number};
  colors: {text: string; active?: string; accent?: string; outline?: string; shadow?: string};
  stroke?: {width?: number; blur?: number};
  shadowDepth?: number;
  box?: {color?: string} | undefined;
  wordBox?: {color?: string} | undefined;
};

export type KineticIdentity = {
  presetId: string;
  /** one face for every role: a caption identity is one family */
  font: FontKey;
  /** poppins only (the one variable-weight face): the preset's weight snapped to the shipped weights */
  weight: number | null;
  /** true = every line upper-case, false = lower-case, null = Kinetic decides per role (preset case 'none') */
  upper: boolean | null;
  /** plain (non-highlighted) text */
  text: string;
  /** the highlighted / hero word */
  accent: string;
  accent2: string;
  /** outline (stroke) around the glyphs; null = none requested */
  outline: {color: string; strokePxAt1920: number} | null;
  /** cast shadow colour (rgba); null = keep Kinetic's neutral shadow */
  shadowColor: string | null;
  limitations: string[];
  mapping: {family: string; fontKey: FontKey; exact: boolean};
};

/** CaptionKit family -> the closest of the 10 Remotion font keys. `exact` = the same typeface. */
export const FONT_MAP: Readonly<Record<string, {key: FontKey; exact: boolean; why: string; /** poppins targets of a non-Poppins source: the weight to use (a fat display face must not become light Poppins) */ weight?: number}>> = {
  Anton: {key: 'anton', exact: true, why: 'same face'},
  'Bebas Neue': {key: 'bebas', exact: true, why: 'same face'},
  'Archivo Black': {key: 'archivoBlack', exact: true, why: 'same face'},
  Poppins: {key: 'poppins', exact: true, why: 'same face'},
  Pacifico: {key: 'pacifico', exact: true, why: 'same face'},
  Shrikhand: {key: 'shrikhand', exact: true, why: 'same face'},
  'Barlow Condensed': {key: 'bebas', exact: false, why: 'condensed caps grotesk'},
  'Fira Sans': {key: 'inter', exact: false, why: 'neutral humanist sans'},
  'Space Mono': {key: 'spaceGrotesk', exact: false, why: 'technical / mono feel'},
  'Chakra Petch': {key: 'spaceGrotesk', exact: false, why: 'technical sans'},
  'Russo One': {key: 'archivoBlack', exact: false, why: 'heavy wide grotesk'},
  'Press Start 2P': {key: 'spaceGrotesk', exact: false, why: 'pixel / technical'},
  'Black Ops One': {key: 'archivoBlack', exact: false, why: 'heavy stencil caps'},
  'Rubik Mono One': {key: 'archivoBlack', exact: false, why: 'heavy wide caps'},
  'Alfa Slab One': {key: 'archivoBlack', exact: false, why: 'heavy slab'},
  'Bowlby One': {key: 'archivoBlack', exact: false, why: 'heavy rounded display'},
  'Lilita One': {key: 'poppins', exact: false, why: 'fat rounded sans (Shrikhand is an italic serif)', weight: 900},
  'Titan One': {key: 'poppins', exact: false, why: 'fat rounded sans (Shrikhand is an italic serif)', weight: 900},
  'Luckiest Guy': {key: 'archivoBlack', exact: false, why: 'fat upright caps (Shrikhand is an italic serif)'},
  Bangers: {key: 'anton', exact: false, why: 'tall comic caps'},
  Righteous: {key: 'archivoBlack', exact: false, why: 'rounded heavy display'},
  Sniglet: {key: 'poppins', exact: false, why: 'rounded sans', weight: 800},
  Monoton: {key: 'archivoBlack', exact: false, why: 'wide retro display caps (the stripe detail is lost)'},
  Limelight: {key: 'playfair', exact: false, why: 'high-contrast display serif'},
  'Abril Fatface': {key: 'playfair', exact: false, why: 'high-contrast display serif'},
  'DM Serif Display': {key: 'playfair', exact: false, why: 'display serif'},
  'Yeseva One': {key: 'playfair', exact: false, why: 'display serif'},
  'Special Elite': {key: 'spaceGrotesk', exact: false, why: 'typewriter / mono feel (a serif would lose it)'},
  Caveat: {key: 'pacifico', exact: false, why: 'handwritten script'},
  Kalam: {key: 'pacifico', exact: false, why: 'handwritten script'},
  'Gloria Hallelujah': {key: 'pacifico', exact: false, why: 'handwritten script'},
  'Permanent Marker': {key: 'pacifico', exact: false, why: 'handwritten marker'},
};

const POPPINS_WEIGHTS = [300, 500, 600, 700, 800, 900];

const HEX6 = /^#[0-9a-fA-F]{6}/;
/** '#RRGGBB' or '#RRGGBBAA' -> {hex:'#RRGGBB', a: 0..1}; anything else -> null */
function parseColor(c: string | undefined): {hex: string; a: number} | null {
  if (!c || !HEX6.test(c) || (c.length !== 7 && c.length !== 9)) return null;
  return {hex: c.slice(0, 7).toUpperCase(), a: c.length === 9 ? parseInt(c.slice(7, 9), 16) / 255 : 1};
}
const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (hex: string) => 0.2126 * lin(parseInt(hex.slice(1, 3), 16)) + 0.7152 * lin(parseInt(hex.slice(3, 5), 16)) + 0.0722 * lin(parseInt(hex.slice(5, 7), 16));
const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

export function deriveKineticIdentity(preset: PresetLike): KineticIdentity {
  const limitations: string[] = [];
  const fam = FONT_MAP[preset.font.family];
  if (!fam) limitations.push(`font "${preset.font.family}" has no mapping: fell back to poppins`);
  const key: FontKey = fam?.key ?? 'poppins';
  if (fam && !fam.exact) limitations.push(`font "${preset.font.family}" -> ${fam.key} (nearest shipped face: ${fam.why})`);
  const wantW = preset.font.weight ?? 700;
  const weight = key === 'poppins' && fam && !fam.exact && fam.weight ? fam.weight : key === 'poppins' ? POPPINS_WEIGHTS.reduce((b, w) => (Math.abs(w - wantW) < Math.abs(b - wantW) ? w : b), 700) : null;
  if (key !== 'poppins' && wantW !== 400 && wantW !== 700) limitations.push(`weight ${wantW} is not selectable on ${key} (single shipped weight)`);

  const text = parseColor(preset.colors.text)?.hex ?? '#FFFFFF';
  // highlight = the first candidate that is clearly visible on video AND different from the plain text; the preset's own `active` colour wins when usable
  const candidates = [preset.colors.active, preset.colors.accent, preset.wordBox?.color, preset.box?.color].map(parseColor).filter((c): c is {hex: string; a: number} => Boolean(c));
  const usable = (c: {hex: string}) => ratio(c.hex, '#000000') >= 4.5 && ratio(c.hex, text) >= 1.15;
  const accentPick = candidates.find(usable);
  const accent = accentPick?.hex ?? text;
  if (!accentPick) limitations.push('no distinct highlight colour in the preset: highlighted words keep the text colour');
  else if (candidates[0] && accentPick.hex !== candidates[0].hex) limitations.push(`active colour ${candidates[0].hex} is not readable on video (it sits on a word box): highlight uses ${accentPick.hex}`);
  const accent2 = parseColor(preset.colors.accent)?.hex ?? accent;

  const stroke = preset.stroke?.width ?? 0;
  const outlineColor = parseColor(preset.colors.outline);
  const outline = stroke > 0 && outlineColor && outlineColor.a > 0 ? {color: outlineColor.hex, strokePxAt1920: Math.min(10, Math.round(stroke * 1920 * 10) / 10)} : null;
  if (stroke > 0 && !outline) limitations.push('outline requested without a usable colour: none drawn');
  if (outline && stroke * 1920 > 10) limitations.push(`outline ${(stroke * 1920).toFixed(1)}px capped at 10px (Kinetic type is scaled by its own solver)`);
  const sh = parseColor(preset.colors.shadow);
  const shadowColor = sh && sh.a > 0 && (preset.shadowDepth ?? 0) > 0 ? `rgba(${parseInt(sh.hex.slice(1, 3), 16)},${parseInt(sh.hex.slice(3, 5), 16)},${parseInt(sh.hex.slice(5, 7), 16)},${Math.max(0.35, Math.round(sh.a * 100) / 100)})` : null;

  const upper = preset.font.case === 'upper' ? true : preset.font.case === 'lower' ? false : null;
  if (preset.box || preset.wordBox) limitations.push('word / line box is a CaptionKit construct: its colour feeds the highlight, the box itself is not drawn (Kinetic uses its own plates)');
  limitations.push('size, position, animation and word timing stay Kinetic-owned by design');
  return {presetId: preset.id, font: key, weight, upper, text, accent, accent2, outline, shadowColor, limitations, mapping: {family: preset.font.family, fontKey: key, exact: Boolean(fam?.exact)}};
}

/** the BrandConfig a Kinetic run takes (legacy block presets read fonts / palette from it); ink = a dark neutral, paper = the preset's text colour */
export function identityToBrand(id: KineticIdentity): BrandConfig {
  return {
    fonts: {hero: id.font, support: id.font, caption: id.font},
    palette: {ink: '#111111', paper: id.text, accent: id.accent, accent2: id.accent2, gradients: {}},
  };
}
