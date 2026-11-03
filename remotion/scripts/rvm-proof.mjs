/**
 * RVM cutout proof: is the Phase 3 RVM WebM (VP9 yuva420p) an independent Remotion layer? LOCAL render only: no Lambda, no network, no model run (the cutout is the existing Phase 3 file).
 *
 * Usage (from remotion/):   node scripts/rvm-proof.mjs            (not an npm script on purpose)
 *                           node scripts/rvm-proof.mjs --selftest (checker mechanics only: no bundle, no render, no Chrome)
 *
 * Inputs : ../subjectmatte/out/phase3/hi-first48.webm   (48 frames, 720x1280, 25 fps, alpha)
 *          ../captionkit_tmp/samples/sample.mp4           (a plain gradient, no person)
 * Output : out/rvm-proof/rvm-cutout-proof.mp4, 01-blue.png ... 07-subject-foreground-track.png, verify-*.png, rvm-proof-report.json
 *
 * Disk: refuses to start when less than 1.5 GiB is free. Only two small files are copied into a temp public dir (not remotion/public), and the temp bundle + public dirs are removed at the end.
 * Verification (ffmpeg, from the RENDERED files): the blue section's background must be #0033FF (not the room: plants / window / brown sofa) and the PIP section must show the gradient around
 * the person. If alpha did not survive Remotion the report says so and the process exits 1.
 */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..'); // remotion/
const engine = path.resolve(root, '..');
const require = createRequire(path.join(root, 'package.json'));

const W = 720;
const H = 1280;
const FPS = 25;
const SECTION = 8;
const FRAMES = 48;
const MIN_FREE_BYTES = 1.5 * 1024 ** 3;
const BLUE = [0x00, 0x33, 0xff];

const CUTOUT = path.join(engine, 'subjectmatte/out/phase3/hi-first48.webm');
const FOOTAGE = path.join(engine, 'captionkit_tmp/samples/sample.mp4');
const ROOM = path.join(root, 'public/hi.mp4'); // the ORIGINAL clip: used only as the negative control for the checks, never rendered
const outDir = path.join(root, 'out/rvm-proof');
const selftest = process.argv.includes('--selftest');

const STILLS = [
  ['01-blue.png', 4],
  ['02-footage.png', 12],
  ['03-split.png', 20],
  ['04-pip.png', 28],
  ['05-motion.png', 36],
  ['06-type-behind.png', 44],
]; // the middle frame of each 8-frame section
const PIP_BOX = {x: 0.56, y: 0.56, w: 0.42, h: 0.42};

