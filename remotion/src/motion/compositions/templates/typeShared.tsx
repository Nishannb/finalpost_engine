import React from 'react';

import {fontFamily} from '../../fonts';
import {hexOr, readableInk} from './colorUtil';

/** WP54: palette every kinetic-type comp reads (edit palette accent / ground / ink; defaults are proof-shell only). */
/** WP56: paper editorial defaults (Color Director); personalized beats still override via palette props. */
export const TYPE_DEFAULTS = {accent: '#3D4A5C', ground: '#FAFAF7', ink: '#111111'} as const;

export function typePalette(props: {accent?: string; ground?: string; ink?: string}): {accent: string; ground: string; ink: string} {
  const ground = hexOr(props.ground) ?? TYPE_DEFAULTS.ground;
  const accent = hexOr(props.accent) ?? TYPE_DEFAULTS.accent;
  const ink = hexOr(props.ink) ?? readableInk(ground, '#FFFFFF', '#0B0B0B');
  return {accent, ground, ink};
}

/** Frame-owning ground + centred column inside the safe area (type sits above the caption band; captions are muted while this owns the frame). */
export const TypeStage: React.FC<{width: number; height: number; ground: string; children: React.ReactNode}> = ({width, height, ground, children}) => (
  <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: ground, fontFamily: fontFamily('inter')}}>
    <div style={{position: 'absolute', left: width * 0.08, top: height * 0.12, width: width * 0.84, height: height * 0.64, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start'}}>{children}</div>
  </div>
);

/** Font size so the longest unbreakable run fits `boxW` (0.58 em per char is Inter-800 average), capped to a fraction of the height. */
export function fitFont(longestRun: number, boxW: number, maxPx: number): number {
  return Math.min(maxPx, boxW / (Math.max(4, longestRun) * 0.58));
}
