"""Focused network-free proofs for the S-1P experiment.

These tests never instantiate ``zipfile.ZipFile`` and never read a shared
archive member or sibling S-1H/V-G9 outcome artifact.
"""

from __future__ import annotations

import ast
import copy
import json
import os
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from typing import Any
from unittest import mock

import pytest
from research.s1p import experiment as subject


def make_bar(index: int, quote_volume: str = "20000000") -> subject.Bar:
    price = Decimal("100")
    return subject.Bar(
        ts_ms=index * subject.FIVE_MINUTES_MS,
        open=price,
        high=price,
        low=price,
        close=price,
        quote_volume=Decimal(quote_volume),
    )


def make_point(
    index: int,
    *,
    relative_volume: str = "0",
    raw_basis: str = "0",
    basis_location: str = "0",
    basis_scale: str = "1",
    basis_z: str | None = None,
) -> subject.CalibrationPoint:
    raw = Decimal(raw_basis)
    location = Decimal(basis_location)
    scale = Decimal(basis_scale)
    z = (raw - location) / scale if basis_z is None else Decimal(basis_z)
    return subject.CalibrationPoint(
        ts_ms=index * subject.FIVE_MINUTES_MS,
        raw_basis_bps=raw,
        basis_location=location,
        basis_scale=scale,
        basis_z=z,
        spot_volume_location=Decimal("1"),
        spot_volume_scale=Decimal("1"),
        perpetual_volume_location=Decimal("1"),
        perpetual_volume_scale=Decimal("1"),
        relative_volume_intensity_z=Decimal(relative_volume),
    )


def make_phase(length: int, symbols: tuple[str, ...] = ("BTCUSDT",)) -> subject.PhaseData:
    bars = {}
    for symbol in symbols:
        series = tuple(make_bar(index) for index in range(length))
        bars[symbol] = {
            "spotKlines": series,
            "perpetualKlines": series,
            "markPriceKlines": series,
        }
    return subject.PhaseData(
        phase="development",
        start_ms=0,
        end_ms=length * subject.FIVE_MINUTES_MS,
        bars=bars,
        funding=dict.fromkeys(symbols, ()),
    )


def protocol_for_tests() -> dict[str, Any]:
    return copy.deepcopy(json.loads(subject.PROTOCOL_PATH.read_text(encoding="utf-8")))


def empty_simulation_result(
    trial: subject.Trial,
    phase: str,
    start_ms: int,
    end_ms: int,
    protocol: dict[str, Any],
) -> subject.SimulationResult:
    dates = subject.expected_daily_dates(start_ms, end_ms)
    zero_row = tuple(Decimal("0") for _ in dates)
    capital = Decimal(protocol["trials"]["portfolioCapitalUsd"])
    return subject.SimulationResult(
        trial=trial,
        phase=phase,
        trades=(),
        daily_net_by_cost={
            "base": zero_row,
            "stress": zero_row,
            "severe": zero_row,
        },
        daily_dates=dates,
        severe_equity_curve_usd=(capital,),
        maximum_severe_drawdown_pct=Decimal("0"),
    )


def redigest(document: dict[str, Any]) -> dict[str, Any]:
    unsigned = copy.deepcopy(document)
    unsigned.pop("artifactSha256", None)
    return subject.with_artifact_digest(unsigned)


