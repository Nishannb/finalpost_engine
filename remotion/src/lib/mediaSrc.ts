/**
 * Blueprint asset URLs are rewritten to /prefetch/<job>/file before a local
 * burn. staticFile() maps that onto Remotion's public/ origin so Chrome never
 * has to hit Pexels mid-render.
 */

import {staticFile} from 'remotion';

export function resolveMediaSrc(src: string): string {
  if (src.startsWith('/prefetch/')) {
    return staticFile(src.slice(1));
  }
  if (src.startsWith('prefetch/')) {
    return staticFile(src);
  }
  if (src.startsWith('staticFile:')) {
    return staticFile(src.slice('staticFile:'.length));
  }
  return src;
}
