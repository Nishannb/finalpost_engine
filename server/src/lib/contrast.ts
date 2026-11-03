/** WCAG relative luminance and contrast ratio of two #rrggbb colours. Pure; moved out of contentProfile.ts (which re-exports both) so pure modules and tests can use it. */
export function hexLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [hexLuminance(a), hexLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** WP10H: a vivid blue-green (hue 165-205, saturation >= 0.55, lightness 0.35-0.85): the karaoke neon. Same test as remotion/src/motion/palette.ts `isKaraokeCyan` (kept in sync by a test). */
export function isNeonCyanHex(hex: string): boolean {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return false;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1]!.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return false;
  const sat = d / (1 - Math.abs(2 * l - 1));
  const raw = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const hue = (raw * 60 + 360) % 360;
  return hue >= 165 && hue <= 205 && sat >= 0.55 && l >= 0.35 && l <= 0.85;
}
