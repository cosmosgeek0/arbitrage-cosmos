from __future__ import annotations

import hashlib
import zipfile
from collections.abc import Mapping
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from research.vg4 import experiment as vg4

SYMBOL = "TESTUSDT"
MONTH = "2025-07"
OPEN_US = (date(2025, 7, 1) - date(1970, 1, 1)).days * 86_400_000_000


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _row(
    *,
    open_us: int = OPEN_US,
    close_us: int | None = None,
    replacements: Mapping[int, str] | None = None,
) -> str:
    values = [
        str(open_us),
        "100",
        "102",
        "99",
        "101",
        "12",
        str(close_us if close_us is not None else open_us + 86_399_999_999),
        "1200",
        "7",
        "5",
        "500",
        "0",
    ]
    for index, value in (replacements or {}).items():
        values[index] = value
    return ",".join(values)


def _write_archive(
    root: Path,
    *,
    symbol: str = SYMBOL,
    month: str = MONTH,
    rows: tuple[str, ...] | None = None,
    header: bool = True,
    member_name: str | None = None,
    raw_member: bytes | None = None,
    extra_members: Mapping[str, str | bytes] | None = None,
) -> tuple[dict[str, object], Path, Path]:
    directory = root / "archives" / symbol / month
    directory.mkdir(parents=True)
    zip_name = f"{symbol}-1d-{month}.zip"
    zip_path = directory / zip_name
    member = member_name or zip_name.removesuffix(".zip") + ".csv"
    content_rows = (_row(),) if rows is None else rows
    content = "\n".join(((",".join(vg4.KLINE_HEADER),) if header else ()) + content_rows)
    if content:
        content += "\n"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr(member, raw_member if raw_member is not None else content.encode("ascii"))
        for name, extra_content in (extra_members or {}).items():
            archive.writestr(name, extra_content)
    zip_sha = _sha256(zip_path)
    checksum_path = directory / f"{zip_name}.CHECKSUM"
    checksum_path.write_text(f"{zip_sha}  {zip_name}\n", encoding="ascii")
    checksum_sha = _sha256(checksum_path)
    return (
        {
            "checksumPath": str(checksum_path.relative_to(root)),
            "checksumSha256": checksum_sha,
            "month": month,
            "symbol": symbol,
            "zipPath": str(zip_path.relative_to(root)),
            "zipSha256": zip_sha,
        },
        zip_path,
        checksum_path,
    )


