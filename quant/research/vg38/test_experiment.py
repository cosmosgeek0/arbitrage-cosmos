from __future__ import annotations

import copy
import hashlib
import inspect
import json
import zipfile
from dataclasses import fields, replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from research.vg38 import experiment as vg38

from quant_edge.labels.rational import make_ratio


def _timestamp_us(day: date) -> int:
    opened = datetime(day.year, day.month, day.day, tzinfo=UTC)
    return int(opened.timestamp()) * 1_000_000


def _bar(
    symbol: str,
    day: date,
    *,
    open_price: Decimal | str = "100",
    close_price: Decimal | str | None = None,
    quote_volume: Decimal | str = "1000",
) -> vg38.Bar:
    opened = _timestamp_us(day)
    open_value = Decimal(open_price)
    close_value = open_value if close_price is None else Decimal(close_price)
    return vg38.Bar(
        symbol=symbol,
        day=day,
        open=open_value,
        high=max(open_value, close_value) + Decimal(1),
        low=min(open_value, close_value) - Decimal(1),
        close=close_value,
        base_volume=Decimal(1),
        quote_volume=Decimal(quote_volume),
        open_time_us=opened,
        close_time_us=opened + 86_400_000_000 - 1,
    )


def _ratios(exponents: tuple[int, ...]) -> tuple[Decimal, ...]:
    return tuple(Decimal(2) ** exponent for exponent in exponents)


def _volume_path(
    open_day: date,
    baseline_ratios: tuple[Decimal, ...],
    recent_ratios: tuple[Decimal, ...],
    *,
    scale: Decimal = Decimal(1),
) -> dict[str, dict[date, vg38.Bar]]:
    """Build synthetic daily bars whose final feature observation is D-2."""

    ratios = baseline_ratios + recent_ratios
    first_day = open_day - timedelta(days=len(ratios) + 2)
    btc: dict[date, vg38.Bar] = {}
    level = Decimal(1_000) * scale
    btc[first_day] = _bar("BTCUSDT", first_day, quote_volume=level)
    for offset, ratio in enumerate(ratios, start=1):
        level *= ratio
        day = first_day + timedelta(days=offset)
        btc[day] = _bar(
            "BTCUSDT",
            day,
            open_price=Decimal(100 + offset),
            close_price=Decimal(101 + offset),
            quote_volume=level,
        )
    assert max(btc) == open_day - timedelta(days=2)

    for offset in (-1, 0, 1):
        day = open_day + timedelta(days=offset)
        btc[day] = _bar("BTCUSDT", day, quote_volume=level)

    bars = {"BTCUSDT": btc}
    for symbol in vg38.COHORT:
        if symbol == "BTCUSDT":
            continue
        bars[symbol] = {day: _bar(symbol, day, quote_volume=Decimal(10_000)) for day in btc}
    return bars


def _trial(
    baseline_ratios: tuple[Decimal, ...],
    recent_ratios: tuple[Decimal, ...],
    *,
    threshold: Decimal = Decimal("0.50"),
) -> vg38.Trial:
    return vg38.Trial(
        trial_id="synthetic-vov-compression",
        recent_days=len(recent_ratios),
        baseline_days=len(baseline_ratios),
        compression_threshold=threshold,
    )


def _portfolio_units(
    portfolio: vg38.Portfolio,
) -> dict[str, Decimal] | None:
    """Read mutable units without retaining an obsolete type narrowing."""

    return portfolio.units


BASELINE_RATIOS = _ratios((-4, -3, -2, -1, 1, 2, 3, 4))
COMPRESSED_RATIOS = _ratios((-1, 1, -1, 0, 1, 0, 0))
DISPERSED_RATIOS = _ratios((-4, 4, -3, 0, 3, 0, 0))


