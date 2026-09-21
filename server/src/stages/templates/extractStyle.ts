/**
 * Extract a Kinmel TemplateRecipe from a reference edit video.
 *
 * Uses ASR + Gemini text (not a generative video model). The recipe only
 * describes edits our Remotion engine can perform. Watermarked platform
 * marks are explicitly ignored — we never redistribute the source pixels
 * as the public template preview.
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
import {extractSpeechAudio, probeMedia} from '../../media/ffmpeg.ts';
import {transcribeAudio} from '../transcribe/groqTranscribe.ts';
import {
  formatLutsForDirectorPrompt,
  shortlistLutsForDirector,
} from '../color/lutCatalog.ts';
import {
  coerceVideoTemplateRecipe,
  defaultVideoTemplateRecipe,
  type VideoTemplateRecipe,
} from '../../types/templateRecipe.ts';
import {directorConfigured} from '../broll/geminiDirector.ts';

const log = stageLogger('template-extract');

const GEMINI_USD_PER_M_INPUT = 0.075;
const GEMINI_USD_PER_M_OUTPUT = 0.3;
const MAX_SOURCE_BYTES = 400 * 1024 * 1024;

type GeminiResponse = {
  candidates?: Array<{
    content?: {parts?: Array<{text?: string}>};
  }>;
  usageMetadata?: {promptTokenCount?: number; candidatesTokenCount?: number};
};

const SYSTEM = `You reverse-engineer a vertical social video's EDIT STYLE for Kinmel.

Analyze: speech pacing, kinetic captions, motion graphics, transitions, zooms,
B-roll / overlays, color grade, hook title treatment — and write a generative
prompt that can recreate that EDIT STYLE on a different talking-head (Seedance).

Return ONE JSON object:
{
  "summary": string,
  "energy": "calm" | "educational" | "hype" | "sales" | "story",
  "caption_template": "karaoke" | "pop" | "beast" | "grape" | "hustle" | "gaming-stream" | "basic" | "weight-shift" | "classic" | "box" | "bounce" | "minimal",
  "hook_style": "impact" | "boxed" | "minimal" | "bar" | "stack" | "outline" | "rail" | "poster" | "underline" | "duo",
  "preferred_lut": string,
  "suggested_luts": [string, string, string],
  "broll_density": number,
  "zoom_density": number,
  "trim_silence": boolean,
  "director_notes": string,
  "seedance_prompt": string
}

Rules:
- seedance_prompt: 4–8 sentences, specific about motion graphics, caption look,
  camera moves, pacing, color, hook — ready to send to a video model.
- IGNORE Instagram / Facebook / TikTok / Meta watermarks, logos, and UI chrome.
  Never ask to recreate watermarks in seedance_prompt or director_notes.
- preferred_lut and suggested_luts MUST be ids from AVAILABLE_LUTS (or "" for natural).
- broll_density / zoom_density are 0–1.
- Output JSON only.`;

export type ExtractStyleResult = {
  recipe: VideoTemplateRecipe;
  /** Full generative prompt for Seedance (also on recipe.seedancePrompt). */
  prompt: string;
  transcriptPreview: string;
  sourceDurationSec: number;
  estimatedCostUsd: number;
};

