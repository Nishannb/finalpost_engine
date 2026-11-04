import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

import {saveBlueprintForReplay} from './saveBlueprint.ts';

describe('saveBlueprintForReplay', () => {
  it('writes out/blueprints/{videoId}.json under the injected root, atomically', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-save-'));
    const envelope = {videoId: 'abc123', sourceVideoPath: '/x/a.mp4', voLufs: -20, savedAt: '2026-01-01T00:00:00Z', blueprint: {blueprintId: 'bp_1'} as never};
    const out = await saveBlueprintForReplay(envelope, root);
    expect(out).toBe(path.join(root, 'out', 'blueprints', 'abc123.json'));
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).blueprint.blueprintId).toBe('bp_1');
    expect(fs.readdirSync(path.dirname(out))).toEqual(['abc123.json']);
  });

  it('rejects a path-like videoId', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-save-'));
    await expect(
      saveBlueprintForReplay({videoId: '../x', sourceVideoPath: null, voLufs: null, savedAt: '', blueprint: {} as never}, root),
    ).rejects.toThrow();
  });
});
