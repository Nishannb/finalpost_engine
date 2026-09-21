/**
 * Make one edited vertical video from a talking-head file you pass in.
 *
 *   npm run first-video -- /path/to/talking-head.mp4
 *   npm run first-video -- /path/to/clip.mp4 auto CELLULOID_01_FU_LOW
 *   npm run first-video -- /path/to/clip.mp4 auto --broll=/path/broll1.mp4,/path/broll2.mp4
 *   npm run first-video -- https://example.com/talking-head.mp4 hi
 *
 * Language defaults to `auto` so Hindi/Hinglish is not forced into English captions.
 * Local/dev first-video never applies a LUT. `--lut=` is accepted but ignored.
 * Optional `--broll=` is a comma-separated list of local files or public URLs.
 * `--cutout` forces speaker-over-B-roll so you can test the cutout path.
 * `--director-v2` runs the free multi-stage director (perception/story/creative/compiler).
 * `--north-star` runs Director v2 plus plate contrast, thesis tokens, stock rerank, and SFX.
 */

import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {analyzeVideo} from '../pipeline/analyzeVideo.ts';
import {DEFAULT_RENDER_STYLE} from '../http/schemas.ts';
import {isLocalMediaPath, resolveLocalMediaPath} from '../lib/tempFiles.ts';
import {userBrollFingerprintKey} from '../stages/broll/userBrollDescribe.ts';
import {logger} from '../lib/logger.ts';
import {dumpDirectorTrace} from '../lib/directorDump.ts';
import {formatAssemblerTerminal} from '../lib/assembler/index.ts';
import {listAvailableLuts, normalizeLutId} from '../stages/color/luts.ts';
import {saveBlueprint, fingerprintSource} from '../store/engineStore.ts';
import {renderLocally} from '../stages/render/localRender.ts';
import {r2Configured} from '../storage/r2.ts';
import {transcriptionConfigured} from '../stages/transcribe/groqTranscribe.ts';
import type {LanguageCode} from '../types/blueprint.ts';
import {SUPPORTED_LANGUAGES} from '../types/blueprint.ts';
import {
  formatEditToolkitList,
  mergeDeliveryShapingAllowlist,
  parseCaptionTemplateFlag,
  parseEditAllowlist,
  resolvePipelineEdits,
} from '../lib/editToolkits.ts';

function usage(): string {
  const luts = listAvailableLuts();
  return [
    'Pass the talking-head file to edit.',
    '',
    '  npm run first-video -- "/path/to/your-clip.mp4" [language] [lutId]',
    '  npm run first-video -- "https://your-public-clip.mp4" auto CELLULOID_01_FU_LOW',
    '  npm run first-video -- "/path/to/clip.mp4" auto --broll="/path/broll1.mp4,/path/broll2.mp4"',
    '  npm run first-video -- "/path/to/clip.mp4" auto --cutout --broll="/path/broll.mp4"',
    '  npm run first-video -- "/path/to/clip.mp4" auto --north-star',
    '  npm run first-video -- "/path/to/clip.mp4" auto --captions=karaoke',
    '  npm run first-video -- "/path/to/clip.mp4" auto --full-edits --captions=karaoke',
    '',
    '  npm run first-video -- "/path/to/clip.mp4" auto --edits=inset_reveal,depth_overlay,cutaway --delivery-shaping --captions=karaoke',
    '  npm run first-video -- "/path/to/clip.mp4" auto --edits=delivery_shaping,inset_reveal --captions=karaoke',
    '  npm run first-video -- --list-edits',
    '',
    'language: en | es | hi | ta | ne | auto  (default: auto)',
    `lutId: one of ${luts.length ? luts.join(', ') : '(none found in luts/)'}`,
    'broll: comma-separated local files or public URLs (optional)',
    '--cutout: force speaker cutout over B-roll (test the cutout renderer)',
    '--director-v2: free multi-stage director (Stages 0/1/2/4)',
    '--north-star: Director v2 + plate contrast + thesis tokens + stock rerank + SFX',
    '--edits=id,id  (or repeated --edit=id): turn specific visual toolkits back on',
    '--full-edits: unlock every toolkit (same as --edits=all)',
    '--delivery-shaping: include Delivery Shaping (audio/pacing). Also --edits=delivery_shaping',
    '--no-delivery-shaping: skip Delivery Shaping even when --edits is omitted',
    '--no-repair: skip the one director repair pass (dumps / diagnostics)',
    '--captions=<template>: kinetic caption look (karaoke, hormozi, …)',
    '--list-edits: print every toolkit and caption template, then exit',
    '',
    'Default pipeline is lean: captions, auto-trim, auto-zoom, and a varied hook title.',
    'B-roll and the other visual toolkits stay in the repo; pass --edits= to use them.',
    '',
    'Paste the command as one line. A space after a trailing \\ makes zsh run --edits=... as its own command.',
    'The Director still decides WHERE and HOW each requested toolkit is used.',
    '',
    'Example:',
    '  npm run first-video -- "/Users/nishanbaral/Downloads/ok.mp4" auto CELLULOID_01_FU_LOW',
  ].join('\n');
}

