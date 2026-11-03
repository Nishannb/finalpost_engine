/**
 * WP23 / WP25 shared fixtures (NOT part of the production bundle): inline SVG data-URL logos + screenshot, a stand-in for talking-head footage, and the motion theme wrapper.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';

import {MotionProvider} from '../../src/motion/context';
import {defaultTheme} from '../../src/motion/theme';

export const W = 1080;
export const H = 1920;
export const svg = (body: string, bg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" rx="60" fill="${bg}"/>${body}</svg>`)}`;
export const LOGOS = [
  svg('<circle cx="300" cy="300" r="170" fill="#fff"/><circle cx="300" cy="300" r="90" fill="#E11D48"/>', '#111827'),
  svg('<path d="M120 440 L300 130 L480 440 Z" fill="#fff"/><rect x="250" y="330" width="100" height="110" fill="#2563EB"/>', '#0F766E'),
  svg('<rect x="130" y="170" width="340" height="80" fill="#111"/><rect x="130" y="290" width="240" height="80" fill="#111"/><rect x="130" y="410" width="340" height="40" fill="#111"/>', '#FACC15'),
];
export const SHOT = svg('<rect x="40" y="70" width="520" height="70" rx="12" fill="#1F2937"/><rect x="40" y="170" width="250" height="150" rx="12" fill="#3B82F6"/><rect x="310" y="170" width="250" height="150" rx="12" fill="#10B981"/><rect x="40" y="350" width="520" height="60" rx="12" fill="#374151"/><rect x="40" y="430" width="520" height="60" rx="12" fill="#374151"/>', '#E5E7EB');

export const SAFE = {top: 120, bottom: 220, left: 40, right: 40};

/** A stand-in for talking-head footage so overlays read against a picture. `moving` adds a slow breathing scale so a preview does not read as a still. */
export const Footage: React.FC<{moving?: boolean}> = ({moving = false}) => {
  const frame = useCurrentFrame();
  const scale = moving ? 1 + 0.03 * Math.sin(frame / 22) : 1;
  return (
    <AbsoluteFill style={{background: 'linear-gradient(160deg,#4b5563 0%,#9a8f80 55%,#2b3340 100%)'}}>
      <AbsoluteFill style={{transform: `scale(${scale})`}}>
        <div style={{position: 'absolute', left: 340, top: 520, width: 400, height: 520, borderRadius: 200, background: '#c9a58a', opacity: 0.85}} />
        <div style={{position: 'absolute', left: 190, top: 1020, width: 700, height: 700, borderRadius: 330, background: '#1f2937', opacity: 0.9}} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Themed: React.FC<{children: React.ReactNode}> = ({children}) => (
  <MotionProvider theme={defaultTheme} safeArea={SAFE} width={W} height={H} idScope="wp23">{children}</MotionProvider>
);
