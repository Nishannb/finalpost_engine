/**
 * Theme tokens for generated motion graphics.
 *
 * The engine passes a (partial) theme in `props.theme`; the host resolves it
 * against `defaultTheme` so every graphic in a video shares one palette.
 * Graphics may still use other colours deliberately — the theme is a default,
 * not a cage.
 */

import type {DesignTokens} from '../blueprintSchema';
import {resolveShortFormLook} from './looks';
import type {FontId} from './fonts';

export type MotionTheme = {
  primary: string;
  secondary: string;
  /** Full-canvas background for opaque graphics. */
  background: string;
  /** Cards, panels, chips. */
  surface: string;
  text: string;
  mutedText: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  fontDisplay: FontId;
  fontBody: FontId;
  /** Corner radius in px at a 1080 px wide region; scale with the region. */
  radius: number;
  /** WP12A: short-form look ('auto' = pick from this theme). Set by the polish explain path; absent = the generic palette and the theme's own fonts. */
  look?: 'auto' | import('./looks').ShortFormLookId;
};

/** WP56: editorial paper default (was navy website `#0B1020` + indigo — flashy web look on kinetic plates). */
export const defaultTheme: MotionTheme = {
  primary: '#3D4A5C',
  secondary: '#6B7280',
  background: '#FAFAF7',
  surface: '#F0EEE8',
  text: '#111111',
  mutedText: '#5C5A55',
  accent: '#3D4A5C',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  fontDisplay: 'inter',
  fontBody: 'inter',
  radius: 28,
};

export function resolveTheme(partial?: Partial<MotionTheme> | null): MotionTheme {
  const theme = {...defaultTheme, ...(partial ?? {})};
  // WP12A: a themed short-form look also fixes the faces (display for hero titles, body for passages).
  if (theme.look) {
    const look = resolveShortFormLook(theme, theme.look);
    return {...theme, fontDisplay: look.fontDisplay, fontBody: look.fontBody};
  }
  return theme;
}

/** Maps the existing North Star design tokens onto a motion theme. */
export function themeFromNorthStar(design: DesignTokens): Partial<MotionTheme> {
  return {
    primary: design.primaryColor,
    secondary: design.secondaryColor,
    text: design.inkColor,
    surface: design.surfaceColor,
    radius: design.cornerRadius,
    fontDisplay: design.displayFont === 'bebas' ? 'bebas' : design.displayFont === 'space_grotesk' ? 'space_grotesk' : 'inter',
  };
}

/** `#RRGGBB` + alpha → rgba(). Non-hex input is returned unchanged. */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return color;
  }
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
