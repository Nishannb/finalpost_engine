/**
 * Study creator-supplied B-roll clips so the director can place them.
 *
 * Downloads each public URL, probes duration, grabs two stills, and asks Gemini
 * for a short English description used for moment matching.
 */

import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';

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

const MAX_USER_BROLL = 5;
const MAX_BYTES = 120 * 1024 * 1024;

export type UserBrollAsset = {
  id: string;
  url: string;
  description: string;
  durationSec: number;
  width: number;
  height: number;
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
  const ext = url.toLowerCase().includes('.mov') ? '.mov' : '.mp4';
  const localPath = workspace.file(`${id}_src${ext}`);
  if (isLocalMediaPath(url)) {
    await copyLocalFile(url, localPath, {maxBytes: MAX_BYTES});
  } else {
    await downloadToFile(url, localPath, {maxBytes: MAX_BYTES});
  }

  const probe = await probeMedia(localPath);
  if (probe.durationSec < 0.6) {
    return null;
  }

  const frameA = workspace.file(`${id}_a.jpg`);
  const frameB = workspace.file(`${id}_b.jpg`);
  await extractStillJpeg(localPath, frameA, probe.durationSec * 0.2);
  await extractStillJpeg(
    localPath,
    frameB,
    Math.min(probe.durationSec * 0.65, Math.max(0.4, probe.durationSec - 0.3)),
  );

  const description = await describeFrames(frameA, frameB, probe.durationSec);
  return {
    id,
    url,
    description: description || 'Creator-supplied vertical video clip',
    durationSec: probe.durationSec,
    width: probe.width || 1080,
    height: probe.height || 1920,
  };
}

async function describeFrames(
  jpegA: string,
  jpegB: string,
  durationSec: number,
): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    return `Creator B-roll clip (~${durationSec.toFixed(1)}s)`;
  }

  const [a, b] = await Promise.all([
    fs.readFile(jpegA),
    fs.readFile(jpegB),
  ]);
  const model = env.GEMINI_MODEL || 'gemini-3.6-flash';
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const body = await requestJson<GeminiResponse>(url, {
    method: 'POST',
    label: 'Gemini user B-roll describe',
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
              inlineData: {
                mimeType: 'image/jpeg',
                data: a.toString('base64'),
              },
            },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: b.toString('base64'),
              },
            },
            {
              text:
                `Two frames from a ~${durationSec.toFixed(1)}s vertical B-roll clip the creator uploaded.\n` +
                `Write ONE English sentence (max 28 words) describing subject, action, and setting so an editor can match it to a talking-head transcript.\n` +
                `No quotes, no markdown — plain sentence only.`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 120,
      },
    }),
  });

  const text = body.candidates?.[0]?.content?.parts
    ?.map(part => part.text ?? '')
    .join(' ')
    .trim()
    .replace(/^["']|["']$/g, '')
    .slice(0, 220);
  return text || `Creator B-roll clip (~${durationSec.toFixed(1)}s)`;
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
  const hay = asset.description.toLowerCase();
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
