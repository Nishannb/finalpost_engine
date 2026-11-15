/**
 * Production Completion Sprint 1: the supervised FIRST live SFX run (Runware mirelo:1@1). Default is a DRY RUN: it plans the exact requests with the
 * production planner (production/eventSfx.ts planEventSfxRequests), prices them (expected and worst case, generation/sfxContract.ts) and writes the
 * plan; no transport is built and no key is read.
 *
 * A live run needs ALL of: --live, --approve <planHash printed by the dry run>, --max-usd >= the worst case, --ledger-dir, RUNWARE_API_KEY in the
 * environment. It then generates exactly the approved requests (one per sound, one round per video in the ledger), ingests them under --public-dir,
 * and reports the provider-reported cost. Rights: assets are NOT cleared (and not placed) unless --rights-confirmed is passed, which records the
 * product owner's Mirelo licence confirmation.
 *
 *   npx vite-node src/stages/audioDirector/listeningTest/generateFirstSfx.ts -- --blueprint <bp.json> --audio <source> --video-id <id> --vo-lufs <n> \
 *     --out <dir> [--placement pause_preonset] [--live --approve <hash> --max-usd <n> --ledger-dir <dir> --public-dir <dir> [--rights-confirmed]]
 */
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {buildEventSheet} from '../eventSheet/buildEventSheet.ts';
import {FetchRunwareTransport} from '../generation/fetchTransport.ts';
import {FixtureSfxTransport} from '../generation/fixtureSfxTransport.ts';
import {buildSfxTask, sfxPrompt, sfxTaskDurationSec} from '../generation/runware.ts';
import {MIRELO_USAGE_CONFIRMED, MIRELO_USAGE_UNCONFIRMED, sfxCapUsd, sfxExpectedUsd, VERIFIED_SFX_CONTRACT} from '../generation/sfxContract.ts';
import {eventSfxRelDir, planEventSfxRequests, runEventSfxStage} from '../production/eventSfx.ts';
import {measureVoiceActivity} from '../production/voiceActivityProbe.ts';

export type FirstSfxPlan = {
  videoId: string;
  placementPolicy: string;
  planHash: string;
  contract: string;
  requests: Array<{requestId: string; eventId: string; eventType: string; visual: string; family: string; prompt: string; requestedMaxSec: number; providerSec: number; tier?: string; startFrame?: number; plannedStartSec?: number; essential: boolean}>;
  /** Validation Sprint 2: the switches the plan was made with (part of the hash). */
  settings: {placement: string; design: string | null; underSpeech: string};
  /** Fixture simulation of the full chain on exactly these requests (synthetic sounds): every planned sound must be placed where planned. */
  /** Every visual event the Sound Design Director considered but did not send to the provider, with its reason (silences of ordinary words omitted). */
  rejectedByDirector?: Array<{eventId: string; decision: string; reason: string}>;
  compilerCheck?: {requested: number; placed: number; compileDropped: Array<{ref: string; reason: string}>; maxPlacementDeltaFrames: number; ok: boolean};
  providerSeconds: number;
  expectedUsd: number;
  worstCaseUsd: number;
  refusedBeforePayment: Array<{ref: string; code: string}>;
};