def test_trial_grid_is_exact_frozen_two_by_two_by_two_family() -> None:
    trials = vg38.trial_grid()
    assert tuple(trial.trial_id for trial in trials) == (
        "vg38-r07-b30-c50",
        "vg38-r07-b30-c75",
        "vg38-r07-b45-c50",
        "vg38-r07-b45-c75",
        "vg38-r14-b30-c50",
        "vg38-r14-b30-c75",
        "vg38-r14-b45-c50",
        "vg38-r14-b45-c75",
    )
    assert len(trials) == 8
    assert {
        (trial.recent_days, trial.baseline_days, trial.compression_threshold) for trial in trials
    } == {
        (recent, baseline, threshold)
        for recent in (7, 14)
        for baseline in (30, 45)
        for threshold in (Decimal("0.50"), Decimal("0.75"))
    }
    assert len({trial.trial_id for trial in trials}) == len(trials)


def test_trial_mapping_exposes_only_vg38_compression_parameters() -> None:
    assert vg38.trial_mapping(
        vg38.Trial("trial", 7, 30, Decimal("0.50")),
    ) == {
        "baselineDays": 30,
        "compressionThreshold": "0.50",
        "recentDays": 7,
        "trialId": "trial",
    }


def test_holm_adjustment_preserves_exact_bootstrap_grid_before_display() -> None:
    trial_ids = tuple(trial.trial_id for trial in vg38.trial_grid())
    raw = {
        trial_id: (make_ratio(1, vg38.BOOTSTRAP_REPLICATES + 1) if index == 0 else make_ratio(1, 1))
        for index, trial_id in enumerate(trial_ids)
    }
    adjusted = vg38.holm_adjusted(raw)
    expected = make_ratio(8, vg38.BOOTSTRAP_REPLICATES + 1)
    assert adjusted[trial_ids[0]] == expected
    raw_display = vg38.decimal_text(
        Decimal(raw[trial_ids[0]].numerator) / Decimal(raw[trial_ids[0]].denominator)
    )
    adjusted_display = vg38.decimal_text(
        Decimal(expected.numerator) / Decimal(expected.denominator)
    )
    assert raw_display == "0.000244081035"
    assert adjusted_display == "0.001952648279"
    assert Decimal(8) * Decimal(raw_display) != Decimal(adjusted_display)


def test_signal_surface_has_no_weekday_or_utc_slot_parameter() -> None:
    assert tuple(field.name for field in fields(vg38.Trial)) == (
        "trial_id",
        "recent_days",
        "baseline_days",
        "compression_threshold",
    )
    assert tuple(inspect.signature(vg38.regime_score_at_open).parameters) == (
        "bars",
        "trial",
        "open_day",
    )


def test_exact_median_and_mad_do_not_use_binary_floats() -> None:
    assert vg38.median_decimal((Decimal(3), Decimal(1), Decimal(2))) == Decimal(2)
    assert vg38.median_decimal(
        (Decimal("0.1"), Decimal("0.2"), Decimal("0.3"), Decimal("0.4")),
    ) == Decimal("0.25")
    assert vg38.mad_decimal(
        (Decimal(1), Decimal(2), Decimal(2), Decimal(4), Decimal(100)),
    ) == Decimal(1)
    with pytest.raises(vg38.VG38Error, match="median requires"):
        vg38.median_decimal(())
    with pytest.raises(vg38.VG38Error, match="median requires"):
        vg38.mad_decimal(())


def test_log_quote_volume_change_is_exactly_scale_free_and_positive_only() -> None:
    expected = Decimal(2).ln()
    assert vg38.log_quote_volume_change(Decimal(5), Decimal(10)) == expected
    assert vg38.log_quote_volume_change(Decimal(5_000), Decimal(10_000)) == expected
    for invalid in (Decimal(0), Decimal(-1)):
        with pytest.raises(vg38.VG38Error, match="positive inputs"):
            vg38.log_quote_volume_change(invalid, Decimal(1))
        with pytest.raises(vg38.VG38Error, match="positive inputs"):
            vg38.log_quote_volume_change(Decimal(1), invalid)


