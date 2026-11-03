/**
 * Font loading per language.
 *
 * Lambda's Chromium ships almost no non-Latin coverage, so Hindi/Nepali and
 * Tamil captions would render as tofu boxes without explicitly bundling Noto.
 * Fonts are loaded at module scope so they are ready before the first frame.
 */

import {loadFont as loadAnton} from '@remotion/google-fonts/Anton';
import {loadFont as loadBebas} from '@remotion/google-fonts/BebasNeue';
import {loadFont as loadInter} from '@remotion/google-fonts/Inter';
import {loadFont as loadManrope} from '@remotion/google-fonts/Manrope';
import {loadFont as loadTamil} from '@remotion/google-fonts/NotoSansTamil';
import {loadFont as loadOswald} from '@remotion/google-fonts/Oswald';
import {loadFont as loadPlayfair} from '@remotion/google-fonts/PlayfairDisplay';
import {loadFont as loadPoppins} from '@remotion/google-fonts/Poppins';
import {loadFont as loadSpaceGrotesk} from '@remotion/google-fonts/SpaceGrotesk';

import type {LanguageCode, DesignTokens, HookStyle} from '../blueprintSchema';
import {chooseFontFamily, guardFace, type GuardedFace} from './fontFallback';
import {CAPTION_FONT_REQUESTS, CAPTION_FONT_STYLE, type CaptionFontKey} from './fontRequests';

// WP3W: each family is loaded behind its own guard, so a failed fetch (or a bad weight/subset) loses that family only. A working load keeps the loader's own family name.
const warnOnce = new Set<string>();
const onFontFail = (name: string, error: unknown) => {
  if (warnOnce.has(name)) return;
  warnOnce.add(name);
  console.warn(`[fonts] ${name} failed to load; using a fallback face`, error);
};
// WP4Q: ask the loader for the style, weights and subsets the product uses (styles/fontRequests.ts), not for every file of the family. The library's option types are per-family literal unions, so the
// shared request is passed through one cast; the WP4Q test checks each entry against the installed metadata (a missing weight or subset would throw and drop the family).
type LoadWith = (style: typeof CAPTION_FONT_STYLE, options: never) => ReturnType<typeof loadInter>;
const requested = (key: CaptionFontKey, load: unknown) => () => {
  const request = CAPTION_FONT_REQUESTS[key];
  return (load as LoadWith)(CAPTION_FONT_STYLE, {weights: [...request.weights], subsets: [...request.subsets]} as never);
};
const anton = guardFace('Anton', requested('anton', loadAnton), onFontFail);
const bebas = guardFace('Bebas Neue', requested('bebas', loadBebas), onFontFail);
const inter = guardFace('Inter', requested('inter', loadInter), onFontFail);
const manrope = guardFace('Manrope', requested('manrope', loadManrope), onFontFail);
const tamil = guardFace('Noto Sans Tamil', requested('tamil', loadTamil), onFontFail);
const oswald = guardFace('Oswald', requested('oswald', loadOswald), onFontFail);
const playfair = guardFace('Playfair Display', requested('playfair', loadPlayfair), onFontFail);
const poppins = guardFace('Poppins', requested('poppins', loadPoppins), onFontFail);
const spaceGrotesk = guardFace('Space Grotesk', requested('spaceGrotesk', loadSpaceGrotesk), onFontFail);

// A failed family falls back to a face that DID load: Inter first (the general sans), then the rest in the order they are loaded above; none loaded -> sans-serif.
const FALLBACK_ORDER: readonly GuardedFace[] = [inter, anton, bebas, manrope, tamil, oswald, playfair, poppins, spaceGrotesk];
const familyOf = (face: GuardedFace): string => chooseFontFamily(face, FALLBACK_ORDER);

export type FontWeightKind = 'impact' | 'sans';

export function fontFamilyFor(
  language: LanguageCode,
  kind: FontWeightKind,
  design?: DesignTokens,
): string {
  // Captions/hooks are romanized to Latin letters for hi/ne/ta upstream.
  // Keep native faces only when the language is Tamil and we still need glyph
  // coverage for rare leftover native-script tokens.
  if (language === 'ta' && kind === 'sans') {
    return familyOf(tamil);
  }
  if ((language === 'hi' || language === 'ne') && kind === 'sans') {
    // Prefer Inter for romanized Hinglish; Noto Devanagari as soft fallback face.
    return familyOf(inter);
  }
  if (design?.enabled) {
    if (kind === 'sans') {
      return familyOf(manrope);
    }
    if (design.displayFont === 'bebas') {
      return familyOf(bebas);
    }
    if (design.displayFont === 'oswald') {
      return familyOf(oswald);
    }
    if (design.displayFont === 'playfair') {
      return familyOf(playfair);
    }
    return familyOf(spaceGrotesk);
  }
  return kind === 'impact' ? familyOf(anton) : familyOf(inter);
}

export function poppinsFontFamily(): string {
  return familyOf(poppins);
}

/**
 * Anton is a single-weight display face; Noto and Inter need an explicit weight
 * to look like the preview's bold captions.
 */
export function fontWeightFor(
  language: LanguageCode,
  kind: FontWeightKind,
  design?: DesignTokens,
): number {
  if (language === 'hi' || language === 'ne' || language === 'ta') {
    return 800;
  }
  if (design?.enabled) {
    if (kind === 'sans') {
      return 700;
    }
    return design.displayFont === 'playfair' ? 700 : design.displayFont === 'bebas' ? 400 : 700;
  }
  return kind === 'impact' ? 400 : 800;
}

export function hookDisplayFamily(
  language: LanguageCode,
  styleId: HookStyle,
  design?: DesignTokens,
): string {
  if (design?.enabled) {
    return fontFamilyFor(language, 'impact', design);
  }
  if (styleId === 'poster' || styleId === 'stack') {
    return familyOf(playfair);
  }
  if (styleId === 'minimal' || styleId === 'underline' || styleId === 'boxed') {
    return familyOf(inter);
  }
  if (styleId === 'bar' || styleId === 'rail') {
    return familyOf(oswald);
  }
  if (styleId === 'duo') {
    return familyOf(bebas);
  }
  return familyOf(anton);
}
