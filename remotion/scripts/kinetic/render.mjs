/**
 * Local kinetic renderer (stills + video) for the CLI and the storyboard. NOT an npm script.
 *   node scripts/kinetic/render.mjs <job.json>
 * job = {
 *   extraPublic: [{from: "/abs/file", to: "kinetic-job/name.mp4"}],          // copied into a temp public dir next to the repo's public/ (symlinked)
 *   stills:  [{id, frame, out, props}],                                       // PNG
 *   videos:  [{id, out, props, from?, to?, crf?}]                              // h264 mp4 (from/to = frame range)
 * }
 * Temp bundle + temp public dir are removed at the end. Refuses to start under 1.5 GiB free.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(path.join(root, 'package.json'));
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const free = (() => { const s = fs.statfsSync(root); return s.bavail * s.bsize; })();
if (free < 1.5 * 1024 ** 3) { console.error(`STOP: ${(free / 1024 ** 3).toFixed(2)} GiB free, need 1.5`); process.exit(2); }

const {bundle} = require('@remotion/bundler');
const {openBrowser, renderMedia, renderStill, selectComposition} = require('@remotion/renderer');

const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-bundle-'));
const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-public-'));
const hardlinkOrCopy = (from, to) => { try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); } };
// the bundler's static server does not follow file symlinks: directories are symlinked, files are hard-linked (else copied)
for (const name of fs.readdirSync(path.join(root, 'public'))) {
  const from = path.join(root, 'public', name);
  if (fs.statSync(from).isDirectory()) fs.symlinkSync(from, path.join(publicDir, name));
  else hardlinkOrCopy(from, path.join(publicDir, name));
}
for (const {from, to} of job.extraPublic ?? []) {
  const dest = path.join(publicDir, to);
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  // real file (hard link, else copy): the bundler's static server does not follow nested symlinks
  hardlinkOrCopy(path.resolve(from), dest);
}
let browser;
const written = [];
try {
  const serveUrl = await bundle({entryPoint: path.join(root, 'src/index.ts'), outDir: bundleDir, publicDir});
  // three.js needs a WebGL context: ANGLE (software SwiftShader when no GPU)
  const chromiumOptions = {gl: 'angle'};
  browser = await openBrowser('chrome', {chromiumOptions});
  for (const s of job.stills ?? []) {
    const composition = await selectComposition({serveUrl, id: s.id, puppeteerInstance: browser, inputProps: s.props ?? {}});
    fs.mkdirSync(path.dirname(s.out), {recursive: true});
    await renderStill({composition, serveUrl, frame: s.frame, output: s.out, puppeteerInstance: browser, chromiumOptions, imageFormat: 'png', inputProps: s.props ?? {}, logLevel: 'warn'});
    written.push(s.out);
  }
  for (const v of job.videos ?? []) {
    const composition = await selectComposition({serveUrl, id: v.id, puppeteerInstance: browser, inputProps: v.props ?? {}});
    fs.mkdirSync(path.dirname(v.out), {recursive: true});
    await renderMedia({
      composition, serveUrl, codec: 'h264', outputLocation: v.out, puppeteerInstance: browser, chromiumOptions, imageFormat: 'jpeg', crf: v.crf ?? 20, inputProps: v.props ?? {}, logLevel: 'warn',
      // keep peak /tmp JPEG buffer small on tight disks (full 1080x1920 kinetic edits)
      concurrency: v.concurrency ?? 1,
      ...(v.from !== undefined && v.to !== undefined ? {frameRange: [v.from, v.to]} : {}), muted: v.muted ?? false,
    });
    written.push(v.out);
  }
} finally {
  if (browser) await browser.close({silent: true});
  fs.rmSync(bundleDir, {recursive: true, force: true});
  fs.rmSync(publicDir, {recursive: true, force: true});
}
console.log('wrote:\n' + written.map(f => '  ' + f).join('\n'));
