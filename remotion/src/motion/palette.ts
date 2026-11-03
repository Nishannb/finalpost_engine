/**
 * WP10A: the PLATE PALETTE. Pure: theme in, colours out. Plates (open / stamp / post / statement) take their identity from the video's theme (content profile), never from a fixed neon default.
 * Nothing here looks at what the video is about: it only measures contrast between the theme's own colours and picks the readable, most distinct ones.
 */
import {BLACK, hsl, isKaraokeCyan, luminanceOf, mixColors, plateContrast, readable, WHITE} from './colorMath';
import {resolveShortFormLook, type ShortFormLookId} from './looks';
import type {MotionTheme} from './theme';

export {isKaraokeCyan, mixColors, plateContrast} from './colorMath';

export type PlatePalette = {
  /** Top of the plate background. */
  ground: string;
  /** Bottom of the plate background: the ground pulled toward the theme's primary. */
  groundDeep: string;
  /** Main type on the ground (readable, >= 4.5:1). */
  ink: string;
  mutedInk: string;
  /** The highlighter / rule / ordinal colour (readable on the ground, >= 3:1). */
  marker: string;
  /** Type drawn ON the marker bar (>= 4.5:1). */
  markerInk: string;
  /** A captured-post / article surface and its ink. */
  paper: string;
  paperInk: string;
  paperMuted: string;
  /** Accent used as TEXT or an icon on the ground (the marker when it reads there, else ink): a lime bar is a fine highlighter but unreadable type on an off-white ground. */
  markerText: string;
  /** WP12A: the short-form look that produced this palette; absent for the generic theme-derived palette. */
  look?: ShortFormLookId;
};

/**
 * WP12A: with `theme.look` set ('auto' or a look id; the polish explain path sets it) the palette is the CURATED short-form look (looks.ts) picked from the theme. Without it the generic theme-derived palette
 * below (WP10A-WP11A) is returned unchanged.
 */
export function platePalette(theme: Pick<MotionTheme, 'primary' | 'secondary' | 'background' | 'surface' | 'text' | 'mutedText' | 'accent'> & {look?: 'auto' | ShortFormLookId}): PlatePalette {
  if (theme.look) {
    const look = resolveShortFormLook(theme, theme.look);
    return {
      ground: look.ground,
      groundDeep: look.groundDeep,
      ink: look.ink,
      mutedInk: look.mutedInk,
      marker: look.marker,
      markerInk: look.markerInk,
      paper: look.paper,
      paperInk: look.paperInk,
      paperMuted: look.paperMuted,
      markerText: plateContrast(look.marker, look.ground) >= 3 ? look.marker : look.ink,
      look: look.id,
    };
  }
  const ground = theme.background;
  const ink = readable(ground, 4.5, [theme.text]);
  // The marker is the most distinct readable colour the theme offers: accent first, then primary, secondary, ink.
  const offCyan = (colors: readonly string[]) => colors.filter(color => !isKaraokeCyan(color));
  // The theme's own accent stays the marker when it reads (>= 3:1 on the ground); ink otherwise.
  const markerCandidates = [...offCyan([theme.accent, theme.primary, theme.secondary]), ink];
  const marker = readable(ground, 3, markerCandidates);
  const tint = offCyan([theme.primary, theme.secondary])[0] ?? ink;
  // A card / chip that does not stand off the ground (surface within ~2:1 of it) is replaced by the ink colour, so paper reads as a bright object on the plate, with ground-coloured ink on it.
  const paper = plateContrast(theme.surface, ground) >= 2 ? theme.surface : ink;
  const paperInk = readable(paper, 4.5, paper === ink ? [ground, theme.text] : [theme.text, ink]);
  // The deep end of the gradient goes toward black (dark grounds) or white (light grounds) with only a hint of the tint: no muddy mid-tone navy.
  const dark = luminanceOf(ground) < 0.4;
  const deep = mixColors(ground, dark ? BLACK : WHITE, 0.35);
  return {
    ground,
    groundDeep: mixColors(deep, tint, tint === ink ? 0.04 : 0.12),
    ink,
    mutedInk: readable(ground, 3, [theme.mutedText]),
    marker,
    markerInk: readable(marker, 4.5, [ground, ink]),
    paper,
    paperInk,
    paperMuted: readable(paper, 3, [theme.mutedText, paperInk]),
    markerText: plateContrast(marker, ground) >= 3 ? marker : ink,
  };
}
