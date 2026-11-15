/**
 * Test-only mock Runware transport: scripted responses, no network. `live` is false, so the job orchestration treats it as a non-paying transport.
 * Responses follow the shape the project's Python transport parses (agents/music_specialist/runware.py): {data: [{taskUUID, status?, audioURL?, cost?}]}.
 */
import {writeFileSync} from 'node:fs';

import type {RunwareTransport} from './runware.ts';

export type Script = {
  /** Body returned for the first post of this model's task; default: ready with a URL and cost. */
  first?: (task: Record<string, unknown>) => unknown;
  /** getResponse polls answer `processing` this many times before `first`'s ready body (default 0). */
  processingPolls?: number;
  /** Bytes the download writes. */
  bytes: Buffer;
  throwOnPost?: Error;
  throwOnDownload?: Error;
};

export class MockTransport implements RunwareTransport {
  readonly live = false;
  readonly posts: Record<string, unknown>[][] = [];
  readonly downloads: string[] = [];
  private readonly polls = new Map<string, number>();
  private readonly byUrl = new Map<string, Buffer>();
  private readonly scriptFor: (task: Record<string, unknown>) => Script;
  constructor(scriptFor: (task: Record<string, unknown>) => Script) {
    this.scriptFor = scriptFor;
  }

  async post(tasks: readonly Record<string, unknown>[]): Promise<unknown> {
    this.posts.push(tasks.map(task => ({...task})));
    const task = tasks[0]!;
    if (task.taskType === 'getResponse') {
      const uuid = String(task.taskUUID);
      const original = this.posts.find(batch => batch[0]!.taskUUID === uuid && batch[0]!.taskType === 'audioInference')![0]!;
      const script = this.scriptFor(original);
      const used = this.polls.get(uuid) ?? 0;
      this.polls.set(uuid, used + 1);
      if (used + 1 < (script.processingPolls ?? 0)) return {data: [{taskUUID: uuid, status: 'processing'}]};
      return this.ready(original, script);
    }
    const script = this.scriptFor(task);
    if (script.throwOnPost) throw script.throwOnPost;
    if ((script.processingPolls ?? 0) > 0) return {data: [{taskUUID: task.taskUUID, status: 'processing'}]};
    return script.first ? script.first(task) : this.ready(task, script);
  }

  private ready(task: Record<string, unknown>, script: Script): unknown {
    const url = `https://mock.invalid/${String(task.taskUUID)}.wav`;
    this.byUrl.set(url, script.bytes);
    return {data: [{taskType: 'audioInference', taskUUID: task.taskUUID, audioURL: url, cost: task.model === 'runware:ace-step@v1.5-base' ? 0.0075 : 0.0005}]};
  }

  async download(url: string, dest: string): Promise<void> {
    this.downloads.push(url);
    const uuidTask = this.posts.find(batch => url.includes(String(batch[0]!.taskUUID)))?.[0];
    const script = uuidTask ? this.scriptFor(uuidTask) : null;
    if (script?.throwOnDownload) throw script.throwOnDownload;
    const bytes = this.byUrl.get(url);
    if (!bytes) throw new Error(`mock has no audio for ${url}`);
    writeFileSync(dest, bytes);
  }
}
