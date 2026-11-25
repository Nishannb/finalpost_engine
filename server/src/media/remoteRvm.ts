/**
 * Remote RVM (2026-11-26): the speaker cutout on a Modal GPU (subjectmatte/modal_app.py) instead of a local python process.
 *
 * Why: the engine droplet has no GPU and RVM on CPU is ~0.5 s per 1080x1920 frame, so a 30 s clip cannot finish inside MATTING_TIMEOUT_SEC.
 * How: this is a drop-in `RunPython` for media/personMatte.ts. It takes the exact argv buildRvmArgs() made for the local CLI
 * (`-m human_matting.cli <input> <out.webm> <result.json> ...flags`), uploads <input> to storage (the worker fetches it over https),
 * POSTs the flags, and writes the two files the local process would have written. Cache, slot, timeout, quality gate and the
 * foreground compose downstream are unchanged. Exit codes mirror the local process: 0 ok, 1 tool failed, 2 bad request; a timeout
 * is `timedOut`.
 *
 * Enabled by RVM_REMOTE_URL (+ RVM_REMOTE_TOKEN). Unset = the local python exactly as before.
 */
import {promises as fs} from 'node:fs';
import path from 'node:path';

import {env} from '../config/env.ts';
import type {RunPython, RunPythonResult} from './rvmMatte.ts';

export type RemoteRvmConfig = {
  url: string;
  token: string;
  /** Puts the local input where the worker can fetch it (https). Default: storage/r2.ts uploadSourceVideo. */
  upload?: (filePath: string) => Promise<{publicUrl: string}>;
  fetchImpl?: typeof fetch;
};

export function remoteRvmConfigured(): boolean {
  return Boolean(env.RVM_REMOTE_URL.trim() && env.RVM_REMOTE_TOKEN.trim());
}

const fail = (code: number, stderr: string): RunPythonResult => ({code, stderr: stderr.slice(0, 400), timedOut: false});

async function defaultUpload(filePath: string): Promise<{publicUrl: string}> {
  const {uploadSourceVideo} = await import('../storage/r2.ts');
  return uploadSourceVideo(filePath, path.extname(filePath) || '.mp4');
}

export function makeRemoteRvmRunner(config: RemoteRvmConfig): RunPython {
  const upload = config.upload ?? defaultUpload;
  return async (_cmd, args, options) => {
    if (args[0] !== '-m' || args[1] !== 'human_matting.cli' || args.length < 5) return fail(2, 'remote_rvm: unexpected argv');
    const [, , input, outputWebm, resultJson, ...flags] = args as [string, string, string, string, string, ...string[]];
    let videoUrl: string;
    try {
      videoUrl = (await upload(input)).publicUrl;
    } catch (error) {
      return fail(1, `remote_rvm: upload_failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, options.timeoutMs));
    try {
      const init: RequestInit = {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${config.token}`},
        body: JSON.stringify({video_url: videoUrl, args: flags}),
        signal: controller.signal,
      };
      const response = config.fetchImpl ? await config.fetchImpl(config.url, init) : await fetch(config.url, init);
      if (response.status === 504) return {code: null, stderr: 'remote_rvm: worker timeout', timedOut: true};
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        return fail(response.status === 422 ? 1 : 2, `remote_rvm: HTTP ${response.status}: ${detail}`);
      }
      const header = response.headers.get('x-matting-result');
      if (!header) return fail(1, 'remote_rvm: missing result header');
      const report = Buffer.from(header, 'base64').toString('utf8');
      JSON.parse(report); // a corrupt report fails here, not later in the quality gate
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) return fail(1, 'remote_rvm: empty webm');
      // write-then-rename: the cache only ever sees complete files
      await fs.writeFile(`${outputWebm}.part`, bytes);
      await fs.rename(`${outputWebm}.part`, outputWebm);
      await fs.writeFile(resultJson, report);
      options.onStdoutLine?.(`PROGRESS 1 1`);
      return {code: 0, stderr: '', timedOut: false};
    } catch (error) {
      if (controller.signal.aborted) return {code: null, stderr: 'remote_rvm: timeout', timedOut: true};
      return fail(1, `remote_rvm: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  };
}
