/**
 * Font loading per language.
 *
 * Lambda's Chromium ships almost no non-Latin coverage, so Hindi/Nepali and
 * Tamil captions would render as tofu boxes without explicitly bundling Noto.
 * Fonts are loaded at module scope so they are ready before the first frame.
 */

import {loadFont as loadAnton} from '@remotion/google-fonts/Anton';
import {loadFont as loadInter} from '@remotion/google-fonts/Inter';
import {loadFont as loadTamil} from '@remotion/google-fonts/NotoSansTamil';

import type {LanguageCode} from '../blueprintSchema';

const anton = loadAnton();
const inter = loadInter();
const tamil = loadTamil();

export type FontWeightKind = 'impact' | 'sans';

export function fontFamilyFor(
  language: LanguageCode,
  kind: FontWeightKind,
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
  return kind === 'impact' ? anton.fontFamily : inter.fontFamily;
}

/**
 * Anton is a single-weight display face; Noto and Inter need an explicit weight
 * to look like the preview's bold captions.
 */
export function fontWeightFor(
  language: LanguageCode,
  kind: FontWeightKind,
): number {
  if (language === 'hi' || language === 'ne' || language === 'ta') {
    return 800;
  }
  return kind === 'impact' ? 400 : 800;
}
