/**
 * WP3W: a font family that fails to load must not fail the render. Pure (no Remotion import) so it can be tested with stubs; `fonts.ts` wires the real `@remotion/google-fonts` loaders in.
 *
 * How `loadFont` fails (read in @remotion/google-fonts/dist/cjs/base.js):
 *  - SYNCHRONOUSLY, when the requested style/weight/subset is not in the font's metadata (a thrown Error);
 *  - ASYNCHRONOUSLY, when the font file cannot be fetched: after its retries the promise behind `waitUntilDone()` rejects.
 * Each family is guarded on its own, so one failure leaves every other family exactly as it was.
 */

/** What a Google font loader hands back (the part we use). */
export type LoadedFont = {fontFamily: string; waitUntilDone?: () => Promise<unknown>};

/** One guarded family. `family` is the loader's own name while it is usable and `undefined` once it threw or its fetch rejected. */
export type GuardedFace = {name: string; family: string | undefined};

/** Generic family used when no face loaded at all. */
export const LAST_RESORT_FAMILY = 'sans-serif';

export function guardFace(name: string, load: () => LoadedFont, onFail?: (name: string, error: unknown) => void): GuardedFace {
  const face: GuardedFace = {name, family: undefined};
  let reported = false;
  const fail = (error: unknown) => {
    face.family = undefined;
    if (reported) return;
    reported = true;
    onFail?.(name, error);
  };
  try {
    const font = load();
    face.family = typeof font?.fontFamily === 'string' && font.fontFamily.length > 0 ? font.fontFamily : undefined;
    if (face.family === undefined) {
      fail(new Error(`font ${name} returned no fontFamily`));
    } else if (typeof font.waitUntilDone === 'function') {
      // The promise can reject after the retries (network): mark this family unusable and handle the rejection so it is not left unhandled.
      Promise.resolve(font.waitUntilDone()).catch(fail);
    }
  } catch (error) {
    fail(error);
  }
  return face;
}

/**
 * The family to use for `preferred`: its own name when it loaded (so a working load keeps today's name), else the first face in `fallbackOrder` that did load, else `sans-serif`.
 */
export function chooseFontFamily(preferred: GuardedFace, fallbackOrder: readonly GuardedFace[]): string {
  if (preferred.family !== undefined) return preferred.family;
  for (const face of fallbackOrder) {
    if (face !== preferred && face.family !== undefined) return face.family;
  }
  return LAST_RESORT_FAMILY;
}
