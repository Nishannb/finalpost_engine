/**
 * Checkpoint 3 harness: real (paid) verification renders for the edit styles. docs/STYLE_VERIFICATION_PLAN.md.
 *
 *   node --experimental-strip-types src/scripts/styleVerify.ts --env-file ../.env.verify [--env-file overrides.env] --bucket <verify-bucket> [--allow-bucket <name>] [--styles a,b] [--no-repeat] --out ~/Desktop/style-verify-<date> \
 *     --clip list=/path/list.mp4 --clip punchy=/path/punchy.mp4 --clip busy=/path/busy.mp4 --clip hi=../remotion/public/hi.mp4 \
 *     --rvm-python /path/to/subjectmatte/.venv-rvm/bin/python  [--dry-run | --approved]
 *
 * Paid calls: Gemini (<= each style's cap per run) and Groq (one transcription per run). Never Claude, Runware, MiniMax or Remotion Lambda.
 * --dry-run (the default) checks every guard and prints the run plan and the worst-case call count; it makes no network call.
 * --approved runs it. Runs are sequential.
 *
 * Guards (any failure = refuse to start, nothing is sent):
 *  - none of the .env files config/env.ts loads with override:true may exist (they would silently replace the verify settings); the settings
 *    come ONLY from --env-file;
 *  - R2_BUCKET_NAME must equal --bucket AND contain verify / staging / test: never the production bucket or its paths;
 *  - render is local (Remotion Lambda variables empty) and LOCAL_RENDER_SKIP_R2=1 (the render stays on disk);
 *  - ANTHROPIC_API_KEY and RUNWARE_API_KEY empty, MUSIC_SPECIALIST off, MUSIC_BED_FRESH unset, NODE_ENV not production;
 *  - EDIT_STYLES_ENGINE_FLAGS=1, PRODUCT_EDIT_PROFILE=polish, DEV_AUTH_BYPASS=1 (no quota rows);
 *  - every clip exists, has audio, and is 20-75 s;
 *  - while running: Gemini HTTP attempts are counted from the run observer; the remaining runs are skipped once --max-gemini (default 180) is reached.
 */
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import dotenv from 'dotenv';

type Style = 'ai_clean_cut' | 'kinetic_typography' | 'explainer';
type Run = {clip: string; file: string; style: Style; rvm: boolean; repeat?: number};

const here = path.dirname(fileURLToPath(import.meta.url));
const CAPS: Record<Style, number> = {ai_clean_cut: 3, kinetic_typography: 12, explainer: 12};
const ALLOWED_HOSTS = new Set(['generativelanguage.googleapis.com', 'api.groq.com', 'api.pexels.com', 'pixabay.com']);

function args() {
  const argv = process.argv.slice(2);
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const clips = argv.flatMap((value, i) => (argv[i - 1] === '--clip' ? [value] : [])).map(spec => {
    const eq = spec.indexOf('=');
    if (eq <= 0) throw new Error(`--clip must be id=path, got "${spec}"`);
    return {id: spec.slice(0, eq), file: path.resolve(spec.slice(eq + 1))};
  });
  const envFiles = argv.flatMap((value, i) => (argv[i - 1] === '--env-file' ? [path.resolve(value)] : []));
  const styles = (get('--styles') ?? 'ai_clean_cut,kinetic_typography,explainer').split(',').map(item => item.trim()).filter(Boolean) as Style[];
  return {
    envFiles,
    allowBucket: get('--allow-bucket'),
    styles,
    noRepeat: argv.includes('--no-repeat'),
    envFile: envFiles[0],
    bucket: get('--bucket'),
    out: get('--out'),
    rvmPython: get('--rvm-python'),
    maxGemini: Number(get('--max-gemini') ?? 180),
    approved: argv.includes('--approved'),
    clips,
    repeatClip: get('--repeat-clip') ?? clips[0]?.id,
  };
}

