from __future__ import annotations

import csv
import hashlib
import io
import json
import zipfile
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from research.vg16 import experiment as vg16


def make_bar(
    symbol: str,
    day: date,
    *,
    quote_volume: Decimal = Decimal("10000000"),
    open_price: Decimal = Decimal("100"),
    close_price: Decimal = Decimal("100"),
) -> vg16.Bar:
    open_dt = datetime.combine(day, datetime.min.time(), tzinfo=UTC)
    open_us = int(open_dt.timestamp()) * 1_000_000
    close_us = open_us + 86_400_000_000 - 1
    high = max(open_price, close_price)
    low = min(open_price, close_price)
    raw = (
        str(open_us),
        str(open_price),
        str(high),
        str(low),
        str(close_price),
        "1",
        str(close_us),
        str(quote_volume),
        "1",
        "0.5",
        str(quote_volume / 2),
        "0",
    )
    return vg16.Bar(
        symbol=symbol,
        day=day,
        open=open_price,
        high=high,
        low=low,
        close=close_price,
        quote_volume=quote_volume,
        open_time_us=open_us,
        close_time_us=close_us,
        raw_fields=raw,
        decoded_fields_sha256=vg16.canonical_sha(list(raw)),
    )


def feature(
    day: date,
    delta: str,
    contributions: tuple[tuple[str, str], ...] = (),
) -> vg16.ConcentrationFeature:
    return vg16.ConcentrationFeature(
        decision_day=day,
        delta_hhi=Decimal(delta),
        risk_set_size=30,
        positive_contributions=tuple((symbol, Decimal(value)) for symbol, value in contributions),
        risk_set_sha256="0" * 64,
    )


def archive_artifact(
    root: Path,
    *,
    symbol: str,
    month: str,
    rows: list[tuple[str, ...]],
) -> dict[str, object]:
    directory = root / "archives" / symbol / month
    directory.mkdir(parents=True)
    zip_name = f"{symbol}-1d-{month}.zip"
    zip_path = directory / zip_name
    csv_buffer = io.StringIO(newline="")
    writer = csv.writer(csv_buffer, lineterminator="\n")
    writer.writerows(rows)
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(zip_name.removesuffix(".zip") + ".csv", csv_buffer.getvalue())
    zip_sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    checksum_path = directory / f"{zip_name}.CHECKSUM"
    checksum_path.write_text(f"{zip_sha}  {zip_name}\n", encoding="ascii")
    return {
        "checksumPath": str(checksum_path.relative_to(root)),
        "checksumSha256": hashlib.sha256(checksum_path.read_bytes()).hexdigest(),
        "month": month,
        "symbol": symbol,
        "zipPath": str(zip_path.relative_to(root)),
        "zipSha256": zip_sha,
    }


def test_protocol_declares_distinct_public_only_contract() -> None:
    protocol = json.loads(vg16.PROTOCOL_PATH.read_text(encoding="utf-8"))

    assert vg16.sha256_path(vg16.PROTOCOL_PATH) == vg16.PROTOCOL_SHA256
    assert protocol["baseCommit"] == vg16.BASE_COMMIT
    assert protocol["signal"]["candidateGrid"]["trialCount"] == 12
    assert "ONE_DAY_HHI_INCREASE_EVENT_ONLY" in protocol["signal"]["semanticExclusions"]
    assert protocol["execution"]["validCash"].startswith("FULLY_VALID_RISK_SET")
    assert protocol["execution"]["missingRequiredEvidence"].startswith("TERMINAL_UNMEASURED")
    assert protocol["verdictLaw"]["consumer"] == "N3 successor/final convergence"
    assert protocol["verdictLaw"]["repairOrRerunAfterMarker"] is False
    assert protocol["verdictLaw"]["capitalAuthority"] == "NONE"
    assert "POST_EXIT_OPEN" in protocol["inference"]["drawdownObservation"]
    assert protocol["universe"]["excludedPairedLeveragedSymbols"] == sorted(
        vg16.EXCLUDED_PAIRED_LEVERAGED_SYMBOLS,
        key=vg16.symbol_sort_key,
    )
    assert protocol["universe"]["excludedStableOrFiatSymbols"] == sorted(
        vg16.EXCLUDED_STABLE_OR_FIAT_SYMBOLS,
        key=vg16.symbol_sort_key,
    )