// ---------------------------------------------------------------------------------------------------- helpers
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {maxBuffer: 1 << 28, ...opts});
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 6).join(' ')} ... failed: ${String(r.stderr).slice(-400)}`);
  return r.stdout;
}
const ffmpeg = args => sh('ffmpeg', ['-v', 'error', '-y', ...args]);

/** One frame (0-based index n) of `input` as a raw buffer in `pix`, optionally with extra filters (applied after the frame select). */
function rawFrame({input, n, pix, extraVf = '', decoder = null}) {
  const vf = `select=eq(n\\,${n})${extraVf ? ',' + extraVf : ''}`;
  return ffmpeg([...(decoder ? ['-c:v', decoder] : []), '-i', input, '-vf', vf, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', pix, '-']);
}
/** The alpha plane (0..255) of frame n of the WebM, decoded with libvpx-vp9 (the native vp9 decoder ignores WebM alpha). */
function alphaPlane(n, w = W, h = H) {
  const rgba = rawFrame({input: CUTOUT, n, pix: 'rgba', decoder: 'libvpx-vp9', extraVf: w === W && h === H ? '' : `scale=${w}:${h}`});
  const a = new Uint8Array(w * h);
  for (let i = 0; i < a.length; i += 1) a[i] = rgba[i * 4 + 3];
  return a;
}

/** 1 where the mask is set and stays set within a (2r+1) square: removes antialiased edges and codec bleed from the comparison. */
function erode(mask, w, h, r) {
  const pass = (src, len, stride, lines, lineStride) => {
    const out = new Uint8Array(src.length);
    for (let line = 0; line < lines; line += 1) {
      const base = line * lineStride;
      const pre = new Int32Array(len + 1);
      for (let i = 0; i < len; i += 1) pre[i + 1] = pre[i] + (src[base + i * stride] ? 0 : 1);
      for (let i = 0; i < len; i += 1) {
        const lo = Math.max(0, i - r);
        const hi = Math.min(len - 1, i + r);
        out[base + i * stride] = pre[hi + 1] - pre[lo] === 0 ? 1 : 0;
      }
    }
    return out;
  };
  return pass(pass(mask, w, 1, h, w), h, w, w, 1);
}

/** Fraction of the masked pixels whose colour is within `tol` (per channel) of `target`. `rgb` is rgb24, `refRgb` (optional) an rgb24 image to compare against instead of a flat colour. */
function matchFraction({rgb, mask, w, target, refRgb, tol, offsetX = 0, offsetY = 0, imgW = w}) {
  let ok = 0;
  let n = 0;
  for (let y = 0; y < mask.length / w; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x]) continue;
      const p = ((y + offsetY) * imgW + (x + offsetX)) * 3;
      const ref = refRgb ? [refRgb[p], refRgb[p + 1], refRgb[p + 2]] : target;
      n += 1;
      if (Math.abs(rgb[p] - ref[0]) <= tol && Math.abs(rgb[p + 1] - ref[1]) <= tol && Math.abs(rgb[p + 2] - ref[2]) <= tol) ok += 1;
    }
  }
  return {fraction: n ? ok / n : 0, pixels: n};
}
const r4 = v => Math.round(v * 10000) / 10000;

// ---------------------------------------------------------------------------------------------------- checks
/** Blue background: wherever the cutout alpha is 0 (eroded), the rendered frame must be #0033FF. Control: the ORIGINAL room clip at the same positions must NOT be. */
function blueCheck({renderedRgb, n}) {
  const alpha = alphaPlane(n);
  const transparent = erode(alpha.map(a => (a <= 2 ? 1 : 0)), W, H, 6);
  const total = transparent.reduce((s, v) => s + v, 0);
  const rendered = matchFraction({rgb: renderedRgb, mask: transparent, w: W, target: BLUE, tol: 40});
  const room = rawFrame({input: ROOM, n, pix: 'rgb24'});
  const control = matchFraction({rgb: room, mask: transparent, w: W, target: BLUE, tol: 40});
  return {
    transparentAreaFraction: r4(total / (W * H)),
    backgroundIsBlueFraction: r4(rendered.fraction),
    controlOriginalRoomIsBlueFraction: r4(control.fraction),
    pass: total / (W * H) > 0.2 && rendered.fraction >= 0.99 && control.fraction <= 0.2,
  };
}

/** PIP: inside the box, wherever the (scaled) cutout alpha is 0, the rendered frame must show the gradient footage; the original room at those positions must not match it. */
function pipCheck({renderedRgb, n}) {
  const bx = Math.round(PIP_BOX.x * W);
  const by = Math.round(PIP_BOX.y * H);
  const bw = Math.round(PIP_BOX.w * W);
  const bh = Math.round(PIP_BOX.h * H);
  const alpha = alphaPlane(n, bw, bh);
  const transparent = erode(alpha.map(a => (a <= 2 ? 1 : 0)), bw, bh, 3);
  const total = transparent.reduce((s, v) => s + v, 0);
  const gradient = rawFrame({input: FOOTAGE, n, pix: 'rgb24', extraVf: `scale=${W}:${H}`});
  const room = rawFrame({input: ROOM, n, pix: 'rgb24', extraVf: `scale=${bw}:${bh}`});
  const shown = matchFraction({rgb: renderedRgb, refRgb: gradient, mask: transparent, w: bw, tol: 24, offsetX: bx, offsetY: by, imgW: W});
  // control: the room clip scaled into the box vs the gradient at the same positions
  const roomFull = Buffer.alloc(W * H * 3);
  for (let y = 0; y < bh; y += 1) room.copy(roomFull, ((y + by) * W + bx) * 3, y * bw * 3, (y + 1) * bw * 3);
  const control = matchFraction({rgb: roomFull, refRgb: gradient, mask: transparent, w: bw, tol: 24, offsetX: bx, offsetY: by, imgW: W});
  return {
    transparentAreaInBoxFraction: r4(total / (bw * bh)),
    gradientVisibleAroundPersonFraction: r4(shown.fraction),
    controlOriginalRoomMatchesGradientFraction: r4(control.fraction),
    pass: total / (bw * bh) > 0.15 && shown.fraction >= 0.97 && control.fraction <= 0.2,
  };
}

if (selftest) {
  // Mechanics only: build the "rendered" frame in JS (cutout RGBA composited over blue). This is NOT a Remotion render; it proves the checker passes a true composite and rejects the original room.
  for (const p of [CUTOUT, ROOM]) if (!fs.existsSync(p)) throw new Error(`missing ${p}`);
  const n = 4;
  const rgba = rawFrame({input: CUTOUT, n, pix: 'rgba', decoder: 'libvpx-vp9'});
  const comp = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i += 1) {
    const a = rgba[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c += 1) comp[i * 3 + c] = Math.round(rgba[i * 4 + c] * a + BLUE[c] * (1 - a));
  }
  const good = blueCheck({renderedRgb: comp, n});
  const room = rawFrame({input: ROOM, n, pix: 'rgb24'});
  const bad = blueCheck({renderedRgb: room, n});
  console.log('selftest: JS composite over blue ->', JSON.stringify(good));
  console.log('selftest: original room as "render" ->', JSON.stringify(bad));
  const ok = good.pass && !bad.pass;
  console.log(ok ? 'selftest OK: the checker accepts a true composite and rejects the room' : 'selftest FAILED');
  process.exit(ok ? 0 : 1);
}

// ---------------------------------------------------------------------------------------------------- gates (before anything is bundled)
const stat = fs.statfsSync(root);
const freeBytes = stat.bavail * stat.bsize;
if (freeBytes < MIN_FREE_BYTES) {
  console.error(`STOP: ${(freeBytes / 1024 ** 3).toFixed(2)} GiB free, need at least ${(MIN_FREE_BYTES / 1024 ** 3).toFixed(1)} GiB. Nothing was bundled or rendered.`);
  process.exit(2);
}
for (const p of [CUTOUT, FOOTAGE, ROOM]) if (!fs.existsSync(p)) throw new Error(`missing input: ${p}`);
const probe = JSON.parse(sh('ffprobe', ['-v', 'error', '-c:v', 'libvpx-vp9', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_read_packets:stream_tags=alpha_mode', '-of', 'json', CUTOUT]).toString()).streams[0];
if (!(probe.codec_name === 'vp9' && probe.pix_fmt === 'yuva420p' && probe.width === W && probe.height === H && probe.r_frame_rate === `${FPS}/1` && Number(probe.nb_read_packets) === FRAMES)) {
  throw new Error(`cutout is not the expected Phase 3 file: ${JSON.stringify(probe)}`);
}

const {bundle} = require('@remotion/bundler');
const {openBrowser, renderMedia, renderStill, selectComposition} = require('@remotion/renderer');

fs.mkdirSync(outDir, {recursive: true});
const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rvm-proof-bundle-'));
const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rvm-proof-public-'));
fs.mkdirSync(path.join(publicDir, 'rvm-proof'));
fs.copyFileSync(CUTOUT, path.join(publicDir, 'rvm-proof/cutout.webm'));
fs.copyFileSync(FOOTAGE, path.join(publicDir, 'rvm-proof/footage.mp4'));
const inputProps = {cutoutSrc: 'staticFile:rvm-proof/cutout.webm', footageSrc: 'staticFile:rvm-proof/footage.mp4'};

const report = {startedAt: new Date().toISOString(), freeGiBBefore: r4(freeBytes / 1024 ** 3), cutout: probe, files: [], checks: {}};
let browser;
try {
  const serveUrl = await bundle({entryPoint: path.join(here, 'rvm/entry.tsx'), outDir: bundleDir, publicDir});
  browser = await openBrowser('chrome');
  const common = {serveUrl, puppeteerInstance: browser, inputProps};

  // 1) the 48-frame composition
  const comp = await selectComposition({...common, id: 'RvmCutoutProof'});
  const mp4 = path.join(outDir, 'rvm-cutout-proof.mp4');
  await renderMedia({...common, composition: comp, codec: 'h264', outputLocation: mp4, muted: true, imageFormat: 'png', pixelFormat: 'yuv420p', crf: 16, concurrency: 2, logLevel: 'warn'});
  report.files.push(mp4);
  console.log('rendered', mp4);

  // 2) stills: middle frame of each section, plus the production SubjectForegroundTrack
  for (const [name, frame] of STILLS) {
    await renderStill({...common, composition: comp, frame, output: path.join(outDir, name), imageFormat: 'png', logLevel: 'warn'});
    report.files.push(path.join(outDir, name));
  }
  const fgComp = await selectComposition({...common, id: 'RvmSubjectForegroundProof'});
  await renderStill({...common, composition: fgComp, frame: 24, output: path.join(outDir, '07-subject-foreground-track.png'), imageFormat: 'png', logLevel: 'warn'});
  report.files.push(path.join(outDir, '07-subject-foreground-track.png'));

  // 3) verification from the RENDERED files with ffmpeg
  const outProbe = JSON.parse(sh('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_read_packets', '-of', 'json', mp4]).toString()).streams[0];
  report.output = outProbe;
  report.checks.outputShape = {pass: outProbe.width === W && outProbe.height === H && outProbe.r_frame_rate === `${FPS}/1` && Number(outProbe.nb_read_packets) === FRAMES, ...outProbe};

  // the blue section, extracted from the mp4 (frame 4); the PNG is kept for inspection
  ffmpeg(['-i', mp4, '-vf', 'select=eq(n\\,4)', '-frames:v', '1', path.join(outDir, 'verify-blue-frame4-from-mp4.png')]);
  report.checks.blue = blueCheck({renderedRgb: rawFrame({input: mp4, n: 4, pix: 'rgb24'}), n: 4});

  // the PIP section (frame 28)
  ffmpeg(['-i', mp4, '-vf', 'select=eq(n\\,28)', '-frames:v', '1', path.join(outDir, 'verify-pip-frame28-from-mp4.png')]);
  report.checks.pip = pipCheck({renderedRgb: rawFrame({input: mp4, n: 28, pix: 'rgb24'}), n: 28});

  // the production SubjectForegroundTrack still: blue wherever alpha is 0 (frame 24 of the asset)
  report.checks.subjectForegroundTrack = blueCheck({renderedRgb: ffmpeg(['-i', path.join(outDir, '07-subject-foreground-track.png'), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']), n: 24});
} finally {
  if (browser) await browser.close({silent: true});
  fs.rmSync(bundleDir, {recursive: true, force: true});
  fs.rmSync(publicDir, {recursive: true, force: true});
}

report.pass = Object.values(report.checks).every(c => c.pass);
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(outDir, 'rvm-proof-report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.checks, null, 1));
console.log(report.pass ? 'PASS: alpha survived Remotion; the person is an independent layer' : 'FAIL: alpha did NOT survive Remotion (or a check failed); see rvm-proof-report.json');
process.exit(report.pass ? 0 : 1);
