"""Network-free focused acceptance tests for the sealed V-G3 evaluator."""

from __future__ import annotations

import csv
import hashlib
import io
import urllib.request
import zipfile
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from fractions import Fraction
from pathlib import Path
from types import SimpleNamespace, TracebackType
from typing import Any, cast

import pytest
from research.vg3 import experiment as exp

D = Decimal


class _FakeResponse:
    def __init__(self, payload: bytes, final_url: str) -> None:
        self.payload = payload
        self.final_url = final_url
        self.offset = 0
        self.headers: dict[str, str] = {}

    def __enter__(self) -> _FakeResponse:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback

    def geturl(self) -> str:
        return self.final_url

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            size = len(self.payload) - self.offset
        chunk = self.payload[self.offset : self.offset + size]
        self.offset += len(chunk)
        return chunk


def _bar(
    day: date,
    *,
    close: str = "100",
    quote_volume: str = "10000000",
) -> exp.Bar:
    opened = D("100")
    closed = D(close)
    return exp.Bar(
        day=day,
        open=opened,
        high=max(opened, closed),
        low=min(opened, closed),
        close=closed,
        quote_volume=D(quote_volume),
        trade_count=100,
    )


def _cross_section(entry_day: date) -> dict[str, dict[date, exp.Bar]]:
    bars: dict[str, dict[date, exp.Bar]] = {}
    signal_day = entry_day - timedelta(days=1)
    for index in range(40):
        symbol = f"S{index:02d}USDT"
        rows: dict[date, exp.Bar] = {}
        for offset in range(25, 0, -1):
            day = signal_day - timedelta(days=offset)
            rows[day] = _bar(day)
        if index == 39:
            rows[signal_day] = _bar(
                signal_day,
                close="90",
                quote_volume="40000000",
            )
        else:
            rows[signal_day] = _bar(signal_day)
        bars[symbol] = rows
    return bars


def test_protocol_and_trial_family_are_exact() -> None:
    protocol = exp.protocol()
    assert protocol["canonicalBaseCommit"] == exp.BASE_COMMIT
    trials = exp.trial_family()
    assert len(trials) == 12
    assert len({trial.trial_id for trial in trials}) == 12
    assert {trial.loss_threshold_bps for trial in trials} == {200, 400, 600}
    assert {trial.volume_multiple_milli for trial in trials} == {2000, 4000}
    assert {trial.slots for trial in trials} == {3, 5}


def test_archive_partitions_are_disjoint_and_bounded() -> None:
    symbols = ("BTCUSDT",)
    formation = exp.formation_specs(symbols)
    development = exp.development_specs(symbols)
    holdout = exp.holdout_specs(symbols)
    assert len(formation) == 3
    assert len(development) == 33
    assert len(holdout) == 11
    keys = [
        {spec.key for spec in formation},
        {spec.key for spec in development},
        {spec.key for spec in holdout},
    ]
    assert keys[0].isdisjoint(keys[1])
    assert keys[0].isdisjoint(keys[2])
    assert keys[1].isdisjoint(keys[2])
    assert all(spec.url.startswith("https://data.binance.vision/") for spec in development)


