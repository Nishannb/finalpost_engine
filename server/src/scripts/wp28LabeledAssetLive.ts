/**
 * WP28: live labeled-asset polish proof (analyze -> bind logos -> re-analyze -> render).
 *
 *   PRODUCT_EDIT_PROFILE=polish MOTION_GRAPHICS_ENABLED=1 CUTS_DEBUG=1 \
 *     node --experimental-strip-types src/scripts/wp28LabeledAssetLive.ts /path/clip.mp4 auto \
 *     [--labeled-assets=/a.png,/b.png,/c.png] [--skip-render] [--dump-dir=DIR]
 *     [--render-blueprint=DIR/pass2-blueprint.json]   (render a saved pass-2 blueprint; no analysis, no API cost)
 *
 * Pass 1 analyzes with no assets and prints `editReadiness` + slots. The local assets (or three
 * generated solid-colour fixture logos) are uploaded to public HTTPS, bound onto the required
 * logo group (else the first logo/screenshot slots), and pass 2 re-analyzes with
 * `labeledAssetBindings` + `userBrollUrls`, then renders locally. Any other flag is handed to
 * firstVideo's parser. Live: costs Gemini/Groq/R2 per run, so there is no retry loop.
 */

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

import {env} from '../config/env.ts';
import {analyzeVideo} from '../pipeline/analyzeVideo.ts';
import {DEFAULT_RENDER_STYLE} from '../http/schemas.ts';
import {geminiBudgetFromLimit, geminiBudgetPlanFor, withGeminiBudget} from '../lib/geminiEditBudget.ts';
import {analyzeOverridesFor, normalizeEditProfile} from '../lib/productEditProfile.ts';
import {isLocalMediaPath, resolveLocalMediaPath} from '../lib/tempFiles.ts';
import {logger} from '../lib/logger.ts';
import {renderLocally} from '../stages/render/localRender.ts';
import {r2Configured, uploadPublicFile} from '../storage/r2.ts';
import {denoiseWasApplied} from '../stages/audio/noiseFilter.ts';
import type {LabeledAssetBinding, LabeledAssetSlot} from '../stages/broll/labeledAssetBrief.ts';
import {parseArgs} from './firstVideo.ts';

const DEFAULT_DUMP_DIR = path.resolve(
  process.cwd(),
  '../remotion/out/phase36-readiness/cuts-validation-test2-wp28-live',
);
const FIXTURE_COLORS = ['0x1a73e8', '0xe8453c', '0x2e9e5b'];

function takeFlag(argv: string[], prefix: string): {value: string | null; rest: string[]} {
  const hit = argv.find(arg => arg.startsWith(prefix));
  return {value: hit ? hit.slice(prefix.length) : null, rest: argv.filter(arg => arg !== hit)};
}

