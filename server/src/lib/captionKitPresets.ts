/**
 * CaptionKit preset ids. `presets.json` is the style source of truth.
 * Demo mp4s are not inspected and are not the user's video.
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export type CaptionKitPresetMeta = {
  id: string;
  name: string;
  category: string;
};

function captionKitRoot(): string {
  const fromEnv = (process.env.CAPTIONKIT_ROOT || '').trim();
  if (fromEnv) {
    return fromEnv;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  // server/src/lib and server/dist/lib both sit three levels under the engine root.
  return path.resolve(here, '../../../captionkit_tmp');
}

export function captionKitPaths(): {
  root: string;
  script: string;
  presets: string;
  fonts: string;
} {
  const root = captionKitRoot();
  return {
    root,
    script: path.join(root, 'captionkit.py'),
    presets: path.join(root, 'presets.json'),
    fonts: path.join(root, 'fonts'),
  };
}

let cached: CaptionKitPresetMeta[] | null = null;

export function loadCaptionKitPresets(): CaptionKitPresetMeta[] {
  if (cached) {
    return cached;
  }
  const {presets} = captionKitPaths();
  const raw = JSON.parse(fs.readFileSync(presets, 'utf8')) as {
    presets?: Array<{id?: string; name?: string; category?: string}>;
  };
  const list = Array.isArray(raw.presets) ? raw.presets : [];
  cached = list
    .map(item => ({
      id: String(item.id || '').trim(),
      name: String(item.name || item.id || '').trim(),
      category: String(item.category || '').trim(),
    }))
    .filter(item => item.id.length > 0);
  return cached;
}

export function captionKitPresetIds(): Set<string> {
  return new Set(loadCaptionKitPresets().map(item => item.id));
}

export function isCaptionKitPresetId(id: string): boolean {
  return captionKitPresetIds().has(id.trim());
}
