import {dumpDirectorTrace} from '../../lib/directorDump.ts';
import {stageLogger} from '../../lib/logger.ts';
import type {CaptionWord, DirectorRunReport, WordToken} from '../../types/blueprint.ts';
import type {Timeline} from '../filters/timeline.ts';
import type {Occupancy} from '../layout/occupancy.ts';
import type {VisualDirection} from '../broll/geminiDirector.ts';
import {fallbackVisualDirection} from '../broll/geminiDirector.ts';
import {buildPerceptionPack} from './perception.ts';
import {analyzeStory} from './storyAnalyst.ts';
import {designEdit} from './creativeDirector.ts';
import {compileCreativePlan} from './compiler.ts';
import {STAGE1_PROMPT_VERSION, STAGE2_PROMPT_VERSION} from './promptLoader.ts';
import type {CreativePlan, PerceptionPack, StoryAnalysis} from './types.ts';

const log = stageLogger('director-v2');

export type DirectorV2Result = {
  direction: VisualDirection;
  pack: PerceptionPack;
  story?: StoryAnalysis;
  plan?: CreativePlan;
  report: DirectorRunReport;
};

export async function runDirectorV2(input: {
  captionWords: CaptionWord[];
  sourceWords: WordToken[];
  transcript: string;
  timeline: Timeline;
  sourcePath: string;
  stillDir: (name: string) => string;
  occupancy?: Occupancy;
  userAssets?: PerceptionPack['userAssets'];
  captionStyleGuide?: Record<string, unknown> | null;
  forceSpeakerCutout?: boolean;
  language?: string;
  creatorProfile?: string;
  speakerCutoutAvailable?: boolean;
  speakerCutoutNote?: string;
  requestedEdits?: string[] | null;
  themeColors?: string[];
  noRepair?: boolean;
}): Promise<DirectorV2Result> {
  const timings: Record<string, number> = {};
  const costs: Record<string, number> = {};
  let mark = Date.now();
  const pack = await buildPerceptionPack({
    captionWords: input.captionWords,
    sourceWords: input.sourceWords,
    transcript: input.transcript,
    timeline: input.timeline,
    sourcePath: input.sourcePath,
    stillDir: input.stillDir,
    userAssets: input.userAssets,
    captionStyleGuide: input.captionStyleGuide,
    primaryOccupancy: input.occupancy,
    language: input.language,
    creatorProfile: input.creatorProfile,
    speakerCutoutAvailable: Boolean(input.speakerCutoutAvailable),
    speakerCutoutNote: input.speakerCutoutNote,
    requestedEdits: input.requestedEdits ?? null,
    themeColors: input.themeColors ?? [],
  });
  timings.perception = Date.now() - mark;

  try {
    mark = Date.now();
    const story = await analyzeStory(pack);
    timings.story = Date.now() - mark;
    costs.story = story.estimatedCostUsd;

    mark = Date.now();
    const plan = await designEdit(pack, story, input.forceSpeakerCutout, input.requestedEdits ? new Set(input.requestedEdits) : null);
    timings.creative = Date.now() - mark;
    costs.creative = plan.estimatedCostUsd;

    mark = Date.now();
    const compiled = await compileCreativePlan({
      pack,
      plan,
      story,
      forceSpeakerCutout: input.forceSpeakerCutout,
      noRepair: input.noRepair,
    });
    timings.compiler = Date.now() - mark;
    compiled.report.perStageCostUsd = {...costs, ...compiled.report.perStageCostUsd};
    compiled.report.perStageLatencyMs = timings;
    if (compiled.report.stages?.story) {
      compiled.report.stages.story.latencyMs = timings.story ?? 0;
    }
    if (compiled.report.stages?.creative) {
      compiled.report.stages.creative.latencyMs = timings.creative ?? 0;
    }
    log.info(
      {
        timings,
        costs,
        elements: compiled.direction.moments.length,
        thesis: compiled.plan.editThesis.slice(0, 80),
        stage1: STAGE1_PROMPT_VERSION,
        stage2: STAGE2_PROMPT_VERSION,
      },
      'director v2 ready',
    );
    dumpDirectorTrace('v2-compiled-direction', {
      report: compiled.report,
      story,
      plan: compiled.plan,
      direction: {
        hookTitle: compiled.direction.hookTitle,
        hookStyle: compiled.direction.hookStyle,
        caption: compiled.direction.caption,
        zooms: compiled.direction.zooms,
        moments: compiled.direction.moments,
        depthOverlays: compiled.direction.depthOverlays,
        insetReveals: compiled.direction.insetReveals,
        motionGraphics: compiled.direction.motionGraphics,
        mediaContainers: compiled.direction.mediaContainers,
        semanticEmphasis: compiled.direction.semanticEmphasis,
      },
    });
    return {
      direction: compiled.direction,
      pack,
      story,
      plan: compiled.plan,
      report: compiled.report,
    };
  } catch (error) {
    log.warn({error}, 'director v2 failed; using deterministic fallback');
    return {
      direction: fallbackVisualDirection({
        transcript: input.transcript,
        sourceDurationSec: input.timeline.outputDurationSec,
        momentCount: 4,
      }),
      pack,
      report: {
        source: 'fallback',
        passes: 0,
        violations: [{code: 'director_v2_failed', reason: String((error as Error).message ?? error)}],
        coercions: [],
        drops: [],
        perStageCostUsd: costs,
        perStageLatencyMs: timings,
        promptVersions: {story: STAGE1_PROMPT_VERSION, creative: STAGE2_PROMPT_VERSION},
      },
    };
  }
}