export async function planFirstSfx(input: {blueprint: unknown; audioPath: string; videoId: string; placement: 'pause_preonset' | 'speech_hybrid'; design?: 'visual'; underSpeech?: 'none' | 'onset_accent'}): Promise<{plan: FirstSfxPlan; sheet: ReturnType<typeof buildEventSheet>; voiceActivity: Awaited<ReturnType<typeof measureVoiceActivity>>; placementInput: Parameters<typeof planEventSfxRequests>[0]['placement']}> {
  const bp = input.blueprint as {keepSegments: Array<{sourceStart: number; sourceEnd: number; outputStart: number}>; outputDurationSec: number};
  const sheet = buildEventSheet(input.blueprint, input.design === 'visual' ? {kineticLines: true} : {});
  const pause = input.placement === 'pause_preonset' || input.design === 'visual';
  const voiceActivity = pause ? await measureVoiceActivity({audioPath: input.audioPath, segments: bp.keepSegments, outputDurationSec: bp.outputDurationSec}) : null;
  const placementInput = pause ? {policy: 'speech_pause_preonset' as const, voiceActivity, ...(input.underSpeech ? {underSpeech: input.underSpeech} : {}), ...(input.design ? {design: input.design} : {})} : undefined;
  const planned = planEventSfxRequests({sheet, videoId: input.videoId, ...(placementInput ? {placement: placementInput} : {})});
  const events = new Map(sheet.events.map(event => [event.id, event]));
  const requests = planned.set.requests.map(request => ({
    requestId: request.requestId,
    eventId: request.event.id,
    eventType: request.event.type,
    visual: ((e) => (e ? [e.attrs.anim, e.attrs.role, e.attrs.text ?? e.attrs.keyword ?? e.attrs.drawnAs].filter(Boolean).join(' ') : ''))(events.get(request.event.id)),
    essential: request.essential,
    family: request.character.family,
    prompt: sfxPrompt(request),
    requestedMaxSec: request.durationSec.max,
    providerSec: sfxTaskDurationSec(request),
    ...(request.timing?.tier ? {tier: request.timing.tier} : {}),
    ...(request.timing ? {startFrame: request.timing.startFrame, plannedStartSec: Math.round((request.timing.startFrame / sheet.fps) * 1000) / 1000} : {}),
  }));
  const seconds = requests.map(request => request.providerSec);
  const tasks = planned.set.requests.map(request => buildSfxTask(request).task);
  const settings = {placement: pause ? 'speech_pause_preonset' : 'speech_hybrid', design: input.design ?? null, underSpeech: input.underSpeech ?? 'none'};
  const planHash = createHash('sha256').update(JSON.stringify({videoId: input.videoId, contract: VERIFIED_SFX_CONTRACT.id, settings, tasks})).digest('hex').slice(0, 16);
  return {
    sheet,
    voiceActivity,
    placementInput,
    plan: {
      settings,
      videoId: input.videoId,
      placementPolicy: planned.reportFields.placementPolicy ?? 'speech_hybrid',
      planHash,
      contract: VERIFIED_SFX_CONTRACT.id,
      requests,
      providerSeconds: seconds.reduce((sum, sec) => sum + sec, 0),
      expectedUsd: sfxExpectedUsd(seconds),
      worstCaseUsd: sfxCapUsd(seconds),
      refusedBeforePayment: [...planned.reportFields.refusedBeforePayment, ...planned.reportFields.budgetDropped],
      rejectedByDirector: (planned.reportFields.designDecisions ?? [])
        .filter(d => d.decision !== 'sound' && d.decision !== 'duplicate' && !/ordinary caption|soft focus fade|phrase container|connector word|word swap exit/.test(d.reason))
        .map(d => ({eventId: d.eventId, decision: d.decision, reason: d.reason})),
    },
  };
}

