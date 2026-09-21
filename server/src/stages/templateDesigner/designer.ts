/**
 * AI Template Designer — medium vision/reasoning model.
 * Separate from the AI Director. Does not apply templates to user videos.
 */

import {readFile} from 'node:fs/promises';

import {env} from '../../config/env.ts';
import {EngineError} from '../../lib/errors.ts';
import {requestJson} from '../../lib/http.ts';
import {formatMotionPrimitiveRegistry} from '../../lib/motionPrimitives.ts';
import {stageLogger} from '../../lib/logger.ts';
import {loadPromptFile} from '../directorV2/promptLoader.ts';
import {directorConfigured} from '../broll/geminiDirector.ts';
import {validateEditSpec} from './validate.ts';
import type {DesignerPreprocess} from './preprocess.ts';
import type {EditSpec} from '../../types/editSpec.ts';

const log = stageLogger('template-designer');
const GEMINI_USD_PER_M_INPUT = 0.075;
const GEMINI_USD_PER_M_OUTPUT = 0.3;

type GeminiResponse = {
  candidates?: Array<{
    content?: {parts?: Array<{text?: string}>};
  }>;
  usageMetadata?: {promptTokenCount?: number; candidatesTokenCount?: number};
};

export type DesignerResult = {
  spec: EditSpec;
  warnings: string[];
  estimatedCostUsd: number;
  modelUsed: string;
};

export async function runTemplateDesigner(input: {
  preprocess: DesignerPreprocess;
  referenceUrl?: string;
}): Promise<DesignerResult> {
  const model =
    env.GEMINI_TEMPLATE_DESIGNER_MODEL || env.GEMINI_MODEL || 'gemini-3.6-flash';
  const fallback = validateEditSpec({
    overallStyle: 'Standard talking-head captions',
    modelUsed: model,
  });
  if (!directorConfigured()) {
    return {
      spec: {...fallback.spec, modelUsed: model},
      warnings: ['GEMINI_API_KEY missing; used default EditSpec'],
      estimatedCostUsd: input.preprocess.asrCostUsd,
      modelUsed: model,
    };
  }

  const system = `${loadPromptFile('template_designer.v1').trim()}\n\n${formatMotionPrimitiveRegistry()}`;
  const phraseLines = input.preprocess.phrases
    .slice(0, 24)
    .map(
      p =>
        `${p.start.toFixed(2)}-${p.end.toFixed(2)}s: ${p.text.slice(0, 80)}`,
    )
    .join('\n');
  const frameLines = input.preprocess.frames
    .map(
      f =>
        `${f.atSec.toFixed(2)}s ${f.reason}`,
    )
    .join(', ');

  const userText = [
    `Duration ${input.preprocess.durationSec.toFixed(1)}s, ${input.preprocess.width}x${input.preprocess.height} @ ${input.preprocess.fps.toFixed(1)}fps.`,
    `Scene cuts (s): ${input.preprocess.sceneCutsSec.map(t => t.toFixed(2)).join(', ') || 'none detected'}.`,
    `Sampled frames: ${frameLines || 'none'}.`,
    'Transcript with phrase boundaries (timing only — do not copy wording into the spec):',
    phraseLines || input.preprocess.transcript.slice(0, 4000) || '(no transcript)',
    'Return one JSON object:',
    `{
  "version": "1.0",
  "canvas": {"aspectRatio": "9:16"},
  "name": "2-4 word catalog name",
  "overallStyle": "short reusable description",
  "caption": {
    "template": "<catalog id>",
    "grouping": "word|phrase|line",
    "position": {"x": 0-1, "y": 0-1, "confidence": 0-1},
    "fontCategory": "condensed-bold|sans|rounded|neon|impact",
    "case": "uppercase|title|as-spoken",
    "size": 0.04-0.16,
    "tracking": -0.12-0.12,
    "textColor": "#RRGGBB",
    "highlightColor": "#RRGGBB",
    "box": false,
    "boxColor": null,
    "animation": "highlight|karaoke|scale|bounce|box|pop|type",
    "confidence": 0-1
  },
  "emphasis": {
    "trigger": {"type": "emphasis_word|hook|cta|number", "importance": "high|medium|low"},
    "action": {"textScale": 0.5-3, "colorChange": true, "cameraZoom": 0.5-3}
  },
  "animations": {
    "captionIn": {"type": "pop|fade|slide|karaoke|bounce|typewriter|none", "durationMs": 40-800, "intensity": 0-1, "confidence": 0-1},
    "captionOut": {"type": "fade|none", "durationMs": 0-600}
  },
  "camera": {"emphasisZoom": {"enabled": false, "scale": 1.08, "durationMs": 220}},
  "confidence": 0-1
}`,
  ].join('\n\n');

  const stillParts: Array<{inlineData: {mimeType: string; data: string}}> = [];
  for (const frame of input.preprocess.frames.slice(0, env.TEMPLATE_DESIGNER_MAX_FRAMES)) {
    const jpeg = await readFile(frame.path);
    stillParts.push({
      inlineData: {mimeType: 'image/jpeg', data: jpeg.toString('base64')},
    });
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  try {
    const body = await requestJson<GeminiResponse>(url, {
      method: 'POST',
      label: 'Gemini template designer',
      failureCode: 'broll_failed',
      timeoutMs: 90_000,
      retries: 1,
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        systemInstruction: {parts: [{text: system}]},
        contents: [
          {
            role: 'user',
            parts: [...stillParts, {text: userText}],
          },
        ],
        generationConfig: {
          temperature: 0.25,
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
      throw new EngineError('broll_failed', 'Template designer returned no content');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, ''),
      );
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new EngineError('broll_failed', 'Template designer returned bad JSON');
      }
      parsed = JSON.parse(match[0]);
    }

    const usage = body.usageMetadata ?? {};
    const estimatedCostUsd =
      input.preprocess.asrCostUsd +
      ((usage.promptTokenCount ?? 0) / 1_000_000) * GEMINI_USD_PER_M_INPUT +
      ((usage.candidatesTokenCount ?? 0) / 1_000_000) * GEMINI_USD_PER_M_OUTPUT;
    const validated = validateEditSpec({
      ...(typeof parsed === 'object' && parsed ? parsed : {}),
      modelUsed: model,
    });
    return {
      spec: validated.spec,
      warnings: validated.warnings,
      estimatedCostUsd,
      modelUsed: model,
    };
  } catch (error) {
    log.warn({error}, 'template designer gemini failed');
    return {
      spec: {...fallback.spec, modelUsed: model},
      warnings: [
        error instanceof Error ? error.message : 'Template designer fallback',
      ],
      estimatedCostUsd: input.preprocess.asrCostUsd,
      modelUsed: model,
    };
  }
}
