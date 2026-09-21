/**
 * Study creator-supplied clips AND stills so the director can place them
 * as motion-designed cards (not mystery URLs).
 *
 * Downloads each file, probes it, grabs stills, and asks Gemini for kind +
 * description + optional text regions (for document focus highlights).
 */

import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';

import {env} from '../../config/env.ts';
import {requestJson} from '../../lib/http.ts';
import {stageLogger} from '../../lib/logger.ts';
import {
  copyLocalFile,
  downloadToFile,
  isLocalMediaPath,
  type Workspace,
} from '../../lib/tempFiles.ts';
import {extractStillJpeg, probeMedia} from '../../media/ffmpeg.ts';

const log = stageLogger('stage-c-user-broll');

const MAX_USER_BROLL = 12;
const MAX_BYTES = 120 * 1024 * 1024;
const IMAGE_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.heic',
  '.heif',
]);

export type AssetKind = 'clip' | 'photo' | 'document' | 'tall';

export type AssetRegion = {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type UserBrollAsset = {
  id: string;
  url: string;
  description: string;
  durationSec: number;
  width: number;
  height: number;
  kind: AssetKind;
  regions: AssetRegion[];
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {parts?: Array<{text?: string}>};
  }>;
};

export async function describeUserBrollAssets(
  urls: string[],
  workspace: Workspace,
): Promise<UserBrollAsset[]> {
  const unique = [...new Set(urls.map(u => u.trim()).filter(Boolean))].slice(
    0,
    MAX_USER_BROLL,
  );
  if (unique.length === 0) {
    return [];
  }

  const out: UserBrollAsset[] = [];
  for (let i = 0; i < unique.length; i += 1) {
    const url = unique[i]!;
    const id = `ub_${i + 1}`;
    try {
      const asset = await describeOne(url, id, workspace);
      if (asset) {
        out.push(asset);
      }
    } catch (error) {
      log.warn({error, url: url.slice(0, 80)}, 'user broll describe failed');
    }
  }
  return out;
}

async function describeOne(
  url: string,
  id: string,
  workspace: Workspace,
): Promise<UserBrollAsset | null> {
  const ext = extensionOf(url);
  const isImage = IMAGE_EXT.has(ext);
  const localPath = workspace.file(`${id}_src${isImage ? ext || '.jpg' : ext || '.mp4'}`);
  if (isLocalMediaPath(url)) {
    await copyLocalFile(url, localPath, {maxBytes: MAX_BYTES});
  } else {
    await downloadToFile(url, localPath, {maxBytes: MAX_BYTES});
  }

  let width = 1080;
  let height = 1920;
  let durationSec = 0;
  if (!isImage) {
    const probe = await probeMedia(localPath);
    durationSec = probe.durationSec;
    width = probe.width || 1080;
    height = probe.height || 1920;
    if (durationSec < 0.6) {
      return null;
    }
  } else {
    const probe = await probeMedia(localPath).catch(() => null);
    if (probe) {
      width = probe.width || width;
      height = probe.height || height;
    }
  }

  const frameA = workspace.file(`${id}_a.jpg`);
  const frameB = workspace.file(`${id}_b.jpg`);
  if (isImage) {
    await extractStillJpeg(localPath, frameA, 0);
    await fs.copyFile(frameA, frameB).catch(() => undefined);
  } else {
    await extractStillJpeg(localPath, frameA, durationSec * 0.2);
    await extractStillJpeg(
      localPath,
      frameB,
      Math.min(durationSec * 0.65, Math.max(0.4, durationSec - 0.3)),
    );
  }

  const insight = await describeFrames(frameA, isImage ? frameA : frameB, {
    durationSec,
    isImage,
    width,
    height,
  });
  const kind = insight.kind || inferKind(isImage, width, height, durationSec, insight.description);
  return {
    id,
    url,
    description: insight.description || 'Creator-supplied visual',
    durationSec,
    width,
    height,
    kind,
    regions: insight.regions,
  };
}

function inferKind(
  isImage: boolean,
  width: number,
  height: number,
  durationSec: number,
  description: string,
): AssetKind {
  const text = description.toLowerCase();
  if (
    isImage &&
    /\b(screenshot|wikipedia|article|document|paragraph|headline|paper|tweet)\b/.test(text)
  ) {
    return 'document';
  }
  if (isImage) {
    return 'photo';
  }
  if (height > width * 1.35 && durationSec >= 0.6) {
    return 'tall';
  }
  return 'clip';
}

