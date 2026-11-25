"""Allow-list for the CLI flags the Modal cutout worker passes to human_matting.cli (only what server/src/media/rvmMatte.ts buildRvmArgs emits)."""
from __future__ import annotations

import re

VALUE_FLAGS = {
    "--quality": re.compile(r"^(high|fast)$"),
    "--ranges": re.compile(r"^\d+(\.\d+)?-\d+(\.\d+)?(,\d+(\.\d+)?-\d+(\.\d+)?)*$"),
    "--max-side": re.compile(r"^\d{2,5}$"),
    "--max-frames": re.compile(r"^\d{1,6}$"),
    "--stroke-px": re.compile(r"^\d{1,3}$"),
    "--pocket-passes": re.compile(r"^\d{1,2}$"),
}
BOOL_FLAGS = {"--alpha-only", "--skip-fgr-download", "--reuse-pack-buffer"}


def validate_args(args: object) -> list[str]:
    """Return the args unchanged when every element is an allowed flag with a well-formed value; raise ValueError otherwise."""
    if not isinstance(args, list) or len(args) > 24:
        raise ValueError("args must be a short list")
    out: list[str] = []
    i = 0
    while i < len(args):
        flag = args[i]
        if not isinstance(flag, str):
            raise ValueError("args must be strings")
        if flag in BOOL_FLAGS:
            out.append(flag)
            i += 1
            continue
        pattern = VALUE_FLAGS.get(flag)
        value = args[i + 1] if i + 1 < len(args) else None
        if pattern is None or not isinstance(value, str) or not pattern.match(value):
            raise ValueError(f"flag not allowed: {flag}")
        out += [flag, value]
        i += 2
    return out
