/**
 * Make one edited vertical video from a talking-head file you pass in.
 *
 *   npm run first-video -- /path/to/talking-head.mp4
 *   npm run first-video -- /path/to/clip.mp4 auto CELLULOID_01_FU_LOW
 *   npm run first-video -- https://example.com/talking-head.mp4 hi
 *
 * Language defaults to `auto` so Hindi/Hinglish is not forced into English captions.
 * Optional 4th arg / `--lut=` selects a .cube from ai-video-engine/luts/.
 */

import {existsSync} from 'node:fs';

import {analyzeVideo} from '../pipeline/analyzeVideo.ts';
import {DEFAULT_RENDER_STYLE} from '../http/schemas.ts';
import {isLocalMediaPath} from '../lib/tempFiles.ts';
import {logger} from '../lib/logger.ts';
import {listAvailableLuts, normalizeLutId} from '../stages/color/luts.ts';
import {saveBlueprint, fingerprintSource} from '../store/engineStore.ts';
import {renderLocally} from '../stages/render/localRender.ts';
import {r2Configured} from '../storage/r2.ts';
import {transcriptionConfigured} from '../stages/transcribe/groqTranscribe.ts';
import type {LanguageCode} from '../types/blueprint.ts';
import {SUPPORTED_LANGUAGES} from '../types/blueprint.ts';

function usage(): string {
  const luts = listAvailableLuts();
  return [
    'Pass the talking-head file to edit.',
    '',
    '  npm run first-video -- "/path/to/your-clip.mp4" [language] [lutId]',
    '  npm run first-video -- "https://your-public-clip.mp4" auto CELLULOID_01_FU_LOW',
    '',
    'language: en | es | hi | ta | ne | auto  (default: auto)',
    `lutId: one of ${luts.length ? luts.join(', ') : '(none found in luts/)'}`,
    '',
    'Example:',
    '  npm run first-video -- "/Users/nishanbaral/Downloads/ok.mp4" auto CELLULOID_01_FU_LOW',
  ].join('\n');
}

function parseArgs(argv: string[]): {
  videoUrl: string;
  languageCode: LanguageCode;
  colorGradeLut: string;
} {
  const positional = argv.filter(arg => !arg.startsWith('--'));
  const lutFlag = argv.find(arg => arg.startsWith('--lut='))?.slice('--lut='.length);
  const videoUrl = (positional[0] || '').trim();
  const languageRaw = (positional[1] || 'auto').trim().toLowerCase();
  const lutRaw = (lutFlag || positional[2] || '').trim();

  if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(languageRaw)) {
    throw new Error(`Unknown language "${languageRaw}".\n\n${usage()}`);
  }

  return {
    videoUrl,
    languageCode: languageRaw as LanguageCode,
    colorGradeLut: normalizeLutId(lutRaw) || lutRaw,
  };
}

async function main(): Promise<void> {
  const {videoUrl, languageCode, colorGradeLut} = parseArgs(process.argv.slice(2));

  if (!videoUrl || videoUrl.startsWith('-')) {
    console.error(usage());
    process.exit(1);
  }
  if (isLocalMediaPath(videoUrl) && !existsSync(videoUrl)) {
    throw new Error(`File not found: ${videoUrl}\n\n${usage()}`);
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

  logger.info({videoUrl, languageCode, colorGradeLut}, 'analyzing');
  const blueprint = await analyzeVideo({
    videoUrl,
    languageCode,
    userId: 'dev-user',
    colorGradeLut,
  });
  await saveBlueprint(
    blueprint,
    fingerprintSource({videoUrl, languageCode, colorGradeLut}),
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
      splits: blueprint.stats.splitCount,
      transitions: blueprint.stats.transitionCount,
      hook: blueprint.hookTitle,
      hookStyle: blueprint.hookStyle,
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
      colorGradeLut: colorGradeLut || blueprint.colorGradeLut || '',
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

main().catch(error => {
  console.error(error);
  process.exit(1);
});
