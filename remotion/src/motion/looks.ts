/**
 * WP12A: the SHORT-FORM LOOK SYSTEM. A few named, curated video looks shared by the plates and the polish captions. Each look is ONE ground, ONE ink, ONE highlighter marker and a white / off-white paper for
 * article and post cards, plus the display / body faces its plates use. Pure: theme in, look id out; the look id then fixes the colours, so a plate never inherits a muddy navy or a neon green that fights the
 * karaoke. The pick uses only the theme's own background lightness and accent hue / saturation, nothing about the subject of the video.
 *
 *   paper_lime   light background  -> off-white plate, black type, lime highlighter (the Quartz-style article look)
 *   night_amber  dark + warm accent -> near-black plate, warm white type, amber highlighter
 *   ink_white    dark + other saturated accent -> near-black plate, white type, lime highlighter
 *   clean_mono   dark + no usable accent -> near-black plate, white type, white-bar highlighter with black ink
 *
 * Faces are the three locally bundled ones (Inter, Space Grotesk, Bebas Neue): display = Bebas Neue (heavy condensed, the shorts headline face) or Space Grotesk; body = Inter.
 */
import {hsl, isKaraokeCyan, luminanceOf} from './colorMath';
import type {FontId} from './fonts';

export type ShortFormLookId = 'paper_lime' | 'ink_white' | 'night_amber' | 'clean_mono';
export const SHORT_FORM_LOOK_IDS: readonly ShortFormLookId[] = ['paper_lime', 'ink_white', 'night_amber', 'clean_mono'];

export type ShortFormLook = {
  id: ShortFormLookId;
  ground: string;
  groundDeep: string;
  ink: string;
  mutedInk: string;
  marker: string;
  markerInk: string;
  paper: string;
  paperInk: string;
  paperMuted: string;
  /** The karaoke caption highlight colour on a polish explain edit (the look's own accent: one highlighter colour per video). */
  caption: string;
  fontDisplay: FontId;
  fontBody: FontId;
};

const LIME = '#C8F31D';

export const SHORT_FORM_LOOKS: Record<ShortFormLookId, ShortFormLook> = {
  paper_lime: {id: 'paper_lime', ground: '#F5F2EA', groundDeep: '#E7E2D2', ink: '#0B0B0B', mutedInk: '#55524A', marker: LIME, markerInk: '#0B0B0B', paper: '#FFFFFF', paperInk: '#0B0B0B', paperMuted: '#5A5A55', caption: LIME, fontDisplay: 'bebas', fontBody: 'inter'},
  ink_white: {id: 'ink_white', ground: '#0A0A0A', groundDeep: '#000000', ink: '#FFFFFF', mutedInk: '#B4B4B4', marker: LIME, markerInk: '#0B0B0B', paper: '#FFFFFF', paperInk: '#0B0B0B', paperMuted: '#5A5A55', caption: LIME, fontDisplay: 'bebas', fontBody: 'inter'},
  night_amber: {id: 'night_amber', ground: '#12100C', groundDeep: '#050403', ink: '#FFF8EC', mutedInk: '#B3A998', marker: '#FFB020', markerInk: '#14110A', paper: '#FFF8EC', paperInk: '#14110A', paperMuted: '#5E564A', caption: '#FFB020', fontDisplay: 'space_grotesk', fontBody: 'inter'},
  clean_mono: {id: 'clean_mono', ground: '#111111', groundDeep: '#000000', ink: '#FFFFFF', mutedInk: '#A3A3A3', marker: '#FFFFFF', markerInk: '#0A0A0A', paper: '#F2F2F2', paperInk: '#0A0A0A', paperMuted: '#555555', caption: '#FFFFFF', fontDisplay: 'space_grotesk', fontBody: 'inter'},
};

type LookTheme = {background: string; accent: string; primary: string; secondary: string};

/** Pure pick from the theme's own colours (see the table above). Stable: same theme, same id. */
export function pickShortFormLookId(theme: LookTheme): ShortFormLookId {
  if (luminanceOf(theme.background) >= 0.45) return 'paper_lime';
  const usable = [theme.accent, theme.primary, theme.secondary]
    .filter(color => !isKaraokeCyan(color))
    .map(color => ({color, c: hsl(color)}))
    .filter((item): item is {color: string; c: {h: number; s: number; l: number}} => item.c !== null && item.c.s >= 0.4 && item.c.l >= 0.2);
  if (usable.length === 0) return 'clean_mono';
  return usable.some(item => item.c.h >= 10 && item.c.h <= 65) ? 'night_amber' : 'ink_white';
}

/** `look` is 'auto' (pick from the theme) or a look id. */
export function resolveShortFormLook(theme: LookTheme, look: 'auto' | ShortFormLookId = 'auto'): ShortFormLook {
  return SHORT_FORM_LOOKS[look === 'auto' ? pickShortFormLookId(theme) : look];
}
