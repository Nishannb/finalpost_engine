# RVM host provisioning (plan P3)

The Docker image and `rsync` deploy do **not** ship the RVM venv or weights (`--exclude '**/.venv*'`, `--exclude subjectmatte/weights`). A host that should run RVM needs the steps below.
Nothing here is run by the engine or by CI. Run them by hand on the host; verify with `node scripts/rvm-preflight.mjs` (read-only; exit 0 = ready).

## 1. Python env (outside the deploy tree so a redeploy cannot delete it)
```bash
python3 -m venv /opt/finalpost/rvm/venv
/opt/finalpost/rvm/venv/bin/pip install -r subjectmatte/requirements-rvm.txt   # CPU wheels by default
```
Env: `RVM_PYTHON=/opt/finalpost/rvm/venv/bin/python`. (Without `RVM_PYTHON` the engine looks for `subjectmatte/.venv-rvm/bin/python`.)

## 2. Weights
The official Robust Video Matting MobileNetV3 checkpoint (`rvm_mobilenetv3.pth`, ~15 MB) from the RVM project's own release page. Verify the file's origin and checksum yourself; the engine never downloads weights.
Put it at `/opt/finalpost/rvm/rvm_mobilenetv3.pth` and set `RVM_WEIGHTS_PATH` to it (a path, not a secret).

## 3. ffmpeg
Needs `libvpx-vp9` (`ffmpeg -encoders | grep libvpx-vp9`); there is no fallback encoder because the asset must carry real alpha.

## 4. Env on the host (names only; values are set on the host, never committed)
| Var | Value / note |
|---|---|
| `RVM_PYTHON`, `RVM_WEIGHTS_PATH` | as above |
| `RVM_DEVICE` | `cpu` today. With a GPU host: `cuda` (explicit; `auto` is treated as CPU by the Subject Stage gate). |
| `PERSON_MATTE_CACHE_DIR` | a persistent directory (default is the OS temp dir, cleared on reboot). `PERSON_MATTE_CACHE_MAX_MB` caps it (default 1024). |
| `MATTING_MAX_CONCURRENT` | 1 on a CPU host. The slot is per process: run ONE engine process per RVM host, or the limit is per process. |
| `MATTING_TIMEOUT_SEC` | default 900. A 45 s clip on CPU should be well inside it; measure (step 6). |
| `POLISH_SUBJECT_STAGE`, `POLISH_KINETIC_ENGINE_MATTE` | **leave OFF** until the rollout in `docs/RVM_SUBJECT_STAGE_PLAN.md` (P4/P8). |

## 5. What the engine does on this host
- No GPU (`RVM_DEVICE=cpu`/`auto`): Subject Stage may run whole-run RVM only for clips <= 45 s. Longer clips skip with `polish_subject_stage:skipped:cpu_over_45s` (the edit is exactly what it was). A provided cutout or a keyable backdrop is not subject to the cap.
- RVM missing/unconfigured: `polish_subject_stage:skipped:no_matte_backend` (same fail-closed result).
- GPU host: `RVM_DEVICE=cuda` lifts the cap up to `SUBJECT_STAGE_MATTE.maxVideoSec` (120 s).

## 6. Smoke test (by hand, on the host, with your own clip; no paid API involved)
```bash
node scripts/rvm-preflight.mjs
# one matting job through the engine's own CLI, 10 s clip:
cd subjectmatte && $RVM_PYTHON -m human_matting.cli /path/clip10s.mp4 /tmp/out.webm /tmp/out.json --quality fast
```
Check `out.json`: `ok`, `device`, `detected_ratio >= 0.7`, `elapsed_sec`. Run again with the same clip through the engine to see a cache hit (`person_matte:rvm:cache:...` in the job warnings).
