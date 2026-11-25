#!/usr/bin/env node
/**
 * RVM host preflight (plan P3). READ-ONLY: spawns `python -c` / `ffmpeg -encoders` and reads env + file existence. No model run, no network, no writes, no secrets printed.
 *
 *   node scripts/rvm-preflight.mjs            human-readable report, exit 0 = ready for RVM, 1 = not ready
 *   node scripts/rvm-preflight.mjs --json     the same as JSON
 *
 * Mirrors the engine's own resolution (server/src/media/rvmMatte.ts): RVM_PYTHON, else subjectmatte/.venv-rvm/bin/python; RVM_WEIGHTS_PATH, else subjectmatte/weights/rvm_mobilenetv3.pth;
 * ffmpeg needs libvpx-vp9. It also states what Subject Stage may do on this host (whole-run RVM needs an explicit mps/cuda device, else clips <= 45 s).
 */
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rvmRoot = path.join(root, 'subjectmatte');
const json = process.argv.includes('--json');
const CPU_MAX_SEC = 45; // SUBJECT_STAGE_MATTE.cpuMaxVideoSec

const configuredPython = (process.env.RVM_PYTHON ?? '').trim();
const venvPython = path.join(rvmRoot, '.venv-rvm', 'bin', 'python');
const python = configuredPython || (existsSync(venvPython) ? venvPython : null);
const weights = (process.env.RVM_WEIGHTS_PATH ?? '').trim() || path.join(rvmRoot, 'weights', 'rvm_mobilenetv3.pth');
const ffmpeg = (process.env.FFMPEG_PATH ?? '').trim() || 'ffmpeg';
const requestedDevice = (process.env.RVM_DEVICE ?? 'auto').trim().toLowerCase() || 'auto';

const checks = [];
const add = (name, ok, detail) => checks.push({name, ok, detail});

add('python', Boolean(python) && (!path.isAbsolute(python ?? '') || existsSync(python)), python ?? 'not configured: set RVM_PYTHON or create subjectmatte/.venv-rvm');
add('weights', existsSync(weights), existsSync(weights) ? 'present' : `missing at ${weights}`);

const enc = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], {encoding: 'utf8', timeout: 15_000});
add('ffmpeg_libvpx_vp9', enc.status === 0 && String(enc.stdout).includes('libvpx-vp9'), enc.status === 0 ? (String(enc.stdout).includes('libvpx-vp9') ? 'ok' : 'ffmpeg has no libvpx-vp9') : 'ffmpeg not runnable');

let torch = {import: false, cuda: false, mps: false, version: ''};
if (python && checks[0].ok) {
  const probe = spawnSync(python, ['-I', '-c', "import json,torch;print(json.dumps({'version':torch.__version__,'cuda':bool(torch.cuda.is_available()),'mps':bool(getattr(torch.backends,'mps',None) and torch.backends.mps.is_available())}))"], {encoding: 'utf8', timeout: 60_000});
  if (probe.status === 0) {
    try {
      torch = {import: true, ...JSON.parse(String(probe.stdout).trim().split('\n').pop())};
    } catch {
      /* leave as not importable */
    }
  }
}
add('torch_import', torch.import, torch.import ? `torch ${torch.version}` : 'torch not importable from that python (pip install -r subjectmatte/requirements-rvm.txt)');

const resolvedDevice = requestedDevice === 'cuda' ? (torch.cuda ? 'cuda' : 'unavailable') : requestedDevice === 'mps' ? (torch.mps ? 'mps' : 'unavailable') : requestedDevice === 'cpu' ? 'cpu' : torch.cuda ? 'cuda' : torch.mps ? 'mps' : 'cpu';
add('device', resolvedDevice !== 'unavailable', `requested=${requestedDevice} resolved=${resolvedDevice}`);

const ready = checks.every(c => c.ok);
// The ENGINE's gate reads the configured value, not the resolved one: only an explicit mps/cuda earns whole-run RVM (isFullRvmDevice).
const explicitGpu = requestedDevice === 'mps' || requestedDevice === 'cuda';
const policy = !ready
  ? 'RVM not ready: Subject Stage will skip (polish_subject_stage:skipped:no_matte_backend) unless a provided cutout or keyable backdrop exists.'
  : explicitGpu
    ? 'Whole-run RVM allowed (explicit GPU device), up to SUBJECT_STAGE_MATTE.maxVideoSec.'
    : `CPU policy: Subject Stage whole-run RVM only for clips <= ${CPU_MAX_SEC} s (longer -> polish_subject_stage:skipped:cpu_over_45s).` + (resolvedDevice !== 'cpu' ? ` NOTE: this host has ${resolvedDevice} but RVM_DEVICE=${requestedDevice}; set RVM_DEVICE=${resolvedDevice} to lift the 45 s cap.` : '');

const report = {ready, checks, policy};
if (json) console.log(JSON.stringify(report, null, 2));
else {
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
  console.log(`\n${ready ? 'READY' : 'NOT READY'}\n${policy}`);
}
process.exit(ready ? 0 : 1);
