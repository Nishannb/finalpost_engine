"""Process-wide loader for the official Robust Video Matting MobileNetV3 model.

The network code is the unmodified upstream v1.0.0 package in ``subjectmatte/vendor/RobustVideoMatting``
(see UPSTREAM.txt there). This module only: picks a device, imports that package, builds
``MattingNetwork('mobilenetv3')``, loads the official state dict once, and caches the module.

Device policy (env ``RVM_DEVICE``: auto | cuda | mps | cpu, default auto):
  auto  -> CUDA if torch reports it available, else Apple MPS if available, else CPU.
  other -> exactly that device; if it is not actually available this raises instead of silently
           falling back, so a caller can never believe it ran on a device it did not.
"""
from __future__ import annotations

import importlib.util
import os
import sys
import threading
import types
from pathlib import Path
from typing import Dict, Optional, Tuple, Union

import torch

DEVICE_ENV = "RVM_DEVICE"
VALID_DEVICES = ("auto", "cuda", "mps", "cpu")

_SUBJECTMATTE_ROOT = Path(__file__).resolve().parents[2]
VENDOR_PACKAGE_DIR = _SUBJECTMATTE_ROOT / "vendor" / "RobustVideoMatting" / "model"
DEFAULT_WEIGHTS_PATH = _SUBJECTMATTE_ROOT / "weights" / "rvm_mobilenetv3.pth"

_VENDOR_MODULE_NAME = "_rvm_official_model"

_lock = threading.Lock()
_models: Dict[Tuple[str, str], torch.nn.Module] = {}
_vendor_module: Optional[types.ModuleType] = None


def resolve_device(requested: Optional[str] = None) -> torch.device:
    """Resolve ``requested`` (or env RVM_DEVICE, default ``auto``) to a device that is really available."""
    choice = (requested if requested is not None else os.environ.get(DEVICE_ENV, "auto")).strip().lower() or "auto"
    if choice not in VALID_DEVICES:
        raise ValueError(f"{DEVICE_ENV} must be one of {VALID_DEVICES}, got {choice!r}")
    mps_ok = bool(getattr(torch.backends, "mps", None)) and torch.backends.mps.is_available()
    if choice == "auto":
        if torch.cuda.is_available():
            return torch.device("cuda")
        if mps_ok:
            return torch.device("mps")
        return torch.device("cpu")
    if choice == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("RVM_DEVICE=cuda requested but torch.cuda.is_available() is False")
    if choice == "mps" and not mps_ok:
        raise RuntimeError("RVM_DEVICE=mps requested but torch.backends.mps.is_available() is False")
    return torch.device(choice)


def _ensure_torchvision_utils_alias() -> None:
    """Upstream v1.0.0 does ``from torchvision.models.utils import load_state_dict_from_url``; modern torchvision
    removed that module. Register the equivalent alias so the vendored code imports unchanged. It is only
    needed to import; nothing here downloads backbone weights (pretrained_backbone=False)."""
    try:
        import torchvision.models.utils  # noqa: F401
        return
    except ImportError:
        pass
    import torchvision.models as tv_models

    shim = types.ModuleType("torchvision.models.utils")
    shim.load_state_dict_from_url = torch.hub.load_state_dict_from_url  # type: ignore[attr-defined]
    sys.modules["torchvision.models.utils"] = shim
    tv_models.utils = shim  # type: ignore[attr-defined]


def _import_vendor_package() -> types.ModuleType:
    """Import the vendored ``model`` package under a private name (avoids clashing with any other ``model``)."""
    global _vendor_module
    if _vendor_module is not None:
        return _vendor_module
    init_py = VENDOR_PACKAGE_DIR / "__init__.py"
    if not init_py.is_file():
        raise FileNotFoundError(f"Vendored RVM package not found at {VENDOR_PACKAGE_DIR}")
    _ensure_torchvision_utils_alias()
    spec = importlib.util.spec_from_file_location(
        _VENDOR_MODULE_NAME, init_py, submodule_search_locations=[str(VENDOR_PACKAGE_DIR)]
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[_VENDOR_MODULE_NAME] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(_VENDOR_MODULE_NAME, None)
        raise
    _vendor_module = module
    return module


def get_model(
    weights_path: Union[str, "os.PathLike[str]"],
    device: Union[str, torch.device],
) -> torch.nn.Module:
    """Return the official MobileNetV3 ``MattingNetwork`` in eval mode on ``device``.

    Loaded once per process per (weights file, device): a later call with the same arguments returns the
    same module object and does not read the weight file again.
    """
    dev = torch.device(device)
    weights = Path(weights_path).expanduser().resolve()
    key = (str(weights), str(dev))
    with _lock:
        cached = _models.get(key)
        if cached is not None:
            return cached
        if not weights.is_file():
            raise FileNotFoundError(f"RVM weights not found: {weights}")
        vendor = _import_vendor_package()
        model = vendor.MattingNetwork("mobilenetv3").eval().to(dev)
        # Same as upstream inference.py: model.load_state_dict(torch.load(checkpoint, map_location=device)).
        # weights_only=True because this is a plain tensor state dict.
        state = torch.load(str(weights), map_location=dev, weights_only=True)
        model.load_state_dict(state)
        for param in model.parameters():
            param.requires_grad_(False)
        _models[key] = model
        return model


def reset_model_cache() -> None:
    """Drop the process-wide model cache. For tests only."""
    with _lock:
        _models.clear()
