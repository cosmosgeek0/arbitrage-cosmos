"""Generate deterministic Q16 local-inference evidence and protocol clients."""

from __future__ import annotations

import sys
from pathlib import Path

from quant_edge.inference.generation import build_q16_artifacts


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: q16_inference_campaign.py REPO_ROOT", file=sys.stderr)
        return 2
    repo_root = Path(argv[1]).resolve()
    artifacts = build_q16_artifacts(repo_root)
    for relative_path, raw in sorted(artifacts.items()):
        path = repo_root / "quant" / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        print(f"{relative_path} {len(raw)} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