function planRuns(clips: Array<{id: string; file: string}>, repeatClip: string | undefined, withRvm: boolean, styles: Style[] = ['ai_clean_cut', 'kinetic_typography', 'explainer']): Run[] {
  const runs: Run[] = [];
  for (const clip of clips) {
    if (styles.includes('ai_clean_cut')) runs.push({clip: clip.id, file: clip.file, style: 'ai_clean_cut', rvm: false});
    if (styles.includes('kinetic_typography')) runs.push({clip: clip.id, file: clip.file, style: 'kinetic_typography', rvm: false});
    if (withRvm && styles.includes('kinetic_typography')) runs.push({clip: clip.id, file: clip.file, style: 'kinetic_typography', rvm: true});
    if (styles.includes('explainer')) runs.push({clip: clip.id, file: clip.file, style: 'explainer', rvm: false});
  }
  const again = repeatClip ? clips.find(clip => clip.id === repeatClip) : undefined;
  if (again) {
    if (withRvm) runs.push({clip: again.id, file: again.file, style: 'kinetic_typography', rvm: true, repeat: 2});
    runs.push({clip: again.id, file: again.file, style: 'explainer', rvm: false, repeat: 2});
  }
  return runs;
}

const runName = (run: Run) => `${run.clip}-${run.style}${run.rvm ? '-rvm' : ''}${run.repeat ? `-r${run.repeat}` : ''}`;

function probe(file: string): {durationSec: number; hasAudio: boolean; width: number; height: number} {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], {encoding: 'utf8'});
  const parsed = JSON.parse(out) as {format?: {duration?: string}; streams?: Array<{codec_type?: string; width?: number; height?: number}>};
  const video = parsed.streams?.find(stream => stream.codec_type === 'video');
  return {durationSec: Number(parsed.format?.duration ?? 0), hasAudio: Boolean(parsed.streams?.some(stream => stream.codec_type === 'audio')), width: video?.width ?? 0, height: video?.height ?? 0};
}

function guards(a: ReturnType<typeof args>): string[] {
  const problems: string[] = [];
  const configDir = path.resolve(here, '../config');
  for (const candidate of [path.resolve(configDir, '../../../../server/.env'), path.resolve(configDir, '../../../.env'), path.resolve(configDir, '../../.env')]) {
    if (existsSync(candidate)) problems.push(`${candidate} exists and would override --env-file (config/env.ts loads it with override:true): move it aside for the run`);
  }
  if (a.envFiles.length === 0) problems.push('--env-file <path> is required (repeatable: later files override earlier ones)');
  for (const file of a.envFiles) if (!existsSync(file)) problems.push(`--env-file ${file} does not exist`);
  if (!a.out) problems.push('--out <folder> is required');
  if (a.clips.length === 0) problems.push('at least one --clip id=path');
  if (!a.bucket) problems.push('--bucket <verify bucket> is required');
  // --allow-bucket <exact name> is the owner's explicit approval to write to a non-test bucket; uploads are then add-only (never overwrite, never delete)
  // and the test sources go under verify/<date>/.
  if (a.bucket && !/(verify|staging|test)/i.test(a.bucket) && a.allowBucket !== a.bucket) {
    problems.push(`--bucket "${a.bucket}" does not look like a verification bucket (name must contain verify / staging / test, or pass --allow-bucket ${a.bucket})`);
  }
  if (!Number.isFinite(a.maxGemini) || a.maxGemini <= 0) problems.push('--max-gemini must be a positive number');
  if (problems.length > 0) return problems;
  // the settings come from --env-file ONLY (process.env starts without them: nothing else is loaded)
  for (const file of a.envFiles) dotenv.config({path: file, quiet: true, override: true});
  const e = process.env;
  const want = (name: string, ok: boolean, why: string) => (ok ? undefined : problems.push(`${name}: ${why}`));
  want('R2_BUCKET_NAME', e.R2_BUCKET_NAME === a.bucket, `must equal --bucket (${a.bucket}), is "${e.R2_BUCKET_NAME ?? ''}"`);
  for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_BASE_URL', 'GEMINI_API_KEY', 'GROQ_API_KEY']) want(name, Boolean(e[name]?.trim()), 'must be set');
  for (const name of ['REMOTION_FUNCTION_NAME', 'REMOTION_SERVE_URL', 'ANTHROPIC_API_KEY', 'RUNWARE_API_KEY', 'MUSIC_BED_FRESH', 'MUSIC_SPECIALIST_CALLER', 'SPEAKER_CUTOUT_API_URL', 'REDIS_URL']) {
    want(name, !e[name]?.trim(), 'must be empty');
  }
  want('LOCAL_RENDER_SKIP_R2', e.LOCAL_RENDER_SKIP_R2 === '1', 'must be 1 (renders stay on disk)');
  want('MUSIC_SPECIALIST', !e.MUSIC_SPECIALIST || e.MUSIC_SPECIALIST === 'off', 'must be off');
  want('NODE_ENV', e.NODE_ENV !== 'production', 'must not be production');
  want('EDIT_STYLES_ENGINE_FLAGS', e.EDIT_STYLES_ENGINE_FLAGS === '1', 'must be 1');
  want('PRODUCT_EDIT_PROFILE', e.PRODUCT_EDIT_PROFILE === 'polish', 'must be polish (proves Clean Cut stays cuts)');
  want('DEV_AUTH_BYPASS', e.DEV_AUTH_BYPASS === '1', 'must be 1 (no quota bookkeeping)');
  want('RVM_PYTHON', !e.RVM_PYTHON?.trim(), 'must be empty in the env file (the harness sets it per run from --rvm-python)');
  if (a.rvmPython && !existsSync(a.rvmPython)) problems.push(`--rvm-python ${a.rvmPython} does not exist`);
  for (const clip of a.clips) {
    if (!existsSync(clip.file)) {
      problems.push(`clip ${clip.id}: ${clip.file} not found`);
      continue;
    }
    const info = probe(clip.file);
    if (!info.hasAudio) problems.push(`clip ${clip.id}: no audio track`);
    if (info.durationSec < 20 || info.durationSec > 75) problems.push(`clip ${clip.id}: ${info.durationSec.toFixed(1)} s (want 20-75 s)`);
  }
  return problems;
}