def test_trial_grid_is_exactly_twelve_unique_predeclared_trials() -> None:
    trials = vg16.trial_grid()

    assert len(trials) == 12
    assert len({trial.trial_id for trial in trials}) == 12
    assert {trial.history_days for trial in trials} == {20, 60}
    assert {trial.z_floor for trial in trials} == {Decimal("1.0"), Decimal("2.0")}
    assert {trial.cohort_size for trial in trials} == {3, 5, 10}


def test_symbol_filter_is_semantic_and_unicode_safe() -> None:
    assert vg16.eligible_symbol("BTCUSDT")
    assert vg16.eligible_symbol("ΩUSDT")
    assert vg16.eligible_symbol("JUPUSDT")
    assert vg16.eligible_symbol("SYRUPUSDT")
    assert not vg16.eligible_symbol("USDCUSDT")
    assert not vg16.eligible_symbol("BTCDOWNUSDT")
    assert not vg16.eligible_symbol("BTCBUSD")


def test_concentration_change_uses_one_point_in_time_cross_section() -> None:
    decision_day = date(2026, 1, 31)
    bars: dict[str, dict[date, vg16.Bar]] = {}
    for symbol_index in range(30):
        symbol = f"ASSET{symbol_index:02d}USDT"
        bars[symbol] = {}
        for offset in range(30, -1, -1):
            day = decision_day - timedelta(days=offset)
            quote_volume = Decimal("10000000")
            if offset == 0 and symbol_index == 0:
                quote_volume = Decimal("30000000")
            bars[symbol][day] = make_bar(symbol, day, quote_volume=quote_volume)

    result = vg16.concentration_feature(bars, decision_day)

    assert result is not None
    assert result.risk_set_size == 30
    assert result.delta_hhi > 0
    assert tuple(symbol for symbol, _ in result.positive_contributions) == ("ASSET00USDT",)


def test_concentration_feature_is_invariant_to_future_rows() -> None:
    decision_day = date(2026, 1, 31)
    bars: dict[str, dict[date, vg16.Bar]] = {}
    for symbol_index in range(30):
        symbol = f"ASSET{symbol_index:02d}USDT"
        bars[symbol] = {
            day: make_bar(
                symbol,
                day,
                quote_volume=(
                    Decimal("30000000")
                    if day == decision_day and symbol_index == 0
                    else Decimal("10000000")
                ),
            )
            for day in (decision_day - timedelta(days=offset) for offset in range(30, -1, -1))
        }
    before = vg16.concentration_feature(bars, decision_day)
    bars["ASSET00USDT"][decision_day + timedelta(days=1)] = make_bar(
        "ASSET00USDT",
        decision_day + timedelta(days=1),
        quote_volume=Decimal("999999999999"),
        open_price=Decimal("999"),
        close_price=Decimal("1"),
    )

    after = vg16.concentration_feature(bars, decision_day)

    assert before == after


def test_signal_is_lagged_and_selects_exact_ranked_cohort() -> None:
    decision_day = date(2026, 2, 1)
    features = {
        decision_day - timedelta(days=offset): feature(
            decision_day - timedelta(days=offset),
            str(Decimal(offset) / Decimal("1000")),
        )
        for offset in range(20, 0, -1)
    }
    features[decision_day] = feature(
        decision_day,
        "0.1",
        (
            ("AAAUSDT", "0.03"),
            ("BBBUSDT", "0.02"),
            ("CCCUSDT", "0.01"),
        ),
    )
    trial = vg16.Trial("test", 20, Decimal("1.0"), 3)

    signal = vg16.signal_for_day(features, trial, decision_day)

    assert signal is not None
    assert signal.decision_day == decision_day
    assert signal.symbols == ("AAAUSDT", "BBBUSDT", "CCCUSDT")
    assert signal.robust_z >= trial.z_floor
    assert (
        vg16.signal_for_day(
            features,
            vg16.Trial("too-large", 20, Decimal("1.0"), 5),
            decision_day,
        )
        is None
    )


def test_missing_required_feature_is_terminal_not_cash() -> None:
    decision_day = date(2026, 2, 1)

    with pytest.raises(vg16.VG16Error, match="REQUIRED_CONCENTRATION_FEATURE_MISSING"):
        vg16.signal_for_day(
            {},
            vg16.Trial("missing-feature", 20, Decimal("1"), 3),
            decision_day,
        )


