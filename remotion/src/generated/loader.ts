/**
 * Runtime loader for generated motion graphics.
 *
 * Each graphic is a small CommonJS module (compiled from one TSX file) stored
 * content-addressed in R2. The module is fetched, its sha256 checked, then
 * evaluated with a `require` that only resolves the host's own React/Remotion,
 * so hooks and Sequence timing behave exactly like bundled components. A new
 * graphic never needs a site rebuild or redeploy.
 */

import React, {useEffect, useState} from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {
  AbsoluteFill,
  Easing,
  Sequence,
  Series,
  continueRender,
  delayRender,
  interpolate,
  interpolateColors,
  random,
  spring,
  useCurrentFrame,
} from 'remotion';

import type {GeneratedGraphic} from '../blueprintSchema';
import {resolveMediaSrc} from '../lib/mediaSrc';
import * as Motion from '../motion';
import {loadMotionFonts, textOf} from '../motion/fonts';
import {describeLoadError, fetchVerifyEvaluate, GRAPHIC_FETCH_TIMEOUT_MS, settleGraphicLoads} from './loadFold';

/** Bump when the module/props contract changes. */
export const GENERATED_RUNTIME_VERSION = '0.3.0';

/** The only Remotion surface a generated graphic can reach. */
const remotionSubset = {
  AbsoluteFill,
  Easing,
  Sequence,
  Series,
  interpolate,
  interpolateColors,
  random,
  spring,
  useCurrentFrame,
};

const MODULES: Record<string, unknown> = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  remotion: remotionSubset,
  '@finalpost/motion': Motion,
};

export type GraphicComponent = React.ComponentType<Record<string, unknown>>;

const moduleCache = new Map<string, Promise<GraphicComponent>>();

function requireShim(specifier: string): unknown {
  const mod = MODULES[specifier];
  if (!mod) {
    throw new Error(`Generated graphic imported "${specifier}", which is not allowed`);
  }
  return mod;
}

async function fetchAndEvaluate(url: string, sha256: string): Promise<GraphicComponent> {
  return fetchVerifyEvaluate<GraphicComponent>(
    {
      fetchText: async moduleUrl => {
        const response = await fetch(resolveMediaSrc(moduleUrl));
        if (!response.ok) {
          throw new Error(`Generated graphic fetch failed (${response.status}) for ${moduleUrl}`);
        }
        return response.text();
      },
      evaluate: (code, hash) => {
        const module = {exports: {} as Record<string, unknown>};
        // eslint-disable-next-line no-new-func
        const evaluate = new Function('require', 'module', 'exports', `${code}\n//# sourceURL=generated-graphic-${hash.slice(0, 12)}.js`);
        evaluate(requireShim, module, module.exports);
        return module.exports.default;
      },
    },
    url,
    sha256,
  );
}

function loadGeneratedGraphic(url: string, sha256: string): Promise<GraphicComponent> {
  let pending = moduleCache.get(sha256);
  if (!pending) {
    pending = fetchAndEvaluate(url, sha256);
    moduleCache.set(sha256, pending);
  }
  return pending;
}

/**
 * Loads every module the blueprint references, keyed by sha256. Called once at
 * the top of the composition so modules are ready before the first frame,
 * instead of stalling the frame where a graphic begins. Returns null while
 * loading; an empty blueprint resolves immediately without a delayRender.
 * WP4L: a module that fails (fetch, sha256, evaluate) is skipped, never cancels the render.
 */
export function useGeneratedGraphicComponents(
  graphics: GeneratedGraphic[],
): Record<string, GraphicComponent> | null {
  const signature = graphics.map(graphic => `${graphic.module.sha256}@${graphic.module.url}`).join('|');
  const [components, setComponents] = useState<Record<string, GraphicComponent> | null>(
    graphics.length === 0 ? {} : null,
  );
  const [handle] = useState(() =>
    graphics.length === 0 ? null : delayRender('Loading generated motion graphics'),
  );

  useEffect(() => {
    if (handle === null) {
      return;
    }
    // WP4L/WP4M: a graphic that fails to load, or does not answer within GRAPHIC_FETCH_TIMEOUT_MS, must not cancel the render. Fonts, then every module; each failure is skipped (and warned), the modules that loaded are used, and the render is
    // always released.
    const load = async () => {
      try {
        // Fonts first: modules may measure text, and measurements are cached.
        await loadMotionFonts(textOf(graphics.map(graphic => graphic.props)));
      } catch (error) {
        console.warn(`[generated graphics] motion fonts failed to load; continuing: ${describeLoadError(error)}`);
      }
      const {components: loaded, failures} = await settleGraphicLoads(graphics, loadGeneratedGraphic, {timeoutMs: GRAPHIC_FETCH_TIMEOUT_MS});
      for (const failure of failures) {
        console.warn(`[generated graphics] skipped ${failure.url} (${failure.sha256.slice(0, 12)}): ${failure.reason}`);
      }
      setComponents(loaded);
    };
    load()
      .catch(error => {
        console.warn(`[generated graphics] loading failed; rendering without generated graphics: ${describeLoadError(error)}`);
        setComponents({});
      })
      .finally(() => continueRender(handle));
    // `signature` captures every module identity; the array itself may be re-created per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, handle]);

  return components;
}
