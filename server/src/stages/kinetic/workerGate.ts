/**
 * D2: Claude worker gate. The existing motion worker (motionWorker/worker.ts, not modified) is considered ONLY for events with needsCustomTreatment. It is OFF unless KINETIC_WORKER=1 and ANTHROPIC_API_KEY is set
 * (it is a paid call that uploads a module to R2). Whenever it cannot run, the event falls back to the closest preset and the decision is logged; the job is never blocked.
 * Even a successful worker result is NOT mounted by the kinetic compositor yet: the closest preset still renders, and the result is recorded in the report.
 */
import {PRESETS, closestPreset} from './presets.ts';
import type {KineticPlan, PresetName} from './schema.ts';

export type GateOutcome = {eventId: string; outcome: 'fallback-worker-disabled' | 'fallback-no-api-key' | 'fallback-worker-failed' | 'worker-ok-preset-rendered'; preset: PresetName; detail?: string};
export type WorkerRun = (brief: unknown) => Promise<{id: string; moduleUrl?: string}>;

export async function gateCustomTreatments(plan: KineticPlan, opts: {env?: NodeJS.ProcessEnv; run?: WorkerRun; log?: (m: string) => void} = {}): Promise<{overrides: Record<string, PresetName>; outcomes: GateOutcome[]}> {
  const env = opts.env ?? process.env;
  const overrides: Record<string, PresetName> = {};
  const outcomes: GateOutcome[] = [];
  for (const ev of plan.events) {
    if (!ev.needsCustomTreatment) continue;
    const preset = closestPreset(ev.needsCustomTreatment.description, ev.preset);
    overrides[ev.id] = preset;
    let outcome: GateOutcome['outcome'] = 'fallback-worker-disabled';
    let detail: string | undefined;
    if (env.KINETIC_WORKER === '1' || opts.run) {
      if (!opts.run && !env.ANTHROPIC_API_KEY) outcome = 'fallback-no-api-key';
      else {
        try {
          const run = opts.run ?? (await defaultWorkerRun());
          const res = await run({
            id: `kin-${ev.id}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60),
            goal: ev.needsCustomTreatment.description,
            visualDescription: `Typographic treatment for: ${ev.lines.map(l => l.text).join(' / ')}. ${ev.needsCustomTreatment.description}`,
            placement: 'overlay',
            durationSeconds: 3,
            content: {lines: ev.lines.map(l => l.text)},
          });
          outcome = 'worker-ok-preset-rendered';
          detail = res.moduleUrl ?? res.id;
        } catch (err) {
          outcome = 'fallback-worker-failed';
          detail = err instanceof Error ? err.message : String(err);
        }
      }
    } else if (!env.ANTHROPIC_API_KEY) outcome = 'fallback-no-api-key';
    outcomes.push({eventId: ev.id, outcome, preset, ...(detail ? {detail} : {})});
    opts.log?.(`kinetic worker gate: ${ev.id} -> ${outcome} (rendering ${preset}${detail ? `; ${detail}` : ''})`);
  }
  void PRESETS;
  return {overrides, outcomes};
}

async function defaultWorkerRun(): Promise<WorkerRun> {
  const {generateMotionGraphic} = await import('../../motionWorker/worker.ts');
  return async brief => {
    const r = await generateMotionGraphic(brief);
    return {id: String((r as {id?: string}).id ?? 'worker'), moduleUrl: (r as {module?: {url?: string}}).module?.url};
  };
}
