"""ffmpeg pipe encoder: raw RGBA frames in, silent VP9 WebM with a real alpha plane out.

    ffmpeg -f rawvideo -pix_fmt rgba -s WxH -framerate F -i -  -an  -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 ...

Frames are streamed through stdin; nothing is staged on disk except the output itself, which is written to
``<name>.partial.webm`` and atomically renamed on success. On any failure (ffmpeg non-zero exit, killed
encoder, exception in the caller) the partial file is removed and the final path is never created.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import threading
from fractions import Fraction
from pathlib import Path
from typing import Dict, List, Optional, Union

QUALITY_PRESETS: Dict[str, List[str]] = {
    # Slower deadline, better compression per bit. Alpha-safe.
    "high": ["-deadline", "good", "-cpu-used", "1", "-crf", "22", "-b:v", "0", "-row-mt", "1"],
    # Realtime deadline (what the existing chroma-key cutout path uses). Alpha-safe.
    "fast": ["-deadline", "realtime", "-cpu-used", "6", "-crf", "32", "-b:v", "0", "-row-mt", "1"],
}


class EncoderError(RuntimeError):
    """ffmpeg failed, exited non-zero, or died while frames were being written."""


def ffmpeg_executable() -> str:
    return os.environ.get("FFMPEG_PATH", "").strip() or "ffmpeg"


def ensure_vp9_alpha_encoder(ffmpeg: Optional[str] = None) -> None:
    """Raise unless this ffmpeg has libvpx-vp9. There is no fallback: a build without it cannot make real alpha."""
    exe = ffmpeg or ffmpeg_executable()
    if shutil.which(exe) is None and not Path(exe).is_file():
        raise EncoderError(f"ffmpeg not found: {exe}")
    out = subprocess.run([exe, "-hide_banner", "-encoders"], capture_output=True, text=True, check=False).stdout
    if "libvpx-vp9" not in out:
        raise EncoderError("this ffmpeg build has no libvpx-vp9 encoder; cannot write VP9 yuva420p WebM")


def _fps_arg(fps: float) -> str:
    frac = Fraction(fps).limit_denominator(1001)
    return f"{frac.numerator}/{frac.denominator}"


class TransparentWebmEncoder:
    """Context manager. ``write(rgba_uint8_hwc)`` per frame; ``close()`` finalizes and renames to ``output_path``."""

    def __init__(
        self,
        output_path: Union[str, "Path"],
        width: int,
        height: int,
        fps: float,
        *,
        quality: str = "high",
        metadata: Optional[Dict[str, str]] = None,
        ffmpeg: Optional[str] = None,
    ) -> None:
        if quality not in QUALITY_PRESETS:
            raise ValueError(f"quality must be one of {sorted(QUALITY_PRESETS)}")
        if width < 1 or height < 1 or not fps > 0:
            raise ValueError("width, height and fps must be positive")
        self.output_path = Path(output_path)
        self.partial_path = self.output_path.with_name(self.output_path.stem + ".partial.webm")
        self.width, self.height, self.fps, self.quality = width, height, fps, quality
        self._metadata = dict(metadata or {})
        self._ffmpeg = ffmpeg or ffmpeg_executable()
        self._proc: Optional[subprocess.Popen] = None
        self._stderr_tail = b""
        self._drain: Optional[threading.Thread] = None
        self.frames_written = 0
        self._finished = False

    # --- lifecycle -------------------------------------------------------------------------------------
    def command(self) -> List[str]:
        gop = max(1, int(round(self.fps * 2)))  # a keyframe about every 2 s keeps seeking cheap for the compositor
        cmd = [
            self._ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{self.width}x{self.height}",
            "-framerate", _fps_arg(self.fps), "-i", "-",
            "-an",  # silent by contract: audio stays on the source asset
            "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0",
            *QUALITY_PRESETS[self.quality],
            "-threads", str(min(8, os.cpu_count() or 1)),
            "-g", str(gop),
        ]
        for key, value in self._metadata.items():
            cmd += ["-metadata", f"{key}={value}"]
        cmd += ["-f", "webm", str(self.partial_path)]
        return cmd

    def __enter__(self) -> "TransparentWebmEncoder":
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        self.partial_path.unlink(missing_ok=True)
        self._proc = subprocess.Popen(
            self.command(), stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
        )
        self._drain = threading.Thread(target=self._drain_stderr, daemon=True)
        self._drain.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if exc_type is not None or not self._finished:
            self.abort()

    def _drain_stderr(self) -> None:
        assert self._proc is not None and self._proc.stderr is not None
        for chunk in iter(lambda: self._proc.stderr.read(4096), b""):
            self._stderr_tail = (self._stderr_tail + chunk)[-4000:]

    def _fail(self, what: str) -> EncoderError:
        self.abort()
        tail = self._stderr_tail.decode("utf-8", "replace").strip().splitlines()[-3:]
        return EncoderError(f"{what}" + (f": {' | '.join(tail)}" if tail else ""))

    # --- frames ----------------------------------------------------------------------------------------
    def write(self, rgba: "object") -> None:
        if self._proc is None or self._proc.stdin is None:
            raise EncoderError("encoder is not running")
        expected = (self.height, self.width, 4)
        shape = getattr(rgba, "shape", None)
        if shape != expected or getattr(rgba, "dtype", None) != "uint8":
            raise ValueError(f"expected uint8 RGBA {expected}, got {shape} {getattr(rgba, 'dtype', None)}")
        try:
            self._proc.stdin.write(memoryview(rgba).cast("B"))
        except (BrokenPipeError, ValueError, OSError):
            self._proc.wait()
            raise self._fail(f"ffmpeg died while writing frame {self.frames_written} (exit {self._proc.returncode})")
        self.frames_written += 1

    def close(self) -> Path:
        """Finish the stream, require a clean ffmpeg exit, and move the file to ``output_path``."""
        if self._proc is None:
            raise EncoderError("encoder was never started")
        if self.frames_written == 0:
            self.abort()
            raise EncoderError("no frames were written")
        try:
            assert self._proc.stdin is not None
            self._proc.stdin.close()
        except (BrokenPipeError, OSError):
            pass
        code = self._proc.wait()
        if self._drain is not None:
            self._drain.join(timeout=5)
        if code != 0:
            raise self._fail(f"ffmpeg exited with status {code}")
        if not self.partial_path.is_file() or self.partial_path.stat().st_size < 1:
            raise self._fail("ffmpeg produced no output")
        os.replace(self.partial_path, self.output_path)
        self._finished = True
        return self.output_path

    def abort(self) -> None:
        """Kill the encoder (if alive) and delete the partial file. Safe to call more than once."""
        proc = self._proc
        if proc is not None and proc.poll() is None:
            proc.kill()
        if proc is not None:
            try:
                if proc.stdin is not None:
                    proc.stdin.close()
            except (BrokenPipeError, OSError):
                pass
            proc.wait()
        if self._drain is not None:
            self._drain.join(timeout=5)
        self.partial_path.unlink(missing_ok=True)
