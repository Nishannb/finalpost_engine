import {useEffect, useState} from 'react';
import {continueRender, delayRender} from 'remotion';

import {loadMotionFonts} from './fonts';

/**
 * Holds the render until the motion fonts (and the script subsets `text` needs) are loaded, so text measured by CurvedText / FitText never sees
 * fallback metrics. For host components outside generated graphics (those load fonts in `useGeneratedGraphicComponents`). A no-op when `enabled` is false.
 */
export function useMotionFonts(text: string, enabled = true): boolean {
  const [ready, setReady] = useState(!enabled);
  const [handle] = useState(() => (enabled ? delayRender('Loading motion fonts') : null));
  useEffect(() => {
    if (handle === null) {
      return;
    }
    // WP4O: a font failure never cancels the render. The text draws with fallback glyphs and the render is released exactly as on success (`loadMotionFonts` itself no longer rejects; this
    // keeps the hook safe if it ever does).
    loadMotionFonts(text)
      .catch(error => {
        console.warn(`[motion fonts] loading failed; drawing with fallback glyphs: ${error instanceof Error ? error.message : String(error)}`);
      })
      .then(() => {
        setReady(true);
        continueRender(handle);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);
  return ready;
}