def test_regime_score_is_exact_recent_over_disjoint_baseline_mad() -> None:
    open_day = date(2025, 8, 1)
    bars = _volume_path(open_day, BASELINE_RATIOS, COMPRESSED_RATIOS)
    trial = _trial(BASELINE_RATIOS, COMPRESSED_RATIOS)
    baseline_changes = tuple(ratio.ln() for ratio in BASELINE_RATIOS)
    recent_changes = tuple(ratio.ln() for ratio in COMPRESSED_RATIOS)
    expected = vg38.mad_decimal(recent_changes) / vg38.mad_decimal(
        baseline_changes,
    )
    assert expected.quantize(Decimal("0.000000000001")) == Decimal("0.400000000000")
    assert vg38.regime_score_at_open(bars, trial, open_day) == expected
    assert vg38.target_at_open(bars, trial, open_day)


def test_target_is_on_at_threshold_and_off_above_threshold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    trial = vg38.Trial("boundary", 7, 30, Decimal("0.50"))
    open_day = date(2025, 8, 1)
    monkeypatch.setattr(
        vg38,
        "regime_score_at_open",
        lambda _bars, _trial, _day: Decimal("0.50"),
    )
    assert vg38.target_at_open({}, trial, open_day)
    monkeypatch.setattr(
        vg38,
        "regime_score_at_open",
        lambda _bars, _trial, _day: Decimal("0.5000000000000000000000000001"),
    )
    assert not vg38.target_at_open({}, trial, open_day)


def test_signal_uses_only_btcusdt_quote_volume_not_prices_or_peers() -> None:
    open_day = date(2025, 8, 1)
    bars = _volume_path(open_day, BASELINE_RATIOS, COMPRESSED_RATIOS)
    trial = _trial(BASELINE_RATIOS, COMPRESSED_RATIOS)
    expected = vg38.regime_score_at_open(bars, trial, open_day)

    for day, bar in tuple(bars["BTCUSDT"].items()):
        bars["BTCUSDT"][day] = replace(
            bar,
            open=Decimal("0.0001"),
            high=Decimal("999999999"),
            low=Decimal("0.00001"),
            close=Decimal("123456789"),
        )
    for symbol in vg38.COHORT:
        if symbol == "BTCUSDT":
            continue
        for day, bar in tuple(bars[symbol].items()):
            bars[symbol][day] = replace(
                bar,
                open=Decimal(-1),
                high=Decimal(-1),
                low=Decimal(-1),
                close=Decimal(-1),
                quote_volume=Decimal(0),
            )
    assert vg38.regime_score_at_open(bars, trial, open_day) == expected
    assert (
        vg38.regime_score_at_open(
            {"BTCUSDT": bars["BTCUSDT"]},
            trial,
            open_day,
        )
        == expected
    )


def test_signal_is_invariant_to_quote_volume_scale() -> None:
    open_day = date(2025, 8, 1)
    trial = _trial(BASELINE_RATIOS, COMPRESSED_RATIOS)
    unit = _volume_path(open_day, BASELINE_RATIOS, COMPRESSED_RATIOS)
    scaled = _volume_path(
        open_day,
        BASELINE_RATIOS,
        COMPRESSED_RATIOS,
        scale=Decimal("987654321.125"),
    )
    assert vg38.regime_score_at_open(unit, trial, open_day) == (
        vg38.regime_score_at_open(scaled, trial, open_day)
    )


