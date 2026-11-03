import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {flushSpool, listSpool, writeSpool} from './spool.ts';

let root: string;
let spool: string;
let wav: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'spool-test-'));
  spool = path.join(root, 'spool');
  wav = path.join(root, 'src.wav');
  await fs.writeFile(wav, Buffer.from('RIFF0000WAVEfmt '));
});

afterEach(async () => {
  await fs.rm(root, {recursive: true, force: true});
});

const meta = (mood = 'calm') => ({mood, dry: true, meta: {bpm: 90}});

describe('spool', () => {
  it('flushes an entry and removes it', async () => {
    await writeSpool({dir: spool, cacheKey: 'k1', filePath: wav, meta: meta()});
    const seen: Array<{key: string; file: string}> = [];
    const count = await flushSpool({
      dir: spool,
      upload: async entry => {
        seen.push({key: entry.cacheKey, file: entry.filePath});
      },
    });
    expect(count).toBe(1);
    expect(seen).toEqual([{key: 'k1', file: path.join(spool, 'k1', 'bed.wav')}]);
    expect(await listSpool(spool)).toEqual([]);
  });

  it('keeps a failed entry and still flushes the others', async () => {
    await writeSpool({dir: spool, cacheKey: 'bad', filePath: wav, meta: meta()});
    await writeSpool({dir: spool, cacheKey: 'good', filePath: wav, meta: meta()});
    const count = await flushSpool({
      dir: spool,
      upload: async entry => {
        if (entry.cacheKey === 'bad') throw new Error('network');
      },
    });
    expect(count).toBe(1);
    expect((await listSpool(spool)).map(e => e.cacheKey)).toEqual(['bad']);
  });

  it('ignores half entries', async () => {
    await fs.mkdir(path.join(spool, 'half'), {recursive: true});
    await fs.copyFile(wav, path.join(spool, 'half', 'bed.wav'));
    await fs.mkdir(path.join(spool, '.tmp-x'), {recursive: true});
    expect(await listSpool(spool)).toEqual([]);
  });

  it('keeps the entry when the process is killed mid-upload, and a later flush sees it', async () => {
    const script = `
      const fs = require('fs'), path = require('path');
      const [wav, dir] = process.argv.slice(1);
      const d = path.join(dir, 'killed');
      fs.mkdirSync(d, {recursive: true});
      fs.copyFileSync(wav, path.join(d, 'bed.wav'));
      fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({cacheKey: 'killed', mood: 'calm', dry: true, meta: {}}));
      setTimeout(() => {}, 30000);
    `;
    const child = spawn(process.execPath, ['-e', script, wav, spool], {stdio: 'ignore'});
    const exited = new Promise<void>(resolve => child.on('close', () => resolve()));
    const deadline = Date.now() + 5000;
    const ready = async () => {
      try {
        await fs.access(path.join(spool, 'killed', 'bed.wav'));
        await fs.access(path.join(spool, 'killed', 'meta.json'));
        return true;
      } catch {
        return false;
      }
    };
    while (!(await ready())) {
      if (Date.now() > deadline) {
        child.kill('SIGKILL');
        throw new Error('child never wrote spool entry');
      }
      await new Promise(r => setTimeout(r, 25));
    }
    child.kill('SIGKILL');
    await exited;

    expect((await listSpool(spool)).map(e => e.cacheKey)).toEqual(['killed']);
    const uploaded: string[] = [];
    const count = await flushSpool({dir: spool, upload: async entry => void uploaded.push(entry.cacheKey)});
    expect(count).toBe(1);
    expect(uploaded).toEqual(['killed']);
  });
});
