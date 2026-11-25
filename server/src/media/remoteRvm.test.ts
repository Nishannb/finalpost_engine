import {mkdtempSync, readFileSync, existsSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {makeRemoteRvmRunner} from './remoteRvm.ts';
import {buildRvmArgs} from './rvmMatte.ts';
import {extractSubjectMatte} from './personMatte.ts';

const dir = () => mkdtempSync(path.join(tmpdir(), 'remote-rvm-'));
const REPORT = {ok: true, device: 'cuda', detected_ratio: 1, mean_area: 0.4, segmented_frames: 300, frames: 300, seconds: 3.1, model: 'rvm_mobilenetv3'};
const okResponse = () => new Response(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]), {status: 200, headers: {'X-Matting-Result': Buffer.from(JSON.stringify(REPORT)).toString('base64')}});

function setup(respond: (init: RequestInit) => Response | Promise<Response>) {
  const d = dir();
  const input = path.join(d, 'in.mp4');
  writeFileSync(input, 'video');
  const calls: Array<{url: string; body: {video_url: string; args: string[]}; auth: string}> = [];
  const uploads: string[] = [];
  const runner = makeRemoteRvmRunner({
    url: 'https://worker.example/matte',
    token: 't0ken',
    upload: async file => { uploads.push(file); return {publicUrl: 'https://cdn.example/src.mp4'}; },
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({url, body: JSON.parse(String(init.body)), auth: String((init.headers as Record<string, string>).Authorization)});
      return respond(init);
    }) as unknown as typeof fetch,
  });
  const args = ['-m', 'human_matting.cli', ...buildRvmArgs({input, outputWebm: path.join(d, 'o.webm'), resultJson: path.join(d, 'o.json'), quality: 'high', ranges: [[0, 12.5], [14, 30]], alphaOnly: true, skipFgrDownload: true}).slice(2)];
  return {d, input, runner, args, calls, uploads};
}

describe('remote RVM runner (Modal worker)', () => {
  it('uploads the input, sends only the flags, and writes the webm + report the local CLI would write', async () => {
    const {d, input, runner, args, calls, uploads} = setup(() => okResponse());
    const r = await runner('remote', args, {cwd: '/', env: {}, timeoutMs: 5000});
    expect(r).toEqual({code: 0, stderr: '', timedOut: false});
    expect(uploads).toEqual([input]);
    expect(calls[0]!.auth).toBe('Bearer t0ken');
    expect(calls[0]!.body.video_url).toBe('https://cdn.example/src.mp4');
    expect(calls[0]!.body.args).toEqual(['--quality', 'high', '--ranges', '0-12.5,14-30', '--alpha-only', '--skip-fgr-download']);
    expect(readFileSync(path.join(d, 'o.webm')).length).toBe(7);
    expect(JSON.parse(readFileSync(path.join(d, 'o.json'), 'utf8')).device).toBe('cuda');
    expect(existsSync(path.join(d, 'o.webm.part'))).toBe(false);
  });

  it('maps worker failures to the local exit semantics', async () => {
    expect((await setup(() => new Response('exit 3: boom', {status: 422})).runner('remote', setup(() => okResponse()).args, {cwd: '/', env: {}, timeoutMs: 5000})).code).toBe(1);
    const s401 = setup(() => new Response('unauthorized', {status: 401}));
    expect((await s401.runner('remote', s401.args, {cwd: '/', env: {}, timeoutMs: 5000})).code).toBe(2);
    const s504 = setup(() => new Response('', {status: 504}));
    expect((await s504.runner('remote', s504.args, {cwd: '/', env: {}, timeoutMs: 5000})).timedOut).toBe(true);
    const noHeader = setup(() => new Response(new Uint8Array([1]), {status: 200}));
    expect((await noHeader.runner('remote', noHeader.args, {cwd: '/', env: {}, timeoutMs: 5000})).code).toBe(1);
  });

  it('a slow worker is a timeout (aborted at timeoutMs)', async () => {
    const slow = setup(init => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))));
    const r = await slow.runner('remote', slow.args, {cwd: '/', env: {}, timeoutMs: 1000});
    expect(r.timedOut).toBe(true);
  });

  it('extractSubjectMatte runs through it end to end (cache, quality gate, copy to outputPath)', async () => {
    const s = setup(() => okResponse());
    const out = path.join(s.d, 'final.webm');
    const result = await extractSubjectMatte({inputPath: s.input, outputPath: out, ranges: [[0, 10]], runner: s.runner, cacheDir: path.join(s.d, 'cache'), alphaOnly: true});
    expect(result?.report.device).toBe('cuda');
    expect(readFileSync(out).length).toBe(7);
    expect(s.calls).toHaveLength(1);
    // second call: cache hit, no new request
    await extractSubjectMatte({inputPath: s.input, outputPath: out, ranges: [[0, 10]], runner: s.runner, cacheDir: path.join(s.d, 'cache'), alphaOnly: true});
    expect(s.calls).toHaveLength(1);
  });
});