def _parse(
    root: Path,
    artifact: Mapping[str, object],
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[vg4.Bar, ...]:
    monkeypatch.setattr(vg4, "SOURCE_ROOT", root)
    return vg4.parse_archive(artifact)


def test_checksum_text_requires_every_checksum_law() -> None:
    digest = "a" * 64
    zip_name = "TESTUSDT-1d-2025-07.zip"
    vg4.verify_checksum_text(f"{digest}  {zip_name}\n".encode(), zip_name, digest)
    with pytest.raises(vg4.VG4Error, match="invalid grammar"):
        vg4.verify_checksum_text(b"not-a-checksum\n", zip_name, digest)
    with pytest.raises(vg4.VG4Error, match="different object"):
        vg4.verify_checksum_text(f"{digest}  OTHER.zip\n".encode(), zip_name, digest)
    with pytest.raises(vg4.VG4Error, match="official checksum"):
        vg4.verify_checksum_text(f"{'b' * 64}  {zip_name}\n".encode(), zip_name, digest)


@pytest.mark.parametrize("value", ["1_000", " 1", "1 ", "+1", "1e3"])
def test_decimal_parser_rejects_non_archive_numeric_grammar(value: str) -> None:
    with pytest.raises(vg4.VG4Error, match="archive decimal grammar"):
        vg4.decimal_from_text(value, field="value", nonnegative=True)


def test_decimal_parser_enforces_declared_domain() -> None:
    for value in ("-1", "-0", "NaN", "Infinity"):
        with pytest.raises(vg4.VG4Error, match="archive decimal grammar"):
            vg4.decimal_from_text(value, field="value", nonnegative=True)


@pytest.mark.parametrize(
    "value",
    [
        "1_750_000_000_000_000",
        " 1750000000000000",
        "1750000000000000 ",
        "+1750000000000000",
        "1.75e15",
    ],
)
def test_integer_parser_rejects_non_archive_numeric_grammar(value: str) -> None:
    with pytest.raises(vg4.VG4Error, match="archive integer grammar"):
        vg4.parse_timestamp_us(value, field="openTime")


def test_timestamp_parser_enforces_microsecond_floor() -> None:
    with pytest.raises(vg4.VG4Error, match="post-2025 microsecond"):
        vg4.parse_timestamp_us("999999999999999", field="openTime")


def test_archive_parser_accepts_exact_header_and_derives_symbol(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact, _zip_path, _checksum_path = _write_archive(tmp_path)
    bars = _parse(tmp_path, artifact, monkeypatch)
    assert len(bars) == 1
    assert bars[0].symbol == SYMBOL
    assert bars[0].day == date(2025, 7, 1)
    assert bars[0].quote_volume == Decimal("1200")


def test_archive_parser_never_swallows_headerless_first_row(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    second_open_us = OPEN_US + 86_400_000_000
    artifact, _zip_path, _checksum_path = _write_archive(
        tmp_path,
        header=False,
        rows=(_row(), _row(open_us=second_open_us)),
    )
    bars = _parse(tmp_path, artifact, monkeypatch)
    assert tuple(bar.day for bar in bars) == (date(2025, 7, 1), date(2025, 7, 2))


@pytest.mark.parametrize(
    ("field", "escaped_value"),
    [
        ("zipPath", "absolute"),
        ("zipPath", "../escape.zip"),
        ("checksumPath", "absolute"),
        ("checksumPath", "../escape.CHECKSUM"),
    ],
)
def test_archive_parser_rejects_absolute_and_parent_escaped_paths(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    field: str,
    escaped_value: str,
) -> None:
    root = tmp_path / "root"
    artifact, zip_path, checksum_path = _write_archive(root)
    if escaped_value == "absolute":
        artifact[field] = str(zip_path if field == "zipPath" else checksum_path)
    else:
        artifact[field] = escaped_value
    with pytest.raises(vg4.VG4Error, match="SOURCE_ROOT"):
        _parse(root, artifact, monkeypatch)


def test_archive_parser_rejects_resolved_symlink_escape(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "root"
    artifact, _zip_path, _checksum_path = _write_archive(root)
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "escape").symlink_to(outside, target_is_directory=True)
    artifact["zipPath"] = "escape/TESTUSDT-1d-2025-07.zip"
    with pytest.raises(vg4.VG4Error, match="outside SOURCE_ROOT"):
        _parse(root, artifact, monkeypatch)


def test_archive_parser_cross_checks_symbol_against_archive(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact, _zip_path, _checksum_path = _write_archive(tmp_path)
    artifact["symbol"] = "OTHERUSDT"
    with pytest.raises(vg4.VG4Error, match="does not bind symbol"):
        _parse(tmp_path, artifact, monkeypatch)


def test_archive_parser_enforces_both_frozen_digests(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact, _zip_path, checksum_path = _write_archive(tmp_path / "zip-digest")
    wrong_digest = "b" * 64
    checksum_path.write_text(
        f"{wrong_digest}  {SYMBOL}-1d-{MONTH}.zip\n",
        encoding="ascii",
    )
    artifact["zipSha256"] = wrong_digest
    artifact["checksumSha256"] = _sha256(checksum_path)
    with pytest.raises(vg4.VG4Error, match="changed after freeze"):
        _parse(tmp_path / "zip-digest", artifact, monkeypatch)

    artifact, _zip_path, _checksum_path = _write_archive(tmp_path / "checksum-digest")
    artifact["checksumSha256"] = wrong_digest
    with pytest.raises(vg4.VG4Error, match="changed after freeze"):
        _parse(tmp_path / "checksum-digest", artifact, monkeypatch)


def test_archive_parser_enforces_zip_size_bound(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact, zip_path, _checksum_path = _write_archive(tmp_path)
    original_stat = Path.stat

    def bounded_stat(path: Path, *args: Any, **kwargs: Any) -> Any:
        if path == zip_path:
            return SimpleNamespace(st_size=10_000_001)
        return original_stat(path, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", bounded_stat)
    with pytest.raises(vg4.VG4Error, match="exceeds the frozen parser bound"):
        _parse(tmp_path, artifact, monkeypatch)


def test_archive_parser_enforces_single_regular_member(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact, _zip_path, _checksum_path = _write_archive(
        tmp_path,
        extra_members={"extra.txt": "ignored"},
    )
    with pytest.raises(vg4.VG4Error, match="exactly one regular member"):
        _parse(tmp_path, artifact, monkeypatch)


def test_archive_parser_enforces_member_identity(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact, _zip_path, _checksum_path = _write_archive(
        tmp_path,
        member_name="OTHER.csv",
    )
    with pytest.raises(vg4.VG4Error, match="member identity or size"):
        _parse(tmp_path, artifact, monkeypatch)


def test_archive_parser_enforces_row_width(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    short_row = ",".join(_row().split(",")[:-1])
    artifact, _zip_path, _checksum_path = _write_archive(tmp_path, rows=(short_row,))
    with pytest.raises(vg4.VG4Error, match="does not have 12 kline fields"):
        _parse(tmp_path, artifact, monkeypatch)


def test_archive_parser_enforces_utc_daily_open(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    noon_us = OPEN_US + 43_200_000_000
    artifact, _zip_path, _checksum_path = _write_archive(
        tmp_path,
        rows=(_row(open_us=noon_us),),
    )
    with pytest.raises(vg4.VG4Error, match="not a UTC daily open"):
        _parse(tmp_path, artifact, monkeypatch)


def test_archive_parser_enforces_close_boundary(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact, _zip_path, _checksum_path = _write_archive(
        tmp_path,
        rows=(_row(close_us=OPEN_US + 86_400_000_000),),
    )
    with pytest.raises(vg4.VG4Error, match="close boundary is invalid"):
        _parse(tmp_path, artifact, monkeypatch)


def test_archive_parser_enforces_archive_month(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    august_us = (date(2025, 8, 1) - date(1970, 1, 1)).days * 86_400_000_000
    artifact, _zip_path, _checksum_path = _write_archive(
        tmp_path,
        rows=(_row(open_us=august_us),),
    )
    with pytest.raises(vg4.VG4Error, match="outside its archive month"):
        _parse(tmp_path, artifact, monkeypatch)


def test_archive_parser_enforces_trade_and_taker_volume_fields(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact, _zip_path, _checksum_path = _write_archive(
        tmp_path,
        rows=(_row(replacements={9: "13"}),),
    )
    with pytest.raises(vg4.VG4Error, match="invalid trade or taker-volume fields"):
        _parse(tmp_path, artifact, monkeypatch)


def test_archive_parser_rejects_trade_count_non_archive_numeric_grammar(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact, _zip_path, _checksum_path = _write_archive(
        tmp_path,
        rows=(_row(replacements={8: "1_0"}),),
    )
    with pytest.raises(vg4.VG4Error, match="archive integer grammar"):
        _parse(tmp_path, artifact, monkeypatch)


def test_archive_parser_enforces_positive_prices(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact, _zip_path, _checksum_path = _write_archive(
        tmp_path,
        rows=(_row(replacements={1: "0", 2: "1", 3: "0", 4: "1"}),),
    )
    with pytest.raises(vg4.VG4Error, match="non-positive price"):
        _parse(tmp_path, artifact, monkeypatch)


def test_archive_parser_enforces_ohlc_geometry(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact, _zip_path, _checksum_path = _write_archive(
        tmp_path,
        rows=(_row(replacements={1: "100", 2: "99", 3: "98", 4: "100"}),),
    )
    with pytest.raises(vg4.VG4Error, match="violates OHLC geometry"):
        _parse(tmp_path, artifact, monkeypatch)


def test_archive_parser_enforces_daily_row_count(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact, _zip_path, _checksum_path = _write_archive(tmp_path, rows=())
    with pytest.raises(vg4.VG4Error, match="daily row count is outside"):
        _parse(tmp_path, artifact, monkeypatch)


def test_archive_parser_enforces_strict_unique_day_order(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact, _zip_path, _checksum_path = _write_archive(
        tmp_path,
        rows=(_row(), _row()),
    )
    with pytest.raises(vg4.VG4Error, match="duplicate or unsorted"):
        _parse(tmp_path, artifact, monkeypatch)


def test_archive_parser_wraps_hostile_zip_failure_as_vg4_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact, zip_path, checksum_path = _write_archive(tmp_path)
    zip_path.write_bytes(b"hostile-not-a-zip")
    zip_sha = _sha256(zip_path)
    checksum_path.write_text(
        f"{zip_sha}  {zip_path.name}\n",
        encoding="ascii",
    )
    artifact["zipSha256"] = zip_sha
    artifact["checksumSha256"] = _sha256(checksum_path)
    with pytest.raises(vg4.VG4Error, match="archive ingestion failed") as captured:
        _parse(tmp_path, artifact, monkeypatch)
    assert isinstance(captured.value.__cause__, zipfile.BadZipFile)
