"""Plan (and, behind hard gates, run) a BGM pool prewarm.

Importing this module is side-effect free: no network, no transport, no spend.
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Dict, List, Optional

from music_specialist.models import BGM_COST_USD

MOODS = ("high-energy", "nostalgic", "calm", "tense", "neutral")
DEFAULT_POOL_SIZE = 3


def plan_prewarm(counts: Dict[str, int], pool_size: int, unit_usd: float) -> dict:
    per_mood = {}
    for mood in MOODS:
        have = max(0, int(counts.get(mood, 0) or 0))
        per_mood[mood] = max(0, int(pool_size) - have) if pool_size >= 1 else 0
    calls = sum(per_mood.values())
    return {"calls": calls, "cost_usd": round(calls * float(unit_usd), 4), "per_mood": per_mood}


def format_plan(plan: dict) -> str:
    per = ",".join(f"{m}:{plan['per_mood'][m]}" for m in MOODS)
    return f"prewarm_plan calls={plan['calls']} cost_usd={plan['cost_usd']:.4f} per_mood={per}"


def parse_counts(raw: Optional[str]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    if not raw:
        return counts
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        mood, _, value = part.partition("=")
        mood = mood.strip()
        if mood not in MOODS:
            raise ValueError(f"unknown mood: {mood}")
        counts[mood] = int(value)
    return counts


def run_live_fill(plan: dict) -> None:
    """Generate the planned beds. Callers must have passed every gate in main()."""
    if os.environ.get("MUSIC_PREWARM_LIVE") != "1":
        raise RuntimeError("live prewarm is not invoked by tests")
    # Lazy import: importing this script must never construct the paid transport.
    from music_specialist.runware import RunwareTransport  # noqa: F401
    from music_specialist.spend import append_spend  # noqa: F401

    raise RuntimeError("live prewarm generation is not wired to a pool API yet")


def _refuse(reason: str) -> int:
    print(f"prewarm_refused {reason}", file=sys.stderr)
    return 2


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="prewarm_pool")
    parser.add_argument("--plan", action="store_true", help="print the plan and exit (default)")
    parser.add_argument("--confirm-spend", action="store_true", help="enable the gated live path")
    parser.add_argument("--counts", default="", help="e.g. high-energy=1,nostalgic=0")
    parser.add_argument("--pool-size", type=int, default=None)
    args = parser.parse_args(argv)

    try:
        counts = parse_counts(args.counts)
    except ValueError as exc:
        print(f"prewarm_error {exc}", file=sys.stderr)
        return 2
    pool_size = args.pool_size
    if pool_size is None:
        pool_size = int(os.environ.get("MUSIC_BED_POOL_SIZE", DEFAULT_POOL_SIZE))

    plan = plan_prewarm(counts, pool_size, BGM_COST_USD)
    print(format_plan(plan), flush=True)

    if args.plan or not args.confirm_spend:
        return 0

    if os.environ.get("MUSIC_SPECIALIST_CALLER") != "pipeline":
        return _refuse("caller")
    if not sys.stdin.isatty():
        return _refuse("notty")
    if plan["calls"] == 0:
        return 0
    print(f"Generate {plan['calls']} beds for ~${plan['cost_usd']:.4f}? Type y to proceed: ", end="", flush=True)
    if sys.stdin.readline().rstrip("\n") != "y":
        return _refuse("declined")

    run_live_fill(plan)
    return 0


if __name__ == "__main__":
    sys.exit(main())