export function parseArgs(argv: string[]): {
  videoUrl: string;
  languageCode: LanguageCode;
  colorGradeLut: string;
  userBrollUrls: string[];
  forceSpeakerCutout: boolean;
  directorV2: boolean;
  northStar: boolean;
  listEdits: boolean;
  requestedEdits: string[] | null;
  forceDeliveryShaping?: boolean;
  captionTemplate: ReturnType<typeof parseCaptionTemplateFlag>;
  noRepair: boolean;
} {
  const positional: string[] = [];
  let lutFlag = '';
  let brollFlag = '';
  let forceSpeakerCutout = false;
  let directorV2 = false;
  let northStar = false;
  let listEdits = false;
  let fullEdits = false;
  const editTokens: string[] = [];
  let forceDeliveryShaping: boolean | undefined;
  let captionsFlag = '';
  let noRepair = false;
  for (const arg of argv) {
    if (arg === '--list-edits' || arg === '--list-edit' || arg === '--list_edits') {
      listEdits = true;
      continue;
    }
    if (arg === '--full-edits' || arg === '--all-edits') {
      fullEdits = true;
      continue;
    }
    if (arg.startsWith('--lut=')) {
      lutFlag = arg.slice('--lut='.length);
      continue;
    }
    if (arg.startsWith('--broll=')) {
      brollFlag = arg.slice('--broll='.length);
      continue;
    }
    if (arg.startsWith('--edits=')) {
      editTokens.push(arg.slice('--edits='.length));
      continue;
    }
    if (arg.startsWith('--edit=')) {
      editTokens.push(arg.slice('--edit='.length));
      continue;
    }
    if (arg.startsWith('--captions=')) {
      captionsFlag = arg.slice('--captions='.length);
      continue;
    }
    if (arg.startsWith('--caption-template=')) {
      captionsFlag = arg.slice('--caption-template='.length);
      continue;
    }
    if (arg === '--cutout') {
      forceSpeakerCutout = true;
      continue;
    }
    if (arg === '--director-v2') {
      directorV2 = true;
      continue;
    }
    if (arg === '--north-star' || arg === '--northstar' || arg === '--north_star') {
      northStar = true;
      continue;
    }
    if (
      arg === '--delivery-shaping' ||
      arg === '--delivery_shaping' ||
      arg === '--delivery'
    ) {
      forceDeliveryShaping = true;
      continue;
    }
    if (arg === '--no-repair' || arg === '--no_repair') {
      noRepair = true;
      continue;
    }
    if (
      arg === '--no-delivery-shaping' ||
      arg === '--no-delivery_shaping' ||
      arg === '--no-delivery'
    ) {
      forceDeliveryShaping = false;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown flag "${arg}".\n\n${usage()}`);
    }
    positional.push(arg);
  }
  const parsedEdits = parseEditAllowlist(editTokens);
  if (parsedEdits.unknown.length > 0) {
    throw new Error(
      `Unknown edit toolkit "${parsedEdits.unknown.join(', ')}".\n\n${formatEditToolkitList()}`,
    );
  }
  const captionTemplate = parseCaptionTemplateFlag(captionsFlag);
  if (captionsFlag && !captionTemplate) {
    throw new Error(`Unknown caption template "${captionsFlag}".\n\n${formatEditToolkitList()}`);
  }
  const videoUrl = (positional[0] || '').trim();
  const languageRaw = (positional[1] || 'auto').trim().toLowerCase();
  const lutRaw = (lutFlag || positional[2] || '').trim();
  const userBrollUrls = brollFlag
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  if (!listEdits && !(SUPPORTED_LANGUAGES as readonly string[]).includes(languageRaw)) {
    throw new Error(`Unknown language "${languageRaw}".\n\n${usage()}`);
  }

  return {
    videoUrl,
    languageCode: ((SUPPORTED_LANGUAGES as readonly string[]).includes(languageRaw)
      ? languageRaw
      : 'auto') as LanguageCode,
    colorGradeLut: normalizeLutId(lutRaw) || lutRaw,
    userBrollUrls,
    forceSpeakerCutout,
    directorV2: directorV2 || northStar,
    northStar,
    listEdits,
    requestedEdits: mergeDeliveryShapingAllowlist(
      resolvePipelineEdits({
        ...parsedEdits,
        fullEdits,
        pipelineMode: 'lean',
      }),
      forceDeliveryShaping,
    ),
    forceDeliveryShaping,
    captionTemplate,
    noRepair,
  };
}

async function main(): Promise<void> {
  const {
    videoUrl,
    languageCode,
    colorGradeLut,
    userBrollUrls,
    forceSpeakerCutout,
    directorV2,
    northStar,
    listEdits,
    requestedEdits,
    forceDeliveryShaping,
    captionTemplate,
    noRepair,
  } = parseArgs(process.argv.slice(2));

  if (listEdits) {
    console.log(formatEditToolkitList());
    process.exit(0);
  }

  if (!videoUrl || videoUrl.startsWith('-')) {
    console.error(usage());
    process.exit(1);
  }
  if (isLocalMediaPath(videoUrl) && !existsSync(resolveLocalMediaPath(videoUrl))) {
    throw new Error(`File not found: ${videoUrl}\n\n${usage()}`);
  }
  for (const broll of userBrollUrls) {
    if (isLocalMediaPath(broll) && !existsSync(resolveLocalMediaPath(broll))) {
      throw new Error(`B-roll file not found: ${broll}\n\n${usage()}`);
    }
  }
  if (colorGradeLut && !normalizeLutId(colorGradeLut)) {
    throw new Error(
      `Unknown LUT "${colorGradeLut}". Available: ${listAvailableLuts().join(', ')}\n\n${usage()}`,
    );
  }

  if (!transcriptionConfigured()) {
    throw new Error('GROQ_API_KEY is missing in ai-video-engine/.env');
  }
  if (!r2Configured()) {
    throw new Error(
      'R2 keys are missing. They are read from server/.env automatically.',
    );
  }

  logger.info(
    {videoUrl, languageCode, colorGradeLut, userBroll: userBrollUrls.length, forceSpeakerCutout, directorV2, northStar, requestedEdits, forceDeliveryShaping, captionTemplate},
    'analyzing',
  );
  const blueprint = await analyzeVideo({
    videoUrl,
    languageCode,
    userId: 'dev-user',
    userBrollUrls,
    forceSpeakerCutout,
    directorV2,
    northStar,
    requestedEdits,
    forceDeliveryShaping,
    captionTemplate,
    noRepair,
  });
  dumpDirectorTrace('04-blueprint-applied', {
    blueprintId: blueprint.blueprintId,
    sourceDurationSec: blueprint.sourceDurationSec,
    outputDurationSec: blueprint.outputDurationSec,
    hookTitle: blueprint.hookTitle,
    hookStyle: blueprint.hookStyle,
    hookAnchor: blueprint.hookAnchor,
    hookStartSec: blueprint.hookStartSec ?? 0,
    hookDurationSec: blueprint.hookDurationSec,
    caption: blueprint.captionDirection,
    zooms: blueprint.zoomTriggers,
    brollClips: blueprint.brollClips,
    visualOverlays: blueprint.visualOverlays.map(overlay => ({
      start: overlay.start,
      end: overlay.end,
      layout: overlay.layout,
      text: overlay.overlayText,
    })),
    insetReveals: blueprint.insetReveals,
    depthOverlays: blueprint.depthOverlays,
    deliveryShaping: blueprint.deliveryShaping
      ? {
          intensity: blueprint.deliveryShaping.intensity,
          preset: blueprint.deliveryShaping.preset,
          reason: blueprint.deliveryShaping.reason,
          ops: blueprint.deliveryShaping.ops,
          summary: blueprint.deliveryShaping.summary,
        }
      : null,
    keepSegments: blueprint.keepSegments,
    warnings: blueprint.stats.warnings,
    stats: blueprint.stats,
  });
  const assembler = blueprint.assembler;
  if (assembler) {
    console.log(
      '\n' +
        formatAssemblerTerminal({
          refusals: assembler.refusals,
          log: assembler.log,
          sanity: assembler.sanity,
          diff: assembler.diff,
        }) +
        '\n',
    );
  } else {
    const requested = (blueprint.stats.warnings ?? []).filter(
      warning =>
        warning.startsWith('requested_not_placed') ||
        warning.startsWith('refusal:') ||
        warning.startsWith('override:flag_over_director'),
    );
    if (requested.length > 0) {
      console.log('\n--- assembler ---\n' + requested.join('\n') + '\n');
    }
  }
  await saveBlueprint(
    blueprint,
    fingerprintSource({
      videoUrl,
      languageCode,
      colorGradeLut,
      userBrollKey: userBrollFingerprintKey(userBrollUrls),
      forceSpeakerCutout,
      directorV2,
      northStar,
      requestedEdits: (requestedEdits ?? []).slice().sort().join(','),
      forceDeliveryShaping,
      captionTemplate: captionTemplate ?? '',
    }),
  );
  logger.info(
    {
      blueprintId: blueprint.blueprintId,
      outputSec: blueprint.outputDurationSec,
      sourceSec: blueprint.sourceDurationSec,
      words: blueprint.stats.wordCount,
      cuts: blueprint.stats.silenceCutCount,
      zooms: blueprint.stats.zoomTriggerCount,
      broll: blueprint.stats.brollClipCount,
      overlays: blueprint.stats.visualOverlayCount,
      cutout: blueprint.visualOverlays.some(overlay => overlay.layout === 'cutout'),
      splits: blueprint.stats.splitCount,
      transitions: blueprint.stats.transitionCount,
      hook: blueprint.hookTitle,
      hookStyle: blueprint.hookStyle,
      hookAnchor: blueprint.hookAnchor,
      hookStartSec: blueprint.hookStartSec ?? 0,
      hookDurationSec: blueprint.hookDurationSec,
      caption: blueprint.captionDirection,
      insetReveals: (blueprint.insetReveals ?? []).map(clip => ({
        start: clip.start,
        end: clip.end,
        variant: clip.params.variant,
        reason: clip.reason,
      })),
      depthOverlays: (blueprint.depthOverlays ?? []).map(clip => ({
        start: clip.start,
        end: clip.end,
        reason: clip.reason,
      })),
      deliveryShaping: blueprint.deliveryShaping
        ? {
            intensity: blueprint.deliveryShaping.intensity,
            preset: blueprint.deliveryShaping.preset,
            reason: blueprint.deliveryShaping.reason,
            operations: blueprint.deliveryShaping.ops.map(op => ({
              op: op.op,
              start: op.start,
              end: op.end,
              reason: op.reason,
            })),
            summary: blueprint.deliveryShaping.summary,
            loudnessBefore: blueprint.deliveryShaping.loudnessBefore,
            loudnessAfter: blueprint.deliveryShaping.loudnessAfter,
          }
        : null,
      motionGraphics: blueprint.motionGraphics.length,
      lut: blueprint.colorGradeLut,
      captionSample: blueprint.captionWords.slice(0, 12).map(word => word.text).join(' '),
      warnings: blueprint.stats.warnings,
    },
    'blueprint ready — starting local render',
  );

  const {outputUrl} = await renderLocally({
    blueprint,
    style: {
      ...DEFAULT_RENDER_STYLE,
      captionTemplate: blueprint.captionDirection?.template ?? DEFAULT_RENDER_STYLE.captionTemplate,
      captionBottomFrac:
        blueprint.captionDirection?.bottomFrac ?? DEFAULT_RENDER_STYLE.captionBottomFrac,
      colorGradeLut: '',
    },
    renderJobId: `first_${blueprint.blueprintId}`,
    onProgress: progress => {
      if (Math.round(progress * 20) % 4 === 0) {
        logger.info({progress: Math.round(progress * 100)}, 'rendering');
      }
    },
  });

  console.log('\nDone. Edited video:\n' + outputUrl + '\n');
}

const invokedDirectly = (() => {
  const invoked = process.argv[1];
  if (!invoked) {
    return false;
  }
  return path.resolve(invoked) === fileURLToPath(import.meta.url);
})();

if (invokedDirectly) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
