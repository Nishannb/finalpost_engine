/**
 * WP12A: server mirror of the short-form look pick (remotion/src/motion/looks.ts; the server does not import the renderer, a test asserts parity). PURE. The look is picked from the theme's own colours
 * (background lightness, accent hue / saturation), never from the subject of the video. The polish explain path uses it to (1) flag the plate theme (`look: 'auto'`, so the renderer draws the curated palette
 * and faces) and (2) set the karaoke highlight to the SAME look's accent, so plates and captions share one highlighter colour.
 */
import {hexLuminance, isNeonCyanHex} from './contrast.ts';

export type ShortFormLookId = 'paper_lime' | 'ink_white' | 'night_amber' | 'clean_mono';
/** The karaoke highlight colour of each look (equal to the look's marker; a test keeps it in sync with the renderer). */
export const LOOK_CAPTION_HIGHLIGHT: Record<ShortFormLookId, string> = {paper_lime: '#C8F31D', ink_white: '#C8F31D', night_amber: '#FFB020', clean_mono: '#FFFFFF'};

type LookTheme = {background?: unknown; accent?: unknown; primary?: unknown; secondary?: unknown};
const hex = (value: unknown): string | null => (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null);

function hsl(color: string): {h: number; s: number; l: number} {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return {h: 0, s: 0, l};
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return {h: (h * 60 + 360) % 360, s, l};
}

/** Same rules as the renderer's `pickShortFormLookId`; a missing / malformed colour counts as absent (a missing background reads as dark). */
export function pickShortFormLookId(theme: LookTheme): ShortFormLookId {
  const background = hex(theme.background);
  if (background && hexLuminance(background) >= 0.45) return 'paper_lime';
  const usable = [theme.accent, theme.primary, theme.secondary]
    .map(hex)
    .filter((color): color is string => color !== null && !isNeonCyanHex(color))
    .map(color => hsl(color))
    .filter(c => c.s >= 0.4 && c.l >= 0.2);
  if (usable.length === 0) return 'clean_mono';
  return usable.some(c => c.h >= 10 && c.h <= 65) ? 'night_amber' : 'ink_white';
}

/**
 * WP48: bias the theme pick toward CapCut / Metromedia video-edit lime when the content profile is product, edu, or energetic.
 * Keeps warm amber for intimate / story / pastel moods. Returns null when the theme pick should stand.
 */
export function preferVideoEditLook(
  picked: ShortFormLookId,
  profile: {contentType?: string | null; mood?: string | null} | null | undefined,
): ShortFormLookId | null {
  if (!profile) return null;
  const type = profile.contentType ?? '';
  const mood = profile.mood ?? '';
  if (mood === 'warm_intimate' || mood === 'soft_pastel' || mood === 'earthy_natural') return null;
  if (type === 'story' || type === 'testimonial' || type === 'comedy') return null;
  if (
    type === 'sales_pitch' ||
    type === 'educational_tips' ||
    type === 'tutorial' ||
    type === 'announcement' ||
    mood === 'bold_energetic' ||
    mood === 'tech_sharp' ||
    mood === 'clean_light'
  ) {
    return picked === 'paper_lime' ? null : 'paper_lime';
  }
  return null;
}

/** The plate theme for the explain path: the given theme plus `look: 'auto'`. */
export function withShortFormLook(theme: Record<string, unknown> | undefined): Record<string, unknown> {
  return {...(theme ?? {}), look: 'auto'};
}

/**
 * WP13C: the CAPTION TYPE contract of each look on the polish explain path: short-form video type, not website chrome.
 *   dark looks   (ink_white, night_amber, clean_mono): the whole line, including the active word, is the look's ink (white / warm white) with a heavy dark stroke and a soft drop shadow; no coloured glow, no
 *                neon fill. The active word is told apart by the animation (full opacity, pop), the Metromedia way.
 *   paper_lime   : white words with a heavy dark stroke; the ACTIVE word is dark ink on a lime marker bar (the Quartz highlighter).
 * Contrast assumption (documented, tested): white on the dark stroke is 21:1, and the stroke is the edge the viewer reads, so legibility does not depend on the face midtone behind it; the active lime bar carries
 * near-black ink at >= 7:1.
 */
export type CaptionTypeContract = {
  textColor: string;
  highlightColor: string;
  strokeColor: string;
  /** Stroke width as a fraction of the font size. */
  strokeWidthEm: number;
  glow: false;
  activeStyle: 'fill' | 'marker';
  /** Marker mode: the ink of the active word on the highlighter bar. */
  activeInk?: string;
};

export const LOOK_CAPTION_TYPE: Record<ShortFormLookId, CaptionTypeContract> = {
  paper_lime: {textColor: '#FFFFFF', highlightColor: '#C8F31D', strokeColor: '#0B0B0B', strokeWidthEm: 0.07, glow: false, activeStyle: 'marker', activeInk: '#0B0B0B'},
  ink_white: {textColor: '#FFFFFF', highlightColor: '#FFFFFF', strokeColor: '#000000', strokeWidthEm: 0.08, glow: false, activeStyle: 'fill'},
  night_amber: {textColor: '#FFF8EC', highlightColor: '#FFF8EC', strokeColor: '#0A0805', strokeWidthEm: 0.08, glow: false, activeStyle: 'fill'},
  clean_mono: {textColor: '#FFFFFF', highlightColor: '#FFFFFF', strokeColor: '#000000', strokeWidthEm: 0.08, glow: false, activeStyle: 'fill'},
};
