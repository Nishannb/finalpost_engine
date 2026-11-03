/**
 * Async job wrapper around stages A→D.
 *
 * Analysis takes tens of seconds, which is far too long to hold a mobile HTTP
 * request open, so callers get a job id immediately and poll. Concurrency is
 * capped because ffmpeg is the one CPU-bound step and the API shares a small VPS.
 */

import {randomUUID} from 'node:crypto';

import {env} from '../config/env.ts';
import {polishRequestedEdits} from '../lib/editToolkits.ts';
import {isEngineError, toEngineError} from '../lib/errors.ts';
import {geminiBudgetFromLimit, geminiBudgetPlanFor, withGeminiBudget} from '../lib/geminiEditBudget.ts';
import {analyzeOverridesFor, graphicsFingerprintKey, normalizeEditProfile, profileFingerprintKey, unrecognizedEditProfile, requestGraphicsStatus, type ProductEditProfile} from '../lib/productEditProfile.ts';
import {stageLogger} from '../lib/logger.ts';
import {normalizeProvidedCutoutUrl} from '../lib/providedCutout.ts';
import {
  fingerprintSource,
  loadBlueprintByFingerprint,
  loadBlueprintGraphicsStatus,
  saveAnalysisJob,
  saveBlueprint,
} from '../store/engineStore.ts';
import {
  assertAnalysisAllowed,
  recordAnalysis,
} from '../stages/render/renderBudget.ts';
import {userBrollFingerprintKey} from '../stages/broll/userBrollDescribe.ts';
import type {
  AnalysisJob,
  AnalysisStage,
  LanguageCode,
} from '../types/blueprint.ts';
import {analyzeVideo} from './analyzeVideo.ts';
import type {AnalyzeInput} from './analyzeVideo.ts';

const log = stageLogger('analysis-runner');

const MAX_CONCURRENT_ANALYSES = 2;
let active = 0;
const waiting: Array<() => void> = [];

async function acquireSlot(): Promise<() => void> {
  if (active >= MAX_CONCURRENT_ANALYSES) {
    await new Promise<void>(resolve => waiting.push(resolve));
  }
  active += 1;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    active -= 1;
    waiting.shift()?.();
  };
}

