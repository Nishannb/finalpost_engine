from __future__ import annotations

from typing import Any, List

# Preview only. Production mixing is Remotion's MusicBedTrack. This argv is not
# executed by the engine and does not apply the ducking envelope.
BGM_VOLUME = 0.25


def build_ffmpeg_argv(dialogue_path: str, bgm_path: str, sfx: List[Any],
                      canvas_sec: float, out_path: str) -> List[str]:
    # Ducking is not sample-accurate here: one static BGM volume; the schema's ducking map is what the renderer follows.
    argv = ["ffmpeg", "-y", "-i", dialogue_path,
            "-stream_loop", "-1", "-i", bgm_path]
    for e in sfx:
        argv += ["-i", e.asset_path]
    filters = [f"[1:a]volume={BGM_VOLUME}[bgm]"]
    labels = ["[0:a]", "[bgm]"]
    for i, e in enumerate(sfx):
        ms = int(e.anchor_ms)
        filters.append(f"[{i + 2}:a]adelay={ms}|{ms}[s{i}]")
        labels.append(f"[s{i}]")
    n = len(labels)
    filters.append(f"{''.join(labels)}amix=inputs={n}:duration=longest:normalize=0[out]")
    argv += ["-filter_complex", ";".join(filters), "-map", "[out]",
             "-t", f"{canvas_sec:g}", out_path]
    return argv