def test_positive_event_with_zero_robust_scale_is_terminal() -> None:
    decision_day = date(2026, 2, 1)
    features = {
        decision_day - timedelta(days=offset): feature(
            decision_day - timedelta(days=offset),
            "0.01",
        )
        for offset in range(20, 0, -1)
    }
    features[decision_day] = feature(
        decision_day,
        "0.1",
        (
            ("AAAUSDT", "0.03"),
            ("BBBUSDT", "0.02"),
            ("CCCUSDT", "0.01"),
        ),
    )

    with pytest.raises(vg16.VG16Error, match="REQUIRED_ROBUST_SCALE_ZERO"):
        vg16.signal_for_day(
            features,
            vg16.Trial("zero-scale", 20, Decimal("1"), 3),
            decision_day,
        )


def test_no_signal_is_valid_cash_and_retains_every_calendar_day(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vg16, "signal_for_day", lambda *_args: None)
    start = date(2026, 1, 1)

    simulation = vg16.simulate_period(
        {},
        {},
        vg16.Trial("cash", 20, Decimal("1"), 3),
        start,
        start + timedelta(days=3),
    )

    assert simulation.days == tuple(start + timedelta(days=i) for i in range(3))
    assert simulation.cash_day_count == 3
    assert simulation.active_signal_count == 0
    assert simulation.base_daily_usdt == (Decimal(0),) * 3
    assert simulation.trades == ()


def test_missing_selected_entry_bar_is_terminal_not_cash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = date(2026, 1, 8)
    signal = vg16.CohortSignal(
        decision_day=start - timedelta(days=1),
        symbols=("AAAUSDT",),
        delta_hhi=Decimal("0.1"),
        robust_z=Decimal("3"),
        risk_set_size=30,
    )
    monkeypatch.setattr(vg16, "signal_for_day", lambda *_args: signal)

    with pytest.raises(vg16.VG16Error, match="REQUIRED_SELECTED_ENTRY_BAR_MISSING"):
        vg16.simulate_period(
            {"AAAUSDT": {}},
            {},
            vg16.Trial("missing", 20, Decimal("1"), 1),
            start,
            start + timedelta(days=2),
        )


