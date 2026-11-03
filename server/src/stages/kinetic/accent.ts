/**
 * Per-video colour: the director names an accent per hero (hex or a small named set); the solver only checks contrast against the plate and nudges BRIGHTNESS (lightness) so the hue stays the director's.
 * When the plan has no accent (fallback / old plans) the accent is derived from THIS plate's dominant colour (complementary hue, contrast-checked): never from the storyboard sheet cycle.
 */
import {contrastRatio} from '../../lib/contrast.ts';
import {ACCENT_NAMES, type Accent} from './schema.ts';

/** Named accents: deliberately NOT the sheet colours (#F2C14E / #E6FF3B / #4FD8C9 / #FF4FA8). */
export const NAMED_ACCENTS: Record<(typeof ACCENT_NAMES)[number], string> = {
  gold: '#FFC21A',
  magenta: '#FF2E9A',
  cyan: '#18E0F5',
  crimson: '#E8143C',
  white: '#FFFFFF',
  lime: '#8CFF2E',
  orange: '#FF7A18',
  violet: '#A064FF',
  ice: '#BDE8FF',
};

export const resolveAccent = (a: Accent | undefined | null): string | null => {
  if (!a) return null;
  if (a.startsWith('#')) return a.toUpperCase();
  return NAMED_ACCENTS[a as keyof typeof NAMED_ACCENTS] ?? null;
};

export type Hsl = {h: number; s: number; l: number};
export function hexToHsl(hex: string): Hsl {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d > 1e-9) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return {h, s, l};
}
export function hslToHex({h, s, l}: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v + m)) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}
export const hueDistance = (a: number, b: number): number => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Keep the director's hue; move lightness until the accent reads (>= `min`:1) on the plate. Returns the colour and whether it was nudged. */
export function nudgeForContrast(hex: string, bgHex: string, min = 3): {hex: string; nudged: boolean} {
  if (contrastRatio(hex, bgHex) >= min) return {hex, nudged: false};
  const hsl = hexToHsl(hex);
  const bgDark = contrastRatio('#000000', bgHex) < contrastRatio('#FFFFFF', bgHex);
  let best = hex;
  let bestC = contrastRatio(hex, bgHex);
  for (let step = 1; step <= 14; step += 1) {
    const l = Math.min(0.95, Math.max(0.05, hsl.l + (bgDark ? 1 : -1) * step * 0.04));
    const cand = hslToHex({...hsl, l});
    const c = contrastRatio(cand, bgHex);
    if (c > bestC) { best = cand; bestC = c; }
    if (c >= min) return {hex: cand, nudged: true};
  }
  return {hex: best, nudged: best !== hex};
}

/** Accents for a plate: the two named colours whose hue sits furthest from the plate's dominant hue (and that read on it). Deterministic. */
export function plateAccents(plateHex: string | undefined, bgHex: string): string[] {
  const names = (['gold', 'magenta', 'cyan', 'crimson', 'lime', 'orange', 'violet', 'white'] as const).map(n => NAMED_ACCENTS[n]);
  if (!plateHex) return [NAMED_ACCENTS.gold, NAMED_ACCENTS.white];
  const p = hexToHsl(plateHex);
  const score = (c: string) => {
    const h = hexToHsl(c);
    const sat = p.s < 0.15 ? 0 : 1; // a grey plate has no hue to avoid
    return sat * (hueDistance(h.h, p.h) / 180) * (c === NAMED_ACCENTS.white ? 0.5 : 1) + Math.min(1, contrastRatio(c, bgHex) / 7) * 0.8;
  };
  return [...names].sort((a, b) => score(b) - score(a) || names.indexOf(a) - names.indexOf(b)).slice(0, 2);
}
