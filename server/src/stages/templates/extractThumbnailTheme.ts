/**
 * Learn thumbnail brand tokens (palette / typography / mood / notes)
 * from one or more reference stills the creator uploaded.
 */

import {env} from '../../config/env.ts';
import {EngineError} from '../../lib/errors.ts';
import {requestJson} from '../../lib/http.ts';
import {stageLogger} from '../../lib/logger.ts';
import {
  copyLocalFile,
  downloadToFile,
  isLocalMediaPath,
  withWorkspace,
} from '../../lib/tempFiles.ts';
import {directorConfigured} from '../broll/geminiDirector.ts';
import {
  coerceThumbnailTheme,
  defaultThumbnailTheme,
  type ThumbnailTheme,
} from '../../types/thumbnailTheme.ts';

const log = stageLogger('thumbnail-theme');
const GEMINI_USD_PER_M_INPUT = 0.075;
const GEMINI_USD_PER_M_OUTPUT = 0.3;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGES = 6;

type GeminiResponse = {
  candidates?: Array<{
    content?: {parts?: Array<{text?: string}>};
  }>;
  usageMetadata?: {promptTokenCount?: number; candidatesTokenCount?: number};
};

const SYSTEM = `You study reference social-video THUMBNAILS to extract a reusable brand kit.

Do NOT describe a fixed layout to clone. Extract theme tokens so future thumbnails can vary composition while matching colors, typography, and mood.

Return ONE JSON object:
{
  "mood": "hype" | "clean" | "educational" | "sales" | "story",
  "palette": {
    "primary": "#RRGGBB",
    "accent": "#RRGGBB",
    "background": "#RRGGBB",
    "text": "#RRGGBB",
    "outline": "#RRGGBB" or ""
  },
  "typography": {
    "headlineWeight": "black" | "bold" | "semibold",
    "case": "upper" | "title" | "sentence",
    "style": "sans-impact" | "rounded" | "editorial",
    "outline": boolean,
    "shadow": boolean
  },
  "visualMotifs": string[],
  "styleNotes": string
}

Rules:
- Infer dominant background, text, and accent colors from the images.
- Infer type weight / case / outline / shadow from how headlines look.
- visualMotifs: 2–5 short phrases (e.g. "high contrast", "face + big text").
- styleNotes: 2–5 sentences describing the brand feel for a thumbnail generator. Explicitly say to vary layout per video and not copy a fixed composition.
- Ignore platform watermarks and UI chrome.
- Output JSON only.`;

export type ExtractThumbnailThemeResult = {
  theme: ThumbnailTheme;
  estimatedCostUsd: number;
};

function extensionForUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('.png')) {
    return '.png';
  }
  if (lower.includes('.webp')) {
    return '.webp';
  }
  if (lower.includes('.gif')) {
    return '.gif';
  }
  return '.jpg';
}

function mimeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lower.endsWith('.gif')) {
    return 'image/gif';
  }
  return 'image/jpeg';
}

export async function extractThumbnailTheme(input: {
  imageUrls: string[];
}): Promise<ExtractThumbnailThemeResult> {
  const urls = input.imageUrls
    .map(url => url.trim())
    .filter(Boolean)
    .slice(0, MAX_IMAGES);
  if (urls.length === 0) {
    throw new EngineError('bad_request', 'imageUrls must include at least one URL');
  }

  const fallback = defaultThumbnailTheme({
    referenceImageUrls: urls,
    styleNotes:
      'Match colors, typography weight, and overall mood from the creator reference thumbnails. Vary layout per video — do not clone a fixed composition.',
    learnedAt: new Date().toISOString(),
  });

  return withWorkspace('thumbnail-theme', async workspace => {
    const localPaths: string[] = [];
    for (const [index, imageUrl] of urls.entries()) {
      const ext = extensionForUrl(imageUrl);
      const dest = workspace.file(`ref-${index}${ext}`);
      try {
        if (isLocalMediaPath(imageUrl)) {
          await copyLocalFile(imageUrl, dest, {maxBytes: MAX_IMAGE_BYTES});
        } else {
          await downloadToFile(imageUrl, dest, {maxBytes: MAX_IMAGE_BYTES});
        }
        localPaths.push(dest);
      } catch (error) {
        log.warn({error, imageUrl}, 'thumbnail-theme download failed');
      }
    }

    if (localPaths.length === 0) {
      throw new EngineError(
        'bad_request',
        'Could not download any reference thumbnail images',
      );
    }

    if (!directorConfigured()) {
      return {theme: fallback, estimatedCostUsd: 0};
    }

    try {
      const {theme, estimatedCostUsd} = await callGeminiThumbnailTheme({
        stillPaths: localPaths,
        imageUrls: urls,
      });
      return {theme, estimatedCostUsd};
    } catch (error) {
      log.warn({error}, 'thumbnail-theme gemini failed');
      return {theme: fallback, estimatedCostUsd: 0};
    }
  });
}

async function callGeminiThumbnailTheme(input: {
  stillPaths: string[];
  imageUrls: string[];
}): Promise<{theme: ThumbnailTheme; estimatedCostUsd: number}> {
  const {promises: fs} = await import('node:fs');
  const model = env.GEMINI_MODEL || 'gemini-3.6-flash';
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const stillParts = [];
  for (const stillPath of input.stillPaths.slice(0, MAX_IMAGES)) {
    const bytes = await fs.readFile(stillPath);
    stillParts.push({
      inlineData: {
        mimeType: mimeForPath(stillPath),
        data: bytes.toString('base64'),
      },
    });
  }

  const prompt =
    `Analyze ${stillParts.length} reference thumbnail image(s). ` +
    `Extract a reusable brand kit (colors, type, mood, notes). ` +
    `Do not prescribe a single layout to copy.`;

  const body = await requestJson<GeminiResponse>(url, {
    method: 'POST',
    label: 'Gemini thumbnail theme',
    failureCode: 'broll_failed',
    timeoutMs: 45_000,
    retries: 1,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      systemInstruction: {parts: [{text: SYSTEM}]},
      contents: [
        {
          role: 'user',
          parts: [...stillParts, {text: prompt}],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    }),
  });

  const text = body.candidates?.[0]?.content?.parts
    ?.map(part => part.text ?? '')
    .join('')
    .trim();
  if (!text) {
    throw new EngineError(
      'broll_failed',
      'Thumbnail theme extractor returned no content',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, ''),
    );
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new EngineError(
        'broll_failed',
        'Thumbnail theme extractor returned bad JSON',
      );
    }
    parsed = JSON.parse(match[0]);
  }

  const usage = body.usageMetadata ?? {};
  const estimatedCostUsd =
    ((usage.promptTokenCount ?? 0) / 1_000_000) * GEMINI_USD_PER_M_INPUT +
    ((usage.candidatesTokenCount ?? 0) / 1_000_000) * GEMINI_USD_PER_M_OUTPUT;

  const theme =
    coerceThumbnailTheme({
      ...(typeof parsed === 'object' && parsed ? parsed : {}),
      referenceImageUrls: input.imageUrls,
      curatedDemoId: null,
      learnedAt: new Date().toISOString(),
    }) ||
    defaultThumbnailTheme({
      referenceImageUrls: input.imageUrls,
      learnedAt: new Date().toISOString(),
    });

  return {theme, estimatedCostUsd};
}