async function describeFrames(
  jpegA: string,
  jpegB: string,
  meta: {durationSec: number; isImage: boolean; width: number; height: number},
): Promise<{description: string; kind?: AssetKind; regions: AssetRegion[]}> {
  if (!env.GEMINI_API_KEY) {
    return {
      description: meta.isImage
        ? 'Creator-supplied still image'
        : `Creator B-roll clip (~${meta.durationSec.toFixed(1)}s)`,
      regions: [],
    };
  }

  const [a, b] = await Promise.all([fs.readFile(jpegA), fs.readFile(jpegB)]);
  const model = env.GEMINI_MODEL || 'gemini-3.6-flash';
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const body = await requestJson<GeminiResponse>(url, {
    method: 'POST',
    label: 'Gemini user asset describe',
    failureCode: 'broll_failed',
    timeoutMs: 35_000,
    retries: 1,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {mimeType: 'image/jpeg', data: a.toString('base64')},
            },
            {
              inlineData: {mimeType: 'image/jpeg', data: b.toString('base64')},
            },
            {
              text:
                `Frames from a creator-uploaded ${meta.isImage ? 'still' : `~${meta.durationSec.toFixed(1)}s clip`} (${meta.width}x${meta.height}).\n` +
                `Return ONLY JSON:\n` +
                `{"kind":"clip"|"photo"|"document"|"tall","description":"one English sentence max 28 words","regions":[{"label":"short quoted text","x":0-1,"y":0-1,"w":0-1,"h":0-1}]}\n` +
                `kind=document if it is a screenshot/article/paper with readable text.\n` +
                `kind=tall if it is a long vertical image/video meant to be scrolled.\n` +
                `regions: 0–4 important text boxes as fractions of the frame. Empty array if none.\n` +
                `No markdown.`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 280,
      },
    }),
  });

  const text = body.candidates?.[0]?.content?.parts
    ?.map(part => part.text ?? '')
    .join(' ')
    .trim();
  return parseAssetInsight(text, meta);
}

export function parseAssetInsight(
  raw: string | undefined,
  meta: {durationSec: number; isImage: boolean},
): {description: string; kind?: AssetKind; regions: AssetRegion[]} {
  const fallback = meta.isImage
    ? 'Creator-supplied still image'
    : `Creator B-roll clip (~${meta.durationSec.toFixed(1)}s)`;
  if (!raw) {
    return {description: fallback, regions: []};
  }
  const json = raw.replace(/```json|```/g, '').trim();
  const match = json.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      description: json.replace(/^["']|["']$/g, '').slice(0, 220) || fallback,
      regions: [],
    };
  }
  try {
    const record = JSON.parse(match[0]) as Record<string, unknown>;
    const kindRaw = String(record.kind ?? '').trim().toLowerCase();
    const kind: AssetKind | undefined =
      kindRaw === 'clip' || kindRaw === 'photo' || kindRaw === 'document' || kindRaw === 'tall'
        ? kindRaw
        : undefined;
    const description = String(record.description ?? '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .slice(0, 220);
    const regions = Array.isArray(record.regions)
      ? record.regions
          .map(row => parseRegion(row))
          .filter((row): row is AssetRegion => Boolean(row))
          .slice(0, 4)
      : [];
    return {description: description || fallback, kind, regions};
  } catch {
    return {description: fallback, regions: []};
  }
}

function parseRegion(raw: unknown): AssetRegion | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const w = Number(record.w ?? record.width);
  const h = Number(record.h ?? record.height);
  if (![x, y, w, h].every(Number.isFinite)) {
    return null;
  }
  return {
    label: String(record.label ?? '').trim().slice(0, 80),
    x: clamp01(x),
    y: clamp01(y),
    w: Math.min(1, Math.max(0.08, w)),
    h: Math.min(1, Math.max(0.05, h)),
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function extensionOf(url: string): string {
  const pathname = url.split('?')[0] ?? url;
  return path.extname(pathname).toLowerCase() || '.mp4';
}

export function userBrollFingerprintKey(urls: string[] | undefined): string {
  if (!urls || urls.length === 0) {
    return '';
  }
  const joined = [...urls]
    .map(u => u.trim())
    .filter(Boolean)
    .sort()
    .join('|');
  if (!joined) {
    return '';
  }
  return createHash('sha256').update(joined).digest('hex').slice(0, 24);
}

/** Simple keyword overlap so leftover clips still get placed. */
export function scoreUserBrollMatch(
  asset: UserBrollAsset,
  keyword: string,
): number {
  const hay = `${asset.description} ${asset.kind} ${asset.regions.map(r => r.label).join(' ')}`.toLowerCase();
  const words = keyword
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
  if (words.length === 0) {
    return 0;
  }
  let hits = 0;
  for (const word of words) {
    if (hay.includes(word)) {
      hits += 1;
    }
  }
  return hits / words.length;
}

export function matchRegionToSpeech(
  asset: UserBrollAsset,
  spoken: string,
): AssetRegion | null {
  if (asset.regions.length === 0) {
    return null;
  }
  const words = spoken
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3);
  if (words.length === 0) {
    return asset.kind === 'document' ? asset.regions[0] ?? null : null;
  }
  let best = asset.regions[0]!;
  let bestHits = -1;
  for (const region of asset.regions) {
    const hay = region.label.toLowerCase();
    const hits = words.filter(word => hay.includes(word)).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = region;
    }
  }
  return bestHits > 0 || asset.kind === 'document' ? best : null;
}