def test_same_terminal_volume_with_different_dispersion_has_different_score() -> None:
    open_day = date(2025, 8, 1)
    compressed = _volume_path(open_day, BASELINE_RATIOS, COMPRESSED_RATIOS)
    dispersed = _volume_path(open_day, BASELINE_RATIOS, DISPERSED_RATIOS)
    trial = _trial(BASELINE_RATIOS, COMPRESSED_RATIOS)
    compressed_final = compressed["BTCUSDT"][open_day - timedelta(days=2)].quote_volume
    dispersed_final = dispersed["BTCUSDT"][open_day - timedelta(days=2)].quote_volume
    assert compressed_final == dispersed_final == Decimal(1_000)
    compressed_signs = tuple((ratio > 1) - (ratio < 1) for ratio in COMPRESSED_RATIOS)
    dispersed_signs = tuple((ratio > 1) - (ratio < 1) for ratio in DISPERSED_RATIOS)
    assert sorted(compressed_signs) == sorted(dispersed_signs)
    compressed_score = vg38.regime_score_at_open(compressed, trial, open_day)
    dispersed_score = vg38.regime_score_at_open(dispersed, trial, open_day)
    assert compressed_score.quantize(Decimal("0.000000000001")) == Decimal("0.400000000000")
    assert dispersed_score.quantize(Decimal("0.000000000001")) == Decimal("1.200000000000")
    assert vg38.target_at_open(compressed, trial, open_day)
    assert not vg38.target_at_open(dispersed, trial, open_day)


def test_one_calm_bar_cannot_impersonate_sustained_compression() -> None:
    open_day = date(2025, 8, 1)
    one_calm_bar = _ratios((-4, 4, -4, 0, 4, -4, 4))
    trial = _trial(BASELINE_RATIOS, COMPRESSED_RATIOS)
    sustained = _volume_path(open_day, BASELINE_RATIOS, COMPRESSED_RATIOS)
    isolated = _volume_path(open_day, BASELINE_RATIOS, one_calm_bar)
    assert vg38.target_at_open(sustained, trial, open_day)
    assert vg38.regime_score_at_open(isolated, trial, open_day) == Decimal("1.6")
    assert not vg38.target_at_open(isolated, trial, open_day)


def test_entropy_and_curvature_are_separate_from_mad_score() -> None:
    open_day = date(2025, 8, 1)
    ordinary = COMPRESSED_RATIOS
    heavy_tail_same_mad = _ratios((-9, 9, -1, 0, 0, 1, -1))
    permuted_baseline = tuple(reversed(BASELINE_RATIOS))
    trial = _trial(BASELINE_RATIOS, ordinary)
    first = _volume_path(open_day, BASELINE_RATIOS, ordinary)
    second = _volume_path(open_day, permuted_baseline, heavy_tail_same_mad)
    assert ordinary != heavy_tail_same_mad
    assert vg38.regime_score_at_open(first, trial, open_day) == (
        vg38.regime_score_at_open(second, trial, open_day)
    )
    ordinary_curvature = ordinary[-1].ln() - ordinary[-2].ln()
    heavy_tail_curvature = heavy_tail_same_mad[-1].ln() - heavy_tail_same_mad[-2].ln()
    assert ordinary_curvature == 0
    assert heavy_tail_curvature == -(Decimal(2) * Decimal(2).ln())

    different_score_same_curvature = _volume_path(
        open_day,
        BASELINE_RATIOS,
        DISPERSED_RATIOS,
    )
    dispersed_curvature = DISPERSED_RATIOS[-1].ln() - DISPERSED_RATIOS[-2].ln()
    assert dispersed_curvature == ordinary_curvature
    assert vg38.regime_score_at_open(
        different_score_same_curvature,
        trial,
        open_day,
    ) != vg38.regime_score_at_open(first, trial, open_day)


def test_baseline_mad_zero_fails_closed() -> None:
    open_day = date(2025, 8, 1)
    constant_baseline = (Decimal(1),) * 8
    bars = _volume_path(open_day, constant_baseline, COMPRESSED_RATIOS)
    trial = _trial(constant_baseline, COMPRESSED_RATIOS)
    with pytest.raises(vg38.VG38Error, match=r"baseline.*MAD.*(zero|non-positive)"):
        vg38.regime_score_at_open(bars, trial, open_day)


