/**
 * Learn how this creator burns captions: colors, placement, animation, type.
 * Watermarks / platform chrome are ignored. The result is a guideline prompt
 * for the director on future edits.
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
import {extractSpeechAudio, extractStillJpeg, probeMedia} from '../../media/ffmpeg.ts';
import {transcribeAudio} from '../transcribe/groqTranscribe.ts';
import {directorConfigured} from '../broll/geminiDirector.ts';
import {
  coerceCaptionStyleGuide,
  defaultCaptionStyleGuide,
  type CaptionStyleGuide,
} from '../../types/captionStyleGuide.ts';

const log = stageLogger('caption-style');
const GEMINI_USD_PER_M_INPUT = 0.075;
const GEMINI_USD_PER_M_OUTPUT = 0.3;
const MAX_SOURCE_BYTES = 400 * 1024 * 1024;

type GeminiResponse = {
  candidates?: Array<{
    content?: {parts?: Array<{text?: string}>};
  }>;
  usageMetadata?: {promptTokenCount?: number; candidatesTokenCount?: number};
};

const SYSTEM = `You study how THIS creator burns on-screen captions in a vertical talking-head video.

Ignore Instagram / Facebook / TikTok / Meta watermarks, logos, and UI chrome.

Return ONE JSON object:
{
  "template": "karaoke" | "pop" | "beast" | "grape" | "hustle" | "gaming-stream" | "basic" | "weight-shift" | "editorial-emphasis" | "classic" | "box" | "bounce" | "minimal",
  "position": "bottom" | "lower_third" | "center" | "top",
  "text_color": "#RRGGBB",
  "highlight_color": "#RRGGBB",
  "box": boolean,
  "box_color": "#RRGGBB" or "",
  "font_scale": number,
  "animation": "pop" | "highlight" | "karaoke" | "bounce" | "type" | "scale",
  "word_reveal": "word" | "phrase" | "line",
  "bottom_frac": number,
  "uppercase": boolean,
  "italic": boolean,
  "notes": string
}

Rules:
- Infer from the stills (how type looks) plus speech energy (how words land).
- font_scale is relative to typical social captions (1.0 = normal, 0.8 smaller, 1.25 larger).
- bottom_frac is distance from the bottom of the 9:16 frame (0.08–0.24 typical).
- notes: 2–5 sentences the AI director can follow: color, placement vs the face, how each word appears, approx size.
- Output JSON only.`;

export type ExtractCaptionStyleResult = {
  guide: CaptionStyleGuide;
  transcriptPreview: string;
  sourceDurationSec: number;
  estimatedCostUsd: number;
};

export async function extractCaptionStyle(input: {
  videoUrl: string;
}): Promise<ExtractCaptionStyleResult> {
  return withWorkspace('caption-style', async workspace => {
    const local = isLocalMediaPath(input.videoUrl);
    const extension = local
      ? input.videoUrl.toLowerCase().includes('.mov')
        ? '.mov'
        : '.mp4'
      : '.mp4';
    const sourcePath = workspace.file(`source${extension}`);
    await (local
      ? copyLocalFile(input.videoUrl, sourcePath, {maxBytes: MAX_SOURCE_BYTES})
      : downloadToFile(input.videoUrl, sourcePath, {maxBytes: MAX_SOURCE_BYTES}));

    const probe = await probeMedia(sourcePath);
    if (probe.durationSec > env.MAX_SOURCE_DURATION_SEC) {
      throw new EngineError(
        'source_too_long',
        `Reference video must be ≤ ${env.MAX_SOURCE_DURATION_SEC}s`,
      );
    }

    let transcript = '';
    let asrCost = 0;
    if (probe.hasAudio) {
      try {
        const speech = await extractSpeechAudio(sourcePath, workspace.file('speech.ogg'));
        const transcription = await transcribeAudio({
          audioPath: speech.path,
          audioBytes: speech.bytes,
          languageCode: 'auto',
          durationSec: probe.durationSec,
        });
        transcript = transcription.transcript;
        asrCost = transcription.estimatedCostUsd;
      } catch (error) {
        log.warn({error}, 'caption-style transcript failed; stills only');
      }
    }

    const fallback = defaultCaptionStyleGuide({
      notes: 'Match this creator’s spoken-word captions: clear type, lower third, pop the active word.',
      sourceVideoUrl: input.videoUrl,
      learnedAt: new Date().toISOString(),
    });

    if (!directorConfigured()) {
      return {
        guide: fallback,
        transcriptPreview: transcript.slice(0, 280),
        sourceDurationSec: probe.durationSec,
        estimatedCostUsd: asrCost,
      };
    }

    const stills: string[] = [];
    const samples = [0.22, 0.55].map(frac =>
      Math.max(0.3, Math.min(probe.durationSec - 0.3, probe.durationSec * frac)),
    );
    for (const [index, at] of samples.entries()) {
      try {
        const path = workspace.file(`caption-${index}.jpg`);
        await extractStillJpeg(sourcePath, path, at);
        stills.push(path);
      } catch (error) {
        log.warn({error, at}, 'caption-style still failed');
      }
    }

    try {
      const {guide, estimatedCostUsd} = await callGeminiCaptionStyle({
        transcript,
        durationSec: probe.durationSec,
        stillPaths: stills,
        videoUrl: input.videoUrl,
      });
      return {
        guide,
        transcriptPreview: transcript.slice(0, 280),
        sourceDurationSec: probe.durationSec,
        estimatedCostUsd: asrCost + estimatedCostUsd,
      };
    } catch (error) {
      log.warn({error}, 'caption-style gemini failed');
      return {
        guide: fallback,
        transcriptPreview: transcript.slice(0, 280),
        sourceDurationSec: probe.durationSec,
        estimatedCostUsd: asrCost,
      };
    }
  });
}

async function callGeminiCaptionStyle(input: {
  transcript: string;
  durationSec: number;
  stillPaths: string[];
  videoUrl: string;
}): Promise<{guide: CaptionStyleGuide; estimatedCostUsd: number}> {
  const {promises: fs} = await import('node:fs');
  const model = env.GEMINI_MODEL || 'gemini-3.6-flash';
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const stillParts = [];
  for (const stillPath of input.stillPaths.slice(0, 2)) {
    const jpeg = await fs.readFile(stillPath);
    stillParts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: jpeg.toString('base64'),
      },
    });
  }

  const prompt =
    `Reference clip duration: ${input.durationSec.toFixed(1)}s.\n` +
    `Stills show the caption look. Transcript is for pacing only:\n` +
    `${input.transcript.slice(0, 4000) || '(no transcript)'}`;

  const body = await requestJson<GeminiResponse>(url, {
    method: 'POST',
    label: 'Gemini caption style',
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
    throw new EngineError('broll_failed', 'Caption style extractor returned no content');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, ''),
    );
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new EngineError('broll_failed', 'Caption style extractor returned bad JSON');
    }
    parsed = JSON.parse(match[0]);
  }

  const usage = body.usageMetadata ?? {};
  const estimatedCostUsd =
    ((usage.promptTokenCount ?? 0) / 1_000_000) * GEMINI_USD_PER_M_INPUT +
    ((usage.candidatesTokenCount ?? 0) / 1_000_000) * GEMINI_USD_PER_M_OUTPUT;

  const guide =
    coerceCaptionStyleGuide({
      ...(typeof parsed === 'object' && parsed ? parsed : {}),
      sourceVideoUrl: input.videoUrl,
      learnedAt: new Date().toISOString(),
    }) || defaultCaptionStyleGuide();

  return {guide, estimatedCostUsd};
}
