import pytest

from music_specialist.runware import RunwareTransport


@pytest.fixture(autouse=True)
def _no_runware_transport(monkeypatch, tmp_path):
    """Tests are offline. Constructing the paid transport is an error."""

    def refuse(self, *args, **kwargs):
        raise RuntimeError("RunwareTransport must not be constructed in tests (paid API)")

    monkeypatch.setattr(RunwareTransport, "__init__", refuse)
    monkeypatch.setenv("MUSIC_SPEND_LOG", str(tmp_path / "spend.log"))
