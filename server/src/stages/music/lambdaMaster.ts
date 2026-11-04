/**
 * Master pass for a finished Remotion Lambda render, so production gets the same -14 LUFS / -1 dBTP as a local render.
 *
 * The Lambda MP4 is downloaded (address guard applied by the downloader), the same two-pass loudnorm runs on the audio (video is copied),
 * the result is inspected with the same judge as every render, and only then is it uploaded under its OWN key. The original Lambda object is
 * never touched. On any failure the unmastered URL is returned and `music.master_pass_failed` is logged: a master problem never fails a render.
 *
 * Dependencies are injected so tests never touch the network, ffmpeg or R2.
 */

import {stageLogger} from '../../lib/logger.ts';
import {masterPassEnabled} from './flags.ts';
import type {MasterPassResult} from './masterPass.ts';

const log = stageLogger('music');

export type LambdaMasterDeps = {
  download: (url: string, destination: string) => Promise<unknown>;
  master: (filePath: string) => Promise<MasterPassResult>;
  /** Throws when the mastered file is not a valid render (same judge as the Lambda verification). */
  verify: (filePath: string) => Promise<void>;
  /** Uploads under a new key and returns the public URL. */
  upload: (filePath: string, key: string) => Promise<{publicUrl: string}>;
  workspace: {file: (name: string) => string; cleanup: () => Promise<void>};
  env?: NodeJS.ProcessEnv;
};

export type LambdaMasterResult = {url: string; mastered: boolean; master?: MasterPassResult; reason?: string};

/** The key the mastered copy goes to. Distinct from the Lambda output (`renders/<id>.mp4`), so the original is never overwritten. */
export function masteredKeyFor(renderJobId: string, date: Date = new Date()): string {
  return `ai-video/render/${date.toISOString().slice(0, 10)}/${renderJobId}-mastered.mp4`;
}

export async function masterLambdaOutput(
  input: {outputUrl: string; renderJobId: string; blueprintId?: string},
  deps: LambdaMasterDeps,
): Promise<LambdaMasterResult> {
  if (!masterPassEnabled(deps.env ?? process.env)) {
    log.info({renderJobId: input.renderJobId}, 'music.master_pass_off');
    return {url: input.outputUrl, mastered: false, reason: 'off'};
  }
  try {
    const local = deps.workspace.file('lambda-master.mp4');
    await deps.download(input.outputUrl, local);
    const result = await deps.master(local);
    await deps.verify(local);
    const uploaded = await deps.upload(local, masteredKeyFor(input.renderJobId));
    log.info({renderJobId: input.renderJobId, blueprintId: input.blueprintId, where: 'lambda', ...result}, 'music.master_pass');
    return {url: uploaded.publicUrl, mastered: true, master: result};
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 300) : 'master_pass';
    log.warn({renderJobId: input.renderJobId, where: 'lambda', reason}, 'music.master_pass_failed');
    return {url: input.outputUrl, mastered: false, reason};
  } finally {
    try {
      await deps.workspace.cleanup();
    } catch {
      // a scratch-directory failure must not change the outcome
    }
  }
}