async function main(): Promise<void> {
  const a = args();
  const problems = guards(a);
  const runs = planRuns(a.clips, a.noRepeat ? undefined : a.repeatClip, Boolean(a.rvmPython), a.styles);
  const worstGemini = runs.reduce((sum, run) => sum + CAPS[run.style], 0);
  console.log(`runs: ${runs.length}\n${runs.map(run => `  ${runName(run)}`).join('\n')}`);
  console.log(`worst case: ${worstGemini} Gemini attempts (stopped at --max-gemini ${a.maxGemini}), ${runs.length} Groq transcriptions, 0 Claude / Runware / Lambda`);
  if (problems.length > 0) {
    console.error(`REFUSED:\n${problems.map(problem => `  - ${problem}`).join('\n')}`);
    process.exit(2);
  }
  if (!a.approved) {
    console.log('dry run: every guard passed; nothing was sent. Re-run with --approved to make the paid calls.');
    return;
  }

  // Engine modules are imported only now, after the env file is in process.env (config/env.ts parses it at import).
  const {env} = await import('../config/env.ts');
  const {startAnalysis} = await import('../pipeline/analysisRunner.ts');
  const {startRender, renderMode} = await import('../pipeline/renderRunner.ts');
  const {loadAnalysisJob, loadRenderJob} = await import('../store/engineStore.ts');
  const {uploadSourceVideo, setVerificationUploadPolicy} = await import('../storage/r2.ts');
  // add-only uploads; test sources under verify/<date>/ (the owner's conditions for using a non-test bucket)
  setVerificationUploadPolicy({sourcePrefix: `verify/${new Date().toISOString().slice(0, 10)}/`, noOverwrite: true});
  const {withObserver} = await import('../lib/runObserver.ts');
  const {subjectMatteConfigured} = await import('../media/personMatte.ts');
  const {localServedRenderPath} = await import('../stages/render/localRender.ts');
  if (renderMode() !== 'local') throw new Error(`render mode is ${renderMode()}, expected local`);
  if (env.R2_BUCKET_NAME !== a.bucket) throw new Error('bucket changed after load');

  const out = path.resolve(a.out!);
  mkdirSync(out, {recursive: true});
  const uploaded = new Map<string, string>();
  const summary: string[] = ['| run | status | degraded | reasons | notes | Gemini sent / refused | est. cost USD | analysis s | render s |', '|---|---|---|---|---|---|---|---|---|'];
  let geminiTotal = 0;
  const e = env as unknown as Record<string, unknown>;

  for (const run of runs) {
    const name = runName(run);
    const dir = path.join(out, name);
    mkdirSync(path.join(dir, 'stills'), {recursive: true});
    if (geminiTotal + CAPS[run.style] > a.maxGemini) {
      summary.push(`| ${name} | skipped (--max-gemini) | | | | | | | |`);
      continue;
    }
    // RVM per run (sequential script; the engine itself never mutates env per request)
    e.RVM_PYTHON = run.rvm ? a.rvmPython! : '';
    if (subjectMatteConfigured() !== run.rvm) throw new Error(`${name}: subjectMatteConfigured()=${subjectMatteConfigured()}, expected ${run.rvm}`);
    const calls: Array<{host: string; label: string}> = [];
    const observer = (event: {type: string; [key: string]: unknown}) => {
      if (event.type === 'http_request') calls.push({host: (() => { try { return new URL(String(event.url)).hostname; } catch { return 'unknown'; } })(), label: String(event.label ?? '')});
    };
    const started = Date.now();
    let status = 'failed';
    try {
      if (!uploaded.has(run.clip)) uploaded.set(run.clip, (await uploadSourceVideo(run.file, path.extname(run.file) || '.mp4')).publicUrl);
      const job = await withObserver(observer, () =>
        startAnalysis({userId: 'style-verify', videoUrl: uploaded.get(run.clip)!, languageCode: 'auto' as never, useCache: false, style: run.style}),
      );
      let analysis = await loadAnalysisJob(job.analysisJobId);
      while (analysis && analysis.status !== 'done' && analysis.status !== 'failed') {
        await new Promise(resolve => setTimeout(resolve, 2000));
        analysis = await loadAnalysisJob(job.analysisJobId);
      }
      const analysisSec = (Date.now() - started) / 1000;
      const gemini = calls.filter(call => call.host === 'generativelanguage.googleapis.com');
      geminiTotal += gemini.length;
      // anything else (Claude, Runware, MiniMax, ...) stops the whole harness; free stock search is allowed
      const blocked = calls.filter(call => !ALLOWED_HOSTS.has(call.host) && !call.host.endsWith('r2.cloudflarestorage.com'));
      const bp = analysis?.blueprint;
      const warnings = (bp?.stats as {warnings?: string[]} | undefined)?.warnings ?? [];
      writeFileSync(path.join(dir, 'warnings.txt'), `${warnings.join('\n')}\n`);
      let renderSec = 0;
      let renderPath = '';
      if (analysis?.status === 'done' && bp) {
        const renderStarted = Date.now();
        const render = await startRender({
          userId: 'style-verify',
          blueprintId: bp.blueprintId,
          style: {captionTemplate: 'karaoke' as never, layoutStyle: 'fullscreen' as never, captionBottomFrac: bp.captionDirection?.bottomFrac ?? 0.22, captionCenterXFrac: 0.5, brollEnabled: true, zoomEnabled: true, trimEnabled: true, colorGradeLut: ''},
        });
        let renderJob = await loadRenderJob(render.renderJobId);
        while (renderJob && renderJob.status !== 'done' && renderJob.status !== 'failed') {
          await new Promise(resolve => setTimeout(resolve, 3000));
          renderJob = await loadRenderJob(render.renderJobId);
        }
        renderSec = (Date.now() - renderStarted) / 1000;
        if (renderJob?.status === 'done' && existsSync(localServedRenderPath(render.renderJobId))) {
          renderPath = path.join(dir, 'render.mp4');
          copyFileSync(localServedRenderPath(render.renderJobId), renderPath);
          status = 'done';
        } else {
          status = `render ${renderJob?.status ?? 'missing'}: ${renderJob?.errorCode ?? ''}`;
        }
      } else {
        status = `analysis ${analysis?.status ?? 'missing'}: ${analysis?.errorCode ?? ''}`;
      }
      // stills at the planned kinetic / template beats and explainer layouts (what to look at first)
      const times = [
        ...(bp?.generatedGraphics ?? []).map(graphic => (graphic.start + graphic.end) / 2),
        ...(bp?.explainerLayoutTrack ?? []).filter(span => span.layout !== 'explainer_a').map(span => (span.start + span.end) / 2),
      ].slice(0, 6);
      if (renderPath) {
        for (const [i, t] of times.entries()) {
          try {
            execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', renderPath, '-frames:v', '1', path.join(dir, 'stills', `${i + 1}-${t.toFixed(1)}s.jpg`)]);
          } catch {
            /* a still is a convenience */
          }
        }
      }
      const loudness = renderPath ? integratedLufs(renderPath) : null;
      const byLabel = Object.fromEntries([...new Set(gemini.map(call => call.label))].map(label => [label, gemini.filter(call => call.label === label).length]));
      const report = {
        run: name, clip: run.clip, style: run.style, rvm: run.rvm, status,
        editProfile: analysis?.editProfile, styleApplied: analysis?.styleApplied, graphics: analysis?.graphics,
        degraded: analysis?.degraded, degradedReasons: analysis?.degradedReasons, styleNotes: analysis?.styleNotes,
        gemini: {attempts: gemini.length, cap: CAPS[run.style], byLabel, budgetWarning: warnings.filter(w => w.startsWith('gemini_budget'))},
        otherHosts: blocked.map(call => call.host),
        estimatedCostUsd: (bp?.stats as {estimatedCostUsd?: number} | undefined)?.estimatedCostUsd,
        analysisSec, renderSec,
        counts: {
          generatedGraphics: bp?.generatedGraphics?.length ?? 0,
          kineticPublished: warnings.find(w => w.startsWith('craft_templates:published:')) ?? 'none',
          templatesPublished: warnings.find(w => w.startsWith('polish_motion_templates:published:')) ?? 'none',
          explainerLayouts: bp?.explainerLayoutTrack?.filter(span => span.layout !== 'explainer_a').length ?? 0,
          explainerClaimBeats: bp?.explainerClaimBeats?.length ?? 0,
          outputDurationSec: bp?.outputDurationSec,
        },
        integratedLufs: loudness,
        stillsAtSec: times,
      };
      writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      writeFileSync(path.join(dir, 'report.md'), reportMarkdown(report, run.style));
      summary.push(`| ${name} | ${status} | ${analysis?.degraded ?? ''} | ${(analysis?.degradedReasons ?? []).join(', ')} | ${(analysis?.styleNotes ?? []).join(', ')} | ${gemini.length} / ${warnings.find(w => w.startsWith('gemini_budget_stopped')) ?? '0'} | ${report.estimatedCostUsd ?? ''} | ${analysisSec.toFixed(0)} | ${renderSec.toFixed(0)} |`);
      if (blocked.length > 0) throw new Error(`${name}: unexpected hosts ${blocked.map(call => call.host).join(', ')}; stopping`);
    } catch (error) {
      writeFileSync(path.join(dir, 'error.txt'), `${String(error)}\n`);
      summary.push(`| ${name} | error: ${String(error).slice(0, 80)} | | | | | | | |`);
      if (String(error).includes('unexpected hosts')) break;
    }
    writeFileSync(path.join(out, 'SUMMARY.md'), `# Style verification\n\nGemini attempts so far: ${geminiTotal}\n\n${summary.join('\n')}\n`);
  }
  console.log(`done: ${out}/SUMMARY.md (Gemini attempts: ${geminiTotal})`);
  process.exit(0);
}

