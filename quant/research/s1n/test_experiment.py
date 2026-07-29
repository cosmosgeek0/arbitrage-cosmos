"""Network-free acceptance tests for the sealed S-1N packet."""

from __future__ import annotations

import json
import random
from datetime import UTC, datetime
from decimal import Decimal
from itertools import pairwise
from pathlib import Path

import pytest
from research.s1n import experiment as exp


def test_protocol_and_trial_family_are_exact() -> None:
    protocol = json.loads(exp.PROTOCOL_PATH.read_text())
    family = exp.trial_family()
    assert len(family) == 12
    assert len({trial.trial_id for trial in family}) == 12
    assert {trial.lookback_hours for trial in family} == {24, 72}
    assert {trial.dispersion_multiplier for trial in family} == {
        Decimal("1.25"),
        Decimal("1.75"),
    }
    assert {trial.hold_hours for trial in family} == {6, 12, 24}
    assert protocol["trials"]["primaryTrialId"] == "L72_D175_H12"
    assert protocol["authority"]["executionAuthority"] == "NONE"
    assert protocol["accounting"]["accountEffectiveFees"] == "UNKNOWN"
    assert protocol["statistics"]["pbo"]["diagnosticOnly"] is False


def test_frozen_official_sources_record_is_precode_and_public_only() -> None:
    sources = json.loads(exp.OFFICIAL_SOURCES_PATH.read_text())
    assert sources["schema"] == "cosmos.quant.research.s1n.official_sources.v1"
    assert sources["researchBoundary"]["privateOrSignedEndpoints"] == "PROHIBITED"
    assert sources["livePublicSchemaProbe"]["archiveCsvHeader"] == [
        "calc_time",
        "funding_interval_hours",
        "last_funding_rate",
    ]


def test_june_listing_count_is_raw_not_eligibility_count() -> None:
    symbols = [f"RAW{index:03d}USDT" for index in range(522)] + ["USDCUSDT"]
    keys = "".join(
        "<Contents><Key>"
        f"data/futures/um/monthly/fundingRate/{symbol}/"
        f"{symbol}-fundingRate-2025-06.zip"
        "</Key></Contents>"
        for symbol in symbols
    )
    xml = (
        '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
        f"{keys}<IsTruncated>false</IsTruncated></ListBucketResult>"
    ).encode()

    assert len(exp.list_june_funding_symbols(lambda _url: xml)) == 523
    assert not exp.screen_eligible_symbol("USDCUSDT")
    assert not exp.screen_eligible_symbol("BTC_USDT")
    assert exp.screen_eligible_symbol("BTCUSDT")


def test_checksum_parser_is_strict() -> None:
    digest = "a" * 64
    assert (
        exp.parse_checksum_sidecar(
            f"{digest}  BTCUSDT.zip\n".encode(), expected_filename="BTCUSDT.zip"
        )
        == digest
    )
    with pytest.raises(exp.EvidenceError, match="filename mismatch"):
        exp.parse_checksum_sidecar(
            f"{digest}  ETHUSDT.zip\n".encode(), expected_filename="BTCUSDT.zip"
        )


def test_selected_cartesian_is_exact_1170() -> None:
    symbols = [f"S{index:02d}USDT" for index in range(30)]

    def sidecar(url: str) -> bytes:
        filename = url.removesuffix(".CHECKSUM").rsplit("/", 1)[-1]
        return f"{'a' * 64}  {filename}\n".encode()

    rows = exp.selected_source_rows(symbols, sidecar)
    assert len(rows) == 1170
    assert len({(row["symbol"], row["month"], row["dataset"]) for row in rows}) == 1170
    assert {row["month"] for row in rows} == set(exp.month_sequence("2025-06", "2026-06"))


