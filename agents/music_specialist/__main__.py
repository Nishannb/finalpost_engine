import json
import os
import sys
import tempfile

from .agent import AIMusicSpecialistAgent
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
    json.dump(AIMusicSpecialistAgent(transport).run(payload, workdir, mode), sys.stdout)


if __name__ == "__main__":
    main()
