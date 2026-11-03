/**
 * Phase 20A (A2): RENDERER-LEVEL proof about the hook title. This test really renders frames with Remotion (`remotion still`,
 * headless Chrome) from a synthetic ffmpeg test pattern, then compares the PNG bytes. It does not parse source code.
 *
 *  - an absent hook ('' / whitespace / a window with no title) renders byte-identically to a video with no hook at all
 *  - a real title changes the frame (so the comparison can detect a hook)
 *  - the default-placeholder text ("WATCH THIS") also changes the frame, and differently from a real title
 *  - the method itself is deterministic (the same props rendered twice are byte-identical)
 *
 * OPT-IN: set RENDER_TESTS=1 (it needs ffmpeg and a working Remotion/Chrome install, ~6 s per still). It was default-on in Phase 20A,
 * but Chrome renders running beside the rest of the suite starve unrelated tests (the motion-worker README typecheck then exceeds
 * its 5 s timeout), so it is opt-in and the skip is reported by vitest, not hidden. Run it on its own:
 *   RENDER_TESTS=1 npx vitest run src/stages/broll/hookRender.test.ts src/eval/hookReplay.test.ts
 * No model, no network, no real footage.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {shortVideoPropsSchema} from '../../../../remotion/src/blueprintSchema.ts';

const REMOTION = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../remotion');
const enabled = process.env.RENDER_TESTS === '1';

const propsFor = (hookTitle: string, hookDurationSec: number) =>
  shortVideoPropsSchema.parse({
    blueprint: {
      blueprintId: 'bp_hook_render_test', languageCode: 'en', videoUrl: 'staticFile:testsrc.mp4', fps: 30, width: 1080, height: 1920,
      sourceDurationSec: 3, outputDurationSec: 3, captionWords: [], keepSegments: [{sourceStart: 0, sourceEnd: 3, outputStart: 0}],
      zoomTriggers: [], brollClips: [], hookTitle, hookStartSec: 0, hookDurationSec, hookStyle: 'minimal',
    },
    style: {captionTemplate: 'karaoke', layoutStyle: 'fullscreen', captionBottomFrac: 0.2, captionCenterXFrac: 0.5, brollEnabled: true, zoomEnabled: true, trimEnabled: true, colorGradeLut: ''},
  });

describe.skipIf(!enabled)('hook title, rendered frames (real Remotion render of a synthetic clip)', () => {
  let dir: string;
  const stills = new Map<string, string>();

  const render = (name: string, hookTitle: string, hookDurationSec: number) => {
    const propsPath = join(dir, `${name}.props.json`);
    const outPath = join(dir, `${name}.png`);
    writeFileSync(propsPath, JSON.stringify(propsFor(hookTitle, hookDurationSec)));
    execFileSync('npx', ['remotion', 'still', 'src/index.ts', 'ShortVideo', outPath, `--props=${propsPath}`, '--frame=30', `--public-dir=${join(dir, 'public')}`], {cwd: REMOTION, stdio: 'pipe', timeout: 120_000});
    stills.set(name, createHash('sha256').update(readFileSync(outPath)).digest('hex'));
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'hook-render-'));
    mkdirSync(join(dir, 'public'));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1080x1920:rate=30:duration=3', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', join(dir, 'public', 'testsrc.mp4')], {stdio: 'pipe'});
    render('no_hook', '', 0);
    render('no_hook_again', '', 0);
    render('empty_with_window', '', 3);
    render('whitespace_with_window', '   ', 3);
    render('real_title', 'Silence Speaks', 3);
    render('placeholder_text', 'WATCH THIS', 3);
  }, 240_000);

  afterAll(() => rmSync(dir, {recursive: true, force: true}));

  it('the method is deterministic: the same props rendered twice are byte-identical', () => {
    expect(stills.get('no_hook_again')).toBe(stills.get('no_hook'));
  });

  it('an empty title with a hook window renders exactly like a video with no hook (no hook element is drawn)', () => {
    expect(stills.get('empty_with_window')).toBe(stills.get('no_hook'));
  });

  it('a whitespace-only title also draws nothing visible', () => {
    expect(stills.get('whitespace_with_window')).toBe(stills.get('no_hook'));
  });

  it('a real title changes the frame, so the comparison can detect a hook', () => {
    expect(stills.get('real_title')).not.toBe(stills.get('no_hook'));
  });

  it('the placeholder text ("WATCH THIS", the default policy\'s fallback) also draws a hook, different from a real title', () => {
    expect(stills.get('placeholder_text')).not.toBe(stills.get('no_hook'));
    expect(stills.get('placeholder_text')).not.toBe(stills.get('real_title'));
  });
});
