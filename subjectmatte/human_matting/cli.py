"""Command line entry used by the Node engine (server/src/media/rvmMatte.ts).

    python -m human_matting.cli <input_video> <output.webm> <result.json> [--quality high|fast] [--ranges a-b,c-d] [--max-side N] [--max-frames N]

Run with cwd = subjectmatte/ so the package imports resolve. The device comes from the RVM_DEVICE env var
(auto|cuda|mps|cpu). Progress is printed to stdout as ``PROGRESS <done> <total|0>`` lines; everything else
goes to stderr. ``--max-frames`` exists ONLY for tests; the engine never passes it in production.

``--ranges 3.2-6.0,12-15.5`` (SOURCE seconds): the whole video is decoded in order and the output keeps the source's frame count / fps / duration,
but RVM runs only inside the ranges (+-0.05 s); every other frame is fully transparent. State is reset at the start of each range.
``--max-side N`` caps the longest side of the processed / encoded frames (aspect kept).

The result JSON is always written (success or failure). Exit codes:
    0  success            result.json = {"ok": true, ...process_video() facts}
    2  bad usage          (argparse)
    3  matting failed     result.json = {"ok": false, "code": "matting_failed", "error": ...}
    4  not configured     weights / ffmpeg libvpx-vp9 / requested device missing; {"ok": false, "code": "not_configured", ...}
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path
from typing import List, Optional

EXIT_OK, EXIT_FAILED, EXIT_NOT_CONFIGURED = 0, 3, 4


def _write_result(path: Path, payload: dict) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload))
    tmp.replace(path)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="human_matting.cli", description="RVM transparent WebM extraction")
    parser.add_argument("input_video")
    parser.add_argument("output_webm")
    parser.add_argument("result_json")
    parser.add_argument("--quality", choices=["high", "fast"], default="high")
    parser.add_argument("--ranges", default=None, help="source seconds to matte, e.g. 3.2-6.0,12-15.5 (default: the whole video)")
    parser.add_argument("--max-side", type=int, default=None, help="cap the longest side of the processed frames (aspect kept)")
    parser.add_argument("--max-frames", type=int, default=None, help="TEST HOOK ONLY; never used in production")
    args = parser.parse_args(argv)
    result_path = Path(args.result_json)

    # Heavy imports after argparse so --help / usage errors stay instant.
    from .model.rvm_loader import DEFAULT_WEIGHTS_PATH, resolve_device
    from .processing.video_encoder import EncoderError, ensure_vp9_alpha_encoder
    from .services.matting_service import parse_ranges, process_video

    try:
        ranges = parse_ranges(args.ranges)
    except ValueError as exc:
        parser.error(str(exc))  # exits 2 (usage)

    try:
        if not DEFAULT_WEIGHTS_PATH.is_file():
            raise FileNotFoundError(f"RVM weights not found: {DEFAULT_WEIGHTS_PATH}")
        resolve_device()  # raises if RVM_DEVICE names a device that is not really available
        ensure_vp9_alpha_encoder()
    except (FileNotFoundError, RuntimeError, ValueError, EncoderError) as exc:
        print(f"not configured: {exc}", file=sys.stderr)
        _write_result(result_path, {"ok": False, "code": "not_configured", "error": str(exc)})
        return EXIT_NOT_CONFIGURED

    def on_progress(done: int, total: Optional[int]) -> None:
        print(f"PROGRESS {done} {total or 0}", flush=True)

    try:
        result = process_video(
            args.input_video,
            quality=args.quality,
            max_frames=args.max_frames,
            output_path=args.output_webm,
            on_progress=on_progress,
            ranges=ranges,
            max_side=args.max_side,
        )
    except BaseException as exc:  # noqa: BLE001 - report every failure through the result file and exit code
        traceback.print_exc(file=sys.stderr)
        _write_result(result_path, {"ok": False, "code": "matting_failed", "error": f"{type(exc).__name__}: {exc}"})
        return EXIT_FAILED

    _write_result(result_path, {"ok": True, **result})
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
