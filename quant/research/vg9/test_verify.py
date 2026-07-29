from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from research.vg9 import verify as v


def _write_inventory(root: Path) -> None:
    root.mkdir()
    frozen: dict[str, str] = {}
    for name in v.FREEZE_INPUTS:
        raw = f"{name}\n".encode()
        (root / name).write_bytes(raw)
        frozen[name] = hashlib.sha256(raw).hexdigest()
    freeze = {
        "schema": "VG9Phase1FreezeV1",
        "developmentOpened": False,
        "holdoutOpened": False,
        "fileSha256": frozen,
    }
    freeze_raw = json.dumps(freeze, sort_keys=True).encode()
    (root / "freeze.v1.json").write_bytes(freeze_raw)
    sums = {
        **frozen,
        "freeze.v1.json": hashlib.sha256(freeze_raw).hexdigest(),
    }
    (root / "SHA256SUMS").write_text(
        "".join(f"{digest}  {name}\n" for name, digest in sorted(sums.items()))
    )


def test_hash_inventory_accepts_exact_freeze(tmp_path: Path) -> None:
    root = tmp_path / "packet"
    _write_inventory(root)
    assert len(v.verify_hash_inventory(root)) == len(v.FREEZE_INPUTS) + 1


def test_hash_inventory_rejects_tamper(tmp_path: Path) -> None:
    root = tmp_path / "packet"
    _write_inventory(root)
    (root / "protocol.v1.json").write_text("tampered")
    with pytest.raises(v.VerificationError, match="digest mismatch"):
        v.verify_hash_inventory(root)


def test_unopened_guard_rejects_external_marker(tmp_path: Path) -> None:
    packet = tmp_path / "packet"
    state = tmp_path / "state"
    packet.mkdir()
    state.mkdir()
    (state / "holdout_opened.v1.json").write_text("{}")
    with pytest.raises(v.VerificationError, match="not unopened"):
        v.verify_unopened(packet, state)


def test_protocol_semantics_are_price_free_and_authority_none() -> None:
    from research.vg9 import experiment as e

    v.validate_protocol_semantics(e.load_protocol())
