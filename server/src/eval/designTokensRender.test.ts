/**
 * Phase 31 (opt-in: RENDER_TESTS=1): the design-key migration on ENCODED output. Real Remotion composition (`remotion still ShortVideo`), one still per
 * scenario at a frame where the hook title, a kinetic-text pill and the captions are visible (all three read the design), compared by PNG hash within
 * the same run. No stored hashes, so nothing frozen is involved. Fixtures are new and synthetic (flat-colour source, no network, no model).
 *
 * Expected equivalence classes: a design is visible (A != G); the new key renders exactly like the legacy key (A = B = C); an invalid new design falls
 * back to a valid legacy one (E = F = A); when both are valid and differ, designTokens wins (D = A, and != J); a malformed design is never used
 * (G = H = I). The dual-written blueprint (C) renders exactly like the legacy-only one (A), which is what a not-yet-redeployed renderer produces.
 */
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

const RENDER = process.env.RENDER_TESTS === '1';
const REMOTION = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'remotion');
const W = 270;
const H = 480;
let work = '';

const D1 = {enabled: true, contentType: 'educational_tips', displayFont: 'bebas', primaryColor: '#E11D48', secondaryColor: '#0EA5E9', inkColor: '#FDF2F8', surfaceColor: '#111827', motionPreset: 'kinetic', cornerRadius: 14, density: 'balanced'};
const D2 = {...D1, contentType: 'story', displayFont: 'playfair', primaryColor: '#16A34A', secondaryColor: '#F59E0B', inkColor: '#F7FEE7', surfaceColor: '#052E16', motionPreset: 'editorial'};
const SCENARIOS: Record<string, Record<string, unknown>> = {
  A: {northStarDesign: D1},
  B: {designTokens: D1},
  C: {designTokens: D1, northStarDesign: D1},
  D: {designTokens: D1, northStarDesign: D2},
  E: {designTokens: {...D1, displayFont: 'comic_sans'}, northStarDesign: D1},
  F: {designTokens: {...D1, primaryColor: 'red'}, northStarDesign: D1},
  G: {},
  H: {northStarDesign: {...D1, primaryColor: 'red'}},
  I: {designTokens: {...D1, primaryColor: 'red'}, northStarDesign: {...D1, displayFont: 'comic_sans'}},
  J: {northStarDesign: D2},
};

const still = (name: string, extra: Record<string, unknown>): string => {
  const blueprint = {
    blueprintId: `p31-${name}`, videoUrl: 'staticFile:src.mp4', languageCode: 'en', fps: 30, width: W, height: H, sourceDurationSec: 3, outputDurationSec: 3,
    captionWords: [{text: 'design', start: 0.2, end: 1.0, sentenceIndex: 0}, {text: 'probe', start: 1.0, end: 2.5, sentenceIndex: 0}],
    keepSegments: [{sourceStart: 0, sourceEnd: 3, outputStart: 0}], zoomTriggers: [], brollClips: [],
    hookTitle: 'DESIGN PROBE', hookDurationSec: 3, hookStartSec: 0, hookStyle: 'stack',
    motionGraphics: [{start: 0.5, end: 2.9, text: 'KINETIC', role: 'primary', shape: 'pill', accentColor: '#FACC15', textColor: '#FFFFFF', anchor: 'top_right', entrance: 'scale_pop', exit: 'fade', fontScale: 1}],
    captionDirection: {position: 'bottom', bottomFrac: 0.2, textColor: '#FFFFFF', highlightColor: '#FFE600', boxColor: null, template: 'clean', animation: 'scale', fontScale: 1},
    ...extra,
  };
  const style = {captionTemplate: 'clean', layoutStyle: 'fullscreen', captionBottomFrac: 0.22, captionCenterXFrac: 0.5, brollEnabled: true, zoomEnabled: true, trimEnabled: true, colorGradeLut: ''};
  const props = join(work, `${name}.json`);
  const png = join(work, `${name}.png`);
  writeFileSync(props, JSON.stringify({blueprint, style}));
  const run = spawnSync('npx', ['remotion', 'still', 'src/index.ts', 'ShortVideo', png, `--props=${props}`, '--frame=45', '--log=error', '--timeout=120000', `--public-dir=${join(work, 'public')}`], {cwd: REMOTION, encoding: 'utf8'});
  expect(run.status, run.stderr).toBe(0);
  return createHash('sha256').update(readFileSync(png)).digest('hex');
};

beforeAll(() => {
  if (!RENDER) return;
  work = mkdtempSync(join(tmpdir(), 'design-tokens-'));
  mkdirSync(join(work, 'public'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x5b6b7b:s=${W}x${H}:r=30:d=3`, '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-c:a', 'aac', '-shortest', join(work, 'public', 'src.mp4')]);
});
afterAll(() => {
  if (work) rmSync(work, {recursive: true, force: true});
});

describe.skipIf(!RENDER)('design keys on encoded output (opt-in: RENDER_TESTS=1)', () => {
  it('renders each scenario and the equivalence classes are exactly the contract', () => {
    const hash: Record<string, string> = {};
    for (const [name, extra] of Object.entries(SCENARIOS)) hash[name] = still(name, extra);
    // a design is visibly applied
    expect(hash.A).not.toBe(hash.G);
    expect(hash.J).not.toBe(hash.A);
    // the new key renders exactly like the legacy key; a dual-written blueprint renders like the legacy-only one
    expect(hash.B).toBe(hash.A);
    expect(hash.C).toBe(hash.A);
    // invalid new data falls back to the valid legacy design
    expect(hash.E).toBe(hash.A);
    expect(hash.F).toBe(hash.A);
    // both valid and different: designTokens wins, nothing merged (D is exactly the designTokens-only render, and is not the legacy D2 render)
    expect(hash.D).toBe(hash.B);
    expect(hash.D).not.toBe(hash.J);
    // a malformed design is never used: identical to no design
    expect(hash.H).toBe(hash.G);
    expect(hash.I).toBe(hash.G);
  }, 600_000);
});
