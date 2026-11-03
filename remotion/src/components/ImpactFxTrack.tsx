/**
 * WP35: the Metromedia impact FX layers (see lib/impactFx.ts). Two parts, both reading the ABSOLUTE output frame (they sit outside the per-segment sequences, like SmashPunch):
 *   - `ImpactFxTrack`  an overlay painted over the picture and under the captions: the overexpose flash (1-2 frames), the saturation glow pop (2-4 frames) and the black-and-white grade flip. Plain
 *                      fills + `backdrop-filter` (the same technique the transition overlays already use), no asset, no network.
 *   - `ImpactPunch`    wraps the footage and scales it 1.00 -> 1.10 over 6-8 frames while a money window is open.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';

import {BW_CONTRAST, impactLayersAt, punchScaleForEvents, type ImpactFx} from '../lib/impactFx';

export const ImpactFxTrack: React.FC<{fx: Partial<ImpactFx> | undefined}> = ({fx}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (!fx) return null;
  const {flash, satPop, bw} = impactLayersAt(fx, frame, fps);
  if (!flash && !satPop && !bw) return null;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {bw ? <AbsoluteFill style={{backdropFilter: `grayscale(1) contrast(${BW_CONTRAST})`, WebkitBackdropFilter: `grayscale(1) contrast(${BW_CONTRAST})`}} /> : null}
      {satPop ? (
        <>
          <AbsoluteFill style={{backdropFilter: `saturate(${satPop.saturate}) brightness(${satPop.brightness}) contrast(${satPop.contrast})`, WebkitBackdropFilter: `saturate(${satPop.saturate}) brightness(${satPop.brightness}) contrast(${satPop.contrast})`}} />
          <AbsoluteFill style={{opacity: satPop.glowOpacity, mixBlendMode: 'screen', backgroundImage: 'radial-gradient(ellipse 70% 55% at 50% 45%, rgba(255,214,150,0.95) 0%, rgba(255,160,70,0.45) 55%, rgba(255,120,40,0) 100%)'}} />
        </>
      ) : null}
      {flash ? (
        <AbsoluteFill
          style={{
            backdropFilter: `brightness(${flash.brightness})`,
            WebkitBackdropFilter: `brightness(${flash.brightness})`,
            backgroundColor: `rgba(255,255,255,${flash.whiteOpacity})`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

export const ImpactPunch: React.FC<{fx: Partial<ImpactFx> | undefined; enabled?: boolean; children: React.ReactNode}> = ({fx, enabled = true, children}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const scale = enabled && fx?.punchIns && fx.punchIns.length > 0 ? punchScaleForEvents(fx.punchIns, frame, fps) : 1;
  if (scale === 1) return <>{children}</>;
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <AbsoluteFill style={{transform: `scale(${scale})`, transformOrigin: '50% 42%'}}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};
