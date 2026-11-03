import React from 'react';
import {Img} from 'remotion';

import {ENTER_EASE_OUT, EXIT_EASE_IN, MOVE_IN_OUT, bezierAt, eased} from '../../../lib/craftTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {hexOr, mixHex} from './colorUtil';
import {useTemplateClock} from './useTemplateClock';

export type ProductDeviceFrameProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The provided screenshot (a creator upload / asset-brief screenshot). Required upstream; without it the binder refuses the beat. */
  imageSrc?: string;
  /** browser = window chrome (default); phone = bezel + notch. */
  device?: 'browser' | 'phone';
  accent?: string;
  ground?: string;
  durationInFrames?: number;
};

export const DEVICE_FRAME_BASE_SEC = 3.4;

/**
 * CLIP_41 PRODUCT DEVICE FRAME (WP54 / cutaway, gated): browser or phone chrome around a PROVIDED screenshot. The device rises in (hero band, ease-out), the screenshot scrolls a small amount inside the frame (moveInOut), exit is ease-in
 * and shorter. No fake UI, no invented address text — only traffic-light dots / a notch. Silent, owns the frame.
 */
export const ProductDeviceFrame: React.FC<ProductDeviceFrameProps> = ({width, height, imageSrc, device = 'browser', accent, ground, durationInFrames}) => {
  const {t, durSec} = useTemplateClock(DEVICE_FRAME_BASE_SEC, durationInFrames);
  const bg = hexOr(ground) ?? '#0E1116';
  const hot = hexOr(accent) ?? '#BFFF00';
  const enter = bezierAt(ENTER_EASE_OUT, Math.min(1, t / 0.7));
  const exit = eased(EXIT_EASE_IN, t, Math.max(1.2, durSec - 0.35), 0.3);
  const scroll = eased(MOVE_IN_OUT, t, 0.6, Math.max(1, durSec - 1.2));
  const phone = device === 'phone';
  const frameW = phone ? width * 0.62 : width * 0.88;
  const frameH = phone ? Math.min(height * 0.7, frameW * 2.05) : frameW * 0.68;
  const chrome = phone ? frameW * 0.035 : frameH * 0.075;
  const shell = mixHex(bg, '#FFFFFF', 0.12);
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: bg, fontFamily: fontFamily('inter')}}>
      <div style={{position: 'absolute', left: (width - frameW) / 2, top: height * 0.38 - frameH / 2 + (1 - enter) * height * 0.14 + exit * height * 0.1, width: frameW, height: frameH, opacity: enter * (1 - exit), borderRadius: phone ? frameW * 0.1 : frameW * 0.02, backgroundColor: shell, overflow: 'hidden', border: `${Math.max(2, frameW * 0.004)}px solid ${mixHex(bg, '#FFFFFF', 0.28)}`}}>
        {phone ? (
          <div style={{position: 'absolute', left: '50%', top: chrome * 0.7, width: frameW * 0.22, height: chrome * 0.9, transform: 'translateX(-50%)', borderRadius: chrome, backgroundColor: '#000'}} />
        ) : (
          <div style={{position: 'absolute', left: 0, top: 0, right: 0, height: chrome, display: 'flex', alignItems: 'center', gap: chrome * 0.28, paddingLeft: chrome * 0.5}}>
            {['#FF5F57', '#FEBC2E', '#28C840'].map(c => (
              <div key={c} style={{width: chrome * 0.3, height: chrome * 0.3, borderRadius: '50%', backgroundColor: c}} />
            ))}
          </div>
        )}
        <div style={{position: 'absolute', left: phone ? chrome : 0, right: phone ? chrome : 0, top: phone ? chrome * 2.4 : chrome, bottom: phone ? chrome : 0, overflow: 'hidden', borderRadius: phone ? frameW * 0.07 : 0, backgroundColor: '#fff'}}>
          {imageSrc ? <Img src={imageSrc} style={{position: 'absolute', left: 0, top: 0, width: '100%', height: 'auto', minHeight: '100%', objectFit: 'cover', objectPosition: 'top', transform: `translateY(${-scroll * 6}%)`}} /> : <div style={{position: 'absolute', inset: 0, backgroundColor: mixHex('#FFFFFF', hot, 0.2)}} />}
        </div>
      </div>
      <div style={{position: 'absolute', left: width * 0.08, top: height * 0.38 + frameH / 2 + height * 0.035, width: width * 0.18 * enter * (1 - exit), height: Math.max(4, height * 0.004), backgroundColor: hot}} />
    </div>
  );
};