def write_development_failure_lifecycle(
    state: Path,
    protocol: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    pre_freeze = subject.with_artifact_digest(
        {
            "schema": "S1PPreOutcomeFreezeCandidateV1",
            "protocolId": protocol["protocolId"],
            "vg9Comparison": {"status": "DISTINCT_CLEAR_TO_EVALUATE"},
        }
    )
    subject.exclusive_write_json(state / subject.PRE_FREEZE_NAME, pre_freeze)
    pre_sha = subject.sha256_file(state / subject.PRE_FREEZE_NAME)
    anchor = "a" * 40
    preserved_ref = "refs/tags/s1p-pre-outcome-test"
    git_proof = {
        "schema": "S1PPreOutcomeGitAnchorProofV1",
        "anchorCommit": anchor,
        "preservedRef": preserved_ref,
        "canonicalParent": protocol["canonicalBaseCommit"],
        "originUrl": subject.EXPECTED_ORIGIN_URL,
        "anchorTreeBindings": {},
        "committedFreezeFileSha256": pre_sha,
        "worktreeClean": True,
        "anchorWasCurrentHead": True,
        "currentHeadAtVerification": anchor,
        "networkUsed": False,
    }
    run_marker = subject.with_artifact_digest(
        {
            "schema": "S1PRunConsumedV1",
            "protocolId": protocol["protocolId"],
            "preOutcomeGitAnchor": anchor,
            "preOutcomeGitRef": preserved_ref,
            "gitAnchorProof": git_proof,
            "preOutcomeFreezeFileSha256": pre_sha,
            "committedFreezeFileSha256": pre_sha,
            "archiveContentOpenRunOrdinal": 1,
            "developmentBodiesMayOpen": True,
            "holdoutBodiesMayOpen": False,
            "secondRunRefused": True,
        }
    )
    subject.exclusive_write_json(state / subject.RUN_MARKER_NAME, run_marker)
    development_start = subject.parse_utc_ms(protocol["calendar"]["development"]["startInclusive"])
    development_end = subject.parse_utc_ms(protocol["calendar"]["development"]["endExclusive"])
    trials = subject.trials_from_protocol(protocol)
    development_results = tuple(
        empty_simulation_result(
            trial,
            "development",
            development_start,
            development_end,
            protocol,
        )
        for trial in trials
    )
    family_stats = subject.synchronous_bootstrap(development_results, protocol)
    pbo = subject.calculate_pbo(development_results, protocol)
    fold_results: dict[str, list[subject.SimulationResult]] = {
        trial.trial_id: [] for trial in trials
    }
    fold_documents: dict[str, list[dict[str, Any]]] = {trial.trial_id: [] for trial in trials}
    for fold_number, fold in enumerate(protocol["calendar"]["walkForward"], start=1):
        fold_start = subject.parse_utc_ms(fold["forwardStart"])
        fold_end = subject.parse_utc_ms(fold["forwardEnd"])
        for trial in trials:
            simulation = empty_simulation_result(
                trial,
                f"walk_forward_{fold_number}",
                fold_start,
                fold_end,
                protocol,
            )
            fold_results[trial.trial_id].append(simulation)
            fold_documents[trial.trial_id].append(
                {
                    "foldNumber": fold_number,
                    "trainStart": fold["trainStart"],
                    "trainEnd": fold["trainEnd"],
                    "forwardStart": fold["forwardStart"],
                    "forwardEnd": fold["forwardEnd"],
                    "simulation": subject.simulation_document(simulation),
                }
            )
    gates = {
        result.trial.trial_id: subject.development_gate(
            result,
            tuple(
                subject.cost_total(fold, "stress") for fold in fold_results[result.trial.trial_id]
            ),
            family_stats,
            pbo,
            protocol,
        )
        for result in development_results
    }
    champion = sorted(
        development_results,
        key=lambda result: (
            -family_stats["lowerBounds"][result.trial.trial_id],
            -subject.cost_total(result, "stress"),
            result.trial.trial_id,
        ),
    )[0]
    development = subject.with_artifact_digest(
        {
            "schema": "S1PDevelopmentResultV1",
            "protocolId": protocol["protocolId"],
            "runMarkerFileSha256": subject.sha256_file(state / subject.RUN_MARKER_NAME),
            "archivePhaseOpened": "DEVELOPMENT_ONLY",
            "family": [subject.simulation_document(result) for result in development_results],
            "walkForward": fold_documents,
            "statistics": subject.family_stats_document(family_stats, pbo),
            "gates": gates,
            "selectedChampionTrialId": champion.trial.trial_id,
            "selectionLaw": protocol["trials"]["championSelection"],
        }
    )
    subject.exclusive_write_json(state / subject.DEVELOPMENT_RESULT_NAME, development)
    result = subject.terminal_result_document(
        protocol,
        state,
        "NO_GO",
        "VALID_MEASURED_DEVELOPMENT_GATE_FAILURE",
        "UNOPENED",
        {
            "code": "DEVELOPMENT_CHAMPION_GATE_FAILED",
            "detail": champion.trial.trial_id,
        },
        {
            "developmentChampionTrialId": champion.trial.trial_id,
            "developmentGate": gates[champion.trial.trial_id],
        },
    )
    subject.exclusive_write_json(state / subject.RESULT_NAME, result)
    return pre_freeze, development, result


class FrozenContractTests(unittest.TestCase):
    def test_implementation_has_no_network_import(self) -> None:
        tree = ast.parse(Path(subject.__file__).read_text(encoding="utf-8"))
        imported: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
        assert {"socket", "urllib", "http", "requests", "aiohttp"}.isdisjoint(imported)

    def test_vg9_distinct_protocol_requires_machine_readable_exclusions(self) -> None:
        clear: dict[str, Any] = {
            "schema": "VG9SpotUsdMVolumeShareLeadershipProtocolV1",
            "protocolId": "vg9-test",
            "distinctness": {
                "family": "CROSS_VENUE_SHARE_TO_SPOT_RETURN",
                "forbiddenSignalInputs": ["BASIS"],
                "notS1P": ("NO_OWN_SYMBOL_TEMPORAL_SEQUENCE_NO_BASIS_EVENT_NO_PAIRED_TRADE"),
            },
            "portfolio": {"spotSide": "LONG", "usdMPosition": "NONE_SIGNAL_ONLY"},
        }
        assert subject.validate_vg9_distinctness(clear) == "DISTINCT_CLEAR_TO_EVALUATE"
        collision = copy.deepcopy(clear)
        collision["distinctness"]["family"] = (
            "LATER_OWN_SYMBOL_BASIS_CROSS_LONG_SPOT_SHORT_USD_M_PERPETUAL_BASIS_REVERSION"
        )
        collision["distinctness"]["forbiddenSignalInputs"] = []
        collision["distinctness"]["notS1P"] = "COLLIDING_PAIRED_BASIS_TRADE"
        assert subject.validate_vg9_distinctness(collision) == "COLLISION_STOP_UNMEASURED"
        incomplete = copy.deepcopy(clear)
        incomplete["distinctness"]["forbiddenSignalInputs"] = []
        with pytest.raises(subject.ContractError, match="VG9_BASIS_FORBIDDANCE_NOT_PROVEN"):
            subject.validate_vg9_distinctness(incomplete)

    def test_discovery_requires_exact_96_row_cartesian_product(self) -> None:
        protocol = protocol_for_tests()
        rows = []
        development = set(protocol["calendar"]["development"]["months"])
        for kind, symbol, month in sorted(subject.expected_discovery_keys(protocol)):
            rows.append(
                {
                    "kind": kind,
                    "symbol": symbol,
                    "month": month,
                    "phase": "development" if month in development else "holdout",
                    "sha256": "a" * 64,
                }
            )
        discovery = {
            "archiveBodiesOpened": False,
            "sources": rows,
        }
        indexed = subject.validate_discovery(discovery, protocol)
        assert len(indexed) == 96
        discovery["sources"] = rows[:-1]
        with pytest.raises(subject.DataValidationError, match="DISCOVERY_COUNT_INVALID"):
            subject.validate_discovery(discovery, protocol)

    def test_git_subprocess_uses_fixed_environment_under_hostile_inheritance(self) -> None:
        hostile = {
            "GIT_DIR": "/tmp/attacker-repository",
            "GIT_WORK_TREE": "/tmp/attacker-worktree",
            "GIT_OBJECT_DIRECTORY": "/tmp/attacker-objects",
            "GIT_CONFIG_COUNT": "2",
            "GIT_CONFIG_KEY_0": "core.pager",
            "GIT_CONFIG_VALUE_0": "attacker-pager",
            "GIT_CONFIG_KEY_1": "url.file:///tmp/.insteadOf",
            "GIT_CONFIG_VALUE_1": "https://",
            "HOME": "/tmp/attacker-home",
        }
        completed = mock.Mock(returncode=0, stdout=b"ok\n", stderr=b"")
        with (
            mock.patch.dict(os.environ, hostile, clear=False),
            mock.patch(
                "research.s1p.experiment.subprocess.run",
                return_value=completed,
            ) as run,
        ):
            assert subject.git_bytes(Path("/tmp/repository"), ("status", "--porcelain")) == b"ok\n"
        environment = run.call_args.kwargs["env"]
        assert environment == {
            "PATH": "/usr/bin:/bin",
            "LANG": "C",
            "LC_ALL": "C",
            "GIT_ATTR_NOSYSTEM": "1",
            "GIT_CONFIG_COUNT": "0",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_SYSTEM": os.devnull,
            "GIT_NO_REPLACE_OBJECTS": "1",
            "GIT_OPTIONAL_LOCKS": "0",
            "GIT_PAGER": "cat",
            "GIT_TERMINAL_PROMPT": "0",
        }

    def test_spot_microseconds_and_usdm_milliseconds_are_enforced(self) -> None:
        assert subject.normalize_open_time("1751328000000000", "spotKlines") == 1751328000000
        assert subject.normalize_open_time("1751328000000", "perpetualKlines") == 1751328000000
        with pytest.raises(subject.DataValidationError, match="SPOT_TIMESTAMP_NOT_MICROSECONDS"):
            subject.normalize_open_time("1751328000000", "spotKlines")
        with pytest.raises(subject.DataValidationError, match="USD_M_TIMESTAMP_NOT_MILLISECONDS"):
            subject.normalize_open_time("1751328000000000", "perpetualKlines")

    def test_kline_parser_rejects_nonpositive_price_and_duplicate_time(self) -> None:
        valid = "1751328000000000,100,100,100,100,1,1751328299999999,20000000,1,1,1,0\n"
        bars = subject.parse_kline_csv(
            valid,
            "spotKlines",
            1_751_328_000_000,
            1_751_328_300_000,
        )
        assert len(bars) == 1
        invalid = valid.replace(",100,100,100,100,", ",0,100,0,100,")
        with pytest.raises(subject.DataValidationError, match="KLINE_PRICE_NONPOSITIVE"):
            subject.parse_kline_csv(
                invalid,
                "spotKlines",
                1_751_328_000_000,
                1_751_328_300_000,
            )
        with pytest.raises(subject.DataValidationError, match="KLINE_TIMESTAMP_DUPLICATE"):
            subject.parse_kline_csv(
                valid + valid,
                "spotKlines",
                1_751_328_000_000,
                1_751_328_300_000,
            )

    def test_funding_parser_requires_exact_nonempty_archive_schema(self) -> None:
        start = 1_751_328_000_000
        valid = f"calc_time,funding_interval_hours,last_funding_rate\n{start},8,0.0001\n"
        parsed = subject.parse_funding_csv(valid, start, start + subject.HOUR_MS)
        assert parsed == (subject.Funding(start, 8, Decimal("0.0001")),)
        with pytest.raises(subject.DataValidationError, match="FUNDING_HEADER_INVALID"):
            subject.parse_funding_csv(
                f"{start},8,0.0001\n",
                start,
                start + subject.HOUR_MS,
            )
        with pytest.raises(subject.DataValidationError, match="FUNDING_EMPTY"):
            subject.parse_funding_csv(
                "calc_time,funding_interval_hours,last_funding_rate\n",
                start,
                start + subject.HOUR_MS,
            )

    def test_funding_coverage_rejects_silent_month_gap(self) -> None:
        start = 1_751_328_000_000
        rows = (
            subject.Funding(start, 8, Decimal("0.0001")),
            subject.Funding(start + 16 * subject.HOUR_MS, 8, Decimal("0.0001")),
        )
        with pytest.raises(subject.DataValidationError, match="FUNDING_INTERNAL_COVERAGE_GAP"):
            subject.validate_funding_coverage(
                rows,
                start,
                start + 24 * subject.HOUR_MS,
                "BTCUSDT/test",
            )
        transition_rows = (
            subject.Funding(start, 24, Decimal("0.0001")),
            subject.Funding(start + 16 * subject.HOUR_MS, 8, Decimal("0.0001")),
        )
        with pytest.raises(
            subject.DataValidationError,
            match="FUNDING_INTERVAL_TRANSITION_UNSUPPORTED",
        ):
            subject.validate_funding_coverage(
                transition_rows,
                start,
                start + 24 * subject.HOUR_MS,
                "BTCUSDT/transition",
            )

    def test_concatenated_month_funding_rejects_boundary_gap_and_transition(self) -> None:
        boundary = 1_751_414_400_000
        prior_month = tuple(
            subject.Funding(
                boundary - offset * subject.HOUR_MS,
                8,
                Decimal("0.0001"),
            )
            for offset in (24, 16, 8)
        )
        next_month = tuple(
            subject.Funding(
                boundary + offset * subject.HOUR_MS,
                8,
                Decimal("0.0001"),
            )
            for offset in (8, 16)
        )
        subject.validate_funding_coverage(
            prior_month,
            boundary - 24 * subject.HOUR_MS,
            boundary,
            "BTCUSDT/month-1",
        )
        subject.validate_funding_coverage(
            next_month,
            boundary,
            boundary + 24 * subject.HOUR_MS,
            "BTCUSDT/month-2",
        )
        with pytest.raises(subject.DataValidationError, match="FUNDING_INTERNAL_COVERAGE_GAP"):
            subject.validate_funding_coverage(
                prior_month + next_month,
                boundary - 24 * subject.HOUR_MS,
                boundary + 24 * subject.HOUR_MS,
                "BTCUSDT/concatenated-gap",
            )
        next_month_transition = tuple(
            subject.Funding(
                boundary + offset * subject.HOUR_MS,
                4,
                Decimal("0.0001"),
            )
            for offset in (4, 8, 12, 16, 20)
        )
        subject.validate_funding_coverage(
            next_month_transition,
            boundary,
            boundary + 24 * subject.HOUR_MS,
            "BTCUSDT/month-2-transition",
        )
        with pytest.raises(
            subject.DataValidationError,
            match="FUNDING_INTERVAL_TRANSITION_UNSUPPORTED",
        ):
            subject.validate_funding_coverage(
                prior_month + next_month_transition,
                boundary - 24 * subject.HOUR_MS,
                boundary + 24 * subject.HOUR_MS,
                "BTCUSDT/concatenated-transition",
            )

    def test_calibration_excludes_current_day_and_uses_scale_floors(self) -> None:
        count = 29 * subject.DAY_BARS
        spot = tuple(make_bar(index, "100") for index in range(count))
        perpetual_rows = [make_bar(index, "100") for index in range(count)]
        current_day_start = 28 * subject.DAY_BARS
        perpetual_rows[current_day_start] = make_bar(current_day_start, "1000000")
        points = subject.build_calibration_points(spot, tuple(perpetual_rows))
        assert points[current_day_start - 1] is None
        first = points[current_day_start]
        assert first is not None
        assert first.basis_scale == Decimal("1")
        assert first.spot_volume_scale == Decimal("0.05")
        assert first.perpetual_volume_scale == Decimal("0.05")
        assert first.relative_volume_intensity_z > Decimal("0")


class LifecycleTests(unittest.TestCase):
    def test_terminal_report_authenticates_without_archive_access(self) -> None:
        protocol, _sources, hashes = subject.load_frozen_bundle()
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            pre_freeze = subject.with_artifact_digest(
                {
                    "schema": "S1PPreOutcomeFreezeCandidateV1",
                    "protocolId": protocol["protocolId"],
                    "trackedInputs": {
                        **hashes,
                        "distinctnessSha256": subject.sha256_file(subject.DISTINCTNESS_PATH),
                        "discoverySha256": protocol["data"]["sharedDiscoverySha256"],
                        "vg9ProtocolSha256AtFreeze": "a" * 64,
                    },
                    "vg9Comparison": {
                        "status": "COLLISION_STOP_UNMEASURED",
                    },
                    "archiveBindings": [{} for _ in range(96)],
                }
            )
            subject.exclusive_write_json(state / subject.PRE_FREEZE_NAME, pre_freeze)
            git_proof = {
                "schema": "S1PPreOutcomeGitAnchorProofV1",
                "anchorCommit": "a" * 40,
                "preservedRef": "refs/tags/s1p-pre-outcome-test",
                "canonicalParent": protocol["canonicalBaseCommit"],
                "originUrl": subject.EXPECTED_ORIGIN_URL,
                "anchorTreeBindings": {},
                "committedFreezeFileSha256": subject.sha256_file(state / subject.PRE_FREEZE_NAME),
                "worktreeClean": True,
                "anchorWasCurrentHead": True,
                "currentHeadAtVerification": "a" * 40,
                "networkUsed": False,
            }
            result = subject.terminal_result_document(
                protocol,
                state,
                "UNMEASURED",
                "VALID_PRE_RUN_COLLISION_STOP",
                "UNOPENED",
                {"code": "VG9_COLLISION", "detail": "no archive open"},
                {
                    "preOutcomeGitAnchor": "a" * 40,
                    "preOutcomeGitRef": "refs/tags/s1p-pre-outcome-test",
                    "gitAnchorProof": git_proof,
                },
            )
            subject.exclusive_write_json(state / subject.RESULT_NAME, result)
            with mock.patch.object(
                subject,
                "verify_pre_freeze",
                return_value=pre_freeze,
            ):
                authentication = subject.authenticate_report(
                    state,
                    require_committed_packet=False,
                )
            assert authentication["status"] == "AUTHENTIC"
            assert not authentication["archiveBodiesOpenedDuringAuthentication"]

    def test_incomplete_noncollision_lifecycle_is_not_authentic(self) -> None:
        protocol, _sources, _hashes = subject.load_frozen_bundle()
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            pre_freeze = subject.with_artifact_digest(
                {
                    "schema": "S1PPreOutcomeFreezeCandidateV1",
                    "protocolId": protocol["protocolId"],
                    "vg9Comparison": {"status": "DISTINCT_CLEAR_TO_EVALUATE"},
                }
            )
            subject.exclusive_write_json(state / subject.PRE_FREEZE_NAME, pre_freeze)
            git_proof = {
                "schema": "S1PPreOutcomeGitAnchorProofV1",
                "anchorCommit": "a" * 40,
                "preservedRef": "refs/tags/s1p-pre-outcome-test",
                "canonicalParent": protocol["canonicalBaseCommit"],
                "originUrl": subject.EXPECTED_ORIGIN_URL,
                "anchorTreeBindings": {},
                "committedFreezeFileSha256": subject.sha256_file(state / subject.PRE_FREEZE_NAME),
                "worktreeClean": True,
                "anchorWasCurrentHead": True,
                "currentHeadAtVerification": "a" * 40,
                "networkUsed": False,
            }
            result = subject.terminal_result_document(
                protocol,
                state,
                "UNMEASURED",
                "VALID_PRE_RUN_COLLISION_STOP",
                "UNOPENED",
                {"code": "VG9_COLLISION", "detail": "fabricated"},
                {
                    "preOutcomeGitAnchor": "a" * 40,
                    "preOutcomeGitRef": "refs/tags/s1p-pre-outcome-test",
                    "gitAnchorProof": git_proof,
                },
            )
            subject.exclusive_write_json(state / subject.RESULT_NAME, result)
            with (
                mock.patch.object(
                    subject,
                    "verify_pre_freeze",
                    return_value=pre_freeze,
                ),
                pytest.raises(
                    subject.ContractError,
                    match="RESULT_LIFECYCLE_SEMANTICS_INVALID",
                ),
            ):
                subject.authenticate_report(
                    state,
                    require_committed_packet=False,
                )

    def test_unexpected_post_marker_error_seals_authentic_unmeasured(self) -> None:
        protocol, _sources, _hashes = subject.load_frozen_bundle()
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            state.mkdir()
            pre_freeze = subject.with_artifact_digest(
                {
                    "schema": "S1PPreOutcomeFreezeCandidateV1",
                    "protocolId": protocol["protocolId"],
                    "vg9Comparison": {"status": "DISTINCT_CLEAR_TO_EVALUATE"},
                }
            )
            subject.exclusive_write_json(state / subject.PRE_FREEZE_NAME, pre_freeze)
            committed_freeze = Path(directory) / "freeze.v1.json"
            subject.exclusive_write_json(committed_freeze, pre_freeze)
            with (
                mock.patch.object(subject, "COMMITTED_FREEZE_PATH", committed_freeze),
                mock.patch.object(
                    subject,
                    "verify_pre_freeze",
                    return_value=pre_freeze,
                ),
                mock.patch.object(
                    subject,
                    "verify_committed_freeze",
                    return_value=pre_freeze,
                ),
                mock.patch.object(
                    subject,
                    "load_phase_data",
                    side_effect=RuntimeError("forced post-marker failure"),
                ),
                mock.patch.object(
                    subject,
                    "verify_git_anchor",
                    return_value={
                        "schema": "S1PPreOutcomeGitAnchorProofV1",
                        "anchorCommit": "a" * 40,
                        "preservedRef": "refs/tags/s1p-pre-outcome-test",
                        "canonicalParent": protocol["canonicalBaseCommit"],
                        "originUrl": subject.EXPECTED_ORIGIN_URL,
                        "anchorTreeBindings": {},
                        "committedFreezeFileSha256": subject.sha256_file(
                            state / subject.PRE_FREEZE_NAME
                        ),
                        "worktreeClean": True,
                        "anchorWasCurrentHead": True,
                        "currentHeadAtVerification": "a" * 40,
                        "networkUsed": False,
                    },
                ),
            ):
                result = subject.run_experiment(
                    state,
                    "a" * 40,
                    "refs/tags/s1p-pre-outcome-test",
                )
                assert result["researchVerdict"] == "UNMEASURED"
                assert result["evidenceStatus"] == "INVALID_EVIDENCE_TERMINAL"
                assert result["reason"]["code"] == "UNEXPECTED_RUNTIMEERROR"
                authentication = subject.authenticate_report(
                    state,
                    require_committed_packet=False,
                )
                assert authentication["status"] == "AUTHENTIC"

    def test_run_marker_is_exclusive_and_precedes_body_permission(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            reader = subject.ArchiveReader(state, state / "archives")
            with pytest.raises(subject.ContractError, match="JSON_READ_FAILED"):
                reader._require_body_permission("development")
            pre_freeze = subject.with_artifact_digest(
                {
                    "schema": "S1PPreOutcomeFreezeCandidateV1",
                    "protocolId": "test",
                }
            )
            subject.exclusive_write_json(state / subject.PRE_FREEZE_NAME, pre_freeze)
            marker = subject.with_artifact_digest(
                {
                    "schema": "S1PRunConsumedV1",
                    "protocolId": "test",
                    "preOutcomeFreezeFileSha256": subject.sha256_file(
                        state / subject.PRE_FREEZE_NAME
                    ),
                }
            )
            subject.exclusive_write_json(state / subject.RUN_MARKER_NAME, marker)
            reader._require_body_permission("development")
            with pytest.raises(subject.ContractError, match="SECOND_WRITE_REFUSED"):
                subject.exclusive_write_json(state / subject.RUN_MARKER_NAME, marker)
            with pytest.raises(subject.ContractError, match="JSON_READ_FAILED"):
                reader._require_body_permission("holdout")
            development = subject.with_artifact_digest(
                {
                    "schema": "S1PDevelopmentResultV1",
                    "protocolId": "test",
                }
            )
            subject.exclusive_write_json(state / subject.DEVELOPMENT_RESULT_NAME, development)
            seal = subject.with_artifact_digest(
                {
                    "schema": "S1PDevelopmentChampionSealV1",
                    "protocolId": "test",
                    "developmentResultFileSha256": subject.sha256_file(
                        state / subject.DEVELOPMENT_RESULT_NAME
                    ),
                }
            )
            holdout = subject.with_artifact_digest(
                {
                    "schema": "S1PHoldoutOpenV1",
                    "protocolId": "test",
                    "championSealFileSha256": "",
                }
            )
            subject.exclusive_write_json(state / subject.CHAMPION_SEAL_NAME, seal)
            holdout["championSealFileSha256"] = subject.sha256_file(
                state / subject.CHAMPION_SEAL_NAME
            )
            unsigned_holdout = dict(holdout)
            del unsigned_holdout["artifactSha256"]
            holdout = subject.with_artifact_digest(unsigned_holdout)
            subject.exclusive_write_json(state / subject.HOLDOUT_MARKER_NAME, holdout)
            reader._require_body_permission("holdout")

    def test_artifact_tamper_is_detected(self) -> None:
        artifact = subject.with_artifact_digest({"schema": "ExampleV1", "value": 1})
        subject.verify_artifact(artifact, "ExampleV1")
        tampered = dict(artifact)
        tampered["value"] = 2
        with pytest.raises(subject.ContractError, match="ARTIFACT_DIGEST_MISMATCH"):
            subject.verify_artifact(tampered, "ExampleV1")

    def test_redigested_simulation_arithmetic_tamper_is_not_authentic(self) -> None:
        protocol = protocol_for_tests()
        protocol["statistics"]["bootstrap"]["replicates"] = 16
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            pre_freeze, development, result = write_development_failure_lifecycle(
                state,
                protocol,
            )
            tampered_development = copy.deepcopy(development)
            tampered_development["family"][0]["netUsd"]["stress"] = "1"
            tampered_development = redigest(tampered_development)
            (state / subject.DEVELOPMENT_RESULT_NAME).write_bytes(
                subject.canonical_bytes(tampered_development)
            )
            tampered_result = copy.deepcopy(result)
            tampered_result["artifactChainFileSha256"][subject.DEVELOPMENT_RESULT_NAME] = (
                subject.sha256_file(state / subject.DEVELOPMENT_RESULT_NAME)
            )
            tampered_result = redigest(tampered_result)
            (state / subject.RESULT_NAME).write_bytes(subject.canonical_bytes(tampered_result))
            with (
                mock.patch.object(
                    subject,
                    "load_frozen_bundle",
                    return_value=(protocol, {}, {}),
                ),
                mock.patch.object(
                    subject,
                    "verify_pre_freeze",
                    return_value=pre_freeze,
                ),
                pytest.raises(
                    subject.ContractError,
                    match="SIMULATION_NET_ARITHMETIC_INVALID",
                ),
            ):
                subject.authenticate_report(
                    state,
                    require_committed_packet=False,
                )

    def test_redigested_reported_fold_gate_tamper_is_not_authentic(self) -> None:
        protocol = protocol_for_tests()
        protocol["statistics"]["bootstrap"]["replicates"] = 16
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            pre_freeze, development, result = write_development_failure_lifecycle(
                state,
                protocol,
            )
            selected = development["selectedChampionTrialId"]
            tampered_development = copy.deepcopy(development)
            tampered_development["gates"][selected]["foldStressNetUsd"][0] = "1"
            tampered_development = redigest(tampered_development)
            (state / subject.DEVELOPMENT_RESULT_NAME).write_bytes(
                subject.canonical_bytes(tampered_development)
            )
            tampered_result = copy.deepcopy(result)
            tampered_result["artifactChainFileSha256"][subject.DEVELOPMENT_RESULT_NAME] = (
                subject.sha256_file(state / subject.DEVELOPMENT_RESULT_NAME)
            )
            tampered_result["developmentGate"] = tampered_development["gates"][selected]
            tampered_result = redigest(tampered_result)
            (state / subject.RESULT_NAME).write_bytes(subject.canonical_bytes(tampered_result))
            with (
                mock.patch.object(
                    subject,
                    "load_frozen_bundle",
                    return_value=(protocol, {}, {}),
                ),
                mock.patch.object(
                    subject,
                    "verify_pre_freeze",
                    return_value=pre_freeze,
                ),
                pytest.raises(
                    subject.ContractError,
                    match="DEVELOPMENT_GATE_RECOMPUTATION_INVALID",
                ),
            ):
                subject.authenticate_report(
                    state,
                    require_committed_packet=False,
                )

    def test_committed_packet_requires_exact_external_copies_and_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "state"
            state.mkdir()
            freeze = subject.with_artifact_digest(
                {
                    "schema": "S1PPreOutcomeFreezeCandidateV1",
                    "protocolId": "test",
                }
            )
            result = subject.with_artifact_digest(
                {
                    "schema": "S1PResultCandidateV1",
                    "protocolId": "test",
                }
            )
            subject.exclusive_write_json(state / subject.PRE_FREEZE_NAME, freeze)
            subject.exclusive_write_json(state / subject.RESULT_NAME, result)
            packet_names = (
                "README.md",
                "OFFICIAL_SOURCE_RESEARCH.md",
                "DISTINCTNESS.md",
                "protocol.v1.json",
                "official_sources.v1.json",
                "experiment.py",
                "test_experiment.py",
                "freeze.v1.json",
                "result.v1.json",
            )
            packet_paths = tuple(root / name for name in packet_names)
            for path in packet_paths[:-2]:
                path.write_text(path.name + "\n", encoding="utf-8")
            subject.exclusive_write_json(packet_paths[-2], freeze)
            subject.exclusive_write_json(packet_paths[-1], result)
            manifest = root / "SHA256SUMS"
            manifest.write_text(
                "".join(f"{subject.sha256_file(path)}  {path.name}\n" for path in packet_paths),
                encoding="utf-8",
            )
            with (
                mock.patch.object(subject, "COMMITTED_FREEZE_PATH", packet_paths[-2]),
                mock.patch.object(subject, "COMMITTED_RESULT_PATH", packet_paths[-1]),
                mock.patch.object(subject, "CHECKSUMS_PATH", manifest),
                mock.patch.object(subject, "PACKET_PATHS", packet_paths),
            ):
                verified = subject.verify_committed_packet(state, result)
                assert verified["checksumManifestStatus"] == "PASS"
                packet_paths[-1].write_text("{}\n", encoding="utf-8")
                with pytest.raises(subject.ContractError, match="COMMITTED_RESULT_MISMATCH"):
                    subject.verify_committed_packet(state, result)

    def test_git_anchor_rejects_nonexistent_commit(self) -> None:
        protocol, _sources, hashes = subject.load_frozen_bundle()
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            pre_freeze = {
                "trackedInputs": {
                    **hashes,
                    "discoverySha256": protocol["data"]["sharedDiscoverySha256"],
                    "vg9ProtocolSha256AtFreeze": "b" * 64,
                }
            }
            with pytest.raises(subject.ContractError, match="GIT_COMMAND_FAILED"):
                subject.verify_git_anchor(
                    protocol,
                    pre_freeze,
                    state,
                    "a" * 40,
                    "refs/tags/s1p-pre-outcome-nonexistent",
                    require_current_head=True,
                )


class SignalAndIndexingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.protocol = protocol_for_tests()
        self.trial = subject.Trial("RV2.0_B2.0", Decimal("2"), Decimal("2"))

    def test_volume_event_only_arms_and_later_basis_cross_fills_next_open(self) -> None:
        phase = make_phase(310)
        points = [make_point(index) for index in range(310)]
        points[10] = make_point(10, relative_volume="2", raw_basis="0")
        points[11] = make_point(11, relative_volume="2", raw_basis="2.1")
        points[12] = make_point(12, relative_volume="0", raw_basis="0")
        result = subject.simulate_trial(
            self.trial,
            phase,
            {"BTCUSDT": tuple(points)},
            self.protocol,
            phase_label="development",
        )
        assert len(result.trades) == 1
        trade = result.trades[0]
        assert trade.source_arm_index == 10
        assert trade.entry_index == 12
        assert trade.exit_index == 13
        assert "BASIS_REVERTED" in trade.exit_reasons

    def test_arm_uses_captured_calibration_across_utc_reset(self) -> None:
        phase = make_phase(310)
        points = [make_point(index) for index in range(310)]
        points[10] = make_point(
            10,
            relative_volume="2",
            raw_basis="0",
            basis_location="0",
            basis_scale="1",
        )
        points[11] = make_point(
            11,
            relative_volume="2",
            raw_basis="2.1",
            basis_location="100",
            basis_scale="10",
        )
        points[12] = make_point(12, raw_basis="0")
        result = subject.simulate_trial(
            self.trial,
            phase,
            {"BTCUSDT": tuple(points)},
            self.protocol,
            phase_label="development",
        )
        assert result.trades[0].entry_index == 12

    def test_oldest_arm_wins_before_larger_threshold_excess(self) -> None:
        phase = make_phase(310, ("BTCUSDT", "ETHUSDT"))
        btc = [make_point(index) for index in range(310)]
        eth = [make_point(index) for index in range(310)]
        eth[9] = make_point(9, relative_volume="2", raw_basis="0")
        btc[10] = make_point(10, relative_volume="2", raw_basis="0")
        eth[11] = make_point(11, relative_volume="2", raw_basis="2.1")
        btc[11] = make_point(11, relative_volume="2", raw_basis="10")
        eth[12] = make_point(12, raw_basis="0")
        btc[12] = make_point(12, raw_basis="0")
        result = subject.simulate_trial(
            self.trial,
            phase,
            {"BTCUSDT": tuple(btc), "ETHUSDT": tuple(eth)},
            self.protocol,
            phase_label="development",
        )
        assert len(result.trades) == 1
        assert result.trades[0].symbol == "ETHUSDT"

    def test_phase_embargo_is_strict_at_event_plus_295(self) -> None:
        length = 400
        phase = make_phase(length)
        points = [make_point(index) for index in range(length)]
        blocked_event = length - 295
        points[blocked_event] = make_point(blocked_event, relative_volume="2", raw_basis="0")
        points[blocked_event + 1] = make_point(
            blocked_event + 1, relative_volume="2", raw_basis="2.1"
        )
        result = subject.simulate_trial(
            self.trial,
            phase,
            {"BTCUSDT": tuple(points)},
            self.protocol,
            phase_label="development",
        )
        assert result.trades == ()

    def test_maximum_hold_fills_exactly_at_entry_plus_288(self) -> None:
        phase = make_phase(310)
        points = [make_point(index) for index in range(310)]
        points[10] = make_point(10, relative_volume="2", raw_basis="0")
        points[11] = make_point(11, relative_volume="2", raw_basis="2.1")
        for index in range(12, 301):
            points[index] = make_point(index, relative_volume="0", raw_basis="2.1")
        result = subject.simulate_trial(
            self.trial,
            phase,
            {"BTCUSDT": tuple(points)},
            self.protocol,
            phase_label="development",
        )
        trade = result.trades[0]
        assert trade.exit_index == trade.entry_index + 288
        assert trade.exit_reasons == ("MAXIMUM_HOLD",)


class FundingCapacityAndStatisticsTests(unittest.TestCase):
    def test_funding_half_open_interval_debits_adverse_and_discards_credit(self) -> None:
        marks = {
            "BTCUSDT": tuple(
                subject.Bar(
                    ts_ms=index * 100,
                    open=Decimal("100"),
                    high=Decimal("100"),
                    low=Decimal("100"),
                    close=Decimal("100"),
                    quote_volume=Decimal("1"),
                )
                for index in range(5)
            )
        }
        funding = {
            "BTCUSDT": (
                subject.Funding(100, 8, Decimal("-0.01")),
                subject.Funding(200, 8, Decimal("0.02")),
                subject.Funding(300, 8, Decimal("-0.50")),
            )
        }
        debit, credit = subject.funding_cashflows(
            "BTCUSDT",
            100,
            300,
            Decimal("2"),
            funding,
            marks,
        )
        assert debit == Decimal("2")
        assert credit == Decimal("4")

    def test_capacity_uses_actual_fill_notional_and_prior_closed_volume(self) -> None:
        assert subject.capacity_fill_pass(Decimal("500"), Decimal("0.5"), Decimal("10000000"))
        assert not subject.capacity_fill_pass(Decimal("500"), Decimal("0.5"), Decimal("9999999"))

    def test_trade_capacity_indexes_entry_minus_one_and_exit_minus_one(self) -> None:
        protocol = protocol_for_tests()
        length = 20
        bars = [make_bar(index, "1") for index in range(length)]
        bars[4] = make_bar(4, "10000000")
        bars[9] = make_bar(9, "10000000")
        # Fill-index volumes are intentionally tiny; only indices 4 and 9 pass.
        series = tuple(bars)
        phase = subject.PhaseData(
            phase="development",
            start_ms=0,
            end_ms=length * subject.FIVE_MINUTES_MS,
            bars={
                "BTCUSDT": {
                    "spotKlines": series,
                    "perpetualKlines": series,
                    "markPriceKlines": series,
                }
            },
            funding={"BTCUSDT": ()},
        )
        position = subject.Position(
            symbol="BTCUSDT",
            entry_index=5,
            entry_spot=Decimal("100"),
            entry_perpetual=Decimal("100"),
            quantity=Decimal("5"),
            entry_basis_z=Decimal("2"),
            basis_location=Decimal("0"),
            basis_scale=Decimal("1"),
            source_arm_index=3,
        )
        trade = subject.build_trade(position, 10, ("BASIS_REVERTED",), phase, protocol)
        assert trade.capacity_stress_pass
        failing_bars = list(series)
        failing_bars[9] = make_bar(9, "9999999")
        failing_series = tuple(failing_bars)
        failing_phase = subject.PhaseData(
            phase="development",
            start_ms=0,
            end_ms=length * subject.FIVE_MINUTES_MS,
            bars={
                "BTCUSDT": {
                    "spotKlines": failing_series,
                    "perpetualKlines": failing_series,
                    "markPriceKlines": failing_series,
                }
            },
            funding={"BTCUSDT": ()},
        )
        failing = subject.build_trade(position, 10, ("BASIS_REVERTED",), failing_phase, protocol)
        assert not failing.capacity_stress_pass

    def test_trade_capacity_uses_actual_equal_base_perpetual_notional(self) -> None:
        protocol = protocol_for_tests()
        length = 20
        spot_bars = [make_bar(index, "1") for index in range(length)]
        perpetual_bars = [make_bar(index, "1") for index in range(length)]
        spot_bars[4] = make_bar(4, "10000000")
        spot_bars[9] = make_bar(9, "10000000")
        perpetual_bars[4] = make_bar(4, "11000000")
        perpetual_bars[9] = make_bar(9, "11000000")
        perpetual_bars[10] = subject.Bar(
            ts_ms=10 * subject.FIVE_MINUTES_MS,
            open=Decimal("120"),
            high=Decimal("120"),
            low=Decimal("120"),
            close=Decimal("120"),
            quote_volume=Decimal("1"),
        )
        phase = subject.PhaseData(
            phase="development",
            start_ms=0,
            end_ms=length * subject.FIVE_MINUTES_MS,
            bars={
                "BTCUSDT": {
                    "spotKlines": tuple(spot_bars),
                    "perpetualKlines": tuple(perpetual_bars),
                    "markPriceKlines": tuple(perpetual_bars),
                }
            },
            funding={"BTCUSDT": ()},
        )
        position = subject.Position(
            symbol="BTCUSDT",
            entry_index=5,
            entry_spot=Decimal("100"),
            entry_perpetual=Decimal("110"),
            quantity=Decimal("5"),
            entry_basis_z=Decimal("2"),
            basis_location=Decimal("0"),
            basis_scale=Decimal("1"),
            source_arm_index=3,
        )
        trade = subject.build_trade(position, 10, ("BASIS_REVERTED",), phase, protocol)
        # The exit perpetual fill is USD 600, above 0.5 bp of USD 11m.
        assert not trade.capacity_stress_pass

    def test_seeded_synchronous_bootstrap_is_reproducible(self) -> None:
        protocol = protocol_for_tests()
        protocol["statistics"]["bootstrap"]["replicates"] = 64
        dates = tuple(f"2026-01-{day:02d}" for day in range(1, 17))
        results = []
        for trial_id, amount in (("A", Decimal("1")), ("B", Decimal("2"))):
            results.append(
                subject.SimulationResult(
                    trial=subject.Trial(trial_id, Decimal("2"), Decimal("2")),
                    phase="development",
                    trades=(),
                    daily_net_by_cost={
                        "base": tuple(amount for _ in dates),
                        "stress": tuple(amount for _ in dates),
                        "severe": tuple(amount for _ in dates),
                    },
                    daily_dates=dates,
                    severe_equity_curve_usd=(Decimal("1000"),),
                    maximum_severe_drawdown_pct=Decimal("0"),
                )
            )
        first = subject.synchronous_bootstrap(tuple(results), protocol)
        second = subject.synchronous_bootstrap(tuple(results), protocol)
        assert first == second

    def test_artifact_only_drawdown_and_statistics_are_recomputed(self) -> None:
        protocol = protocol_for_tests()
        protocol["statistics"]["bootstrap"]["replicates"] = 16
        start = subject.parse_utc_ms(protocol["calendar"]["development"]["startInclusive"])
        end = subject.parse_utc_ms(protocol["calendar"]["development"]["endExclusive"])
        trials = subject.trials_from_protocol(protocol)
        runtime_results = tuple(
            empty_simulation_result(trial, "development", start, end, protocol) for trial in trials
        )
        documents = [subject.simulation_document(result) for result in runtime_results]
        tampered_drawdown = copy.deepcopy(documents[0])
        tampered_drawdown["maximumSevereMarkToMarketDrawdownPct"] = "1"
        with pytest.raises(
            subject.ContractError,
            match="SIMULATION_DRAWDOWN_ARITHMETIC_INVALID",
        ):
            subject.validate_simulation_artifact(
                tampered_drawdown,
                trial=trials[0],
                phase="development",
                phase_start_ms=start,
                phase_end_ms=end,
                index_origin_ms=start,
                protocol=protocol,
            )
        tampered_path = copy.deepcopy(documents[0])
        tampered_path["severeEquityCurveUsd"] = ["1000", "900", "1000"]
        tampered_path["maximumSevereMarkToMarketDrawdownPct"] = "10"
        with pytest.raises(
            subject.ContractError,
            match="SIMULATION_SEVERE_EQUITY_TERMINAL_INVALID",
        ):
            subject.validate_simulation_artifact(
                tampered_path,
                trial=trials[0],
                phase="development",
                phase_start_ms=start,
                phase_end_ms=end,
                index_origin_ms=start,
                protocol=protocol,
            )
        authenticated = tuple(
            subject.validate_simulation_artifact(
                document,
                trial=trial,
                phase="development",
                phase_start_ms=start,
                phase_end_ms=end,
                index_origin_ms=start,
                protocol=protocol,
            )
            for trial, document in zip(trials, documents, strict=True)
        )
        family = subject.synchronous_bootstrap(runtime_results, protocol)
        pbo = subject.calculate_pbo(runtime_results, protocol)
        statistics = subject.family_stats_document(family, pbo)
        statistics["oneSidedPValues"][trials[0].trial_id] = "0.5"
        with pytest.raises(
            subject.ContractError,
            match="DEVELOPMENT_STATISTICS_RECOMPUTATION_INVALID",
        ):
            subject.validate_family_statistics_artifact(
                statistics,
                authenticated,
                protocol,
            )

    def test_artifact_only_trade_cost_and_capacity_arithmetic_are_recomputed(self) -> None:
        protocol = protocol_for_tests()
        spot_rows = [make_bar(index) for index in range(subject.DAY_BARS)]
        spot_rows[6] = subject.Bar(
            ts_ms=6 * subject.FIVE_MINUTES_MS,
            open=Decimal("100"),
            high=Decimal("100"),
            low=Decimal("50"),
            close=Decimal("50"),
            quote_volume=Decimal("20000000"),
        )
        perpetual_rows = tuple(make_bar(index) for index in range(subject.DAY_BARS))
        phase = subject.PhaseData(
            phase="development",
            start_ms=0,
            end_ms=subject.DAY_BARS * subject.FIVE_MINUTES_MS,
            bars={
                "BTCUSDT": {
                    "spotKlines": tuple(spot_rows),
                    "perpetualKlines": perpetual_rows,
                    "markPriceKlines": perpetual_rows,
                }
            },
            funding={"BTCUSDT": ()},
        )
        position = subject.Position(
            symbol="BTCUSDT",
            entry_index=5,
            entry_spot=Decimal("100"),
            entry_perpetual=Decimal("100"),
            quantity=Decimal("5"),
            entry_basis_z=Decimal("2"),
            basis_location=Decimal("0"),
            basis_scale=Decimal("1"),
            source_arm_index=3,
        )
        trade = subject.build_trade(
            position,
            10,
            ("BASIS_REVERTED",),
            phase,
            protocol,
        )
        trial = subject.trials_from_protocol(protocol)[0]
        capital = Decimal(protocol["trials"]["portfolioCapitalUsd"])

        def result_for_trade(candidate: subject.Trade) -> subject.SimulationResult:
            severe_equity = (
                capital,
                *(capital + value for value in subject.severe_trade_path(candidate)),
            )
            return subject.SimulationResult(
                trial=trial,
                phase="development",
                trades=(candidate,),
                daily_net_by_cost={
                    name: (candidate.net_by_cost[name],) for name in ("base", "stress", "severe")
                },
                daily_dates=("1970-01-01",),
                severe_equity_curve_usd=severe_equity,
                maximum_severe_drawdown_pct=subject.maximum_drawdown_pct_from_equity(severe_equity),
            )

        result = result_for_trade(trade)
        document = subject.simulation_document(result)
        subject.validate_simulation_artifact(
            document,
            trial=trial,
            phase="development",
            phase_start_ms=0,
            phase_end_ms=subject.DAY_BARS * subject.FIVE_MINUTES_MS,
            index_origin_ms=0,
            protocol=protocol,
        )
        document["trades"][0]["capacityProxy"]["fills"][0]["actualFillNotionalUsd"] = "499"
        with pytest.raises(
            subject.ContractError,
            match="TRADE_CAPACITY_FILL_ARITHMETIC_INVALID",
        ):
            subject.validate_simulation_artifact(
                document,
                trial=trial,
                phase="development",
                phase_start_ms=0,
                phase_end_ms=subject.DAY_BARS * subject.FIVE_MINUTES_MS,
                index_origin_ms=0,
                protocol=protocol,
            )
        flattened = subject.simulation_document(result)
        terminal_equity = capital + trade.net_by_cost["severe"]
        flattened_curve = [capital] + [
            terminal_equity for _ in range(trade.exit_index - trade.entry_index + 1)
        ]
        flattened["severeEquityCurveUsd"] = [subject.dstr(value) for value in flattened_curve]
        flattened["maximumSevereMarkToMarketDrawdownPct"] = subject.dstr(
            subject.maximum_drawdown_pct_from_equity(flattened_curve)
        )
        flattened_envelope = subject.with_artifact_digest(
            {
                "schema": "S1PSemanticTamperProofV1",
                "simulation": flattened,
            }
        )
        subject.verify_artifact(flattened_envelope, "S1PSemanticTamperProofV1")
        with pytest.raises(
            subject.ContractError,
            match="SIMULATION_SEVERE_EQUITY_RECOMPUTATION_INVALID",
        ):
            subject.validate_simulation_artifact(
                flattened_envelope["simulation"],
                trial=trial,
                phase="development",
                phase_start_ms=0,
                phase_end_ms=subject.DAY_BARS * subject.FIVE_MINUTES_MS,
                index_origin_ms=0,
                protocol=protocol,
            )
        oversized_position = subject.Position(
            symbol="BTCUSDT",
            entry_index=5,
            entry_spot=Decimal("100"),
            entry_perpetual=Decimal("100"),
            quantity=Decimal("10"),
            entry_basis_z=Decimal("2"),
            basis_location=Decimal("0"),
            basis_scale=Decimal("1"),
            source_arm_index=3,
        )
        oversized_trade = subject.build_trade(
            oversized_position,
            10,
            ("BASIS_REVERTED",),
            phase,
            protocol,
        )
        oversized_envelope = subject.with_artifact_digest(
            {
                "schema": "S1PSemanticTamperProofV1",
                "simulation": subject.simulation_document(result_for_trade(oversized_trade)),
            }
        )
        subject.verify_artifact(oversized_envelope, "S1PSemanticTamperProofV1")
        with pytest.raises(
            subject.ContractError,
            match="TRADE_FROZEN_LEG_NOTIONAL_INVALID",
        ):
            subject.validate_simulation_artifact(
                oversized_envelope["simulation"],
                trial=trial,
                phase="development",
                phase_start_ms=0,
                phase_end_ms=subject.DAY_BARS * subject.FIVE_MINUTES_MS,
                index_origin_ms=0,
                protocol=protocol,
            )

    def test_holdout_simulation_thresholds_are_bound_to_sealed_trial(self) -> None:
        protocol = protocol_for_tests()
        trial = subject.trials_from_protocol(protocol)[0]
        development_start = subject.parse_utc_ms(
            protocol["calendar"]["development"]["startInclusive"]
        )
        holdout_start = subject.parse_utc_ms(protocol["calendar"]["holdout"]["startInclusive"])
        holdout_end = subject.parse_utc_ms(protocol["calendar"]["holdout"]["endExclusive"])
        result = empty_simulation_result(
            trial,
            "holdout",
            holdout_start,
            holdout_end,
            protocol,
        )
        document = subject.simulation_document(result)
        document["basisThresholdZ"] = "9"
        with pytest.raises(subject.ContractError, match="SIMULATION_TRIAL_BINDING_INVALID"):
            subject.validate_simulation_artifact(
                document,
                trial=trial,
                phase="holdout",
                phase_start_ms=holdout_start,
                phase_end_ms=holdout_end,
                index_origin_ms=development_start,
                protocol=protocol,
            )


if __name__ == "__main__":
    unittest.main()