function makeFixtureLogos(dir: string): string[] {
  mkdirSync(dir, {recursive: true});
  return FIXTURE_COLORS.map((color, index) => {
    const file = path.join(dir, `fixture-logo-${index + 1}.png`);
    execFileSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=512x512`, '-frames:v', '1', file],
      {stdio: 'inherit'},
    );
    return file;
  });
}

async function uploadAsset(file: string, index: number): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  const contentType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
  const key = `wp28/labeled-${Date.now()}-${index + 1}${ext || '.png'}`;
  return (await uploadPublicFile(file, key, contentType)).publicUrl;
}

/** Required logo group siblings first (one group binding); remaining required groups are skipped so editReadiness can reach ready. Else first logo/screenshot slots. */
function planBindings(slots: LabeledAssetSlot[], urls: string[]): {bindings: LabeledAssetBinding[]; note: string} {
  const requiredGroups = [...new Set(slots.filter(slot => slot.required && slot.groupId && slot.status === 'needed').map(slot => slot.groupId!))];
  if (requiredGroups.length > 0) {
    const primary = requiredGroups[0]!;
    const size = slots.filter(slot => slot.groupId === primary).length;
    const bindings: LabeledAssetBinding[] = [
      {slotId: primary, status: 'uploaded', groupId: primary, assetUrls: urls.slice(0, size)},
      ...requiredGroups.slice(1).map(groupId => ({slotId: groupId, status: 'skipped' as const, groupId})),
    ];
    return {
      bindings,
      note: `bound ${primary} (${size} slots) from ${Math.min(size, urls.length)} uploads; skipped ${requiredGroups.slice(1).join(', ') || 'none'}`,
    };
  }
  const targets = slots.filter(slot => slot.kind === 'logo' || slot.kind === 'screenshot').slice(0, urls.length);
  return {
    bindings: targets.map((slot, index) => ({slotId: slot.id, status: 'uploaded' as const, assetUrl: urls[index]})),
    note: targets.length ? `no required group; bound first ${targets.length} logo/screenshot slots` : 'no logo/screenshot slots in the brief; nothing to bind',
  };
}

async function renderBlueprintTo(
  second: Parameters<typeof renderLocally>[0]['blueprint'],
  videoUrl: string,
  dumpDir: string,
): Promise<void> {
  const renderBlueprint =
    isLocalMediaPath(videoUrl) && !second.deliveryShaping && !denoiseWasApplied(second.stats.warnings)
      ? {...second, videoUrl: resolveLocalMediaPath(videoUrl)}
      : second;
  const {outputUrl} = await renderLocally({
    blueprint: renderBlueprint,
    style: {
      ...DEFAULT_RENDER_STYLE,
      captionTemplate: second.captionDirection?.template ?? DEFAULT_RENDER_STYLE.captionTemplate,
      captionBottomFrac: second.captionDirection?.bottomFrac ?? DEFAULT_RENDER_STYLE.captionBottomFrac,
      colorGradeLut: '',
    },
    renderJobId: `wp28_${second.blueprintId}`,
    onProgress: progress => {
      if (Math.round(progress * 20) % 4 === 0) logger.info({progress: Math.round(progress * 100)}, 'rendering');
    },
  });
  writeFileSync(path.join(dumpDir, 'OUTPUT_URL.txt'), outputUrl + '\n');
  console.log('\nDone. Edited video:\n' + outputUrl + '\n');
}

async function main(): Promise<void> {
  let argv = process.argv.slice(2);
  const assetsFlag = takeFlag(argv, '--labeled-assets=');
  argv = assetsFlag.rest;
  const dumpFlag = takeFlag(argv, '--dump-dir=');
  argv = dumpFlag.rest;
  const skipRender = argv.includes('--skip-render');
  argv = argv.filter(arg => arg !== '--skip-render');

  const dumpDir = path.resolve(dumpFlag.value ?? DEFAULT_DUMP_DIR);
  mkdirSync(dumpDir, {recursive: true});
  process.env.DIRECTOR_DUMP_DIR = dumpDir;

  const renderSaved = takeFlag(argv, '--render-blueprint=');
  argv = renderSaved.rest;

  const args = parseArgs(argv);
  if (!args.videoUrl) throw new Error('Pass the video path as the first argument.');
  if (isLocalMediaPath(args.videoUrl) && !existsSync(resolveLocalMediaPath(args.videoUrl))) {
    throw new Error(`File not found: ${args.videoUrl}`);
  }
  const editProfile = normalizeEditProfile(env.PRODUCT_EDIT_PROFILE);
  if (editProfile !== 'polish') throw new Error(`PRODUCT_EDIT_PROFILE must be polish (got ${editProfile}).`);
  if (!r2Configured()) throw new Error('R2 keys are missing.');

  if (renderSaved.value) {
    const saved = JSON.parse(readFileSync(renderSaved.value, 'utf8')) as Parameters<typeof renderLocally>[0]['blueprint'];
    await renderBlueprintTo(saved, args.videoUrl, dumpDir);
    return;
  }

  const localAssets = assetsFlag.value ? assetsFlag.value.split(',').map(item => item.trim()).filter(Boolean) : makeFixtureLogos(path.join(dumpDir, 'fixtures'));
  for (const file of localAssets) if (!existsSync(file)) throw new Error(`Labeled asset not found: ${file}`);

  const run = (extra: {userBrollUrls: string[]; labeledAssetBindings: LabeledAssetBinding[]}) =>
    withGeminiBudget(geminiBudgetFromLimit(env.GEMINI_EDIT_MAX_REQUESTS, geminiBudgetPlanFor(editProfile)), () =>
      analyzeVideo({
        videoUrl: args.videoUrl,
        languageCode: args.languageCode,
        userId: 'dev-user',
        forceSpeakerCutout: args.forceSpeakerCutout,
        directorV2: args.directorV2,
        northStar: args.northStar,
        requestedEdits: args.requestedEdits,
        forceDeliveryShaping: args.forceDeliveryShaping,
        captionTemplate: args.captionTemplate,
        noRepair: args.noRepair,
        generatedGraphicsEnabled: args.generatedGraphicsEnabled,
        ...analyzeOverridesFor(editProfile),
        editProfile,
        ...extra,
      }),
    );

  // Pass 1: no assets.
  logger.info({localAssets: localAssets.length}, 'wp28 pass 1: analyze without assets');
  const first = await run({userBrollUrls: [], labeledAssetBindings: []});
  const slots = first.assetBrief?.slots ?? [];
  console.log('\n--- PASS 1 editReadiness ---\n' + JSON.stringify(first.editReadiness, null, 2));
  console.log('--- PASS 1 slots ---\n' + slots.map(s => `${s.id} [${s.kind}] ${s.status}${s.required ? ' REQUIRED' : ''}${s.groupId ? ` group=${s.groupId}` : ''} ${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}s ${s.label}`).join('\n'));
  writeFileSync(path.join(dumpDir, 'pass1-summary.json'), JSON.stringify({editReadiness: first.editReadiness, slots, warnings: first.stats.warnings}, null, 2));

  // Simulate the mobile upload, then bind.
  const urls: string[] = [];
  for (const [index, file] of localAssets.entries()) urls.push(await uploadAsset(file, index));
  const {bindings, note} = planBindings(slots, urls);
  console.log(`\n--- BINDING --- ${note}\n${JSON.stringify(bindings, null, 2)}`);
  writeFileSync(path.join(dumpDir, 'bindings.json'), JSON.stringify({note, urls, bindings}, null, 2));
  if (bindings.length === 0) {
    console.log('Nothing to bind; stopping after pass 1 (honest result: speech had no logo/screenshot slots).');
    return;
  }

  // Pass 2: re-analyze with bindings.
  logger.info('wp28 pass 2: re-analyze with bindings');
  const second = await run({userBrollUrls: urls, labeledAssetBindings: bindings});
  console.log('\n--- PASS 2 editReadiness ---\n' + JSON.stringify(second.editReadiness, null, 2));
  const interesting = (second.stats.warnings ?? []).filter(w => /^(polish_pace|polish_assets|asset_brief|requested_not_placed|refusal)/.test(w));
  console.log('--- PASS 2 warnings ---\n' + interesting.join('\n'));
  const summary = {
    blueprintId: second.blueprintId,
    outputSec: second.outputDurationSec,
    editReadiness: second.editReadiness,
    overlays: second.visualOverlays.map(o => ({start: o.start, end: o.end, layout: o.layout, intent: (o as {intent?: string}).intent})),
    generatedGraphics: (second.generatedGraphics ?? []).map(g => `${g.id}@${g.start}-${g.end}:${g.placement.mode}`),
    transitions: second.stats.transitionCount,
    zooms: second.stats.zoomTriggerCount,
    warnings: second.stats.warnings,
  };
  writeFileSync(path.join(dumpDir, 'pass2-summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(path.join(dumpDir, 'pass2-blueprint.json'), JSON.stringify(second));

  if (skipRender) {
    console.log('\n--skip-render: done. Summaries in ' + dumpDir);
    return;
  }
  await renderBlueprintTo(second, args.videoUrl, dumpDir);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
