import pytest

from modal_args import validate_args


def test_engine_flags_pass_unchanged():
    args = ["--quality", "high", "--ranges", "0-12.5,14.03-30", "--max-side", "1280", "--stroke-px", "0", "--pocket-passes", "0",
            "--alpha-only", "--skip-fgr-download", "--reuse-pack-buffer"]
    assert validate_args(args) == args


@pytest.mark.parametrize("bad", [
    ["--output", "/etc/passwd"],
    ["--quality", "ultra"],
    ["--ranges", "0-1;rm -rf /"],
    ["--max-side"],
    ["--alpha-only", 3],
    "not-a-list",
    ["--alpha-only"] * 30,
])
def test_anything_else_is_refused(bad):
    with pytest.raises(ValueError):
        validate_args(bad)
