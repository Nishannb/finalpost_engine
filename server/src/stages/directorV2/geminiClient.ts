import {promises as fs} from 'node:fs';

import {env} from '../../config/env.ts';
import {dumpDirectorTrace} from '../../lib/directorDump.ts';
import {EngineError, isEngineError} from '../../lib/errors.ts';
import {requestJson} from '../../lib/http.ts';
import {stageLogger} from '../../lib/logger.ts';
import {hashPromptInput} from './promptLoader.ts';

const log = stageLogger('director-v2-gemini');

const USD_IN = 0.075;
const USD_OUT = 0.3;

type GeminiResponse = {
  candidates?: Array<{
    content?: {parts?: Array<{text?: string}>};
    finishReason?: string;
  }>;
  usageMetadata?: {promptTokenCount?: number; candidatesTokenCount?: number};
};

export type GeminiPart =
  | {text: string}
  | {inlineData: {mimeType: string; data: string}};

export type DirectorModelResult = {
  json: unknown;
  estimatedCostUsd: number;
  model: string;
  inputHash: string;
  latencyMs: number;
  promptTokens: number;
  candidateTokens: number;
};

export async function callDirectorModel(input: {
  model?: string;
  system: string;
  parts: GeminiPart[];
  responseSchema: Record<string, unknown>;
  label: string;
  timeoutMs?: number;
  temperature?: number;
  thinkingBudget?: number;
}): Promise<DirectorModelResult> {
  if (!env.GEMINI_API_KEY) {
    throw new EngineError('not_configured', 'GEMINI_API_KEY is missing');
  }
  const preferred = input.model || env.GEMINI_MODEL || 'gemini-3.6-flash';
  const models = [...new Set([preferred, 'gemini-3.6-flash', 'gemini-3.7-flash'])];
  let lastError: unknown;
  let thinkingBudget = input.thinkingBudget;
  let timeoutMs = input.timeoutMs ?? 90_000;
  for (const model of models) {
    try {
      return await callOnce({...input, model, thinkingBudget, timeoutMs});
    } catch (error) {
      lastError = error;
      if (isTimeout(error) && thinkingBudget !== 0) {
        thinkingBudget = 0;
        timeoutMs = Math.min(timeoutMs, 90_000);
        log.warn(
          {model, error, label: input.label},
          'director timed out; retrying without extended thinking',
        );
        try {
          return await callOnce({
            ...input,
            model,
            thinkingBudget: 0,
            timeoutMs,
          });
        } catch (retryError) {
          lastError = retryError;
          log.warn(
            {model, error: retryError, label: input.label},
            'director low-thinking retry failed; trying next',
          );
        }
      } else {
        log.warn({model, error, label: input.label}, 'director model failed; trying next');
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new EngineError('broll_failed', `${input.label} failed`);
}

function isTimeout(error: unknown): boolean {
  return isEngineError(error) && error.code === 'upstream_timeout';
}

async function callOnce(input: {
  model: string;
  system: string;
  parts: GeminiPart[];
  responseSchema: Record<string, unknown>;
  label: string;
  timeoutMs?: number;
  temperature?: number;
  thinkingBudget?: number;
}): Promise<DirectorModelResult> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(input.model)}:generateContent`;
  const userText = input.parts
    .map(part => ('text' in part ? part.text : ''))
    .join('\n');
  const frameCount = input.parts.filter(part => 'inlineData' in part).length;
  const inputHash = hashPromptInput(input.system, userText, frameCount);
  const started = Date.now();
  const generationConfig: Record<string, unknown> = {
    temperature: input.temperature ?? 0.55,
    responseMimeType: 'application/json',
    responseSchema: input.responseSchema,
  };
  if (input.thinkingBudget !== 0) {
    generationConfig.thinkingConfig = {
      thinkingBudget: input.thinkingBudget ?? 4096,
    };
  }
  const body = await requestJson<GeminiResponse>(url, {
    method: 'POST',
    label: input.label,
    failureCode: 'broll_failed',
    timeoutMs: input.timeoutMs ?? 90_000,
    retries: 1,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: {parts: [{text: input.system}]},
      contents: [{role: 'user', parts: input.parts}],
      generationConfig,
    }),
  });
  const latencyMs = Date.now() - started;
  const text = body.candidates?.[0]?.content?.parts
    ?.map(part => part.text ?? '')
    .join('')
    .trim();
  if (!text) {
    throw new EngineError('broll_failed', `${input.label} returned no content`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new EngineError('broll_failed', `${input.label} returned malformed JSON`, {
      preview: text.slice(0, 240),
    });
  }
  const usage = body.usageMetadata ?? {};
  const promptTokens = usage.promptTokenCount ?? 0;
  const candidateTokens = usage.candidatesTokenCount ?? 0;
  const estimatedCostUsd =
    (promptTokens / 1_000_000) * USD_IN + (candidateTokens / 1_000_000) * USD_OUT;
  dumpDirectorTrace(
    `v2-${input.label.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}`,
    {
      label: input.label,
      model: input.model,
      frameCount,
      systemInstruction: input.system,
      userPrompt: userText,
      rawResponse: json,
      usage,
      latencyMs,
      estimatedCostUsd,
    },
  );
  log.info(
    {
      label: input.label,
      model: input.model,
      inputHash,
      latencyMs,
      promptTokens,
      candidateTokens,
      estimatedCostUsd,
    },
    'director stage call',
  );
  return {
    json,
    estimatedCostUsd,
    model: input.model,
    inputHash,
    latencyMs,
    promptTokens,
    candidateTokens,
  };
}

export async function frameParts(paths: string[], limit = 8): Promise<GeminiPart[]> {
  const out: GeminiPart[] = [];
  for (const filePath of paths.slice(0, limit)) {
    try {
      const buf = await fs.readFile(filePath);
      out.push({
        inlineData: {mimeType: 'image/jpeg', data: buf.toString('base64')},
      });
    } catch (error) {
      log.warn({filePath, error}, 'storyboard frame missing');
    }
  }
  return out;
}
