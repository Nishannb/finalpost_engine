/**
 * WP36: offline proof of the FACELESS DOCUMENTARY lane: the WP33 cut plan + WP34 accumulate captions + WP35 impact FX + the lane's literal stock stills, composed into ONE 20-30 s montage a stranger can hold
 * next to the Metromedia open (100 % B-roll + VO, hard cuts, ~0.85 s shots, accumulate type). No live render, no talking head, no model. Network only for the stock photos (Pexels / Pixabay, cached in
 * public/wp36-fixtures/) and the bundled font fetch.
 * Usage (from remotion/): npm run preview:wp36   (fixture VO words: server/src/stages/broll/fixtures/wp36-vo-words.json; PEXELS_API_KEY / PIXABAY_API_KEY in ../.env on the first run, cached after)
 * Steps: (1) plan with the REAL server planners (voCutGrammar -> polishAccumulateCaptions -> polishImpactFx -> facelessDocLane with the PRODUCTION `findPhotoAsset` resolver),
 * (2) render the lane's runs with the PRODUCTION `ImageRun` (holdsSec + framedItems), FlashCard chapter card, ImpactPunch / ImpactFxTrack / AccumulateCaptions,
 * (3) measure the MP4 (cuts, coverage per frame, B&W share, flash spikes) and cut the evidence.
 * Output (out/phase36-readiness/): wp36-faceless-doc.mp4, wp36-contact-sheet.jpg, wp36-vs-metromedia.jpg, wp36-measured.json, wp36-plan.json, wp36-strip/*.png.
 */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(path.join(root, 'package.json'));
const {bundle} = require('@remotion/bundler');
const {openBrowser, renderMedia, renderStill, selectComposition} = require('@remotion/renderer');

const FPS = 30;
const outDir = path.join(root, 'out/phase36-readiness');
const stripDir = path.join(outDir, 'wp36-strip');
const fixturesDir = path.join(root, 'public/wp36-fixtures');
fs.mkdirSync(stripDir, {recursive: true});
fs.mkdirSync(fixturesDir, {recursive: true});
for (const name of fs.readdirSync(stripDir)) fs.rmSync(path.join(stripDir, name));
const mp4 = path.join(outDir, 'wp36-faceless-doc.mp4');
const contactSheet = path.join(outDir, 'wp36-contact-sheet.jpg');
const compareSheet = path.join(outDir, 'wp36-vs-metromedia.jpg');
const planFile = path.join(outDir, 'wp36-plan.json');
const measuredFile = path.join(outDir, 'wp36-measured.json');
const cacheFile = path.join(fixturesDir, 'query-cache.json');
const planTmp = path.join(os.tmpdir(), 'wp36-plan-raw.json');
const refDir = path.join(outDir, 'editref-994ed0-restudy');

