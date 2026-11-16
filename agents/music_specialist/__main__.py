import json
import os
import sys
import tempfile

from .agent import AIMusicSpecialistAgent, PaidGenerationError
from .runware import DryRunTransport, RunwareTransport


CALLER_ENV = "MUSIC_SPECIALIST_CALLER"
CALLER_TOKEN = "pipeline"


def live_allowed(mode: str, env=None) -> bool:
    """Live (paid) mode only runs when the server sets the pipeline token. Not a secret."""
    env = os.environ if env is None else env
    return mode != "live" or env.get(CALLER_ENV) == CALLER_TOKEN


def main() -> None:
    mode = "dry"
    if "--mode" in sys.argv:
        index = sys.argv.index("--mode")
        if index + 1 >= len(sys.argv):
            raise SystemExit(2)
        mode = sys.argv[index + 1]
    if mode not in ("plan", "dry", "live"):
        raise SystemExit(2)
    if not live_allowed(mode):
        print(f"refusing --mode live: {CALLER_ENV}={CALLER_TOKEN} is set only by the server for a real edit. "
              "Paid generation is not run from a shell.", file=sys.stderr)
        raise SystemExit(3)
    payload = json.loads(sys.stdin.read() or "{}")
    payload["mode"] = mode
    workdir = payload.pop("workdir", None) or tempfile.mkdtemp(prefix="music_specialist_")
    timeout = float(payload.pop("timeout_sec", 40))
    transport = RunwareTransport(timeout_sec=timeout) if mode == "live" else DryRunTransport()
    try:
        result = AIMusicSpecialistAgent(transport).run(payload, workdir, mode)
    except PaidGenerationError as exc:
        # One machine-readable line for the server, which records it in its durable (R2) ledger. stderr alone is NOT a durable record.
        print("MUSIC_PAID_FAILURE " + json.dumps({"stage": exc.stage, "cost_usd": exc.cost, "accounting": exc.accounting}), file=sys.stderr)
        print(f"paid music request failed at {exc.stage}: {exc}", file=sys.stderr)
        raise SystemExit(1)
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
