import React from 'react';
import {Img} from 'remotion';

/** A photo that fills its box (cover), or, with no `src`, a flat-colour silhouette stand-in (head + shoulders on a solid ground). No gradient, no blur, no glow. */
export const PhotoFill: React.FC<{src?: string; ground: string; figure: string; sun: string; grayscale?: boolean; layer?: 'all' | 'ground' | 'figure'}> = ({src, ground, figure, sun, grayscale = false, layer = 'all'}) => {
  // `layer` splits the stand-in so a wordmark can sit between the ground and the figure (text behind subject); a real `src` is always drawn whole (as the ground).
  if (src) {
    if (layer === 'figure') return null;
    return <Img src={src} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: grayscale ? 'grayscale(1)' : undefined}} />;
  }
  return (
    <div style={{position: 'absolute', inset: 0, backgroundColor: layer === 'figure' ? undefined : ground, overflow: 'hidden'}}>
      {layer !== 'figure' && <div style={{position: 'absolute', left: '62%', top: '14%', width: '16%', aspectRatio: '1 / 1', borderRadius: '50%', backgroundColor: sun}} />}
      {layer !== 'ground' && <div style={{position: 'absolute', left: '34%', top: '30%', width: '32%', aspectRatio: '1 / 1', borderRadius: '50%', backgroundColor: figure}} />}
      {layer !== 'ground' && <div style={{position: 'absolute', left: '16%', top: '66%', width: '68%', height: '60%', borderRadius: '50% 50% 0 0', backgroundColor: figure}} />}
    </div>
  );
};
