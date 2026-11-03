/**
 * Kinetic fonts. Everything is vendored under public/fonts (SIL OFL, no network at render): Inter / Space Grotesk / Bebas via the existing motion loader, plus Playfair Display + Poppins woff2 added for this engine.
 * Families are "FP ..." names so a system copy can never change metrics.
 */
import {useEffect, useState} from 'react';
import {continueRender, delayRender, staticFile} from 'remotion';

import {loadMotionFonts} from '../motion/fonts';
import {loadFontFile, loadWithFontFace} from '../motion/fontLoad';
import type {FontKey} from './spec';

const EXTRA = [
  {family: 'FP Playfair Display', file: 'fonts/playfair-display-latin-400-normal.woff2', weight: '400', style: 'normal'},
  {family: 'FP Playfair Display', file: 'fonts/playfair-display-latin-400-italic.woff2', weight: '400', style: 'italic'},
  {family: 'FP Playfair Display', file: 'fonts/playfair-display-latin-700-italic.woff2', weight: '700', style: 'italic'},
  {family: 'FP Poppins', file: 'fonts/poppins-latin-300-normal.woff2', weight: '300', style: 'normal'},
  {family: 'FP Poppins', file: 'fonts/poppins-latin-500-normal.woff2', weight: '500', style: 'normal'},
  {family: 'FP Poppins', file: 'fonts/poppins-latin-600-normal.woff2', weight: '600', style: 'normal'},
  {family: 'FP Poppins', file: 'fonts/poppins-latin-700-normal.woff2', weight: '700', style: 'normal'},
  {family: 'FP Poppins', file: 'fonts/poppins-latin-800-normal.woff2', weight: '800', style: 'normal'},
  {family: 'FP Poppins', file: 'fonts/poppins-latin-900-normal.woff2', weight: '900', style: 'normal'},
  {family: 'FP Inter', file: 'fonts/inter-latin-300-normal.woff2', weight: '300', style: 'normal'},
  {family: 'FP Shrikhand', file: 'fonts/shrikhand-latin-400-normal.woff2', weight: '400', style: 'normal'},
  // per-video font pairings (SIL OFL, vendored): street = Archivo Black + Anton, neon = Poppins + Pacifico
  {family: 'FP Anton', file: 'fonts/anton-latin-400-normal.woff2', weight: '400', style: 'normal'},
  {family: 'FP Archivo Black', file: 'fonts/archivo-black-latin-400-normal.woff2', weight: '400', style: 'normal'},
  {family: 'FP Pacifico', file: 'fonts/pacifico-latin-400-normal.woff2', weight: '400', style: 'normal'},
] as const;

export const FONT_STACK: Record<FontKey, string> = {
  bebas: "'FP Bebas Neue', 'Arial Narrow', Impact, sans-serif",
  inter: "'FP Inter', 'Helvetica Neue', Arial, sans-serif",
  spaceGrotesk: "'FP Space Grotesk', 'FP Inter', Arial, sans-serif",
  poppins: "'FP Poppins', 'FP Inter', Arial, sans-serif",
  playfair: "'FP Playfair Display', Georgia, serif",
  playfairItalic: "'FP Playfair Display', Georgia, serif",
  shrikhand: "'FP Shrikhand', 'FP Playfair Display', Georgia, serif",
  anton: "'FP Anton', Impact, 'Arial Narrow', sans-serif",
  archivoBlack: "'FP Archivo Black', 'FP Inter', Arial, sans-serif",
  pacifico: "'FP Pacifico', 'Brush Script MT', cursive",
};

let pending: Promise<void> | null = null;
export function loadKineticFonts(): Promise<void> {
  pending ??= Promise.all([
    loadMotionFonts(),
    ...EXTRA.map(f =>
      loadFontFile(
        {family: f.family, url: staticFile(f.file), weight: f.weight},
        spec => new FontFace(spec.family, `url(${spec.url})`, {weight: spec.weight, style: f.style}).load().then(face => { (document.fonts as unknown as {add(f: FontFace): void}).add(face); }),
        {warn: m => console.warn(m)},
      ),
    ),
  ]).then(() => undefined);
  return pending;
}

/** Holds the render until the kinetic fonts are registered (never rejects). */
export function useKineticFonts(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const handle = delayRender('kinetic fonts');
    let live = true;
    loadKineticFonts().finally(() => {
      if (live) setReady(true);
      continueRender(handle);
    });
    return () => { live = false; };
  }, []);
  return ready;
}