export async function startAnalysis(input: {
  userId: string;
  videoUrl: string;
  languageCode: LanguageCode;
  useCache: boolean;
  colorGradeLut?: string;
  styleRecipe?: Record<string, unknown>;
  userBrollUrls?: string[];
  labeledAssetBindings?: import('../stages/broll/labeledAssetBrief.ts').LabeledAssetBinding[];
  /** WP55: creator / business brand name (optional). */
  brandName?: string;
  captionStyleGuide?: Record<string, unknown> | null;
  forceSpeakerCutout?: boolean;
  /** A ready transparent talking-head WebM (the RVM matting job's outputUrl); see lib/providedCutout.ts. */
  subjectCutoutUrl?: string;
  directorV2?: boolean;
  northStar?: boolean;
  requestedEdits?: string[] | null;
  captionTemplate?: string | null;
  captionPreset?: string;
  teleprompterClean?: boolean;
  scriptText?: string;
}): Promise<AnalysisJob> {
  const now = new Date().toISOString();
  const bindingUrls = (input.labeledAssetBindings ?? [])
    .flatMap(binding => [binding.assetUrl, ...(binding.assetUrls ?? [])])
    .map(url => (url || '').trim())
    .filter(Boolean);
  const userBrollUrls = [
    ...(input.userBrollUrls ?? []).filter(Boolean),
    ...bindingUrls,
  ]
    .filter((url, index, all) => all.indexOf(url) === index)
    .slice(0, 16);
  const labeledAssetBindings = input.labeledAssetBindings ?? [];
  const scriptKey = (input.scriptText || '').trim().slice(0, 800);
  // WP1: resolved once per job from server configuration (never from the request), so the cache key and the run agree.
  const editProfile = normalizeEditProfile(env.PRODUCT_EDIT_PROFILE);
  const unknownProfile = unrecognizedEditProfile(env.PRODUCT_EDIT_PROFILE);
  if (unknownProfile) log.warn({value: unknownProfile, resolved: editProfile}, 'PRODUCT_EDIT_PROFILE is not legacy, mvp, cuts or polish; using the default (cuts)');
  // WP8I: on polish, the edits the job will really run (an omitted list means the polish default; `all` is its own key), so a change of POLISH_DEFAULT_EDITS or an explicit list never serves a stale blueprint.
  const polishEdits = editProfile === 'polish' ? polishRequestedEdits(input.requestedEdits, env.POLISH_DEFAULT_EDITS) : undefined;
  // WP3Z: the graphics decision this request would make now (server flag + Claude budget, the same helpers analyzeVideo uses), computed before the lookup; `off` adds nothing to the key.
  const graphicsAtRequest = requestGraphicsStatus({
    profile: editProfile,
    graphicsFlag: env.MOTION_GRAPHICS_ENABLED,
    capUsd: env.CLAUDE_EDIT_BUDGET_USD,
    maxRequests: env.CLAUDE_EDIT_MAX_REQUESTS,
    maxTokensPerCall: env.CLAUDE_EDIT_MAX_TOKENS,
  });
  const fingerprint = fingerprintSource({
    videoUrl: input.videoUrl,
    languageCode: input.languageCode,
    colorGradeLut: input.colorGradeLut,
    styleRecipeKey: input.styleRecipe
      ? JSON.stringify(input.styleRecipe).slice(0, 500)
      : '',
    userBrollKey: userBrollFingerprintKey(userBrollUrls),
    captionStyleKey: input.captionStyleGuide
      ? JSON.stringify(input.captionStyleGuide).slice(0, 400)
      : '',
    forceSpeakerCutout: input.forceSpeakerCutout,
    subjectCutoutKey: normalizeProvidedCutoutUrl(input.subjectCutoutUrl),
    directorV2: input.directorV2,
    northStar: input.northStar,
    requestedEdits: editProfile === 'polish' ? (polishEdits === null ? 'all' : (polishEdits ?? []).slice().sort().join(',')) : (input.requestedEdits ?? []).slice().sort().join(','),
    captionTemplate: input.captionPreset
      ? `${input.captionTemplate ?? ''}|kit:${input.captionPreset}`
      : (input.captionTemplate ?? ''),
    teleprompterClean: Boolean(input.teleprompterClean),
    scriptKey,
    editProfileKey: profileFingerprintKey(editProfile),
    graphicsKey: graphicsFingerprintKey(graphicsAtRequest),
  });

  const hasUploadedBindings = labeledAssetBindings.some(
    binding => binding.status === 'uploaded',
  );
  // Uploaded labeled assets must not reuse a cached blueprint without those binds.
  const useCache = input.useCache && !hasUploadedBindings;

  // Cache hit costs nothing and must not consume the user's monthly allowance.
  if (useCache) {
    const cached = await loadBlueprintByFingerprint(fingerprint);
    if (cached) {
      // WP3Y: the decision of the run that made this blueprint, copied as stored; absent for an older entry. Never recomputed from today's flag or budget.
      const storedGraphics = await loadBlueprintGraphicsStatus(cached.blueprintId);
      const job: AnalysisJob = {
        analysisJobId: `an_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        userId: input.userId,
        videoUrl: input.videoUrl,
        languageCode: input.languageCode,
        status: 'done',
        progress: 1,
        createdAt: now,
        updatedAt: now,
        cached: true,
        editProfile, // the profile is part of the cache key, so a hit is a blueprint of this profile
        ...(storedGraphics ? {graphics: storedGraphics} : {}),
        blueprint: cached,
      };
      await saveAnalysisJob(job);
      log.info({blueprintId: cached.blueprintId}, 'served cached blueprint');
      return job;
    }
  }

  await assertAnalysisAllowed(input.userId);

  const job: AnalysisJob = {
    analysisJobId: `an_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    userId: input.userId,
    videoUrl: input.videoUrl,
    languageCode: input.languageCode,
    status: 'queued',
    progress: 0,
    createdAt: now,
    updatedAt: now,
    cached: false,
    editProfile, // WP3X: from server configuration, never from the request
  };
  await saveAnalysisJob(job);

  void runAnalysis(job, fingerprint, {
    colorGradeLut: input.colorGradeLut,
    styleRecipe: input.styleRecipe,
    userBrollUrls,
    labeledAssetBindings,
    brandName: input.brandName,
    captionStyleGuide: input.captionStyleGuide,
    forceSpeakerCutout: input.forceSpeakerCutout,
    subjectCutoutUrl: input.subjectCutoutUrl,
    directorV2: input.directorV2,
    northStar: input.northStar,
    requestedEdits: input.requestedEdits,
    captionTemplate: input.captionTemplate,
    captionPreset: input.captionPreset,
    teleprompterClean: input.teleprompterClean,
    scriptText: input.scriptText,
    editProfile,
  });
  return job;
}

async function runAnalysis(
  job: AnalysisJob,
  fingerprint: string,
  extras: {
    colorGradeLut?: string;
    styleRecipe?: Record<string, unknown>;
    userBrollUrls?: string[];
    labeledAssetBindings?: import('../stages/broll/labeledAssetBrief.ts').LabeledAssetBinding[];
    brandName?: string;
    captionStyleGuide?: Record<string, unknown> | null;
    forceSpeakerCutout?: boolean;
    subjectCutoutUrl?: string;
    directorV2?: boolean;
    northStar?: boolean;
    requestedEdits?: string[] | null;
    captionTemplate?: string | null;
    captionPreset?: string;
    teleprompterClean?: boolean;
    scriptText?: string;
    editProfile?: ProductEditProfile;
  },
): Promise<void> {
  const release = await acquireSlot();
  const patch = async (
    status: AnalysisStage,
    progress: number,
    extra: Partial<AnalysisJob> = {},
  ) => {
    Object.assign(job, extra, {
      status,
      progress,
      updatedAt: new Date().toISOString(),
    });
    await saveAnalysisJob(job);
  };

  try {
    // WP3C: with GEMINI_EDIT_MAX_REQUESTS set (server env only) every Gemini attempt of this job takes a slot; unset, `withGeminiBudget` just runs the job.
    const blueprint = await withGeminiBudget(geminiBudgetFromLimit(env.GEMINI_EDIT_MAX_REQUESTS, geminiBudgetPlanFor(extras.editProfile)), () => analyzeVideo(
      {
        videoUrl: job.videoUrl,
        languageCode: job.languageCode,
        userId: job.userId,
        colorGradeLut: extras.colorGradeLut,
        styleRecipe: extras.styleRecipe,
        userBrollUrls: extras.userBrollUrls,
        labeledAssetBindings: extras.labeledAssetBindings,
        brandName: extras.brandName,
        captionStyleGuide: extras.captionStyleGuide,
        forceSpeakerCutout: extras.forceSpeakerCutout,
        subjectCutoutUrl: extras.subjectCutoutUrl,
        directorV2: extras.directorV2,
        northStar: extras.northStar,
        requestedEdits: extras.requestedEdits,
        captionTemplate: extras.captionTemplate as AnalyzeInput['captionTemplate'],
        captionPreset: extras.captionPreset,
        teleprompterClean: extras.teleprompterClean,
        scriptText: extras.scriptText,
        // WP1: empty for the legacy profile; the explicit MVP options otherwise (see lib/productEditProfile.ts).
        ...analyzeOverridesFor(extras.editProfile ?? 'legacy'),
        editProfile: extras.editProfile ?? 'legacy',
      },
      {
        onStage: (stage, progress) => {
          // Fire-and-forget: a slow store write must not stall the pipeline.
          void patch(stage, progress);
        },
        // WP3X: the server's own graphics decision (flag + Claude budget), recorded on the job record the poll route returns.
        onGraphicsDecision: graphics => {
          void patch(job.status, job.progress, {graphics});
        },
      },
    ));

    await saveBlueprint(blueprint, fingerprint, job.graphics ? {graphics: job.graphics} : {});
    await recordAnalysis(job.userId);
    await patch('done', 1, {blueprint});
  } catch (error) {
    const engineError = toEngineError(error);
    log.error(
      {analysisJobId: job.analysisJobId, code: engineError.code, error},
      'analysis failed',
    );
    await patch('failed', job.progress, {
      errorCode: engineError.code,
      errorMessage: isEngineError(error)
        ? engineError.message
        : 'AI edit failed. Please try again.',
    });
  } finally {
    release();
  }
}