def test_signal_enters_next_open_and_exits_following_open(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = date(2026, 1, 8)
    symbol = "AAAUSDT"
    signal = vg16.CohortSignal(
        decision_day=start - timedelta(days=1),
        symbols=(symbol,),
        delta_hhi=Decimal("0.1"),
        robust_z=Decimal("3"),
        risk_set_size=30,
    )
    monkeypatch.setattr(vg16, "signal_for_day", lambda *_args: signal)
    bars = {
        symbol: {
            day: make_bar(
                symbol,
                day,
                open_price=(Decimal("110") if day == start + timedelta(days=1) else Decimal("100")),
                close_price=Decimal("100"),
            )
            for day in (start - timedelta(days=offset) for offset in range(7, -2, -1))
        }
    }

    simulation = vg16.simulate_period(
        bars,
        {},
        vg16.Trial("lag", 20, Decimal("1"), 1),
        start,
        start + timedelta(days=2),
    )

    assert len(simulation.trades) == 1
    trade = simulation.trades[0]
    assert trade.decision_day == start - timedelta(days=1)
    assert trade.entry_day == start
    assert trade.exit_day == start + timedelta(days=1)
    assert trade.reference_gross_pnl_usdt == Decimal("100")
    assert trade.base_net_pnl_usdt < trade.reference_gross_pnl_usdt
    assert trade.stress_net_pnl_usdt < trade.base_net_pnl_usdt
    assert trade.severe_net_pnl_usdt < trade.stress_net_pnl_usdt


def test_drawdown_path_records_exit_open_before_same_day_rebound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = date(2026, 1, 8)
    first = vg16.CohortSignal(
        decision_day=start - timedelta(days=1),
        symbols=("AAAUSDT",),
        delta_hhi=Decimal("0.1"),
        robust_z=Decimal("3"),
        risk_set_size=30,
    )
    second = vg16.CohortSignal(
        decision_day=start,
        symbols=("BBBUSDT",),
        delta_hhi=Decimal("0.1"),
        robust_z=Decimal("3"),
        risk_set_size=30,
    )

    def fake_signal(
        _features: object,
        _trial: object,
        decision_day: date,
    ) -> vg16.CohortSignal | None:
        return {
            first.decision_day: first,
            second.decision_day: second,
        }.get(decision_day)

    monkeypatch.setattr(vg16, "signal_for_day", fake_signal)
    bars: dict[str, dict[date, vg16.Bar]] = {"AAAUSDT": {}, "BBBUSDT": {}}
    for symbol in bars:
        for offset in range(8, -3, -1):
            day = start - timedelta(days=offset)
            open_price = Decimal("100")
            close_price = Decimal("100")
            if symbol == "AAAUSDT" and day == start + timedelta(days=1):
                open_price = Decimal("50")
                close_price = Decimal("50")
            if symbol == "BBBUSDT" and day >= start + timedelta(days=1):
                open_price = Decimal("100") if day == start + timedelta(days=1) else Decimal("200")
                close_price = Decimal("200")
            bars[symbol][day] = make_bar(
                symbol,
                day,
                open_price=open_price,
                close_price=close_price,
            )

    simulation = vg16.simulate_period(
        bars,
        {},
        vg16.Trial("open-drawdown", 20, Decimal("1"), 1),
        start,
        start + timedelta(days=3),
    )

    assert vg16.maximum_drawdown(simulation.base_drawdown_nav) > Decimal("0.49")
    assert vg16.maximum_drawdown(simulation.base_nav) < Decimal("0.02")


def test_cost_attribution_reconciles_exactly_and_is_monotone() -> None:
    row = vg16.allocation_attribution(
        Decimal("1000"),
        Decimal("100"),
        Decimal("110"),
    )

    assert row[0] - row[1] - row[2] - row[3] - row[4] == row[5]
    assert row[0] > row[5] > row[6] > row[7]
    assert all(value > 0 for value in row[1:5])


def test_capacity_proxy_is_lagged_and_uses_lower_current_or_median() -> None:
    end_day = date(2026, 1, 7)
    bars = {
        end_day - timedelta(days=offset): make_bar(
            "AAAUSDT",
            end_day - timedelta(days=offset),
            quote_volume=(Decimal("5000000") if offset == 0 else Decimal("10000000")),
        )
        for offset in range(7)
    }

    assert vg16.capacity_symbol_proxy(
        bars,
        end_day,
        Decimal("0.0001"),
    ) == Decimal("500")


def test_archive_collapses_only_adjacent_exact_duplicates(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vg16, "SOURCE_ROOT", tmp_path)
    bar = make_bar("AAAUSDT", date(2025, 7, 1))
    artifact = archive_artifact(
        tmp_path,
        symbol=bar.symbol,
        month="2025-07",
        rows=[bar.raw_fields, bar.raw_fields],
    )

    bars, duplicates = vg16.parse_archive(artifact)

    assert len(bars) == 1
    assert len(duplicates) == 1
    assert duplicates[0]["canonicalRowNumber"] == 1
    assert duplicates[0]["duplicateRowNumber"] == 2
    assert duplicates[0]["decodedFieldsSha256"] == bar.decoded_fields_sha256
    assert duplicates[0]["rawToCanonicalDigest"]


def test_archive_rejects_conflicting_duplicate(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vg16, "SOURCE_ROOT", tmp_path)
    bar = make_bar("AAAUSDT", date(2025, 7, 1))
    conflicting = list(bar.raw_fields)
    conflicting[7] = "20000000"
    artifact = archive_artifact(
        tmp_path,
        symbol=bar.symbol,
        month="2025-07",
        rows=[bar.raw_fields, tuple(conflicting)],
    )

    with pytest.raises(vg16.VG16Error, match="CONFLICTING_DUPLICATE"):
        vg16.parse_archive(artifact)


def test_archive_rejects_nonadjacent_duplicate(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vg16, "SOURCE_ROOT", tmp_path)
    first = make_bar("AAAUSDT", date(2025, 7, 1))
    second = make_bar("AAAUSDT", date(2025, 7, 2))
    artifact = archive_artifact(
        tmp_path,
        symbol=first.symbol,
        month="2025-07",
        rows=[first.raw_fields, second.raw_fields, first.raw_fields],
    )

    with pytest.raises(vg16.VG16Error, match="NON_ADJACENT_DUPLICATE"):
        vg16.parse_archive(artifact)


def test_millisecond_timestamp_is_rejected() -> None:
    bar = make_bar("AAAUSDT", date(2025, 7, 1))
    row = list(bar.raw_fields)
    row[0] = str(int(row[0]) // 1000)

    with pytest.raises(vg16.VG16Error, match="post-2025 microsecond"):
        vg16.parse_kline_row(
            bar.symbol,
            "2025-07",
            tuple(row),
            context="synthetic",
        )


def test_checksum_grammar_binds_digest_and_filename() -> None:
    digest = "a" * 64
    vg16.verify_checksum_text(f"{digest}  sample.zip\n".encode(), "sample.zip", digest)

    with pytest.raises(vg16.VG16Error, match="names another object"):
        vg16.verify_checksum_text(f"{digest}  other.zip\n".encode(), "sample.zip", digest)
    with pytest.raises(vg16.VG16Error, match="differs"):
        vg16.verify_checksum_text(f"{digest}  sample.zip\n".encode(), "sample.zip", "b" * 64)


def test_family_bootstrap_is_deterministic_and_bounded() -> None:
    rows = (
        tuple(Decimal(index % 3 - 1) for index in range(28)),
        tuple(Decimal((index + 1) % 5 - 2) for index in range(28)),
    )

    first = vg16.family_bootstrap_inference(
        rows,
        seed=123,
        block_length=7,
        replicates=64,
    )
    second = vg16.family_bootstrap_inference(
        rows,
        seed=123,
        block_length=7,
        replicates=64,
    )

    assert first == second
    p_values, reality_check = first
    assert len(p_values) == 2
    assert all(Decimal(0) <= vg16.ratio_decimal(value) <= Decimal(1) for value in p_values)
    assert Decimal(0) <= vg16.ratio_decimal(reality_check) <= Decimal(1)


def test_maximum_drawdown_starts_from_declared_cash() -> None:
    assert vg16.maximum_drawdown((Decimal("1100"), Decimal("990"), Decimal("1200"))) == Decimal(
        "0.1"
    )


def test_write_once_refuses_nonidentical_replacement(tmp_path: Path) -> None:
    target = tmp_path / "receipt.json"
    vg16.write_json_once(target, {"state": "FROZEN"})
    vg16.write_json_once(target, {"state": "FROZEN"})

    with pytest.raises(vg16.VG16Error, match="refusing to replace"):
        vg16.write_json_once(target, {"state": "CHANGED"})


def test_exclusive_scope_rejects_any_unrelated_path() -> None:
    vg16.require_exclusive_scope(("quant/research/vg16/experiment.py",))

    with pytest.raises(vg16.VG16Error, match="escapes exclusive"):
        vg16.require_exclusive_scope(
            (
                "quant/research/vg16/experiment.py",
                "run.md",
            )
        )


def test_run_marker_rejects_preexisting_candidate_receipt(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = {
        "RUN_MARKER_PATH": tmp_path / "run-marker.v1.json",
        "CANDIDATE_SEAL_PATH": tmp_path / "candidate-seal.v1.json",
        "HOLDOUT_OPEN_PATH": tmp_path / "holdout-open.v1.json",
        "RESULT_PATH": tmp_path / "result.v1.json",
        "TERMINAL_PATH": tmp_path / "TERMINAL.md",
        "FREEZE_PATH": tmp_path / "freeze.v1.json",
    }
    for name, path in paths.items():
        monkeypatch.setattr(vg16, name, path)
    paths["FREEZE_PATH"].write_text("{}", encoding="utf-8")
    paths["CANDIDATE_SEAL_PATH"].write_text("{}", encoding="utf-8")

    with pytest.raises(vg16.VG16Error, match="already consumed"):
        vg16.consume_run_marker(
            {
                "evaluatorSha256": "a" * 64,
                "protocolSha256": "b" * 64,
                "sourceManifestSha256": "c" * 64,
            }
        )


def test_candidate_seal_binds_full_family_and_run_receipts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    freeze = tmp_path / "freeze.v1.json"
    source = tmp_path / "source-manifest.v1.json"
    seal_path = tmp_path / "candidate-seal.v1.json"
    freeze.write_text("{}", encoding="utf-8")
    source.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(vg16, "FREEZE_PATH", freeze)
    monkeypatch.setattr(vg16, "SOURCE_MANIFEST_PATH", source)
    monkeypatch.setattr(vg16, "CANDIDATE_SEAL_PATH", seal_path)
    candidates: list[dict[str, object]] = [
        {
            "gatePass": False,
            "gateReasons": ["SYNTHETIC_GATE_FAILURE"],
            "metrics": {
                "baseNetOneSided95Lcb14DayUsdtPerDayPer1000": "1.0",
                "baseNetOneSided95Lcb7DayUsdtPerDayPer1000": "1.0",
                "stressNetTotalUsdtPer1000": "1.0",
            },
            "trial": vg16.trial_mapping(trial),
        }
        for trial in vg16.trial_grid()
    ]
    ranked = sorted(candidates, key=vg16.candidate_row_rank_key)
    champion_row = ranked[0]
    champion_row["gatePass"] = True
    champion_row["gateReasons"] = []

    def candidate_trial_id(row: dict[str, object]) -> str:
        trial = row["trial"]
        assert isinstance(trial, dict)
        return str(trial["trialId"])

    champion_id = candidate_trial_id(champion_row)
    champion = next(trial for trial in vg16.trial_grid() if trial.trial_id == champion_id)
    inference = {
        "candidateRanking": {
            "rankedTrialIds": [
                candidate_trial_id(row)
                for row in sorted(candidates, key=vg16.candidate_row_rank_key)
            ]
        },
        "pbo": {
            "holdoutTouched": False,
            "role": (
                "DEVELOPMENT_ONLY_DIAGNOSTIC; NEVER_SELECTION_HOLM_INTERVAL_VERDICT_OR_AUTHORITY"
            ),
        },
        "trialLedger": {"attemptedCount": 12},
    }

    seal = vg16.candidate_seal(
        champion,
        champion_row,
        candidates,
        inference,
        "d" * 64,
    )

    assert seal["runMarkerSha256"] == "d" * 64
    development_evidence = seal["developmentEvidence"]
    assert isinstance(development_evidence, dict)
    assert development_evidence["candidates"] == candidates
    assert development_evidence["inference"] == inference
    assert seal["developmentEvidenceSha256"] == vg16.canonical_sha(development_evidence)


def test_holdout_open_rejects_candidate_identity_mismatch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seal_path = tmp_path / "candidate-seal.v1.json"
    holdout_path = tmp_path / "holdout-open.v1.json"
    seal_path.write_text(
        json.dumps(
            {
                "candidate": {"trialId": "different-trial"},
                "state": "DEVELOPMENT_GATES_PASS_CHAMPION_FROZEN",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(vg16, "CANDIDATE_SEAL_PATH", seal_path)
    monkeypatch.setattr(vg16, "HOLDOUT_OPEN_PATH", holdout_path)

    with pytest.raises(vg16.VG16Error, match="candidate seal identity"):
        vg16.open_holdout_once(vg16.trial_grid()[0])


def test_terminal_unmeasured_has_no_numeric_economics(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    freeze = tmp_path / "freeze.v1.json"
    source = tmp_path / "source-manifest.v1.json"
    holdout = tmp_path / "holdout-open.v1.json"
    freeze.write_text("{}", encoding="utf-8")
    source.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(vg16, "FREEZE_PATH", freeze)
    monkeypatch.setattr(vg16, "SOURCE_MANIFEST_PATH", source)
    monkeypatch.setattr(vg16, "HOLDOUT_OPEN_PATH", holdout)

    result = vg16.terminal_unmeasured_result(
        marker_sha="e" * 64,
        reason="SYNTHETIC_REQUIRED_EVIDENCE_FAILURE",
        source_manifest={"state": "FROZEN"},
        duplicate_rows=(),
    )

    assert result["development"] is None
    result_holdout = result["holdout"]
    result_edge = result["netEdge"]
    assert isinstance(result_holdout, dict)
    assert isinstance(result_edge, dict)
    assert result_holdout["metrics"] is None
    assert set(result_edge.values()) >= {None, "UNMEASURED"}
    assert result["riskAndInference"] == {
        "capacity": None,
        "costs": None,
        "drawdown": None,
        "pbo": None,
    }
