/**
 * WP4O source-text tests: the useMotionFonts hook never cancels the render. The hook imports Remotion and React, so it is read as text. No render, no Chromium, no network.
 */
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
});

describe('useMotionFonts (source text)', () => {
  const hook = stripComments(read('remotion/src/motion/useMotionFonts.ts'));
  it('no longer imports or calls cancelRender', () => {
    expect(hook).not.toContain('cancelRender');
    expect(hook).toContain("import {continueRender, delayRender} from 'remotion';");
  });
  it('a rejection is warned and the render is released the same way as on success', () => {
    expect(hook).toContain('loadMotionFonts(text)\n      .catch(error => {');
    expect(hook).toContain('console.warn(`[motion fonts] loading failed; drawing with fallback glyphs:');
    expect(hook).toContain('.then(() => {\n        setReady(true);\n        continueRender(handle);\n      });');
  });
  it('the catch comes before the then, so both paths end in setReady(true) and one continueRender', () => {
    expect(hook.indexOf('.catch(')).toBeLessThan(hook.indexOf('.then(() => {'));
    expect(hook.match(/continueRender\(/g)).toHaveLength(1);
    expect(hook.match(/setReady\(true\)/g)).toHaveLength(1);
  });
  it('no second timeout and nothing else about the fonts changed', () => {
    expect(hook).not.toMatch(/setTimeout|withTimeout|Promise\.race|timeoutInMilliseconds/);
    expect(hook).toContain("delayRender('Loading motion fonts')");
    expect(hook).toContain('loadMotionFonts(text)');
    expect(hook).toContain('const [ready, setReady] = useState(!enabled);');
    expect(hook).toContain('}, [handle]);');
  });
  it('loadMotionFonts and the graphic fetch timeout are untouched', () => {
    const fonts = stripComments(read('remotion/src/motion/fonts.ts'));
    expect(fonts).toContain('export function loadMotionFonts(text = \'\'): Promise<void> {');
    expect(fonts).toContain('loadFontFile(spec, loadWithFontFace, {warn: message => console.warn(message)})');
    const loader = stripComments(read('remotion/src/generated/loader.ts'));
    expect(loader).toContain('{timeoutMs: GRAPHIC_FETCH_TIMEOUT_MS}');
    expect(stripComments(read('remotion/src/generated/loadFold.ts'))).toContain('export const GRAPHIC_FETCH_TIMEOUT_MS = 10_000;');
  });
  it('the opening and the behind-subject track still use the hook', () => {
    expect(read('remotion/src/components/OpeningTreatment.tsx')).toContain('useMotionFonts');
    expect(read('remotion/src/components/TextBehindSubjectTrack.tsx')).toContain('useMotionFonts');
  });
});

describe('no cancelRender is left in our own Remotion code', () => {
  it('no source file under remotion/src calls or imports it (comments aside)', () => {
    const offenders = walk(resolve(ROOT, 'remotion/src')).filter(file => /\bcancelRender\b/.test(stripComments(readFileSync(file, 'utf8'))));
    expect(offenders.map(file => file.slice(ROOT.length + 1))).toEqual([]);
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('server/src/config/env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
