"""Focused deterministic tests for S-1Z."""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import pytest
from research.s1z import acquire, experiment

PACKET = Path(__file__).resolve().parent


def test_protocol_family_and_window_are_frozen() -> None:
    protocol = json.loads((PACKET / "protocol.v1.json").read_text())
    assert protocol["primaryTrialId"] == "w120_l28_h3"
    assert len(experiment.trial_family()) == 12
    assert len(experiment.evaluation_dates()) == 365
    assert experiment.evaluation_dates()[0] == date(2025, 6, 22)
    assert experiment.evaluation_dates()[-1] == date(2026, 6, 21)
    factors, trade, months = experiment.protocol_symbols_months()
    assert factors == ("BTCUSDT", "ETHUSDT")
    assert len(trade) == 14
    assert len({*factors, *trade}) == 16
    assert len(months) == 18


def test_source_matrix_is_exact() -> None:
    specs = acquire.artifact_specs()
    assert len(specs) == 864
    assert len({spec.key for spec in specs}) == 864
    assert acquire.EVALUATION_END_MS - acquire.SOURCE_START_MS == 537 * acquire.DAY_MS


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ((b"a" * 64) + b"  BTCUSDT-1h-2026-01.zip\n", "a" * 64),
        ((b"B" * 64) + b" *BTCUSDT-1h-2026-01.zip\r\n", "b" * 64),
    ],
)
def test_checksum_parser_accepts_sha256sum_grammar(
    raw: bytes,
    expected: str,
) -> None:
    assert acquire.parse_checksum(raw, "BTCUSDT-1h-2026-01.zip") == expected


@pytest.mark.parametrize(
    "raw",
    [
        (b"a" * 63) + b"  BTCUSDT-1h-2026-01.zip\n",
        (b"a" * 64) + b"  ../BTCUSDT-1h-2026-01.zip\n",
        (b"a" * 64) + b"  ETHUSDT-1h-2026-01.zip\n",
        (b"a" * 64) + b"  BTCUSDT-1h-2026-01.zip\npayload",
    ],
)
def test_checksum_parser_rejects_bad_records(raw: bytes) -> None:
    with pytest.raises(acquire.AcquisitionError):
        acquire.parse_checksum(raw, "BTCUSDT-1h-2026-01.zip")


def test_solve3_and_inverse() -> None:
    matrix = [[4.0, 1.0, 0.0], [1.0, 3.0, 1.0], [0.0, 1.0, 2.0]]
    solution = experiment.solve3([row[:] for row in matrix], [1.0, 2.0, 3.0])
    for matrix_row, expected in zip(matrix, (1.0, 2.0, 3.0), strict=True):
        assert sum(
            value * coefficient for value, coefficient in zip(matrix_row, solution, strict=True)
        ) == pytest.approx(expected)
    inverse = experiment.invert3(matrix)
    identity = experiment.matmul(matrix, inverse)
    for row_index in range(3):
        for column in range(3):
            assert identity[row_index][column] == pytest.approx(1.0 if row_index == column else 0.0)


def test_projection_enforces_three_neutralities() -> None:
    longs = ("L1", "L2", "L3", "L4")
    shorts = ("S1", "S2", "S3", "S4")
    beta_btc = (0.8, 1.0, 1.2, 1.4, 0.8, 1.0, 1.2, 1.4)
    beta_eth = (0.7, 1.1, 0.9, 1.3, 0.7, 1.1, 0.9, 1.3)
    points = {
        symbol: experiment.ResidualPoint(
            z=float(index),
            beta_btc=beta_btc[index],
            beta_eth=beta_eth[index],
        )
        for index, symbol in enumerate((*longs, *shorts))
    }
    weights = experiment.project_weights(longs, shorts, points)
    assert weights is not None
    assert sum(abs(value) for value in weights.values()) == pytest.approx(1.0)
    assert sum(weights.values()) == pytest.approx(0.0, abs=1e-8)
    assert sum(weights[symbol] * points[symbol].beta_btc for symbol in weights) == pytest.approx(
        0.0, abs=1e-8
    )
    assert sum(weights[symbol] * points[symbol].beta_eth for symbol in weights) == pytest.approx(
        0.0, abs=1e-8
    )


def test_holm_is_monotone_in_sorted_raw_p() -> None:
    raw = {"a": 0.001, "b": 0.01, "c": 0.2}
    adjusted = experiment.holm_adjust(raw)
    assert adjusted == pytest.approx({"a": 0.003, "b": 0.02, "c": 0.2})


def test_pbo_has_all_70_symmetric_splits() -> None:
    series = {
        f"t{trial}": [float((index + trial) % 7 - 3) for index in range(80)] for trial in range(12)
    }
    result = experiment.cscv_pbo(series)
    assert result["combinations"] == 70
    assert result["blocks"] == 8
    assert result["diagnosticOnly"] is True


def test_signal_dates_skip_latest_completed_day() -> None:
    decision = date(2025, 6, 23)
    days = experiment.signal_dates(decision, 14)
    assert len(days) == 14
    assert days[0] == date(2025, 6, 8)
    assert days[-1] == date(2025, 6, 21)
    assert decision - timedelta(days=1) not in days


