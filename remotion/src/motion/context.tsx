/**
 * Per-graphic context provided by the host (GeneratedGraphicTrack). Generated
 * graphics still receive width/height/theme/safeArea as plain props; this only
 * lets library primitives pick up the theme and a collision-free SVG id scope
 * without prop-drilling.
 */

import React, {createContext, useContext, useId} from 'react';

import {defaultTheme, type MotionTheme} from './theme';
import {NO_SAFE_AREA, type SafeArea} from './layout';

type MotionContextValue = {
  theme: MotionTheme;
  safeArea: SafeArea;
  width: number;
  height: number;
  /** Unique per graphic instance in the timeline (sanitised graphic id). */
  idScope: string;
};

const MotionContext = createContext<MotionContextValue>({
  theme: defaultTheme,
  safeArea: NO_SAFE_AREA,
  width: 1080,
  height: 1920,
  idScope: 'mg',
});

export const MotionProvider: React.FC<MotionContextValue & {children: React.ReactNode}> = ({children, ...value}) => (
  <MotionContext.Provider value={{...value, idScope: sanitizeId(value.idScope)}}>{children}</MotionContext.Provider>
);

/** Theme of the graphic being rendered (resolved, never partial). */
export function useMotionTheme(): MotionTheme {
  return useContext(MotionContext).theme;
}

/**
 * Collision-free SVG id for gradients, filters, clip paths and masks.
 * Stable across frames and Lambda chunks (React useId is tree-positional).
 *   const glow = useSvgId('glow');  <filter id={glow}/>  fill={`url(#${glow})`}
 */
export function useSvgId(name: string): string {
  const {idScope} = useContext(MotionContext);
  return `${idScope}-${sanitizeId(useId())}-${sanitizeId(name)}`;
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}