export async function extractTemplateStyle(input: {
  videoUrl: string;
}): Promise<ExtractStyleResult> {
  return withWorkspace('template-style', async workspace => {
    const local = isLocalMediaPath(input.videoUrl);
    const extension = local
      ? input.videoUrl.toLowerCase().includes('.mov')
        ? '.mov'
        : '.mp4'
      : '.mp4';
    const sourcePath = workspace.file(`source${extension}`);
    const download = local
      ? await copyLocalFile(input.videoUrl, sourcePath, {
          maxBytes: MAX_SOURCE_BYTES,
        })
      : await downloadToFile(input.videoUrl, sourcePath, {
          maxBytes: MAX_SOURCE_BYTES,
        });

    const probe = await probeMedia(sourcePath);
    const durationSec = probe.durationSec;
    if (durationSec > env.MAX_SOURCE_DURATION_SEC) {
      throw new EngineError(
        'source_too_long',
        `Reference video must be ≤ ${env.MAX_SOURCE_DURATION_SEC}s`,
      );
    }
    if (!probe.hasAudio) {
      throw new EngineError(
        'no_speech_detected',
        'Reference video has no audio track',
      );
    }

    const speechPath = workspace.file('speech.opus');
    const speech = await extractSpeechAudio(sourcePath, speechPath);
    const transcription = await transcribeAudio({
      audioPath: speech.path,
      audioBytes: speech.bytes,
      languageCode: 'auto',
      durationSec,
    });

    const fallback = fallbackRecipeFromTranscript(transcription.transcript);
    if (!directorConfigured()) {
      return {
        recipe: fallback,
        prompt: fallback.seedancePrompt,
        transcriptPreview: transcription.transcript.slice(0, 280),
        sourceDurationSec: durationSec,
        estimatedCostUsd: transcription.estimatedCostUsd,
      };
    }

    try {
      const {recipe, estimatedCostUsd} = await callGeminiRecipe({
        transcript: transcription.transcript,
        durationSec,
      });
      return {
        recipe,
        prompt: recipe.seedancePrompt,
        transcriptPreview: transcription.transcript.slice(0, 280),
        sourceDurationSec: durationSec,
        estimatedCostUsd: transcription.estimatedCostUsd + estimatedCostUsd,
      };
    } catch (error) {
      log.warn({error, bytes: download.bytes}, 'template style gemini failed');
      return {
        recipe: fallback,
        prompt: fallback.seedancePrompt,
        transcriptPreview: transcription.transcript.slice(0, 280),
        sourceDurationSec: durationSec,
        estimatedCostUsd: transcription.estimatedCostUsd,
      };
    }
  });
}

function fallbackRecipeFromTranscript(transcript: string): VideoTemplateRecipe {
  const text = transcript.toLowerCase();
  let energy: VideoTemplateRecipe['energy'] = 'sales';
  let captionTemplate: VideoTemplateRecipe['captionTemplate'] = 'karaoke';
  if (/\b(story|when i|remember)\b/.test(text)) {
    energy = 'story';
    captionTemplate = 'weight-shift';
  } else if (/\b(how to|step|tip|learn)\b/.test(text)) {
    energy = 'educational';
    captionTemplate = 'karaoke';
  } else if (/[!]{2,}|\bwow\b|\bhype\b/.test(text)) {
    energy = 'hype';
    captionTemplate = 'beast';
  }
  return defaultVideoTemplateRecipe({
    summary: 'Inferred from speech energy',
    energy,
    captionTemplate,
  });
}

async function callGeminiRecipe(input: {
  transcript: string;
  durationSec: number;
}): Promise<{recipe: VideoTemplateRecipe; estimatedCostUsd: number}> {
  const lutPrompt = formatLutsForDirectorPrompt(shortlistLutsForDirector());
  const model = env.GEMINI_MODEL || 'gemini-3.6-flash';
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const prompt =
    `Reference clip duration: ${input.durationSec.toFixed(1)}s.\n` +
    `AVAILABLE_LUTS:\n${lutPrompt}\n\n` +
    `Transcript (may include filler; infer EDIT STYLE only):\n` +
    `${input.transcript.slice(0, 10_000)}`;

  const body = await requestJson<GeminiResponse>(url, {
    method: 'POST',
    label: 'Gemini template style',
    failureCode: 'broll_failed',
    timeoutMs: 45_000,
    retries: 1,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      systemInstruction: {parts: [{text: SYSTEM}]},
      contents: [{role: 'user', parts: [{text: prompt}]}],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    }),
  });

  const text = body.candidates?.[0]?.content?.parts
    ?.map(part => part.text ?? '')
    .join('')
    .trim();
  if (!text) {
    throw new EngineError('broll_failed', 'Style extractor returned no content');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, ''),
    );
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new EngineError('broll_failed', 'Style extractor returned bad JSON');
    }
    parsed = JSON.parse(match[0]);
  }

  const usage = body.usageMetadata ?? {};
  const estimatedCostUsd =
    ((usage.promptTokenCount ?? 0) / 1_000_000) * GEMINI_USD_PER_M_INPUT +
    ((usage.candidatesTokenCount ?? 0) / 1_000_000) * GEMINI_USD_PER_M_OUTPUT;

  return {
    recipe: coerceVideoTemplateRecipe(parsed),
    estimatedCostUsd,
  };
}