def test_official_fetch_rejects_redirect_outside_allowlist(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VG3_STATE_ROOT", str(tmp_path))

    def fake_urlopen(request: object, timeout: int) -> _FakeResponse:
        del request, timeout
        return _FakeResponse(b"payload", "https://evil.example/payload")

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    allowed_url = (
        "https://raw.githubusercontent.com/binance/binance-public-data/"
        "5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md"
    )
    with pytest.raises(exp.EvidenceError, match="differs from pinned request"):
        exp._http_bytes(allowed_url, maximum_bytes=1024, retries=1)
    with pytest.raises(exp.EvidenceError, match="differs from pinned request"):
        exp._http_stream_to_path(
            allowed_url,
            tmp_path / "archive.zip",
            expected_sha256=hashlib.sha256(b"payload").hexdigest(),
            budget=exp._CompressedByteBudget(1024),
            retries=1,
        )


def test_optional_minute_body_404_is_preserved_as_missing_evidence(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VG3_STATE_ROOT", str(tmp_path))
    spec = exp.ArchiveSpec(
        "HOLDOUT",
        "monthly",
        "1m",
        "BTCUSDT",
        "2026-02",
    )
    zip_path = spec.local_path()
    sidecar_path = zip_path.with_name(f"{zip_path.name}.CHECKSUM")
    sidecar_path.parent.mkdir(parents=True)
    sidecar_path.write_text(f"{'0' * 64}  {spec.filename}\n", encoding="ascii")

    def missing_stream(
        url: str,
        destination: Path,
        *,
        expected_sha256: str,
        budget: exp._CompressedByteBudget,
        retries: int = 4,
    ) -> str | None:
        del destination, expected_sha256, budget, retries
        raise exp.ArchiveMissing(url)

    monkeypatch.setattr(exp, "_http_stream_to_path", missing_stream)
    record = exp.download_archive(
        spec,
        allow_missing=True,
        budget=exp._CompressedByteBudget(1024),
    )
    assert record.state == "MISSING_BODY"
    assert record.zip_sha256 is None
    assert record.checksum_text_sha256 == exp.sha256_file(sidecar_path)
    assert not zip_path.exists()
    assert exp._archive_record_from_mapping(record.as_mapping()) == record


def test_optional_minute_without_sidecar_is_missing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VG3_STATE_ROOT", str(tmp_path))
    spec = exp.ArchiveSpec(
        "DEVELOPMENT",
        "monthly",
        "1m",
        "BTCUSDT",
        "2025-07",
    )

    def missing_bytes(
        url: str,
        *,
        maximum_bytes: int,
        retries: int = 4,
    ) -> tuple[bytes, str | None]:
        del maximum_bytes, retries
        raise exp.ArchiveMissing(url)

    monkeypatch.setattr(exp, "_http_bytes", missing_bytes)
    record = exp.download_archive(
        spec,
        allow_missing=True,
        budget=exp._CompressedByteBudget(1024),
    )
    assert record.state == "MISSING"
    assert exp._archive_record_from_mapping(record.as_mapping()) == record
    spec.local_path().write_bytes(b"contradictory-local-source")
    with pytest.raises(exp.EvidenceError, match="invalid missing archive"):
        exp._archive_record_from_mapping(record.as_mapping())


def test_required_daily_without_sidecar_is_recorded_as_missing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VG3_STATE_ROOT", str(tmp_path))
    spec = exp.ArchiveSpec(
        "HOLDOUT",
        "monthly",
        "1d",
        "OMUSDT",
        "2026-05",
    )

    def missing_bytes(
        url: str,
        *,
        maximum_bytes: int,
        retries: int = 4,
    ) -> tuple[bytes, str | None]:
        del maximum_bytes, retries
        raise exp.ArchiveMissing(url)

    monkeypatch.setattr(exp, "_http_bytes", missing_bytes)
    record = exp.download_archive(
        spec,
        allow_missing=True,
        budget=exp._CompressedByteBudget(1024),
    )
    assert record.state == "MISSING"
    assert exp._archive_record_from_mapping(record.as_mapping()) == record


def test_leveraged_pair_exclusion_requires_discovered_pair() -> None:
    candidates = ("BTCUSDT", "ETHUPUSDT", "ETHDOWNUSDT", "SOLOUPUSDT")
    assert exp.leveraged_symbols(candidates) == frozenset({"ETHUPUSDT", "ETHDOWNUSDT"})


def test_post_2025_microsecond_timestamp_contract() -> None:
    expected = datetime(2025, 7, 1, tzinfo=UTC)
    microseconds = int((expected - datetime(1970, 1, 1, tzinfo=UTC)) / timedelta(microseconds=1))
    assert exp._timestamp(str(microseconds)) == expected
    with pytest.raises(exp.EvidenceError, match="microseconds"):
        exp._timestamp(str(microseconds // 1000))
    with pytest.raises(exp.EvidenceError, match="microseconds"):
        exp._timestamp("123")


def test_kline_period_and_close_boundaries_are_exact() -> None:
    spec = exp.ArchiveSpec(
        "DEVELOPMENT",
        "daily",
        "1m",
        "BTCUSDT",
        "2026-02-01",
    )
    epoch = datetime(1970, 1, 1, tzinfo=UTC)
    opened = datetime(2026, 2, 1, tzinfo=UTC)
    exact_close = int(
        (opened + timedelta(minutes=1) - timedelta(microseconds=1) - epoch)
        / timedelta(microseconds=1)
    )
    exp._validate_kline_time(spec, opened, str(exact_close))
    with pytest.raises(exp.EvidenceError, match="period"):
        exp._validate_kline_time(spec, opened + timedelta(days=1), str(exact_close))
    with pytest.raises(exp.EvidenceError, match="close-time"):
        exp._validate_kline_time(spec, opened, str(exact_close + 1))


def test_signal_is_cross_sectional_causal_and_long_reversal() -> None:
    entry_day = date(2025, 7, 1)
    bars = _cross_section(entry_day)
    symbols = tuple(sorted(bars))
    trial = exp.Trial(
        trial_id="TEST_L0400_V4000_K03",
        loss_threshold_bps=400,
        volume_multiple_milli=4000,
        slots=3,
    )
    selections = exp.build_selections(bars, symbols, (entry_day,), (trial,))
    assert selections[trial.trial_id][0].symbols == ("S39USDT",)

    future_day = entry_day + timedelta(days=20)
    for rows in bars.values():
        rows[future_day] = _bar(future_day, close="1", quote_volume="999999999999")
    repeated = exp.build_selections(bars, symbols, (entry_day,), (trial,))
    assert repeated == selections


def test_execution_evidence_is_required_only_for_selected_events() -> None:
    first = date(2025, 7, 1)
    second = first + timedelta(days=1)
    required = exp._required_execution_dates(
        {
            "A": (
                exp.DailySelection(first, ("BTCUSDT",)),
                exp.DailySelection(second, ()),
            ),
            "B": (
                exp.DailySelection(first, ("ETHUSDT", "BTCUSDT")),
                exp.DailySelection(second, ("ETHUSDT",)),
            ),
        }
    )
    assert required == {
        "BTCUSDT": (first,),
        "ETHUSDT": (first, second),
    }


def test_parallel_execution_parser_skips_irrelevant_months(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    july = exp.ArchiveSpec(
        "DEVELOPMENT",
        "monthly",
        "1m",
        "BTCUSDT",
        "2025-07",
    )
    august = exp.ArchiveSpec(
        "DEVELOPMENT",
        "monthly",
        "1m",
        "BTCUSDT",
        "2025-08",
    )
    observed: list[tuple[str, ...]] = []

    def fake_read(
        specs: tuple[exp.ArchiveSpec, ...] | list[exp.ArchiveSpec],
        entry_dates: tuple[date, ...],
        expected_hashes: dict[str, tuple[str, str]],
    ) -> dict[str, dict[date, exp.ExecutionEvidence]]:
        del entry_dates, expected_hashes
        observed.append(tuple(spec.period for spec in specs))
        return {"BTCUSDT": {}}

    monkeypatch.setattr(exp, "read_execution_evidence", fake_read)
    exp._read_execution_parallel(
        (july, august),
        {"BTCUSDT": (date(2025, 7, 1),)},
        {},
    )
    assert observed == [("2025-07",)]


def test_public_fees_stress_capacity_and_drawdown_are_applied() -> None:
    entry_day = date(2025, 7, 1)
    trial = exp.Trial("TEST_L0200_V2000_K03", 200, 2000, 3)
    selections = (exp.DailySelection(entry_day, ("BTCUSDT",)),)
    evidence = exp.ExecutionEvidence(
        entry_date=entry_day,
        reference_entry=D("100"),
        reference_exit=D("112"),
        entry_price=D("101"),
        exit_price=D("109"),
        holding_low=D("80"),
        entry_quote_volume=D("5000000"),
        exit_quote_volume=D("4000000"),
    )
    execution = {"BTCUSDT": {entry_day: evidence}}
    public = exp.simulate(trial, selections, execution, exp.PUBLIC_SCENARIO)
    stress = exp.simulate(trial, selections, execution, exp.STRESS_SCENARIO)
    severe = exp.simulate(trial, selections, execution, exp.SEVERE_SCENARIO)
    assert public.net_usd > stress.net_usd > severe.net_usd
    assert public.public_fee_terminal_drag_usd > 0
    assert public.public_fill_commission_quote_value_usd > 0
    assert public.public_fill_commission_quote_value_usd != public.public_fee_terminal_drag_usd
    assert stress.extra_stress_terminal_drag_usd > 0
    assert exp.decimal_text(public.net_usd, exp.MONEY_QUANTUM) == exp.decimal_text(
        public.adverse_execution_gross_pnl_usd - public.public_fee_terminal_drag_usd,
        exp.MONEY_QUANTUM,
    )
    assert exp.decimal_text(stress.net_usd, exp.MONEY_QUANTUM) == exp.decimal_text(
        stress.adverse_execution_gross_pnl_usd
        - stress.public_fee_terminal_drag_usd
        - stress.extra_stress_terminal_drag_usd,
        exp.MONEY_QUANTUM,
    )
    assert public.reference_gross_pnl_usd > public.adverse_execution_gross_pnl_usd
    assert public.maximum_drawdown_bps > 0
    assert public.capacity_every_sleeve_fits
    assert public.capacity_p05_headroom > 1
    assert public.round_trips == 1
    assert len(public.daily_returns_scaled) == 1


def test_positive_gates_use_the_precision_sealed_in_result() -> None:
    assert not exp._reported_money_positive(D("0.0000004"))
    assert exp._reported_money_positive(D("0.0000006"))
    assert not exp._reported_rate_bps_positive(D("0.00000000000000004"))
    assert not exp._reported_rate_bps_positive(D("0.000000000001"))
    assert exp._reported_rate_bps_positive(D("0.000000000002"))
    assert exp._reported_bps_at_most(D("4000.0000000000004"), D("4000"))
    assert not exp._reported_bps_at_most(D("4000.0000000000006"), D("4000"))


def test_inference_return_quantization_is_frozen_half_even() -> None:
    assert exp._scaled_rate(D("0.0000000000004")) == 0
    assert exp._scaled_rate(D("0.0000000000005")) == 0
    assert exp._scaled_rate(D("0.0000000000006")) == 1
    assert exp._scaled_rate(D("-0.0000000000006")) == -1


def test_retained_symbol_shares_exit_and_repurchase_capacity_window() -> None:
    first = date(2025, 7, 1)
    second = first + timedelta(days=1)
    trial = exp.Trial("TEST_L0200_V2000_K03", 200, 2000, 3)
    selections = (
        exp.DailySelection(first, ("BTCUSDT",)),
        exp.DailySelection(second, ("BTCUSDT",)),
    )
    execution = {
        "BTCUSDT": {
            day: exp.ExecutionEvidence(
                entry_date=day,
                reference_entry=D("100"),
                reference_exit=D("100"),
                entry_price=D("100"),
                exit_price=D("100"),
                holding_low=D("100"),
                entry_quote_volume=D("500000"),
                exit_quote_volume=D("500000"),
            )
            for day in (first, second)
        }
    }
    run = exp.simulate(trial, selections, execution, exp.PUBLIC_SCENARIO)
    assert run.capacity_every_sleeve_fits is False
    assert run.capacity_p05_headroom < 1


def _minute_zip(path: Path, spec: exp.ArchiveSpec) -> None:
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    start = datetime(2026, 2, 1, tzinfo=UTC)
    epoch = datetime(1970, 1, 1, tzinfo=UTC)
    for offset in range(1450):
        opened = start + timedelta(minutes=offset)
        timestamp = int((opened - epoch) / timedelta(microseconds=1))
        is_entry = opened.date() == date(2026, 2, 1) and 5 <= opened.minute < 10
        is_exit = opened.date() == date(2026, 2, 2) and 5 <= opened.minute < 10
        high = "101" if is_entry else "100"
        low = "99" if is_exit else ("98" if offset == 600 else "100")
        writer.writerow(
            (
                timestamp,
                "100",
                high,
                low,
                "100",
                "1",
                timestamp + 59_999_999,
                "1000",
                "1",
                "0.5",
                "500",
                "0",
            )
        )
    payload = io.BytesIO()
    member = spec.filename.removesuffix(".zip") + ".csv"
    with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member, buffer.getvalue())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload.getvalue())
    digest = hashlib.sha256(payload.getvalue()).hexdigest()
    path.with_name(f"{path.name}.CHECKSUM").write_text(
        f"{digest}  {spec.filename}\n",
        encoding="ascii",
    )


def test_minute_execution_window_requires_all_1440_holding_minutes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VG3_STATE_ROOT", str(tmp_path))
    spec = exp.ArchiveSpec(
        "DEVELOPMENT",
        "monthly",
        "1m",
        "BTCUSDT",
        "2026-02",
    )
    _minute_zip(spec.local_path(), spec)
    parsed = exp.read_execution_evidence((spec,), (date(2026, 2, 1),))
    evidence = parsed["BTCUSDT"][date(2026, 2, 1)]
    assert evidence.entry_price == D("101")
    assert evidence.exit_price == D("99")
    assert evidence.holding_low == D("98")
    assert evidence.entry_quote_volume == D("5000")
    assert evidence.exit_quote_volume == D("5000")


def test_parser_rejects_archive_bytes_replaced_after_acquisition(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VG3_STATE_ROOT", str(tmp_path))
    spec = exp.ArchiveSpec(
        "DEVELOPMENT",
        "monthly",
        "1m",
        "BTCUSDT",
        "2026-02",
    )
    path = spec.local_path()
    _minute_zip(path, spec)
    sidecar_path = path.with_name(f"{path.name}.CHECKSUM")
    sealed_hashes = {
        spec.identity: (
            exp.sha256_file(path),
            exp.sha256_file(sidecar_path),
        )
    }
    assert next(iter(exp._verified_csv_rows(spec, sealed_hashes)))

    replaced = path.read_bytes() + b"publisher-replacement"
    path.write_bytes(replaced)
    replacement_digest = hashlib.sha256(replaced).hexdigest()
    sidecar_path.write_text(
        f"{replacement_digest}  {spec.filename}\n",
        encoding="ascii",
    )
    with pytest.raises(exp.EvidenceError, match="sealed acquisition"):
        next(iter(exp._verified_csv_rows(spec, sealed_hashes)))


def test_bootstrap_is_synchronized_and_deterministic() -> None:
    matrix = {
        "A": tuple((index % 5 - 1) * 100_000_000 for index in range(28)),
        "B": tuple(((index * index) % 11 - 3) * 80_000_000 for index in range(28)),
    }
    first = exp.bootstrap_family(matrix, block_days=7, replicates=512, seed=42)
    second = exp.bootstrap_family(matrix, block_days=7, replicates=512, seed=42)
    assert first.as_mapping() == second.as_mapping()
    assert set(first.rows) == {"A", "B"}
    assert all(row.raw_p_value.denominator <= 513 for row in first.rows.values())


def test_zero_event_trial_remains_in_family_with_p_value_one() -> None:
    matrix = {
        "ACTIVE": tuple((index % 5 - 1) * 100_000_000 for index in range(28)),
        "EMPTY": tuple(0 for _ in range(28)),
    }
    report = exp.bootstrap_family(matrix, block_days=7, replicates=512, seed=7)
    empty = report.rows["EMPTY"]
    assert empty.mean_daily_return == 0
    assert empty.local_lcb == 0
    assert empty.raw_p_value == 1
    assert empty.max_t_p_value == 1


def test_holm_counts_every_attempt() -> None:
    decisions = exp.holm_decisions(
        {
            "A": Fraction(1, 1000),
            "B": Fraction(1, 100),
            "C": Fraction(1, 2),
        }
    )
    assert decisions["A"]["rejected"] is True
    assert decisions["B"]["rejected"] is True
    assert decisions["C"]["rejected"] is False


def test_cscv_pbo_uses_all_12870_symmetric_splits() -> None:
    matrix = {
        "A": tuple(100 if index % 2 == 0 else -50 for index in range(224)),
        "B": tuple(-20 if index % 3 else 80 for index in range(224)),
    }
    report = exp.cscv_pbo(matrix)
    assert report["status"] == "AVAILABLE"
    assert report["splitCount"] == 12_870
    pbo = report["pbo"]
    assert isinstance(pbo, dict)
    assert 0 <= int(pbo["numerator"]) <= int(pbo["denominator"])


def test_walk_forward_never_uses_validation_to_select() -> None:
    matrix = {
        "A": tuple(100 for _ in range(224)),
        "B": tuple(-100 for _ in range(224)),
    }
    report = exp.walk_forward(matrix, "A")
    assert report["pass"] is True
    assert report["championSelectedFolds"] == 6
    folds = report["folds"]
    assert isinstance(folds, list)
    assert all(fold["selectedTrialId"] == "A" for fold in folds)
    assert all(fold["purgedDays"] == 1 for fold in folds)
    assert all(fold["validationDays"] == 27 for fold in folds)


def test_walk_forward_requires_causally_selected_validation_positivity() -> None:
    champion = [100 for _ in range(224)]
    for fold in range(6):
        validation_start = 56 + fold * 28 + 1
        champion[validation_start : validation_start + 27] = [-1] * 27
    matrix = {
        "A": tuple(champion),
        "B": tuple(-100 for _ in range(224)),
    }
    report = exp.walk_forward(matrix, "A")
    assert report["championSelectedFolds"] == 6
    assert report["championPositiveValidationFolds"] == 0
    assert report["selectedPositiveValidationFolds"] == 0
    assert report["pass"] is False


def test_development_eligibility_cannot_contradict_failed_gate() -> None:
    development = {
        "candidateSealEligible": True,
        "championTrialId": exp.trial_family()[0].trial_id,
        "gates": {"netStressPositive": False},
        "status": "MEASURED",
        "trialLedger": {
            "attemptedCount": 12,
            "globalAttemptCount": "UNKNOWN",
            "globalFamilyMapping": "UNADJUDICATED_IN_CANONICAL_BASE",
            "trials": [{"trialId": trial.trial_id} for trial in exp.trial_family()],
        },
    }
    with pytest.raises(exp.EvidenceError, match="eligibility"):
        exp._development_champion(development)


def test_candidate_marker_digest_mismatch_is_rejected(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VG3_STATE_ROOT", str(tmp_path))
    candidate_path = tmp_path / "candidate-seal.v1.json"
    candidate = {
        "schema": "VG3CandidateSealV1",
        "championTrialId": "A",
        "developmentDigest": "dev",
        "developmentEvidenceSha256": "evidence",
        "sealedAtUtc": "2026-07-29T00:00:00Z",
    }
    exp.exclusive_write(candidate_path, exp.canonical_json_bytes(candidate))
    marker = {
        "schema": "VG3HoldoutOpenMarkerV1",
        "candidateSealSha256": "0" * 64,
        "openedAtUtc": "2026-07-29T00:00:01Z",
        "oneUse": True,
    }
    exp.exclusive_write(
        tmp_path / "holdout-opened.v1.json",
        exp.canonical_json_bytes(marker),
    )
    with pytest.raises(exp.EvidenceError, match="holdout marker"):
        exp._verify_candidate_and_holdout_markers(
            champion_id="A",
            development_digest="dev",
            development_evidence_digest="evidence",
        )


def test_external_child_symlink_cannot_escape_state_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "state"
    escape = tmp_path / "escape"
    root.mkdir()
    escape.mkdir()
    (root / "listing-pages").symlink_to(escape, target_is_directory=True)
    monkeypatch.setenv("VG3_STATE_ROOT", str(root))
    with pytest.raises(exp.EvidenceError, match="parent is unsafe"):
        exp.atomic_write(root / "listing-pages" / "page-001.xml", b"unsafe")
    assert not (escape / "page-001.xml").exists()


def test_external_parent_creation_tolerates_concurrent_winner(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "state"
    monkeypatch.setenv("VG3_STATE_ROOT", str(root))
    original_mkdir = Path.mkdir
    race_injected = False

    def racing_mkdir(
        path: Path,
        mode: int = 0o777,
        parents: bool = False,
        exist_ok: bool = False,
    ) -> None:
        nonlocal race_injected
        if path.name == "shared" and not race_injected:
            race_injected = True
            original_mkdir(path, mode=mode, parents=parents, exist_ok=exist_ok)
            raise FileExistsError(path)
        original_mkdir(path, mode=mode, parents=parents, exist_ok=exist_ok)

    monkeypatch.setattr(Path, "mkdir", racing_mkdir)
    exp._guard_external_path(
        root / "shared" / "nested" / "evidence.bin",
        create_parent=True,
    )
    assert race_injected
    assert (root / "shared" / "nested").is_dir()


def test_external_result_recovery_requires_full_verification(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "state"
    tracked = tmp_path / "tracked-result.json"
    monkeypatch.setenv("VG3_STATE_ROOT", str(root))
    monkeypatch.setattr(exp, "RESULT_PATH", tracked)
    fabricated = {
        "schema": "VG3ResultV1",
        "baseCommit": exp.BASE_COMMIT,
        "verdict": "GO",
    }
    exp.exclusive_write(
        root / "result.v1.json",
        exp.canonical_json_bytes(fabricated),
    )

    def fake_verify_acquisition() -> tuple[
        dict[str, Any],
        dict[str, Any],
        dict[str, tuple[str, str]],
    ]:
        return {}, {}, {}

    def reject_fabricated_result(
        *,
        require_terminal_commit: bool = True,
    ) -> dict[str, Any]:
        assert require_terminal_commit is False
        raise exp.EvidenceError("full semantic verification failed")

    monkeypatch.setattr(exp, "verify_acquisition", fake_verify_acquisition)
    monkeypatch.setattr(exp, "verify_result", reject_fabricated_result)
    with pytest.raises(exp.EvidenceError, match="semantic verification"):
        exp.run_sealed_experiment()
    assert not tracked.exists()


def test_required_daily_absence_terminalizes_before_development_open(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VG3_STATE_ROOT", str(tmp_path))
    missing = exp.ArchiveRecord(
        spec=exp.ArchiveSpec(
            "HOLDOUT",
            "monthly",
            "1d",
            "OMUSDT",
            "2026-05",
        ),
        state="MISSING",
        zip_sha256=None,
        checksum_text_sha256=None,
        compressed_bytes=0,
        last_modified=None,
    )
    acquisition: dict[str, Any] = {
        "missingRequiredDailyArchiveCount": 1,
        "records": [missing.as_mapping()],
    }
    universe: dict[str, Any] = {"selectedSymbols": [f"S{i:02d}USDT" for i in range(40)]}
    terminal_call: dict[str, object] = {}

    def fake_verify_acquisition() -> tuple[
        dict[str, Any],
        dict[str, Any],
        dict[str, tuple[str, str]],
    ]:
        return acquisition, universe, {}

    def fake_terminal(
        reason: str,
        detail: str,
        *,
        acquisition: object,
        universe: object,
        development_evidence: object,
    ) -> dict[str, object]:
        del acquisition, universe, development_evidence
        terminal_call.update({"detail": detail, "reason": reason})
        return {"verdict": "UNMEASURED"}

    def forbidden_evaluation(symbols: object, expected_hashes: object) -> object:
        del symbols, expected_hashes
        raise AssertionError("development evaluation must remain unopened")

    monkeypatch.setattr(exp, "verify_acquisition", fake_verify_acquisition)
    monkeypatch.setattr(exp, "_terminal_unmeasured", fake_terminal)
    monkeypatch.setattr(exp, "evaluate_development", forbidden_evaluation)
    assert exp.run_sealed_experiment() == {"verdict": "UNMEASURED"}
    assert terminal_call["reason"] == "REQUIRED_DAILY_ARCHIVE_MISSING"
    assert "HOLDOUT:MONTHLY:1d:OMUSDT:2026-05" in str(terminal_call["detail"])
    assert not (tmp_path / "development-opened.v1.json").exists()


def test_required_daily_terminal_packet_round_trips_real_verifier(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "state"
    tracked_result = tmp_path / "result.v1.json"
    freeze_path = tmp_path / "freeze.v1.json"
    monkeypatch.setenv("VG3_STATE_ROOT", str(root))
    monkeypatch.setattr(exp, "RESULT_PATH", tracked_result)
    monkeypatch.setattr(exp, "FREEZE_PATH", freeze_path)
    missing = exp.ArchiveRecord(
        spec=exp.ArchiveSpec(
            "HOLDOUT",
            "monthly",
            "1d",
            "OMUSDT",
            "2026-05",
        ),
        state="MISSING",
        zip_sha256=None,
        checksum_text_sha256=None,
        compressed_bytes=0,
        last_modified=None,
    )
    acquisition: dict[str, Any] = {
        "compressedBytes": 0,
        "missingOptionalMinuteArchiveCount": 0,
        "missingRequiredDailyArchiveCount": 1,
        "recordCount": 1,
        "records": [missing.as_mapping()],
        "recordsSha256": exp.sha256_bytes(exp.canonical_json_bytes([missing.as_mapping()])),
        "verifiedArchiveCount": 0,
    }
    universe: dict[str, Any] = {
        "asOfUtc": "2025-06-01T00:00:00Z",
        "selectedSymbols": [f"S{i:02d}USDT" for i in range(40)],
    }
    exp.exclusive_write(
        root / "acquisition.v1.json",
        exp.canonical_json_bytes(acquisition),
    )
    exp.exclusive_write(
        root / "universe-seal.v1.json",
        exp.canonical_json_bytes(universe),
    )
    exp.exclusive_write(freeze_path, exp.canonical_json_bytes({"frozen": True}))

    def fake_verify_freeze() -> dict[str, Any]:
        return {}

    def fake_verify_acquisition() -> tuple[
        dict[str, Any],
        dict[str, Any],
        dict[str, tuple[str, str]],
    ]:
        return acquisition, universe, {}

    monkeypatch.setattr(exp, "verify_freeze", fake_verify_freeze)
    monkeypatch.setattr(exp, "verify_acquisition", fake_verify_acquisition)
    produced = exp._terminal_unmeasured(
        "REQUIRED_DAILY_ARCHIVE_MISSING",
        "one required daily archive was absent before development open",
        acquisition=acquisition,
        universe=universe,
        development_evidence=None,
    )
    verified = exp.verify_result(require_terminal_commit=False)
    assert verified == produced
    assert verified["verdict"] == "UNMEASURED"
    assert verified["reasonCodes"] == ["REQUIRED_DAILY_ARCHIVE_MISSING"]
    assert not (root / "development-opened.v1.json").exists()


def test_real_verifier_rejects_fabricated_measured_development(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "state"
    tracked = tmp_path / "tracked-result.json"
    freeze_path = tmp_path / "freeze.json"
    monkeypatch.setenv("VG3_STATE_ROOT", str(root))
    monkeypatch.setattr(exp, "RESULT_PATH", tracked)
    monkeypatch.setattr(exp, "FREEZE_PATH", freeze_path)

    exp.exclusive_write(freeze_path, exp.canonical_json_bytes({"frozen": True}))
    exp.exclusive_write(
        root / "acquisition.v1.json",
        exp.canonical_json_bytes({"acquired": True}),
    )
    exp.exclusive_write(
        root / "universe-seal.v1.json",
        exp.canonical_json_bytes({"selectedSymbols": [f"S{i:02d}USDT" for i in range(40)]}),
    )
    exp.exclusive_write(
        root / "holdout-opened.v1.json",
        exp.canonical_json_bytes({"opened": True}),
    )
    acquisition: dict[str, Any] = {}
    universe: dict[str, Any] = {"selectedSymbols": [f"S{i:02d}USDT" for i in range(40)]}

    def fake_verify_freeze() -> dict[str, Any]:
        return {}

    def fake_verify_acquisition() -> tuple[
        dict[str, Any],
        dict[str, Any],
        dict[str, tuple[str, str]],
    ]:
        return acquisition, universe, {}

    def fake_source_summary(value: object) -> dict[str, object]:
        del value
        return {"sealed": "source"}

    def fake_universe_summary(value: object) -> dict[str, object]:
        del value
        return {"sealed": "universe"}

    def fake_development_marker(value: object) -> bool:
        del value
        return True

    def fake_evaluate_development(
        symbols: object,
        expected_hashes: object,
    ) -> exp.DevelopmentEvaluation:
        del symbols, expected_hashes
        return cast(
            exp.DevelopmentEvaluation,
            SimpleNamespace(report={"status": "MEASURED", "recomputed": True}),
        )

    monkeypatch.setattr(exp, "verify_freeze", fake_verify_freeze)
    monkeypatch.setattr(exp, "verify_acquisition", fake_verify_acquisition)
    monkeypatch.setattr(exp, "_source_summary", fake_source_summary)
    monkeypatch.setattr(exp, "_universe_summary", fake_universe_summary)
    monkeypatch.setattr(exp, "_verify_development_open_marker", fake_development_marker)
    monkeypatch.setattr(exp, "evaluate_development", fake_evaluate_development)

    result: dict[str, object] = {
        "authority": {
            "capital": "NONE",
            "orders": "NONE",
            "privateRead": "NONE",
        },
        "baseCommit": exp.BASE_COMMIT,
        "consumer": "N3_PROFITABILITY_VERDICT",
        "development": {"status": "MEASURED"},
        "economics": {},
        "evidence": {
            "acquisitionReceiptSha256": exp.sha256_file(root / "acquisition.v1.json"),
            "freezeReceiptSha256": exp.sha256_file(freeze_path),
            "universeSealSha256": exp.sha256_file(root / "universe-seal.v1.json"),
        },
        "holdout": {"opened": True, "status": "MEASURED"},
        "n3ProfitabilityStatus": "UNKNOWN",
        "reasonCodes": [],
        "resultCreatedAtUtc": "2026-07-29T00:00:00Z",
        "schema": "VG3ResultV1",
        "sourceTruth": {"sealed": "source"},
        "universe": {"sealed": "universe"},
        "verdict": "GO",
    }
    payload = exp.canonical_json_bytes(result)
    exp.exclusive_write(tracked, payload)
    exp.exclusive_write(root / "result.v1.json", payload)

    with pytest.raises(exp.EvidenceError, match="deterministic sealed-source recomputation"):
        exp.verify_result(require_terminal_commit=False)


def test_exclusive_marker_cannot_be_consumed_twice(tmp_path: Path) -> None:
    marker = tmp_path / "marker.json"
    exp.exclusive_write(marker, b"{}\n")
    with pytest.raises(FileExistsError):
        exp.exclusive_write(marker, b"{}\n")


def test_canonical_json_rejects_floats() -> None:
    with pytest.raises(exp.EvidenceError, match="floating"):
        exp.canonical_json_bytes({"notAllowed": 0.1})
    with pytest.raises(exp.EvidenceError, match="floating"):
        exp.canonical_json_bytes({"notAllowedInTuple": (0.1,)})
    assert exp.canonical_json_bytes({"integer": 1, "text": "ok"}) == (
        b'{"integer":1,"text":"ok"}\n'
    )
    with pytest.raises(exp.EvidenceError, match="must be an integer"):
        exp.require_int(True, "booleanCount")