function integratedLufs(file: string): number | null {
  try {
    const out = execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    return parseLufs(out);
  } catch (error) {
    return parseLufs(String((error as {stderr?: string}).stderr ?? ''));
  }
}
function parseLufs(text: string): number | null {
  const match = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/.exec(text);
  return match ? Number(match[1]) : null;
}

const CHECKS: Record<Style, string[]> = {
  kinetic_typography: [
    'Hero type beats present (count matches report) and readable at phone size',
    'Each beat shows the words being spoken at that moment (no drift after cuts)',
    'RVM run: hero words sit BEHIND the person, clean edges, no halo / flicker',
    'No-RVM run: beats in front, in clear space, never over the face or mouth',
    'No overlapping or clipped text (captions / kinetic type / hook); captions mute under full-frame beats',
  ],
  explainer: [
    'Explainer layouts VISIBLE in the render (B / C / D), not only planned',
    'Claim beats: a number / name / amount gets its visual within ~0.5 s',
    'Chunk-swap captions, positioned per layout',
    'Layout changes on sentence boundaries; no flashing spans',
    'Media: stills or text plates, nothing broken, no placeholder text',
  ],
  ai_clean_cut: ['cuts profile: no Director visuals, no kinetic type; editProfile = cuts on a polish server'],
};
const COMMON = [
  'Voice clearly audible over music and SFX for the whole clip',
  'No clipped / repeated words; retake removed (punchy clip); no pops at cuts',
  'No black / frozen frames, no A/V drift at the end',
  'degraded / degradedReasons / styleNotes match what the render shows',
];

function reportMarkdown(report: Record<string, unknown>, style: Style): string {
  return [
    `# ${String(report.run)}`,
    '',
    '```json',
    JSON.stringify(report, null, 2),
    '```',
    '',
    '## Checklist',
    ...[...CHECKS[style], ...COMMON].map(item => `- [ ] ${item}`),
    '',
  ].join('\n');
}

void main().catch(error => {
  console.error(error);
  process.exit(1);
});
