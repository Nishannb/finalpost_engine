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

import type {LanguageCode, NorthStarDesign, HookStyle} from '../blueprintSchema';

const anton = loadAnton();
const bebas = loadBebas();
const inter = loadInter();
const manrope = loadManrope();
const tamil = loadTamil();
const oswald = loadOswald();
const playfair = loadPlayfair();
const poppins = loadPoppins();
const spaceGrotesk = loadSpaceGrotesk();

export type FontWeightKind = 'impact' | 'sans';

export function fontFamilyFor(
  language: LanguageCode,
  kind: FontWeightKind,
  design?: NorthStarDesign,
): string {
  // Captions/hooks are romanized to Latin letters for hi/ne/ta upstream.
  // Keep native faces only when the language is Tamil and we still need glyph
  // coverage for rare leftover native-script tokens.
  if (language === 'ta' && kind === 'sans') {
    return tamil.fontFamily;
  }
  if ((language === 'hi' || language === 'ne') && kind === 'sans') {
    // Prefer Inter for romanized Hinglish; Noto Devanagari as soft fallback face.
    return inter.fontFamily;
  }
  if (design?.enabled) {
    if (kind === 'sans') {
      return manrope.fontFamily;
    }
    if (design.displayFont === 'bebas') {
      return bebas.fontFamily;
    }
    if (design.displayFont === 'oswald') {
      return oswald.fontFamily;
    }
    if (design.displayFont === 'playfair') {
      return playfair.fontFamily;
    }
    return spaceGrotesk.fontFamily;
  }
  return kind === 'impact' ? anton.fontFamily : inter.fontFamily;
}

export function poppinsFontFamily(): string {
  return poppins.fontFamily;
}

/**
 * Anton is a single-weight display face; Noto and Inter need an explicit weight
 * to look like the preview's bold captions.
 */
export function fontWeightFor(
  language: LanguageCode,
  kind: FontWeightKind,
  design?: NorthStarDesign,
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
  design?: NorthStarDesign,
): string {
  if (design?.enabled) {
    return fontFamilyFor(language, 'impact', design);
  }
  if (styleId === 'poster' || styleId === 'stack') {
    return playfair.fontFamily;
  }
  if (styleId === 'minimal' || styleId === 'underline' || styleId === 'boxed') {
    return inter.fontFamily;
  }
  if (styleId === 'bar' || styleId === 'rail') {
    return oswald.fontFamily;
  }
  if (styleId === 'duo') {
    return bebas.fontFamily;
  }
  return anton.fontFamily;
}
