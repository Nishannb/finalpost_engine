/**
 * WP4N: loading one font file must never cancel the render. Pure (no Remotion, no DOM): the loader is injected, so the rules are testable without a browser.
 *
 * `@remotion/fonts` `loadFont` calls `delayRender` and, on any failure, `cancelRender`, so catching its promise does not undo the cancel, and a load that never settles holds the handle until
 * Remotion gives up. `motion/fonts.ts` therefore registers fonts with `FontFace` itself and goes through this module: a failure is warned and resolves, a file that does not settle within the
 * limit is abandoned and resolves, and nothing here ever rejects.
 */
import {withTimeout} from '../generated/loadFold';

/** A font file is abandoned after this many milliseconds. */
export const FONT_FILE_TIMEOUT_MS = 10_000;

export type FontFileSpec = {family: string; url: string; weight: string; unicodeRange?: string};

export type FontFileResult = {spec: FontFileSpec; ok: true} | {spec: FontFileSpec; ok: false; reason: string};

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Loads one file with the injected `load` (which registers it on success). Never rejects: a failure, a synchronous throw or no answer within `timeoutMs` is `ok: false`. */
export async function loadFontFile(
  spec: FontFileSpec,
  load: (spec: FontFileSpec) => Promise<void>,
  options: {timeoutMs?: number; warn?: (message: string) => void} = {},
): Promise<FontFileResult> {
  try {
    await withTimeout((async () => load(spec))(), options.timeoutMs ?? FONT_FILE_TIMEOUT_MS, `Font ${spec.family} ${spec.weight}`);
    return {spec, ok: true};
  } catch (error) {
    const reason = reasonOf(error);
    options.warn?.(`[motion fonts] ${spec.family} ${spec.weight} (${spec.url}) not loaded; continuing: ${reason}`);
    return {spec, ok: false, reason};
  }
}

/** Loads every file together; resolves once all have loaded or been abandoned. Never rejects. */
export async function loadFontFiles(
  specs: readonly FontFileSpec[],
  load: (spec: FontFileSpec) => Promise<void>,
  options: {timeoutMs?: number; warn?: (message: string) => void} = {},
): Promise<{loaded: FontFileSpec[]; failed: Array<{spec: FontFileSpec; reason: string}>}> {
  const results = await Promise.all(specs.map(spec => loadFontFile(spec, load, options)));
  return {
    loaded: results.flatMap(result => (result.ok ? [result.spec] : [])),
    failed: results.flatMap(result => (result.ok ? [] : [{spec: result.spec, reason: result.reason}])),
  };
}

/** The real loader: a `FontFace` for the file, added to `document.fonts` on success (what `@remotion/fonts` did, without its render handle). Every shipped file is woff2. */
export async function loadWithFontFace(spec: FontFileSpec): Promise<void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') {
    throw new Error('FontFace is not available here');
  }
  const font = new FontFace(spec.family, `url('${spec.url}') format('woff2')`, {weight: spec.weight, unicodeRange: spec.unicodeRange});
  await font.load();
  (document.fonts as unknown as {add(face: FontFace): void}).add(font); // the DOM typings of this TypeScript version omit FontFaceSet.add
}