async function main(argv: string[]): Promise<void> {
  const arg = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const need = (flag: string) => {
    const value = arg(flag);
    if (!value) throw new Error(`missing ${flag}`);
    return value;
  };
  const blueprintRaw = JSON.parse(readFileSync(need('--blueprint'), 'utf8'));
  const blueprint = blueprintRaw.blueprint ?? blueprintRaw;
  const videoId = need('--video-id');
  const out = path.resolve(need('--out'));
  mkdirSync(out, {recursive: true});
  const design = arg('--design') === 'visual' ? ('visual' as const) : undefined;
  const underSpeech = arg('--under-speech') === 'onset_accent' ? ('onset_accent' as const) : ('none' as const);
  const {plan, sheet, placementInput} = await planFirstSfx({blueprint, audioPath: need('--audio'), videoId, placement: arg('--placement') === 'speech_hybrid' ? 'speech_hybrid' : 'pause_preonset', ...(design ? {design} : {}), underSpeech});
  // compiler acceptance, verified offline: the full chain on exactly these requests with the deterministic FIXTURE (synthetic sounds, no provider)
  {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'first-sfx-check-'));
    try {
      const simulated = await runEventSfxStage({sheet, voLufs: Number(need('--vo-lufs')), videoId, transport: new FixtureSfxTransport(), publicRoot: path.join(tmp, 'public'), relDir: eventSfxRelDir(videoId), workDir: path.join(tmp, 'work'), maxUsd: 0, ...(placementInput ? {placement: placementInput} : {})});
      const deltas = plan.requests.map(request => {
        const placed = simulated.report.placements.find(p => p.eventId === request.eventId);
        return placed && request.startFrame !== undefined ? Math.abs(Math.round(placed.startSec * sheet.fps) - request.startFrame) : Number.POSITIVE_INFINITY;
      });
      const maxDelta = deltas.length ? Math.max(...deltas) : 0;
      plan.compilerCheck = {requested: simulated.report.requested, placed: simulated.hits.length, compileDropped: simulated.report.compileDropped, maxPlacementDeltaFrames: maxDelta, ok: simulated.hits.length === plan.requests.length && simulated.report.compileDropped.length === 0 && maxDelta <= 1};
    } finally {
      rmSync(tmp, {recursive: true, force: true});
    }
  }
  writeFileSync(path.join(out, `sfx-plan-${videoId}.json`), JSON.stringify(plan, null, 1));
  console.log(JSON.stringify({...plan, requests: plan.requests.map(request => `${request.eventId} [${request.eventType} ${request.visual}] -> ${request.family} ${request.tier ?? ''} @${request.plannedStartSec}s, ${request.requestedMaxSec}s -> provider ${request.providerSec}s`)}, null, 1));
  if (!plan.compilerCheck?.ok) console.log('COMPILER CHECK FAILED: a planned sound would not be placed as planned; do not run live.');
  if (!argv.includes('--live')) {
    console.log(`DRY RUN. No request made. To generate exactly this plan: --live --approve ${plan.planHash} --max-usd ${plan.worstCaseUsd} --ledger-dir <dir> --public-dir <dir>`);
    return;
  }
  if (!plan.compilerCheck?.ok) throw new Error('compiler check failed: refusing to generate');
  if (arg('--approve') !== plan.planHash) throw new Error(`--approve must equal the plan hash ${plan.planHash} (the plan changed or was not reviewed)`);
  const maxUsd = Number(arg('--max-usd'));
  if (!(maxUsd >= plan.worstCaseUsd)) throw new Error(`--max-usd ${arg('--max-usd')} is below the worst case $${plan.worstCaseUsd}`);
  const transport = new FetchRunwareTransport({apiKey: process.env.RUNWARE_API_KEY ?? ''});
  const result = await runEventSfxStage({
    sheet,
    voLufs: Number(need('--vo-lufs')),
    videoId,
    transport,
    publicRoot: path.resolve(need('--public-dir')),
    relDir: eventSfxRelDir(videoId),
    workDir: path.join(out, 'work'),
    maxUsd,
    sfxContract: VERIFIED_SFX_CONTRACT,
    sfxLedger: {dir: path.resolve(need('--ledger-dir')), videoId},
    usage: argv.includes('--rights-confirmed') ? MIRELO_USAGE_CONFIRMED : MIRELO_USAGE_UNCONFIRMED,
    ...(placementInput ? {placement: placementInput} : {}),
  });
  writeFileSync(path.join(out, `sfx-result-${videoId}.json`), JSON.stringify({report: result.report, hits: result.hits, posts: transport.posts}, null, 1));
  console.log(JSON.stringify({status: result.report.status, placed: result.hits.length, posts: transport.posts, generation: result.report.generation}, null, 1));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