def test_signal_stops_at_d_minus_two_and_never_reads_d_minus_one_or_future() -> None:
    open_day = date(2025, 8, 1)
    bars = _volume_path(open_day, BASELINE_RATIOS, COMPRESSED_RATIOS)
    trial = _trial(BASELINE_RATIOS, COMPRESSED_RATIOS)
    expected = vg38.regime_score_at_open(bars, trial, open_day)
    for offset in (-1, 0, 1, 20):
        day = open_day + timedelta(days=offset)
        bars["BTCUSDT"][day] = _bar(
            "BTCUSDT",
            day,
            open_price="-999",
            close_price="-999",
            quote_volume="0",
        )
    assert vg38.regime_score_at_open(bars, trial, open_day) == expected


def test_signal_fails_on_a_gap_inside_either_required_window() -> None:
    open_day = date(2025, 8, 1)
    bars = _volume_path(open_day, BASELINE_RATIOS, COMPRESSED_RATIOS)
    trial = _trial(BASELINE_RATIOS, COMPRESSED_RATIOS)
    del bars["BTCUSDT"][open_day - timedelta(days=5)]
    with pytest.raises(vg38.VG38Error, match="input gap"):
        vg38.regime_score_at_open(bars, trial, open_day)


def test_fixed_cohort_transition_and_round_trip_cost_reconcile_exactly() -> None:
    prices = {symbol: Decimal(10) for symbol in vg38.COHORT}
    starting_cash = Decimal(1_200)
    portfolio = vg38.Portfolio(cash=starting_cash)
    side_cost = Decimal("0.25")
    assert vg38.transition_at_open(portfolio, True, prices, side_cost)
    entered_units = portfolio.units
    assert entered_units is not None
    assert set(entered_units) == set(vg38.COHORT)
    frozen_units = dict(entered_units)
    risky_notional = starting_cash / (Decimal(1) + side_cost)
    assert vg38.marked_value(portfolio, prices) == risky_notional
    assert starting_cash - risky_notional == risky_notional * side_cost

    changed_prices = {symbol: price * Decimal(3) for symbol, price in prices.items()}
    assert not vg38.transition_at_open(portfolio, True, changed_prices, side_cost)
    assert portfolio.units == frozen_units

    assert vg38.transition_at_open(portfolio, False, prices, side_cost)
    assert _portfolio_units(portfolio) is None
    assert portfolio.cash == risky_notional * (Decimal(1) - side_cost)
    expected_return = (Decimal(1) - side_cost) / (Decimal(1) + side_cost) - Decimal(1)
    assert portfolio.cash / starting_cash - Decimal(1) == expected_return


def test_protocol_contract_matches_vg38_grid_and_rejects_drift() -> None:
    protocol = vg38.load_json(vg38.PROTOCOL_PATH)
    vg38.validate_protocol_contract(protocol)
    changed = copy.deepcopy(protocol)
    signal = changed["signal"]
    assert isinstance(signal, dict)
    grid = signal["candidateGrid"]
    assert isinstance(grid, dict)
    grid["trialCount"] = 9
    with pytest.raises(vg38.VG38Error, match="candidate grid"):
        vg38.validate_protocol_contract(changed)


def _synthetic_acquisition() -> dict[str, object]:
    return {
        "archiveBodiesOpened": False,
        "archiveSourceCommit": vg38.PUBLIC_DATA_COMMIT,
        "artifactPairCount": len(vg38.COHORT) * len(vg38.SOURCE_MONTHS),
        "artifactPairs": [
            {"month": month, "symbol": symbol}
            for symbol in vg38.COHORT
            for month in vg38.SOURCE_MONTHS
        ],
        "schema": "VG26BinancePublicAcquisitionV1",
        "spotDocsCommit": vg38.SPOT_DOCS_COMMIT,
        "state": "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED",
    }


