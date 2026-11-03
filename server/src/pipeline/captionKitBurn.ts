/**
 * Burn a captions-only video with CaptionKit (ffmpeg/libass).
 * The engine already transcribed; this only applies the preset.
 */

import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';

import {EngineError} from '../lib/errors.ts';
import {stageLogger} from '../lib/logger.ts';
import {captionKitPaths} from '../lib/captionKitPresets.ts';
import {downloadToFile, withWorkspace} from '../lib/tempFiles.ts';
import {uploadRenderedVideo} from '../storage/r2.ts';
import type {CaptionWord} from '../types/blueprint.ts';

const log = stageLogger('captionkit');
const MAX_SOURCE_BYTES = 400 * 1024 * 1024;

export async function burnCaptionKitVideo(input: {
  videoUrl: string;
  editJobId: string;
  presetId: string;
  words: CaptionWord[];
}): Promise<{outputUrl: string}> {
  const words = input.words
    .map(word => ({
      text: String(word.text || '').trim(),
      start: Number(word.start),
      end: Number(word.end),
    }))
    .filter(
      word =>
        word.text.length > 0 &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end),
    );
  if (words.length === 0) {
    throw new EngineError(
      'no_speech_detected',
      'No spoken words were found to caption.',
    );
  }

  return withWorkspace('captionkit', async workspace => {
    const sourcePath = workspace.file('source.mp4');
    await downloadToFile(input.videoUrl, sourcePath, {
      maxBytes: MAX_SOURCE_BYTES,
      timeoutMs: 180_000,
    });
    const transcriptPath = workspace.file('words.json');
    const outPath = workspace.file('captioned.mp4');
    await fs.writeFile(transcriptPath, JSON.stringify(words), 'utf8');
    await runCaptionKit({
      videoPath: sourcePath,
      transcriptPath,
      presetId: input.presetId,
      outPath,
    });
    const uploaded = await uploadRenderedVideo(outPath, input.editJobId);
    return {outputUrl: uploaded.publicUrl};
  });
}

function runCaptionKit(input: {
  videoPath: string;
  transcriptPath: string;
  presetId: string;
  outPath: string;
}): Promise<void> {
  const paths = captionKitPaths();
  const python = (process.env.CAPTIONKIT_PYTHON || 'python3').trim() || 'python3';
  const args = [
    paths.script,
    'render',
    '--video',
    input.videoPath,
    '--transcript',
    input.transcriptPath,
    '--preset',
    input.presetId,
    '--out',
    input.outPath,
    '--presets',
    paths.presets,
    '--fonts',
    paths.fonts,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      cwd: paths.root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr += chunk;
      if (stderr.length > 4000) {
        stderr = stderr.slice(-4000);
      }
    });
    child.on('error', error => {
      reject(
        new EngineError(
          'render_failed',
          `CaptionKit could not start (${python}). ${error.message}`,
        ),
      );
    });
    child.on('close', code => {
      if (code === 0) {
        resolve();
        return;
      }
      log.error({code, stderr, presetId: input.presetId}, 'captionkit render failed');
      reject(
        new EngineError(
          'render_failed',
          'Could not burn captions. Try again.',
        ),
      );
    });
  });
}
