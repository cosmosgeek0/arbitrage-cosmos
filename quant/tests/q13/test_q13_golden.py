from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

from quant_edge.deep import generated_artifacts

QUANT_ROOT = Path(__file__).parents[2]
GENERATED_ROOT = QUANT_ROOT / "generated" / "q13"


def _artifact_digests() -> dict[str, str]:
    return {
        name: hashlib.sha256(raw).hexdigest() for name, raw in sorted(generated_artifacts().items())
    }


def test_committed_q13_artifacts_equal_canonical_regeneration() -> None:
    expected = generated_artifacts()
    actual = {
        path.name: path.read_bytes() for path in sorted(GENERATED_ROOT.iterdir()) if path.is_file()
    }
    assert actual == expected


def test_campaign_is_identical_from_different_cwd_timezone_and_hash_seed(
    tmp_path: Path,
) -> None:
    script = (
        "import hashlib,json; from quant_edge.deep import generated_artifacts; "
        "print(json.dumps({k:hashlib.sha256(v).hexdigest() "
        "for k,v in sorted(generated_artifacts().items())},sort_keys=True))"
    )
    env = {
        "PATH": os.environ["PATH"],
        "PYTHONHASHSEED": "987654321",
        "TZ": "Pacific/Honolulu",
    }
    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=tmp_path,
        env=env,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert json.loads(completed.stdout) == _artifact_digests()