def test_source_manifest_requires_exact_matrix_without_archive_open(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    acquisition_path = tmp_path / "acquisition-manifest.v1.json"
    acquisition_path.write_bytes(vg38.canonical_bytes(_synthetic_acquisition()))
    monkeypatch.setattr(vg38, "SOURCE_ACQUISITION", acquisition_path)
    monkeypatch.setattr(
        vg38,
        "SOURCE_ACQUISITION_SHA256",
        vg38.sha256_path(acquisition_path),
    )
    monkeypatch.setattr(
        vg38,
        "source_artifact_row",
        lambda pair: {
            "month": pair["month"],
            "symbol": pair["symbol"],
            "zipSha256": "a" * 64,
        },
    )

    def forbidden_archive_open(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("source-manifest freeze opened an archive")

    monkeypatch.setattr(zipfile, "ZipFile", forbidden_archive_open)
    manifest = vg38.build_source_manifest()
    assert manifest["schema"] == "VG38FrozenBinancePublicSourceManifestV1"
    assert manifest["artifactCount"] == 180
    assert manifest["symbolCount"] == 12
    assert manifest["monthCount"] == 15
    assert manifest["archiveBodiesOpenedDuringFreeze"] is False


@pytest.mark.parametrize("fault", ["missing", "duplicate"])
def test_source_manifest_rejects_missing_or_duplicate_identity(
    fault: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    acquisition = _synthetic_acquisition()
    pairs = acquisition["artifactPairs"]
    assert isinstance(pairs, list)
    if fault == "missing":
        pairs.pop()
    else:
        pairs[-1] = dict(pairs[0])
    acquisition_path = tmp_path / "acquisition-manifest.v1.json"
    acquisition_path.write_bytes(vg38.canonical_bytes(acquisition))
    monkeypatch.setattr(vg38, "SOURCE_ACQUISITION", acquisition_path)
    monkeypatch.setattr(
        vg38,
        "SOURCE_ACQUISITION_SHA256",
        vg38.sha256_path(acquisition_path),
    )
    monkeypatch.setattr(vg38, "source_artifact_row", lambda pair: dict(pair))
    with pytest.raises(vg38.VG38Error, match=r"missing|required|duplicate"):
        vg38.build_source_manifest()


def test_source_manifest_rejects_shared_acquisition_hash_drift(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    acquisition_path = tmp_path / "acquisition-manifest.v1.json"
    acquisition_path.write_bytes(vg38.canonical_bytes(_synthetic_acquisition()))
    monkeypatch.setattr(vg38, "SOURCE_ACQUISITION", acquisition_path)
    monkeypatch.setattr(vg38, "SOURCE_ACQUISITION_SHA256", "0" * 64)
    with pytest.raises(vg38.VG38Error, match="acquisition manifest SHA-256 drift"):
        vg38.build_source_manifest()


def test_freeze_authenticates_synthetic_compressed_bytes_without_decompression(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    zip_path = tmp_path / "BTCUSDT-1d-2025-07.zip"
    zip_path.write_bytes(b"authenticated compressed bytes; intentionally not a ZIP")
    zip_sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    checksum_path = tmp_path / f"{zip_path.name}.CHECKSUM"
    checksum_path.write_text(f"{zip_sha}  {zip_path.name}\n", encoding="ascii")
    monkeypatch.setattr(
        vg38,
        "expected_archive_paths",
        lambda _symbol, _month: (zip_path, checksum_path),
    )
    monkeypatch.setattr(vg38, "SOURCE_ROOT", tmp_path)

    def forbidden_archive_open(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("freeze opened an archive member")

    monkeypatch.setattr(zipfile, "ZipFile", forbidden_archive_open)
    row = vg38.source_artifact_row(
        {
            "checksumBytes": checksum_path.stat().st_size,
            "checksumFrozenEtag": "checksum-etag",
            "checksumFrozenLastModified": "synthetic",
            "checksumSha256": hashlib.sha256(checksum_path.read_bytes()).hexdigest(),
            "checksumUrl": vg38.archive_url("BTCUSDT", "2025-07", checksum=True),
            "month": "2025-07",
            "state": "DOWNLOADED_VERIFIED",
            "symbol": "BTCUSDT",
            "zipBytes": zip_path.stat().st_size,
            "zipFrozenEtag": "zip-etag",
            "zipFrozenLastModified": "synthetic",
            "zipSha256": zip_sha,
            "zipUrl": vg38.archive_url("BTCUSDT", "2025-07"),
        }
    )
    assert row["zipSha256"] == zip_sha


def test_freeze_refuses_after_run_consumption_before_source_access(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    marker_path = tmp_path / "run-marker.v1.json"
    marker_path.write_text("{}\n", encoding="utf-8")
    monkeypatch.setattr(vg38, "RUN_MARKER_PATH", marker_path)
    monkeypatch.setattr(vg38, "RESULT_PATH", tmp_path / "result.v1.json")

    def forbidden_manifest() -> dict[str, object]:
        raise AssertionError("freeze touched sources after run consumption")

    monkeypatch.setattr(vg38, "build_source_manifest", forbidden_manifest)
    with pytest.raises(vg38.VG38Error, match="forbidden after"):
        vg38.freeze()


def test_run_marker_is_exclusive_and_precedes_archive_open(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    marker_path = tmp_path / "run-marker.v1.json"
    freeze_path = tmp_path / "freeze.v1.json"
    manifest_path = tmp_path / "source-manifest.v1.json"
    freeze_path.write_text("{}\n", encoding="utf-8")
    manifest_path.write_text("{}\n", encoding="utf-8")
    monkeypatch.setattr(vg38, "RUN_MARKER_PATH", marker_path)
    monkeypatch.setattr(vg38, "RESULT_PATH", tmp_path / "result.v1.json")
    monkeypatch.setattr(vg38, "FREEZE_PATH", freeze_path)
    monkeypatch.setattr(vg38, "SOURCE_MANIFEST_PATH", manifest_path)
    monkeypatch.setattr(
        vg38,
        "git_output",
        lambda *arguments: "" if arguments == ("status", "--porcelain") else "f" * 40,
    )
    marker_sha = vg38.consume_run_marker({"evaluatorSha256": "e" * 64})
    marker = vg38.load_json(marker_path)
    assert marker_sha == vg38.sha256_path(marker_path)
    assert marker["archiveDecompressionRunOrdinal"] == 1
    assert marker["state"] == "SOLE_ARCHIVE_DECOMPRESSION_RUN_CONSUMED"
    with pytest.raises(vg38.VG38Error, match="already consumed"):
        vg38.consume_run_marker({"evaluatorSha256": "e" * 64})


def test_holdout_requires_candidate_seal_and_is_single_use(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seal_path = tmp_path / "candidate-seal.v1.json"
    open_path = tmp_path / "holdout-open.v1.json"
    monkeypatch.setattr(vg38, "CANDIDATE_SEAL_PATH", seal_path)
    monkeypatch.setattr(vg38, "HOLDOUT_OPEN_PATH", open_path)
    candidate = {"candidate": {"trialId": "vg38-r07-b30-c50"}}
    with pytest.raises(vg38.VG38Error, match="candidate seal"):
        vg38.open_holdout_once(candidate)
    seal_path.write_text(json.dumps(candidate) + "\n", encoding="utf-8")
    receipt = vg38.open_holdout_once(candidate)
    assert receipt["firstEligibleEntryOpenUtc"] == "2026-01-02T00:00:00Z"
    assert receipt["reuseCount"] == 1
    assert receipt["sealedTrialId"] == "vg38-r07-b30-c50"
    with pytest.raises(vg38.VG38Error, match="already opened"):
        vg38.open_holdout_once(candidate)


def _install_verify_harness(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    result: dict[str, object],
) -> None:
    digest = "d" * 64
    freeze_head = "a" * 40
    marker_head = "b" * 40
    current_head = "c" * 40
    marker_path = tmp_path / "run-marker.v1.json"
    result_path = tmp_path / "result.v1.json"
    marker_path.write_bytes(
        vg38.canonical_bytes(
            {
                "archiveDecompressionRunOrdinal": 1,
                "evaluatorSha256": digest,
                "freezeSha256": digest,
                "gitHead": marker_head,
                "sourceManifestSha256": digest,
                "state": "SOLE_ARCHIVE_DECOMPRESSION_RUN_CONSUMED",
            }
        )
    )
    result_path.write_bytes(vg38.canonical_bytes(result))
    monkeypatch.setattr(vg38, "RUN_MARKER_PATH", marker_path)
    monkeypatch.setattr(vg38, "RESULT_PATH", result_path)
    monkeypatch.setattr(vg38, "FREEZE_PATH", tmp_path / "freeze.v1.json")
    monkeypatch.setattr(
        vg38,
        "SOURCE_MANIFEST_PATH",
        tmp_path / "source-manifest.v1.json",
    )
    monkeypatch.setattr(vg38, "PROTOCOL_PATH", tmp_path / "protocol.v1.json")
    monkeypatch.setattr(vg38, "CANDIDATE_SEAL_PATH", tmp_path / "absent-candidate.json")
    monkeypatch.setattr(vg38, "HOLDOUT_OPEN_PATH", tmp_path / "absent-holdout.json")
    monkeypatch.setattr(
        vg38,
        "validate_frozen_identity",
        lambda: (
            {
                "evaluatorSha256": digest,
                "gitHead": freeze_head,
            },
            {"protocolSha256": digest},
        ),
    )
    monkeypatch.setattr(vg38, "verify_source_artifacts", lambda _manifest: None)
    monkeypatch.setattr(vg38, "verify_sha256s", lambda: None)
    monkeypatch.setattr(vg38, "sha256_path", lambda _path: digest)
    monkeypatch.setattr(vg38, "git_blob_sha256", lambda _commit, _path: digest)
    monkeypatch.setattr(vg38, "git_commit_is_ancestor", lambda _left, _right: True)
    monkeypatch.setattr(
        vg38,
        "git_output",
        lambda *arguments: current_head if arguments == ("rev-parse", "HEAD") else "",
    )


def _valid_unopened_no_go() -> dict[str, object]:
    digest = "d" * 64
    return {
        "capitalAuthority": "NONE",
        "development": {"state": "COMPLETE_NO_GATE_PASSER"},
        "freezeSha256": digest,
        "holdout": {
            "metrics": None,
            "reuseCount": 0,
            "state": "UNOPENED_UNTOUCHED",
        },
        "noSideEffects": {
            "hostMutation": False,
            "moneyMovement": False,
            "orderPlacement": False,
            "privateApiRead": False,
            "signedApiCall": False,
            "uiMutation": False,
        },
        "protocolSha256": digest,
        "runMarkerSha256": digest,
        "schema": "VG38TerminalProfitabilityVerdictV1",
        "sourceManifestSha256": digest,
        "verdict": {"status": "NO_GO"},
    }


def test_verifier_accepts_consistent_unopened_no_go_without_rerun(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result = _valid_unopened_no_go()
    _install_verify_harness(tmp_path, monkeypatch, result)

    def forbidden_archive_open(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("verifier opened an archive")

    monkeypatch.setattr(zipfile, "ZipFile", forbidden_archive_open)
    vg38.verify_packet()


@pytest.mark.parametrize(
    ("fault", "message"),
    [
        ("capital", "capital authority"),
        ("side_effect", "side-effect boundary"),
        ("false_go", "GO requires"),
        ("false_unmeasured", "UNMEASURED result"),
    ],
)
def test_verifier_rejects_false_terminal_claims(
    fault: str,
    message: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result = _valid_unopened_no_go()
    if fault == "capital":
        result["capitalAuthority"] = "LIVE"
    elif fault == "side_effect":
        side_effects = result["noSideEffects"]
        assert isinstance(side_effects, dict)
        side_effects["orderPlacement"] = True
    elif fault == "false_go":
        result["verdict"] = {"status": "GO"}
    else:
        result["verdict"] = {"status": "UNMEASURED"}
        result["netEdge"] = {"scope": "MEASURED"}
    _install_verify_harness(tmp_path, monkeypatch, result)
    with pytest.raises(vg38.VG38Error, match=message):
        vg38.verify_packet()