def synthetic_source() -> experiment.SourceData:
    first = date(2025, 7, 1)
    second = first + timedelta(days=1)
    third = second + timedelta(days=1)
    entry_ms = experiment.timestamp_ms(first, 1)
    interior_ms = experiment.timestamp_ms(first, 8)
    exit_ms = experiment.timestamp_ms(third, 1)
    contract = {
        "XUSDT": {
            entry_ms: experiment.HourBar(100.0, 100.0, 1_000_000.0),
            experiment.timestamp_ms(second, 1): experiment.HourBar(110.0, 110.0, 1_000_000.0),
            exit_ms: experiment.HourBar(121.0, 121.0, 1_000_000.0),
        }
    }
    return experiment.SourceData(
        contract=contract,
        mark={"XUSDT": {entry_ms: 100.0, interior_ms: 100.0, exit_ms: 121.0}},
        funding={
            "XUSDT": experiment.FundingSeries(
                times=(entry_ms, interior_ms, exit_ms),
                rates=(0.01, -0.01, -0.01),
            )
        },
        daily_dates=(first, second, third),
        daily_returns={},
    )


def test_funding_boundaries_and_daily_marked_costs() -> None:
    source = synthetic_source()
    first = date(2025, 7, 1)
    flows = experiment.leg_cashflows(
        source,
        "XUSDT",
        first,
        2,
        1.0,
        100.0,
    )
    assert tuple(day for day, _ in flows.gross_events) == (
        first + timedelta(days=1),
        first + timedelta(days=2),
    )
    assert tuple(value for _, value in flows.gross_events) == pytest.approx((10.0, 11.0))
    assert sum(value for _, value in flows.gross_events) == pytest.approx(21.0)
    # Entry debit is retained, interior credit is retained, exit credit is discarded.
    assert tuple(day for day, _ in flows.funding_events) == (
        first,
        first + timedelta(days=1),
    )
    assert tuple(value for _, value in flows.funding_events) == pytest.approx((-1.0, 1.0))
    assert flows.exit_notional == pytest.approx(121.0)
    assert sum(value for _, value in flows.cost_events["base"]) == pytest.approx(
        100.0 * 0.001 + 121.0 * 0.001
    )
    assert flows.cost_events["base"][0][0] == first
    assert flows.cost_events["base"][1][0] == first + timedelta(days=2)


def test_development_and_holdout_are_purged() -> None:
    dev = experiment.decision_dates(False)
    primary = experiment.decision_dates(True)
    assert dev[-1] == date(2026, 1, 27)
    assert dev[-1] + timedelta(days=5) == date(2026, 2, 1)
    assert date(2026, 2, 8) not in primary
    assert date(2026, 2, 9) in primary


def test_shared_bootstrap_uses_identical_draws_for_identical_series() -> None:
    values = [float((index % 11) - 5) for index in range(96)]
    raw, _ = experiment.shared_bootstrap_p_values(
        {"a": values, "b": list(values)},
        block=14,
        seed=77,
    )
    assert raw["a"] == raw["b"]


def test_container_audit_never_reads_member(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeInfo:
        CRC = 7
        compress_size = 11
        file_size = 13
        filename = "expected.csv"

        @staticmethod
        def is_dir() -> bool:
            return False

    class FakeArchive:
        def __enter__(self) -> FakeArchive:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        @staticmethod
        def infolist() -> list[FakeInfo]:
            return [FakeInfo()]

        @staticmethod
        def read(*_args: object) -> bytes:
            raise AssertionError("source body must remain unopened")

    monkeypatch.setattr("research.s1z.acquire.zipfile.ZipFile", lambda _path: FakeArchive())
    assert acquire.audit_zip_container(Path("unused.zip"), "expected.csv") == (7, 11, 13)


def test_arm_rejects_intervening_commit(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    freeze_path = tmp_path / "freeze.v1.json"
    freeze_path.write_bytes(
        experiment.canonical_bytes(
            {
                "inputCommit": "expected-parent",
                "schemaVersion": "s1z.freeze.v1",
            }
        )
    )
    monkeypatch.setattr(experiment, "FREEZE_PATH", freeze_path)
    monkeypatch.setattr(experiment, "MARKER_PATH", tmp_path / "marker.json")
    monkeypatch.setattr(experiment, "RESULT_PATH", tmp_path / "result.json")
    monkeypatch.setattr(experiment, "require_git_ready", lambda: "freeze-head")

    def fake_git(*args: str) -> str:
        if args == ("rev-parse", "HEAD^"):
            return "intervening-parent"
        raise AssertionError(args)

    monkeypatch.setattr(experiment, "git", fake_git)
    with pytest.raises(experiment.S1ZError, match="does not directly follow"):
        experiment.arm()


def test_unmeasured_failure_seals_ledger_and_public_truth(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = {
        "LEDGER_PATH": tmp_path / "trial-ledger.v1.json",
        "RESULT_PATH": tmp_path / "result.v1.json",
        "VERDICT_PATH": tmp_path / "verdict.v1.json",
    }
    for name, path in paths.items():
        monkeypatch.setattr(experiment, name, path)
    monkeypatch.setattr(experiment, "create_sha256sums", lambda: None)
    experiment.write_unmeasured(
        experiment.S1ZError("fixture stop"),
        {"runMarkerCommit": "0" * 40},
    )
    ledger = json.loads(paths["LEDGER_PATH"].read_text())
    result = json.loads(paths["RESULT_PATH"].read_text())
    verdict = json.loads(paths["VERDICT_PATH"].read_text())
    assert ledger["status"] == "UNMEASURED"
    assert ledger["trials"] == []
    assert result["verdict"] == "UNMEASURED"
    assert result["capitalVerdict"] == "NO_GO"
    assert verdict["publicProxy"] == "UNMEASURED"
