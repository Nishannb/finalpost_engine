/** WP12A: pure colour math shared by the plate palette and the short-form looks (no React, no theme). */
export type Rgb = [number, number, number];

const HEX6 = /^#?([0-9a-fA-F]{6})$/;
const HEX3 = /^#?([0-9a-fA-F]{3})$/;

export function parse(color: string): Rgb | null {
  const long = HEX6.exec(color.trim());
  if (long) return [0, 2, 4].map(i => parseInt(long[1]!.slice(i, i + 2), 16)) as Rgb;
  const short = HEX3.exec(color.trim());
  if (short) return short[1]!.split('').map(c => parseInt(c + c, 16)) as Rgb;
  return null;
}

const toHex = (rgb: Rgb): string => `#${rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export function luminanceOf(color: string): number {
  const rgb = parse(color);
  return rgb ? luminance(rgb) : 0;
}

export function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio; an unparseable colour reads as 1 (no contrast) so it is never chosen. */
export function plateContrast(a: string, b: string): number {
  const ra = parse(a);
  const rb = parse(b);
  if (!ra || !rb) return 1;
  const [hi, lo] = [luminance(ra), luminance(rb)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Linear mix of two colours (t = share of `b`). */
export function mixColors(a: string, b: string, t: number): string {
  const ra = parse(a);
  const rb = parse(b);
  if (!ra || !rb) return a;
  return toHex([0, 1, 2].map(i => ra[i]! + (rb[i]! - ra[i]!) * t) as Rgb);
}

/** Hue / saturation / lightness (h in degrees) of a colour, or null when unparseable. */
export function hsl(color: string): {h: number; s: number; l: number} | null {
  const rgb = parse(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(v => v / 255) as Rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return {h: 0, s: 0, l};
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return {h: (h * 60 + 360) % 360, s, l};
}

/**
 * WP10D: the karaoke look is neon blue-green. Plates must not read as the same pill, so a vivid colour in the blue-green band (hue 165-205, saturation >= 0.55,
 * lightness 0.35-0.85) is never chosen as a plate identity colour when the theme offers another. Pure colour test: it never looks at what the video is about.
 */
export function isKaraokeCyan(color: string): boolean {
  const c = hsl(color);
  return c !== null && c.h >= 165 && c.h <= 205 && c.s >= 0.55 && c.l >= 0.35 && c.l <= 0.85;
}

export const BLACK = '#0A0A0A';
export const WHITE = '#FFFFFF';

/** The first candidate that reaches `min` contrast on `on`; otherwise whichever of black / white reads best. */
export function readable(on: string, min: number, candidates: readonly string[]): string {
  for (const candidate of candidates) if (plateContrast(candidate, on) >= min) return candidate;
  return plateContrast(BLACK, on) >= plateContrast(WHITE, on) ? BLACK : WHITE;
}

