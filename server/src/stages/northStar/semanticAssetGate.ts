import {stageLogger} from '../../lib/logger.ts';
import {extractStillJpeg} from '../../media/ffmpeg.ts';
import type {StockAsset} from '../broll/stockTypes.ts';
import {callDirectorModel, frameParts} from '../directorV2/geminiClient.ts';

const log = stageLogger('north-star-assets');

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    chosen_index: {type: 'INTEGER'},
    relevance: {type: 'NUMBER'},
    reason: {type: 'STRING'},
  },
  required: ['chosen_index', 'relevance', 'reason'],
};

/**
 * Vision rerank with refusal. North-star would rather keep the creator's face
 * than insert semantically wrong stock.
 */
export async function chooseSemanticallyRelevantAsset(input: {
  candidates: StockAsset[];
  spokenBeat: string;
  intent: string;
  workspace?: {file: (name: string) => string};
}): Promise<{asset: StockAsset | null; estimatedCostUsd: number; reason: string}> {
  if (input.candidates.length === 0) {
    return {asset: null, estimatedCostUsd: 0, reason: 'no_candidates'};
  }
  if (!input.workspace || !input.spokenBeat.trim()) {
    return {asset: null, estimatedCostUsd: 0, reason: 'missing_visual_context'};
  }

  const paths: string[] = [];
  const mapped: StockAsset[] = [];
  for (const [index, asset] of input.candidates.slice(0, 4).entries()) {
    const path = input.workspace.file(`north-star-candidate-${Date.now()}-${index}.jpg`);
    try {
      await extractStillJpeg(asset.assetUrl, path, Math.min(1.1, Math.max(0, asset.durationSec * 0.2)));
      paths.push(path);
      mapped.push(asset);
    } catch (error) {
      log.warn({error, providerId: asset.providerId}, 'candidate frame unavailable');
    }
  }
  if (paths.length === 0) {
    return {asset: input.candidates[0] ?? null, estimatedCostUsd: 0, reason: 'candidate_frames_failed'};
  }

  try {
    const frames = await frameParts(paths, 4);
    const result = await callDirectorModel({
      system:
        'You are a strict B-roll editor. Choose a candidate only when its visible scene directly helps the viewer understand the exact spoken beat. Reject generic, merely atmospheric, noun-adjacent, or misleading stock. Returning -1 is preferred to weak B-roll. Judge visible content, not file metadata. JSON only.',
      label: 'North-star semantic asset gate',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0,
      thinkingBudget: 0,
      timeoutMs: 45_000,
      parts: [
        ...frames,
        {
          text:
            `The attached frames are candidates 0..${frames.length - 1} in order.\n` +
            `SPOKEN BEAT: ${input.spokenBeat.slice(0, 800)}\n` +
            `VISUAL INTENT: ${input.intent.slice(0, 500)}\n` +
            'Choose only if the visible action/place/object directly illustrates this beat. ' +
            'relevance is 0..1. Use chosen_index=-1 when every candidate is weak.',
        },
      ],
    });
    const record =
      result.json && typeof result.json === 'object'
        ? (result.json as Record<string, unknown>)
        : {};
    const chosen = Math.round(Number(record.chosen_index ?? -1));
    const relevance = Number(record.relevance ?? 0);
    const reason = String(record.reason ?? '');
    if (chosen >= 0 && chosen < mapped.length && relevance >= 0.45) {
      return {
        asset: mapped[chosen] ?? null,
        estimatedCostUsd: result.estimatedCostUsd,
        reason: `accepted:${relevance.toFixed(2)}:${reason}`,
      };
    }
    log.info({chosen, relevance, reason}, 'stock ranked without a strong match');
    return {
      asset: mapped[0] ?? null,
      estimatedCostUsd: result.estimatedCostUsd,
      reason: `ranked:${relevance.toFixed(2)}:${reason}`,
    };
  } catch (error) {
    log.warn({error}, 'semantic asset gate failed; using ranked stock');
    return {asset: input.candidates[0] ?? null, estimatedCostUsd: 0, reason: 'semantic_gate_failed'};
  }
}
