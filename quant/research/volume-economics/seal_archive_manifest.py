#!/usr/bin/env python3
"""Seal the downloaded Binance archive corpus after sidecar verification."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


CHECKSUM_RE = re.compile(r"^([0-9a-f]{64})  ([A-Za-z0-9_.-]+)\n?$")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require(condition: bool, code: str) -> None:
    if not condition:
        raise RuntimeError(code)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-manifest", type=Path, required=True)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--sealed-at-utc", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    raw = json.loads(args.raw_manifest.read_text(encoding="utf-8"))
    require(isinstance(raw, list) and len(raw) == 120, "RAW_MANIFEST_COUNT")
    sealed: list[dict[str, object]] = []
    for item in sorted(raw, key=lambda value: value["archive"]):
        archive_name = item["archive"]
        archive_path = args.raw_dir / archive_name
        sidecar_path = args.raw_dir / f"{archive_name}.CHECKSUM"
        require(archive_path.is_file(), f"ARCHIVE_MISSING:{archive_name}")
        require(sidecar_path.is_file(), f"SIDECAR_MISSING:{archive_name}")
        match = CHECKSUM_RE.fullmatch(sidecar_path.read_text(encoding="ascii"))
        require(match is not None, f"SIDECAR_FORMAT:{archive_name}")
        advertised, advertised_name = match.groups()
        actual = sha256_file(archive_path)
        require(advertised_name == archive_name, f"SIDECAR_NAME:{archive_name}")
        require(actual == advertised, f"SIDECAR_ARCHIVE_MISMATCH:{archive_name}")
        require(actual == item["archiveSha256"], f"RAW_ARCHIVE_HASH:{archive_name}")
        require(
            sha256_file(sidecar_path) == item["sidecarSha256"],
            f"RAW_SIDECAR_HASH:{archive_name}",
        )
        require(archive_path.stat().st_size == item["compressedBytes"], f"RAW_SIZE:{archive_name}")
        sealed.append(
            {
                **item,
                "advertisedArchiveSha256": advertised,
                "checksumVerified": True,
            }
        )

    packet = {
        "schemaVersion": "volume.archive-manifest.v1",
        "sealedAtUtc": args.sealed_at_utc,
        "archiveOrigin": "https://data.binance.vision",
        "rawManifestSha256": sha256_file(args.raw_manifest),
        "archiveCount": len(sealed),
        "officialChecksumVerifiedCount": len(sealed),
        "records": sealed,
    }
    args.output.write_text(
        json.dumps(packet, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
