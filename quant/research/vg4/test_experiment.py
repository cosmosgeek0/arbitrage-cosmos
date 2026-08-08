from __future__ import annotations

import hashlib
import zipfile
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from research.vg4 import experiment as vg4


def test_checksum_text_requires_digest_and_exact_name() -> None:
    digest = "a" * 64
    vg4.verify_checksum_text(
        f"{digest}  TESTUSDT-1d-2025-07.zip\n".encode(),
        "TESTUSDT-1d-2025-07.zip",
        digest,
    )
    with pytest.raises(vg4.VG4Error, match="different object"):
        vg4.verify_checksum_text(
            f"{digest}  OTHER.zip\n".encode(),
            "TESTUSDT-1d-2025-07.zip",
            digest,
        )


def test_archive_parser_accepts_only_exact_documented_header(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    symbol = "TESTUSDT"
    month = "2025-07"
    directory = tmp_path / "archives" / symbol / month
    directory.mkdir(parents=True)
    zip_name = f"{symbol}-1d-{month}.zip"
    zip_path = directory / zip_name
    opened = (date(2025, 7, 1) - date(1970, 1, 1)).days * 86_400_000_000
    row = f"{opened},100,102,99,101,12,{opened + 86_399_999_999},1200,7,5,500,0\n"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr(
            zip_name.removesuffix(".zip") + ".csv",
            ",".join(vg4.KLINE_HEADER) + "\n" + row,
        )
    zip_sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    checksum_path = directory / f"{zip_name}.CHECKSUM"
    checksum_path.write_text(f"{zip_sha}  {zip_name}\n", encoding="ascii")
    checksum_sha = hashlib.sha256(checksum_path.read_bytes()).hexdigest()
    monkeypatch.setattr(vg4, "SOURCE_ROOT", tmp_path)
    bars = vg4.parse_archive(
        {
            "checksumPath": str(checksum_path.relative_to(tmp_path)),
            "checksumSha256": checksum_sha,
            "month": month,
            "symbol": symbol,
            "zipPath": str(zip_path.relative_to(tmp_path)),
            "zipSha256": zip_sha,
        }
    )
    assert len(bars) == 1
    assert bars[0].day == date(2025, 7, 1)
    assert bars[0].quote_volume == Decimal("1200")
