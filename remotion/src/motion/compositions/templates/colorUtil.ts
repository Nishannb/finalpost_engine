const HEX = /^#[0-9a-fA-F]{6}$/;

/** A `#RRGGBB` string, or undefined (palette props are only trusted when they are 6-digit hex). */
export const hexOr = (value: string | undefined): string | undefined => (value && HEX.test(value) ? value : undefined);

const channel = (hex: string, k: number): number => parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16);

/** Linear mix of two `#RRGGBB` colours (amount 0 = a, 1 = b). */
export function mixHex(a: string, b: string, amount: number): string {
  const out = [0, 1, 2].map(k => Math.round(channel(a, k) + (channel(b, k) - channel(a, k)) * amount));
  return `#${out.map(v => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0')).join('')}`;
}

/** Relative luminance 0..1 of a `#RRGGBB` colour. */
export function luminance(hex: string): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(channel(hex, 0)) + 0.7152 * lin(channel(hex, 1)) + 0.0722 * lin(channel(hex, 2));
}

/** White or near-black, whichever reads on `bg`. */
export const readableInk = (bg: string, light = '#FFFFFF', dark = '#0B0B0B'): string => (luminance(bg) > 0.42 ? dark : light);