def test_selection_seal_binds_exact_frozen_top_30(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ranking = [
        {"rank": index + 1, "symbol": f"S{index:02d}USDT", "juneQuoteVolume": str(100 - index)}
        for index in range(31)
    ]
    selection = {
        "schema": "cosmos.quant.research.s1n.selection.v1",
        "freezeSha256": "f" * 64,
        "screenSymbolCount": 31,
        "screenArtifactCount": 0,
        "screenManifestSha256": exp.sha256_bytes(exp.canonical_bytes([])),
        "screenExclusions": [],
        "selectedCount": 30,
        "replacement": "FORBIDDEN",
        "ranking": ranking,
        "selectedSymbols": [str(row["symbol"]) for row in ranking[:30]],
    }
    discovery_raw = exp.canonical_bytes({"symbolCount": 31})
    exp.exclusive_write(tmp_path / "discovery.v1.json", discovery_raw)
    freeze_path = tmp_path / "freeze.v1.json"
    freeze_raw = exp.canonical_bytes({"discoverySha256": exp.sha256_bytes(discovery_raw)})
    exp.exclusive_write(freeze_path, freeze_raw)
    selection["freezeSha256"] = exp.sha256_bytes(freeze_raw)
    monkeypatch.setattr(exp, "FREEZE_PATH", freeze_path)
    monkeypatch.setattr(
        exp,
        "reconstruct_screen_evidence",
        lambda _root, _discovery: ([], ranking, []),
    )
    selection["selectionSha256"] = exp.sha256_bytes(exp.canonical_bytes(selection))
    exp.exclusive_write(tmp_path / "selection.v1.json", exp.canonical_bytes(selection))
    verified, _ = exp.verify_selection(
        tmp_path,
        freeze_sha256=exp.sha256_bytes(freeze_raw),
    )
    assert verified["selectedSymbols"] == [str(row["symbol"]) for row in ranking[:30]]

    (tmp_path / "selection.v1.json").unlink()
    selection["selectedSymbols"] = [str(row["symbol"]) for row in ranking[1:31]]
    unsigned = {key: value for key, value in selection.items() if key != "selectionSha256"}
    selection["selectionSha256"] = exp.sha256_bytes(exp.canonical_bytes(unsigned))
    exp.exclusive_write(tmp_path / "selection.v1.json", exp.canonical_bytes(selection))
    with pytest.raises(exp.EvidenceError, match="top-30"):
        exp.verify_selection(
            tmp_path,
            freeze_sha256=exp.sha256_bytes(freeze_raw),
        )


def test_funding_parser_and_actual_interval_normalization() -> None:
    rows = [
        ["calc_time", "funding_interval_hours", "last_funding_rate"],
        [str(exp.HOUR_MS), "1", "0.001"],
        [str(4 * exp.HOUR_MS), "4", "0.004"],
    ]
    events = exp.parse_funding_rows(rows, label="synthetic")
    score = exp.funding_score(events, signal_time_ms=5 * exp.HOUR_MS, lookback_hours=5)
    assert score == Decimal("0.024")


def test_development_warmup_starts_at_frozen_june_boundary() -> None:
    start_ms = exp.parse_utc("2025-07-01T00:00:00Z")
    first_month = datetime.fromtimestamp(
        (start_ms - 30 * exp.DAY_MS) / 1000,
        tz=UTC,
    ).strftime("%Y-%m")
    assert first_month == "2025-06"


def test_funding_score_rejects_synthetic_eight_hour_repair() -> None:
    events = (
        exp.FundingEvent(exp.HOUR_MS, Decimal("1"), Decimal("0.001")),
        exp.FundingEvent(10 * exp.HOUR_MS, Decimal("1"), Decimal("0.001")),
    )
    with pytest.raises(exp.EvidenceError, match="coverage incomplete"):
        exp.funding_score(events, signal_time_ms=11 * exp.HOUR_MS, lookback_hours=11)


def test_tail_direction_is_long_high_short_low_and_ties_are_atomic() -> None:
    scores = {f"S{index:02d}": Decimal(index) for index in range(20)}
    long_symbols, short_symbols = exp.select_atomic_tails(scores)
    assert long_symbols == ("S16", "S17", "S18", "S19")
    assert short_symbols == ("S00", "S01", "S02", "S03")

    tied = dict(scores)
    tied["S15"] = Decimal(16)
    with pytest.raises(exp.EvidenceError, match="tail below minimum"):
        exp.select_atomic_tails(tied)


def test_beta_matching_minimizes_total_gap_deterministically() -> None:
    matches = exp.optimal_beta_matches(
        ("A", "B"),
        ("C", "D"),
        {
            "A": Decimal("0"),
            "B": Decimal("10"),
            "C": Decimal("9"),
            "D": Decimal("1"),
        },
    )
    assert [(match.long_symbol, match.short_symbol) for match in matches] == [
        ("A", "D"),
        ("B", "C"),
    ]
    assert sum((match.absolute_gap for match in matches), exp.ZERO) == Decimal("2")


def test_cross_sectional_floor_can_exclude_one_causally_unavailable_symbol() -> None:
    signal = 5 * exp.HOUR_MS
    valid = exp.SymbolData(
        (
            exp.FundingEvent(exp.HOUR_MS, Decimal("1"), Decimal("0.001")),
            exp.FundingEvent(4 * exp.HOUR_MS, Decimal("3"), Decimal("0.003")),
        ),
        {},
        {},
    )
    unavailable = exp.SymbolData((), {}, {})
    assert exp.cross_sectional_scores(
        {"AUSDT": valid, "BUSDT": unavailable},
        signal_time_ms=signal,
        lookback_hours=5,
    ) == {"AUSDT": Decimal("0.024")}


def test_circular_block_indices_are_deterministic_and_contiguous() -> None:
    first = exp.circular_block_indices(20, rng=random.Random(7))
    second = exp.circular_block_indices(20, rng=random.Random(7))
    assert first == second
    assert len(first) == 20
    assert all(right == (left + 1) % 20 for left, right in pairwise(first[:7]))


def test_leg_accounting_is_directional_and_public_proxy_only() -> None:
    bars = {
        exp.HOUR_MS: exp.Bar(exp.HOUR_MS, Decimal("100"), Decimal("100"), Decimal("10000000")),
        7 * exp.HOUR_MS: exp.Bar(
            7 * exp.HOUR_MS,
            Decimal("110"),
            Decimal("110"),
            Decimal("10000000"),
        ),
    }
    data = exp.SymbolData((), bars, {})
    net = exp.leg_net(
        data,
        position_sign=1,
        notional=Decimal("500"),
        entry_time_ms=exp.HOUR_MS,
        exit_time_ms=7 * exp.HOUR_MS,
        scenario=exp.CostScenario("none", exp.ZERO, exp.ZERO),
    )
    assert net == Decimal("50")


def test_missing_funding_mark_is_evidence_error() -> None:
    data = exp.SymbolData(
        (exp.FundingEvent(2 * exp.HOUR_MS, Decimal("1"), Decimal("0.001")),),
        {},
        {},
    )
    with pytest.raises(exp.EvidenceError, match="mark proxy missing"):
        exp.funding_cashflow(
            data,
            position_sign=1,
            quantity=exp.ONE,
            entry_time_ms=exp.HOUR_MS,
            exit_time_ms=3 * exp.HOUR_MS,
        )


def test_valid_negative_is_no_go_not_unmeasured() -> None:
    result = exp.terminal_result(
        freeze_sha256="f" * 64,
        manifest_sha256="m" * 64,
        development={"evidenceComplete": True, "economicGatesPassed": False},
        failure=None,
        failure_phase=None,
    )
    assert result["measurementVerdict"] == "NO_GO"
    assert result["publicProxyVerdict"] == "VALID_NEGATIVE"
    assert result["holdoutOpened"] is False


def test_sample_or_integrity_incomplete_is_unmeasured() -> None:
    result = exp.terminal_result(
        freeze_sha256="f" * 64,
        manifest_sha256="m" * 64,
        development={"evidenceComplete": False, "economicGatesPassed": False},
        failure=None,
        failure_phase=None,
    )
    assert result["measurementVerdict"] == "UNMEASURED"
    assert result["publicProxyVerdict"] == "INVALID_OR_INCOMPLETE"


def test_dry_synthetic_one_run_seals_and_never_opens_holdout_on_dev_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        exp,
        "verify_freeze",
        lambda _root: {"_sha256": "f" * 64},
    )
    monkeypatch.setattr(
        exp,
        "verify_manifest",
        lambda _root, **_kwargs: ({}, "a" * 64),
    )
    monkeypatch.setattr(exp, "load_partition_data", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(
        exp,
        "evaluate_development",
        lambda *_args, **_kwargs: {
            "evidenceComplete": False,
            "economicGatesPassed": False,
            "developmentPassed": False,
            "championTrialId": None,
        },
    )

    result = exp.run_development(tmp_path)

    assert result["measurementVerdict"] == "UNMEASURED"
    assert result["holdoutOpened"] is False
    assert (tmp_path / "RUN_STARTED.json").is_file()
    assert (tmp_path / "result.candidate.json").is_file()
    assert not (tmp_path / "candidate-seal.v1.json").exists()
    assert not (tmp_path / "HOLDOUT_ACQUISITION_AUTHORIZED.json").exists()
    assert not (tmp_path / "HOLDOUT_OPEN_STARTED.json").exists()
    with pytest.raises(exp.EvidenceError, match="one-run"):
        exp.run_development(tmp_path)


def test_freeze_and_result_have_explicit_sealing_transitions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    state_root = tmp_path / "state"
    state_root.mkdir()
    tracked_input = tmp_path / "input.txt"
    tracked_input.write_text("frozen\n")
    discovery = {
        "archiveBodiesOpened": False,
        "symbolCount": 523,
    }
    discovery_raw = exp.canonical_bytes(discovery)
    exp.exclusive_write(state_root / "discovery.v1.json", discovery_raw)
    freeze_candidate = {
        "schema": "cosmos.quant.research.s1n.freeze.v1",
        "canonicalBaseCommit": "a169b123fb186d1943a75ad648552c4d95be1be1",
        "worktreeHeadAtFreeze": "a169b123fb186d1943a75ad648552c4d95be1be1",
        "discoverySha256": exp.sha256_bytes(discovery_raw),
        "trackedInputSha256": {"input.txt": exp.sha256_file(tracked_input)},
    }
    exp.exclusive_write(
        state_root / "freeze.candidate.json",
        exp.canonical_bytes(freeze_candidate),
    )
    freeze_path = tmp_path / "repo" / "freeze.v1.json"
    monkeypatch.setattr(exp, "FREEZE_PATH", freeze_path)
    monkeypatch.setattr(exp, "tracked_inputs", lambda: {"input.txt": tracked_input})
    sealed_freeze = exp.seal_freeze(state_root)
    assert sealed_freeze["sealed"] is True
    assert freeze_path.is_file()

    manifest_raw = exp.canonical_bytes({"sources": []})
    exp.exclusive_write(state_root / "archive-manifest.v1.json", manifest_raw)
    run_marker = {"evaluatorSha256": exp.sha256_file(Path(str(exp.__file__)).resolve())}
    run_marker_raw = exp.canonical_bytes(run_marker)
    exp.exclusive_write(state_root / "RUN_STARTED.json", run_marker_raw)
    result_candidate = {
        "schema": "cosmos.quant.research.s1n.result.v1",
        "freezeSha256": sealed_freeze["freezeSha256"],
        "manifestSha256": exp.sha256_bytes(manifest_raw),
        "evaluatorSha256": run_marker["evaluatorSha256"],
        "runMarkerSha256": exp.sha256_bytes(run_marker_raw),
        "measurementVerdict": "NO_GO",
        "capitalVerdict": "NO_GO",
        "executionAuthority": "NONE",
        "runCountConsumed": 1,
        "holdoutOpened": False,
    }
    exp.exclusive_write(
        state_root / "result.candidate.json",
        exp.canonical_bytes(result_candidate),
    )
    result_path = tmp_path / "repo" / "result.v1.json"
    monkeypatch.setattr(exp, "RESULT_PATH", result_path)
    monkeypatch.setattr(
        exp,
        "verify_freeze",
        lambda _root: {"_sha256": sealed_freeze["freezeSha256"]},
    )
    monkeypatch.setattr(
        exp,
        "verify_manifest",
        lambda _root, **_kwargs: ({}, exp.sha256_bytes(manifest_raw)),
    )
    sealed_result = exp.seal_result(state_root)
    assert sealed_result["sealed"] is True
    assert sealed_result["measurementVerdict"] == "NO_GO"
    assert result_path.is_file()


def test_holdout_finalization_refuses_mixed_development_bindings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    evaluator_sha = exp.sha256_file(Path(str(exp.__file__)).resolve())
    manifest_raw = exp.canonical_bytes({"schema": "manifest"})
    exp.exclusive_write(tmp_path / "archive-manifest.v1.json", manifest_raw)
    run_marker = {
        "freezeSha256": "f" * 64,
        "manifestSha256": exp.sha256_bytes(manifest_raw),
        "evaluatorSha256": evaluator_sha,
    }
    run_marker_raw = exp.canonical_bytes(run_marker)
    exp.exclusive_write(tmp_path / "RUN_STARTED.json", run_marker_raw)
    candidate = {
        "developmentPassed": True,
        "freezeSha256": "f" * 64,
        "manifestSha256": "0" * 64,
        "evaluatorSha256": evaluator_sha,
        "runMarkerSha256": exp.sha256_bytes(run_marker_raw),
    }
    candidate_raw = exp.canonical_bytes(candidate)
    exp.exclusive_write(tmp_path / "candidate-seal.v1.json", candidate_raw)
    exp.exclusive_write(
        tmp_path / "HOLDOUT_ACQUISITION_AUTHORIZED.json",
        exp.canonical_bytes(
            {
                "candidateSealSha256": exp.sha256_bytes(candidate_raw),
                "manifestSha256": "0" * 64,
            }
        ),
    )
    monkeypatch.setattr(exp, "verify_freeze", lambda _root: {"_sha256": "f" * 64})
    monkeypatch.setattr(
        exp,
        "verify_holdout_manifest",
        lambda _root: ({}, "h" * 64),
    )
    with pytest.raises(exp.EvidenceError, match="bindings invalid"):
        exp.finalize_holdout(tmp_path)
    assert not (tmp_path / "HOLDOUT_OPEN_STARTED.json").exists()


def test_holdout_acquisition_refuses_evaluator_drift_before_fetch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run_marker = {
        "freezeSha256": "f" * 64,
        "manifestSha256": "m" * 64,
        "evaluatorSha256": "0" * 64,
        "runCount": 1,
    }
    run_marker_raw = exp.canonical_bytes(run_marker)
    exp.exclusive_write(tmp_path / "RUN_STARTED.json", run_marker_raw)
    candidate = {
        "developmentPassed": True,
        "freezeSha256": "f" * 64,
        "manifestSha256": "m" * 64,
        "evaluatorSha256": "0" * 64,
        "runMarkerSha256": exp.sha256_bytes(run_marker_raw),
    }
    candidate_raw = exp.canonical_bytes(candidate)
    exp.exclusive_write(tmp_path / "candidate-seal.v1.json", candidate_raw)
    exp.exclusive_write(
        tmp_path / "HOLDOUT_ACQUISITION_AUTHORIZED.json",
        exp.canonical_bytes(
            {
                "candidateSealSha256": exp.sha256_bytes(candidate_raw),
                "manifestSha256": "m" * 64,
            }
        ),
    )
    monkeypatch.setattr(exp, "verify_freeze", lambda _root: {"_sha256": "f" * 64})
    monkeypatch.setattr(
        exp,
        "verify_manifest",
        lambda _root, **_kwargs: ({"sources": []}, "m" * 64),
    )
    fetch_calls = 0

    def forbidden_fetch(_url: str) -> bytes:
        nonlocal fetch_calls
        fetch_calls += 1
        raise AssertionError("fetch must not run after evaluator drift")

    with pytest.raises(exp.EvidenceError, match="bindings invalid"):
        exp.acquire_holdout(tmp_path, forbidden_fetch)
    assert fetch_calls == 0
    assert not (tmp_path / "holdout-manifest.v1.json").exists()


def test_successful_holdout_lifecycle_can_seal_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    evaluator_sha = exp.sha256_file(Path(str(exp.__file__)).resolve())
    manifest_raw = exp.canonical_bytes({"schema": "manifest"})
    manifest_sha = exp.sha256_bytes(manifest_raw)
    exp.exclusive_write(tmp_path / "archive-manifest.v1.json", manifest_raw)
    run_marker = {
        "freezeSha256": "f" * 64,
        "manifestSha256": manifest_sha,
        "evaluatorSha256": evaluator_sha,
    }
    run_marker_raw = exp.canonical_bytes(run_marker)
    exp.exclusive_write(tmp_path / "RUN_STARTED.json", run_marker_raw)
    candidate = {
        "developmentPassed": True,
        "freezeSha256": "f" * 64,
        "manifestSha256": manifest_sha,
        "evaluatorSha256": evaluator_sha,
        "runMarkerSha256": exp.sha256_bytes(run_marker_raw),
        "championTrialId": "L72_D175_H12",
        "development": {"developmentPassed": True},
    }
    candidate_raw = exp.canonical_bytes(candidate)
    exp.exclusive_write(tmp_path / "candidate-seal.v1.json", candidate_raw)
    exp.exclusive_write(
        tmp_path / "HOLDOUT_ACQUISITION_AUTHORIZED.json",
        exp.canonical_bytes(
            {
                "candidateSealSha256": exp.sha256_bytes(candidate_raw),
                "manifestSha256": manifest_sha,
            }
        ),
    )
    monkeypatch.setattr(exp, "verify_freeze", lambda _root: {"_sha256": "f" * 64})
    monkeypatch.setattr(
        exp,
        "verify_holdout_manifest",
        lambda _root: ({}, "h" * 64),
    )
    monkeypatch.setattr(exp, "load_partition_data", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(
        exp,
        "evaluate_holdout",
        lambda *_args, **_kwargs: {
            "evidenceComplete": True,
            "economicGatesPassed": False,
        },
    )
    result = exp.finalize_holdout(tmp_path)
    assert result["measurementVerdict"] == "NO_GO"
    assert result["evaluatorSha256"] == evaluator_sha
    assert result["runMarkerSha256"] == exp.sha256_bytes(run_marker_raw)

    result_path = tmp_path / "repo" / "result.v1.json"
    monkeypatch.setattr(exp, "RESULT_PATH", result_path)
    monkeypatch.setattr(
        exp,
        "verify_manifest",
        lambda _root, **_kwargs: ({}, manifest_sha),
    )
    sealed = exp.seal_result(tmp_path)
    assert sealed["sealed"] is True
    assert sealed["measurementVerdict"] == "NO_GO"
    assert result_path.is_file()


def test_holdout_manifest_must_equal_predeclared_cartesian(tmp_path: Path) -> None:
    frozen_rows = []
    for symbol in (f"S{index:02d}USDT" for index in range(30)):
        for month in ("2026-04", "2026-05", "2026-06"):
            for dataset in ("fundingRate", "klines_1h", "markPriceKlines_1h"):
                key = f"{symbol}/{month}/{dataset}.zip"
                frozen_rows.append(
                    {
                        "symbol": symbol,
                        "month": month,
                        "dataset": dataset,
                        "key": key,
                        "url": f"https://example.invalid/{key}",
                        "checksumUrl": f"https://example.invalid/{key}.CHECKSUM",
                        "expectedSha256": "a" * 64,
                        "sidecarSha256": "b" * 64,
                        "bodyState": "HOLDOUT_NOT_FETCHED",
                    }
                )
    development_manifest_raw = exp.canonical_bytes({"sources": frozen_rows})
    exp.exclusive_write(
        tmp_path / "archive-manifest.v1.json",
        development_manifest_raw,
    )
    candidate = {
        "manifestSha256": exp.sha256_bytes(development_manifest_raw),
        "developmentPassed": True,
    }
    candidate_raw = exp.canonical_bytes(candidate)
    exp.exclusive_write(tmp_path / "candidate-seal.v1.json", candidate_raw)
    authorization = {
        "candidateSealSha256": exp.sha256_bytes(candidate_raw),
        "manifestSha256": candidate["manifestSha256"],
    }
    authorization_raw = exp.canonical_bytes(authorization)
    exp.exclusive_write(
        tmp_path / "HOLDOUT_ACQUISITION_AUTHORIZED.json",
        authorization_raw,
    )
    observed_rows = [
        {
            **row,
            "observedSha256": row["expectedSha256"],
            "bodyState": "CHECKSUM_VERIFIED_AFTER_DEVELOPMENT_PASS",
        }
        for row in frozen_rows
    ]
    observed_rows[0]["url"] = "https://example.invalid/replaced.zip"
    holdout_manifest = {
        "schema": "cosmos.quant.research.s1n.holdout-acquisition.v1",
        "authorizationSha256": exp.sha256_bytes(authorization_raw),
        "candidateSealSha256": exp.sha256_bytes(candidate_raw),
        "sourceCount": 270,
        "sources": observed_rows,
        "archiveBodiesOpened": False,
    }
    holdout_manifest["holdoutManifestSha256"] = exp.sha256_bytes(
        exp.canonical_bytes(holdout_manifest)
    )
    exp.exclusive_write(
        tmp_path / "holdout-manifest.v1.json",
        exp.canonical_bytes(holdout_manifest),
    )
    with pytest.raises(exp.EvidenceError, match="predeclared Cartesian"):
        exp.verify_holdout_manifest(tmp_path)


def test_exclusive_write_never_overwrites(tmp_path: Path) -> None:
    path = tmp_path / "seal.json"
    exp.exclusive_write(path, b"first")
    with pytest.raises(FileExistsError):
        exp.exclusive_write(path, b"second")
    assert path.read_bytes() == b"first"


def test_cli_help_is_network_free() -> None:
    with pytest.raises(SystemExit) as raised:
        exp.parser().parse_args(["--help"])
    assert raised.value.code == 0