function run(args, label) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed: ${r.stderr}`);
}

// 1) the plan comes from the REAL planners + the PRODUCTION resolver (Pexels / Pixabay `findPhotoAsset`), cached per query so a re-run is offline
const script = `
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
try { process.loadEnvFile(${JSON.stringify(path.resolve(root, '../.env'))}); } catch {}
const {ctaWindowsOf, moneyWindowsOf, planVoCutGrammar} = await import(${JSON.stringify(path.resolve(root, '../server/src/stages/broll/voCutGrammar.ts'))});
const {polishAccumulateCaptions} = await import(${JSON.stringify(path.resolve(root, '../server/src/lib/polishAccumulateCaptions.ts'))});
const {planImpactFx} = await import(${JSON.stringify(path.resolve(root, '../server/src/lib/polishImpactFx.ts'))});
const {planFacelessDocLane} = await import(${JSON.stringify(path.resolve(root, '../server/src/stages/broll/facelessDocLane.ts'))});
const {findPhotoAsset} = await import(${JSON.stringify(path.resolve(root, '../server/src/stages/broll/stockSearch.ts'))});
const fixture = JSON.parse(readFileSync(${JSON.stringify(path.resolve(root, '../server/src/stages/broll/fixtures/wp36-vo-words.json'))}, 'utf8'));
const flags = {moneyWindows: moneyWindowsOf(fixture.words), ctaWindows: ctaWindowsOf(fixture.words, fixture.durationSec)};
const plan = planVoCutGrammar({words: fixture.words, durationSec: fixture.durationSec, flags});
let sentence = 0;
const words = fixture.words.map(word => {
  const out = {text: word.text, start: word.start, end: word.end, sentenceIndex: sentence};
  if (/[.!?]["')]*$/.test(word.text)) sentence += 1;
  return out;
});
const bare = {position: 'bottom', bottomFrac: 0.2, textColor: '#FFFFFF', highlightColor: '#FFFFFF', boxColor: null, template: 'karaoke', animation: 'scale', fontScale: 1.4, maxWords: 2, glow: false, activeStyle: 'fill'};
const accumulate = polishAccumulateCaptions(bare, {plan, words: fixture.words, durationSec: fixture.durationSec});
const impact = planImpactFx({words: fixture.words, plan, durationSec: fixture.durationSec});
const cache = existsSync(${JSON.stringify(cacheFile)}) ? JSON.parse(readFileSync(${JSON.stringify(cacheFile)}, 'utf8')) : {};
const resolver = async (query, options) => {
  const list = Array.isArray(cache[query]) ? cache[query] : (cache[query] = []);
  const hit = list.find(item => !options.excludeKeys.has(item.provider + ':' + item.providerId));
  if (hit) return hit;
  const asset = await findPhotoAsset(query, {excludeKeys: options.excludeKeys, orientation: 'portrait'});
  if (!asset) return null;
  const entry = {assetUrl: asset.assetUrl, provider: asset.provider, providerId: asset.providerId, credit: asset.credit, creditUrl: asset.creditUrl};
  list.push(entry);
  return entry;
};
// chapter cards own their span (the production FlashCard path places them as full-screen graphics)
const blockedRanges = plan.chapterCards.map(card => ({start: card.at, end: card.at + card.duration}));
const lane = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, blockedRanges, resolver});
writeFileSync(${JSON.stringify(cacheFile)}, JSON.stringify(cache, null, 1));
writeFileSync(${JSON.stringify(planTmp)}, JSON.stringify({durationSec: fixture.durationSec, flags, ...plan, words, direction: accumulate.caption, fx: impact.fx, fxWarnings: impact.warnings, fxStats: impact.stats, lane, cache}));
`;
const gen = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {encoding: 'utf8', maxBuffer: 1 << 27, cwd: root});
if (gen.status !== 0) throw new Error(`could not plan the faceless lane: ${gen.stderr}`);
const plan = JSON.parse(fs.readFileSync(planTmp, 'utf8')); // (the stock client logs to stdout, so the plan travels through a file)
console.log(`plan: ${plan.lane.stats.shotCount} still shots in ${plan.durationSec}s (target ${(plan.durationSec / 0.85).toFixed(1)}); coverage photo ${plan.lane.stats.photoCoverage} media ${plan.lane.stats.mediaCoverage}; lookups ${plan.lane.stats.lookups}; ${plan.lane.warnings.join(' ')}`);

// download each distinct photo once (scaled to <= 1080 wide), map url -> local file
const files = {};
const credits = {};
for (const shot of plan.lane.shots) {
  if (files[shot.src]) continue;
  const name = `${shot.provider}-${shot.providerId}.jpg`;
  const file = path.join(fixturesDir, name);
  if (!fs.existsSync(file)) {
    const response = await fetch(shot.src);
    if (!response.ok) throw new Error(`download ${response.status} ${shot.src}`);
    const raw = path.join(os.tmpdir(), `wp36-raw-${name}`);
    fs.writeFileSync(raw, Buffer.from(await response.arrayBuffer()));
    run(['-i', raw, '-vf', "scale='min(1080,iw)':-2", '-q:v', '3', file], `scale ${name}`);
  }
  files[shot.src] = name;
  const entry = Object.values(plan.cache).flat().find(item => item.assetUrl === shot.src);
  credits[name] = {query: shot.query, provider: shot.provider, id: shot.providerId, credit: entry?.credit ?? '', creditUrl: entry?.creditUrl ?? ''};
}
fs.writeFileSync(path.join(fixturesDir, 'credits.json'), JSON.stringify(credits, null, 2));
plan.files = files;
delete plan.cache;
fs.writeFileSync(planFile, JSON.stringify(plan, null, 1));

const frameOfSec = sec => Math.round(sec * FPS);
const serveUrl = await bundle({entryPoint: path.join(here, 'wp36/entry.tsx'), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wp36-bundle-')), publicDir: path.join(root, 'public')});
const reuse = process.env.WP36_REUSE_MP4 === '1' && fs.existsSync(mp4); // re-measure / re-cut the evidence without re-rendering (the plan is deterministic from the cached stock)
const browser = reuse ? null : await openBrowser('chrome');
if (!reuse) try {
  const composition = await selectComposition({serveUrl, id: 'WP36Faceless', puppeteerInstance: browser});
  const started = Date.now();
  const full = path.join(os.tmpdir(), 'wp36-full.mp4');
  await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: full, puppeteerInstance: browser, scale: 1, muted: true, onProgress: p => { if (p.renderedFrames % 100 === 0) console.log('frames', p.renderedFrames); }});
  run(['-i', full, '-vf', 'scale=540:-2,fps=30', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', mp4], 'shrink');
  console.log('wrote', mp4, `${((Date.now() - started) / 1000).toFixed(1)}s`);
} finally {
  await browser?.close({silent: true});
}

// 2) measure the MP4: scene changes (every hard cut), per-frame coverage (luma range / saturation), flash spikes, black-and-white share
const duration = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', mp4], {encoding: 'utf8'}).stdout.trim());
const sceneProbe = spawnSync('ffmpeg', ['-v', 'info', '-i', mp4, '-vf', "select='gt(scene,0.2)',showinfo", '-an', '-f', 'null', '-'], {encoding: 'utf8', maxBuffer: 1 << 27});
const rawChanges = [...sceneProbe.stderr.matchAll(/pts_time:([\d.]+)/g)].map(match => Number(match[1]));
// the scene score also fires on the impact FX themselves (a flash coming off, the card fly-out smear, a B&W flip that is not on a cut), so the file is checked against the PLAN: a planned cut is verified when a
// scene change sits within 3 frames of it; any other change is an FX artifact or a look-alike miss and is reported, not counted as a shot
const plannedCuts = plan.cuts;
const verified = plannedCuts.filter(cut => rawChanges.some(at => Math.abs(at - cut) <= 3 / FPS));
const unmatched = rawChanges.filter(at => !plannedCuts.some(cut => Math.abs(at - cut) <= 3 / FPS));
const changes = verified;
const statsFile = path.join(os.tmpdir(), 'wp36-signalstats.txt');
spawnSync('ffmpeg', ['-v', 'error', '-i', mp4, '-vf', `signalstats,metadata=print:file=${statsFile}`, '-an', '-f', 'null', '-'], {maxBuffer: 1 << 27});
const statsText = fs.readFileSync(statsFile, 'utf8');
const perFrame = [];
for (const block of statsText.split(/frame:\d+\s+pts:/).slice(1)) {
  const pick = key => Number((block.match(new RegExp(`lavfi\\.signalstats\\.${key}=([\\d.]+)`)) ?? [])[1]);
  perFrame.push({pts: Number(block.split(/\s/)[0]), ylow: pick('YLOW'), yhigh: pick('YHIGH'), yavg: pick('YAVG'), satavg: pick('SATAVG')});
}
const frames = perFrame.length;
const cardRanges = plan.chapterCards.map(card => ({start: frameOfSec(card.at), end: frameOfSec(card.at + card.duration)}));
const flashFrames = new Set(plan.fx.flashes.flatMap(flash => Array.from({length: flash.frames}, (_, index) => frameOfSec(flash.startSec) + index)));
const inCard = index => cardRanges.some(range => index >= range.start && index < range.end);
// a "photo world" frame: not a chapter card, not a solid (luma range >= 40: a talking-head-free picture with tonal structure) -- impact flash frames count (the flash is drawn over the photo)
const isPhoto = index => !inCard(index) && (perFrame[index].yhigh - perFrame[index].ylow >= 40 || flashFrames.has(index));
const cardFrames = perFrame.filter((_, index) => inCard(index)).length;
const photoFrames = perFrame.filter((_, index) => isPhoto(index)).length;
const solidFrames = perFrame.filter((_, index) => !inCard(index) && !isPhoto(index)).length;
const bwFrames = perFrame.filter((frame, index) => !inCard(index) && frame.satavg < 1.5).length;
const flashSpikes = [...flashFrames].filter(index => index < frames && index > 0).map(index => ({frame: index, yavg: perFrame[index].yavg, before: perFrame[index - 1].yavg}));
const measured = {
  durationSec: Math.round(duration * 1000) / 1000,
  frames,
  fps: FPS,
  shots: {planned: plan.stats.shotCount, plannedStillShots: plan.lane.stats.shotCount, detectedSceneChangesRaw: rawChanges.length, detectedShotsRaw: rawChanges.length + 1, plannedCuts: plannedCuts.length, plannedCutsVerifiedOnFile: verified.length, unmatchedSceneChanges: unmatched.map(at => Math.round(at * 100) / 100), shotsOnFile: verified.length + 1, meanShotSecPlanned: plan.stats.meanShotSec, meanShotSecMeasured: Math.round((duration / (verified.length + 1)) * 1000) / 1000, targetShots: Math.round((duration / 0.85) * 10) / 10, targetBand: [Math.round((duration / 0.85) * 0.75 * 10) / 10, Math.round((duration / 0.85) * 1.25 * 10) / 10]},
  coverage: {photoFrames, cardFrames, solidOrBlackFrames: solidFrames, photoCoverageMeasured: Math.round((photoFrames / frames) * 1000) / 1000, mediaCoverageMeasured: Math.round(((photoFrames + cardFrames) / frames) * 1000) / 1000, photoCoveragePlanned: plan.lane.stats.photoCoverage, mediaCoveragePlanned: plan.lane.stats.mediaCoverage, maxGapSecPlanned: plan.lane.stats.maxGapSec, talkingHeadFrames: 0},
  grammar: {chapterCards: plan.chapterCards.length, flashes: plan.fx.flashes.length, satPops: plan.fx.satPops.length, punchIns: plan.fx.punchIns.length, framedCards: plan.lane.stats.framedShots, flyOuts: plan.lane.runs.reduce((sum, run) => sum + run.framedItems.filter((flag, index) => flag && index < run.items.length - 1).length, 0), bwSpans: plan.fx.bwSpans.length, bwSharePlanned: plan.fxStats.bwShare, bwShareMeasured: Math.round((bwFrames / frames) * 1000) / 1000, captionMode: plan.direction.mode},
  lane: plan.lane.stats,
  warnings: [...plan.warnings, ...plan.lane.warnings, ...plan.fxWarnings],
  flashSpikes,
  note: 'cuts = ffmpeg scene score > 0.2 on the rendered MP4 (a push-in alone stays far below it), matched to the planned cuts within 3 frames; shotsOnFile = verified cuts + 1; detectedShotsRaw also counts FX artifacts (flash off-edge, fly-out smear, B&W flips). photo frame = not a chapter card and luma range (YHIGH-YLOW) >= 40 or a planned flash frame; talkingHeadFrames is 0 by construction (no footage layer in the composition).',
};
fs.writeFileSync(measuredFile, JSON.stringify(measured, null, 1));
console.log('measured', JSON.stringify({shots: measured.shots, coverage: measured.coverage, grammar: measured.grammar}));

// 3) evidence: the middle frame of every planned shot (from the MP4), then a strip against the Metromedia open
const shotsAll = plan.shots;
const midFrames = [];
for (const [index, shot] of shotsAll.entries()) {
  const mid = Math.min(duration - 0.05, (shot.start + shot.end) / 2);
  const small = path.join(stripDir, `shot-${String(index).padStart(2, '0')}.png`);
  run(['-ss', String(mid), '-i', mp4, '-frames:v', '1', '-vf', 'scale=216:-1', small], `shot ${index}`);
  midFrames.push(small);
}
const columns = 8;
run(['-framerate', '1', '-i', path.join(stripDir, 'shot-%02d.png'), '-vf', `tile=${columns}x${Math.ceil(midFrames.length / columns)}:padding=4:color=black`, '-frames:v', '1', contactSheet], 'contact sheet');
console.log('contact sheet', contactSheet, `${midFrames.length} shots`);

if (fs.existsSync(refDir)) {
  const refs = fs.readdirSync(refDir).filter(name => /^open_0[1-6]\.jpg$/.test(name)).sort();
  const cells = [];
  const cell = (input, out) => run(['-i', input, '-vf', 'scale=300:300:force_original_aspect_ratio=decrease,pad=300:300:(ow-iw)/2:(oh-ih)/2:color=black', out], `cell ${out}`);
  refs.forEach((name, index) => {
    const out = path.join(stripDir, `cmp-ref-${index}.png`);
    cell(path.join(refDir, name), out);
    cells.push(out);
  });
  const picks = [0.5, 1.9, 3.6, 6.3, 12.6, 18.4];
  picks.slice(0, refs.length || 6).forEach((sec, index) => {
    const frame = path.join(stripDir, `cmp-ours-raw-${index}.png`);
    run(['-ss', String(sec), '-i', mp4, '-frames:v', '1', frame], `ours ${index}`);
    const out = path.join(stripDir, `cmp-ours-${index}.png`);
    cell(frame, out);
    cells.push(out);
  });
  const list = path.join(os.tmpdir(), 'wp36-cmp-list.txt');
  fs.writeFileSync(list, cells.map(file => `file '${file}'\nduration 1`).join('\n') + `\nfile '${cells[cells.length - 1]}'\n`);
  run(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `tile=${refs.length || 6}x2:padding=4:color=black`, '-frames:v', '1', compareSheet], 'compare sheet');
  console.log('vs metromedia', compareSheet, '(top: Metromedia open stills; bottom: this proof)');
}
