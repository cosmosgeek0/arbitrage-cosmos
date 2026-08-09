from __future__ import annotations

import copy
import dataclasses
import json
import os
from typing import Any, cast

import pytest
import research.dq13 as dq13
from research.dq13 import (
    ValidationStatus,
    canonical_json_bytes_v1,
    validate_causal_asof_json_v1,
    validate_causal_asof_mapping_v1,
)
from research.dq13 import validator as validator_module
from research.dq13 import verify as verify_module
from research.dq13.fixture_support import FixtureCaseV1, load_fixture_cases_v1

_D = 1_735_689_660_000_000


def _fixture(case_id: str = "valid-all-feeds") -> FixtureCaseV1:
    for case in load_fixture_cases_v1():
        if case.case_id == case_id:
            return case
    raise AssertionError(f"missing fixture {case_id}")


def _frame() -> dict[str, object]:
    return copy.deepcopy(_fixture().frame)


def _list(value: object) -> list[object]:
    assert isinstance(value, list)
    return value


def _dict(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _observations(frame: dict[str, object]) -> list[dict[str, object]]:
    return [_dict(item) for item in _list(frame["observations"])]


def _requirements(frame: dict[str, object]) -> list[dict[str, object]]:
    return [_dict(item) for item in _list(frame["requirements"])]


def _stamp(parent: dict[str, object], field: str) -> dict[str, object]:
    return _dict(parent[field])


def _object_frame() -> dq13.DecisionFrameV1:
    return dq13.frame_from_mapping_v1(_frame())


def _forced_replace[DataclassT](instance: DataclassT, changes: dict[str, object]) -> DataclassT:
    """Inject deliberately ill-typed fields the way an untyped caller could."""

    replace_without_types = cast(Any, dataclasses.replace)
    mutated: DataclassT = replace_without_types(instance, **changes)
    return mutated


def _with_observation(
    frame: dq13.DecisionFrameV1,
    index: int,
    changes: dict[str, object],
) -> dq13.DecisionFrameV1:
    observations = list(frame.observations)
    observations[index] = _forced_replace(observations[index], changes)
    return dataclasses.replace(frame, observations=tuple(observations))


@pytest.mark.parametrize("case", load_fixture_cases_v1(), ids=lambda case: case.case_id)
def test_hostile_fixture_matrix(case: FixtureCaseV1) -> None:
    first = validate_causal_asof_mapping_v1(case.frame)
    second = validate_causal_asof_mapping_v1(copy.deepcopy(case.frame))
    assert first == second
    assert first.canonical_bytes() == second.canonical_bytes()
    assert first.status is case.expected_status
    assert first.reason_codes == case.expected_reasons
    assert first.authority == "NONE"
    assert first.consumer_scope == ("FUTURE_S1_VG", "N3_FINAL_CONVERGENCE")
    assert first.historical_reclassification is False


def test_fixture_declared_digest_equivalence() -> None:
    digests = {
        case.case_id: validate_causal_asof_mapping_v1(case.frame).receipt_digest
        for case in load_fixture_cases_v1()
    }
    for case in load_fixture_cases_v1():
        if case.digest_equals_case is not None:
            assert digests[case.case_id] == digests[case.digest_equals_case]


def test_public_api_is_frozen() -> None:
    assert dq13.PUBLIC_API_V1 == (
        "SCHEMA_V1",
        "RECEIPT_SCHEMA_V1",
        "AvailabilityBasis",
        "CausalReceiptV1",
        "ClockBoundsV1",
        "ClockContractError",
        "ClockStampV1",
        "DecisionFrameV1",
        "FeedKeyV1",
        "FeedKind",
        "FeedObservationV1",
        "FeedRequirementV1",
        "FeedSelectionV1",
        "FillState",
        "ObservationShape",
        "Product",
        "SourceProfile",
        "TimestampUnit",
        "ValidationStatus",
        "canonical_json_bytes_v1",
        "frame_from_mapping_v1",
        "validate_causal_asof_json_v1",
        "validate_causal_asof_mapping_v1",
        "validate_causal_asof_v1",
    )
    assert tuple(name for name in dq13.__all__ if name != "PUBLIC_API_V1") == (dq13.PUBLIC_API_V1)


def test_every_source_profile_declares_one_endpoint_spec() -> None:
    assert set(validator_module._PROFILE_SPECS) == set(dq13.SourceProfile)
    interval_profiles = {
        profile
        for profile, spec in validator_module._PROFILE_SPECS.items()
        if any(shape is dq13.ObservationShape.INTERVAL for _, shape in spec.combinations)
    }
    assert set(validator_module._PROFILE_INTERVAL_ZONES) == interval_profiles


def test_focused_proof_environment_blocks_inherited_pytest_controls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PYTEST_ADDOPTS", "--collect-only")
    monkeypatch.setenv("PYTEST_PLUGINS", "outside.plugin")
    monkeypatch.setenv("PYTEST_DISABLE_PLUGIN_AUTOLOAD", "0")
    environment = verify_module._focused_test_environment()
    assert "PYTEST_ADDOPTS" not in environment
    assert "PYTEST_PLUGINS" not in environment
    assert environment["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] == "1"
    assert environment["PYTHONHASHSEED"] == "0"
    assert environment["PYTHONPATH"] == os.pathsep.join(("src", "."))
    assert "--noconftest" in verify_module._FOCUSED_TEST_ARGS
    assert "research.dq13.verify" in verify_module._FOCUSED_TEST_ARGS


def test_focused_proof_sentinel_binds_executed_bodies() -> None:
    digest = "a" * 64
    assert verify_module._parse_focused_test_sentinel(
        f"DQ13_FOCUSED_TEST_SENTINEL 207 207 {digest}\n".encode()
    ) == (207, digest)


@pytest.mark.parametrize(
    "output",
    [
        b"",
        b"DQ13_FOCUSED_TEST_SENTINEL 0 0 " + b"a" * 64 + b"\n",
        b"DQ13_FOCUSED_TEST_SENTINEL 207 206 " + b"a" * 64 + b"\n",
        b"DQ13_FOCUSED_TEST_SENTINEL 207 207 not-a-digest\n",
        (
            b"DQ13_FOCUSED_TEST_SENTINEL 207 207 "
            + b"a" * 64
            + b"\nDQ13_FOCUSED_TEST_SENTINEL 207 207 "
            + b"a" * 64
            + b"\n"
        ),
    ],
)
def test_focused_proof_rejects_bypass_sentinels(output: bytes) -> None:
    with pytest.raises(RuntimeError, match="FOCUSED_TEST_SENTINEL_INVALID"):
        verify_module._parse_focused_test_sentinel(output)


def test_valid_receipt_exposes_all_normalized_clocks() -> None:
    receipt = validate_causal_asof_mapping_v1(_frame())
    assert receipt.status is ValidationStatus.VALID
    assert len(receipt.selections) == 7
    by_key = {selection.key_id: selection for selection in receipt.selections}
    kline = by_key["BINANCE:SPOT:BTCUSDT:KLINE:1m@UTC"]
    assert kline.interval_open_us == 1_735_689_600_000_000
    assert kline.interval_end_exclusive_us == _D
    assert kline.event_bounds is not None
    assert kline.event_bounds.earliest_us == _D + 100
    assert kline.event_bounds.latest_us == _D + 100
    mark = by_key["BINANCE:USD_M:BTCUSDT:MARK_PRICE:-"]
    assert mark.event_bounds is not None
    assert mark.event_bounds.earliest_us == _D
    assert mark.event_bounds.latest_us == _D + 999
    assert mark.event_bounds.resolution_us == 1000
    rest_kline = by_key["BINANCE:USD_M:BTCUSDT:MARK_PRICE:1m@UTC"]
    assert rest_kline.event_bounds is None
    assert rest_kline.interval_end_exclusive_us == _D
    funding_info = by_key["BINANCE:USD_M:BTCUSDT:CURRENT_FUNDING_INFO:-"]
    assert funding_info.event_bounds is None
    assert funding_info.availability_bounds is not None


def test_every_selected_availability_clock_is_evidence_bound() -> None:
    receipt = validate_causal_asof_mapping_v1(_frame())
    assert receipt.status is ValidationStatus.VALID
    for selection in receipt.selections:
        assert selection.availability_bounds is not None
        assert selection.availability_basis is dq13.AvailabilityBasis.OBSERVED_RECEIPT
        assert selection.availability_evidence_id is not None
        assert selection.availability_evidence_digest is not None
        assert len(selection.availability_evidence_digest) == 64
    payload = _dict(json.loads(receipt.canonical_bytes()))
    selections = [_dict(item) for item in _list(payload["selections"])]
    assert all(item["availabilityEvidenceId"] is not None for item in selections)
    assert all(item["availabilityEvidenceDigest"] is not None for item in selections)
    assert all(item["availabilityBasis"] == "OBSERVED_RECEIPT" for item in selections)
    assert all(item["maxAvailabilityAgeUs"] == 10_000_000 for item in selections)


def test_receipt_binds_freshness_thresholds() -> None:
    baseline = validate_causal_asof_mapping_v1(_frame())
    changed = _frame()
    requirement = _requirements(changed)[1]
    requirement["maxEventAgeUs"] = 121_000_000
    requirement["maxAvailabilityAgeUs"] = 11_000_000
    receipt = validate_causal_asof_mapping_v1(changed)
    assert receipt.status is ValidationStatus.VALID
    assert receipt.receipt_digest != baseline.receipt_digest
    selection = next(item for item in receipt.selections if item.key_id.endswith(":MARK_PRICE:-"))
    assert selection.max_event_age_us == 121_000_000
    assert selection.max_availability_age_us == 11_000_000


def _single_kline(*, milliseconds: bool) -> dict[str, object]:
    frame = _frame()
    frame["requirements"] = [_requirements(frame)[0]]
    frame["observations"] = [_observations(frame)[0]]
    observation = _observations(frame)[0]
    event = _stamp(observation, "eventAt")
    interval_open = _stamp(observation, "intervalOpen")
    interval_close = _stamp(observation, "intervalCloseInclusive")
    if milliseconds:
        observation["sourceProfile"] = "SPOT_WS_KLINE_MS"
        event.update({"value": 1_735_689_660_001, "unit": "MILLISECOND"})
        interval_open.update({"value": 1_735_689_600_000, "unit": "MILLISECOND"})
        interval_close.update({"value": 1_735_689_659_999, "unit": "MILLISECOND"})
        _stamp(observation, "availableAt")["value"] = _D + 2500
    else:
        event["value"] = _D + 1000
        _stamp(observation, "availableAt")["value"] = _D + 2000
    return frame


def _archive_kline(*, interval_id: str, expected_interval_us: int) -> dict[str, object]:
    frame = _single_kline(milliseconds=True)
    requirement = _requirements(frame)[0]
    _dict(requirement["key"])["intervalId"] = interval_id
    requirement["expectedIntervalUs"] = expected_interval_us
    observation = _observations(frame)[0]
    _dict(observation["key"])["intervalId"] = interval_id
    observation["sourceProfile"] = "SPOT_ARCHIVE_KLINES_PRE_2025_MS"
    observation["eventAt"] = None
    observation["isFinal"] = None
    return frame


def test_ms_and_us_interval_edges_normalize_to_same_half_open_boundary() -> None:
    ms = validate_causal_asof_mapping_v1(_single_kline(milliseconds=True))
    us = validate_causal_asof_mapping_v1(_single_kline(milliseconds=False))
    assert ms.status is ValidationStatus.VALID
    assert us.status is ValidationStatus.VALID
    assert ms.selections[0].interval_open_us == us.selections[0].interval_open_us
    assert (
        ms.selections[0].interval_end_exclusive_us
        == us.selections[0].interval_end_exclusive_us
        == _D
    )
    assert ms.selections[0].event_bounds is not None
    assert us.selections[0].event_bounds is not None
    assert ms.selections[0].event_bounds.resolution_us == 1000
    assert us.selections[0].event_bounds.resolution_us == 1


def test_ms_normalization_never_invents_within_millisecond_precision() -> None:
    receipt = validate_causal_asof_mapping_v1(_frame())
    mark = next(
        selection for selection in receipt.selections if selection.key_id.endswith(":MARK_PRICE:-")
    )
    assert mark.event_bounds is not None
    assert (mark.event_bounds.earliest_us, mark.event_bounds.latest_us) == (
        _D,
        _D + 999,
    )


def test_us_equality_is_inclusive_but_coarse_overlap_is_unknown() -> None:
    exact = _frame()
    _stamp(_observations(exact)[1], "availableAt")["value"] = _D + 3000
    exact_receipt = validate_causal_asof_mapping_v1(exact)
    assert exact_receipt.status is ValidationStatus.VALID

    coarse = _frame()
    mark = _observations(coarse)[1]
    _stamp(mark, "availableAt").update(
        {
            "value": 1_735_689_660_000,
            "unit": "MILLISECOND",
            "clockId": "other-clock",
        }
    )
    coarse_receipt = validate_causal_asof_mapping_v1(coarse)
    assert coarse_receipt.status is ValidationStatus.UNKNOWN
    assert "EVENT_AVAILABILITY_ORDER_AMBIGUOUS" in coarse_receipt.reason_codes


def test_local_sequence_resolves_same_tick_order() -> None:
    frame = _frame()
    decision = _stamp(frame, "decisionAt")
    decision.update(
        {
            "value": 1_735_689_660_003,
            "unit": "MILLISECOND",
            "clockId": "local-capture",
            "sequence": 20,
        }
    )
    fill = _stamp(frame, "fillAt")
    fill.update(
        {
            "value": 1_735_689_660_003,
            "unit": "MILLISECOND",
            "clockId": "local-capture",
            "sequence": 21,
        }
    )
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.VALID


def test_future_record_cannot_replace_available_predecessor() -> None:
    frame = _frame()
    mark = copy.deepcopy(_observations(frame)[1])
    mark["recordId"] = "mark-future"
    mark["payloadDigest"] = "f" * 64
    _stamp(mark, "eventAt")["value"] = 1_735_689_660_010
    _stamp(mark, "availableAt")["value"] = _D + 11_000
    _list(frame["observations"]).append(mark)
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.VALID
    selection = next(item for item in receipt.selections if item.key_id.endswith(":MARK_PRICE:-"))
    assert selection.selected_record_ids == ("mark-instant",)


def test_late_old_event_cannot_replace_newer_semantic_event() -> None:
    frame = _frame()
    late_old = copy.deepcopy(_observations(frame)[1])
    late_old["recordId"] = "mark-old-late"
    late_old["payloadDigest"] = "f" * 64
    _stamp(late_old, "eventAt")["value"] = 1_735_689_659_000
    _stamp(late_old, "availableAt").update({"value": _D + 2500, "sequence": 19})
    _list(frame["observations"]).append(late_old)
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.VALID
    selection = next(item for item in receipt.selections if item.key_id.endswith(":MARK_PRICE:-"))
    assert selection.selected_record_ids == ("mark-instant",)


def test_byte_identical_duplicate_collapses_without_extra_semantic_record() -> None:
    frame = _frame()
    duplicate = copy.deepcopy(_observations(frame)[1])
    duplicate["recordId"] = "mark-identical-copy"
    _list(frame["observations"]).append(duplicate)
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.VALID
    selection = next(item for item in receipt.selections if item.key_id.endswith(":MARK_PRICE:-"))
    assert selection.selected_record_ids == ("mark-identical-copy", "mark-instant")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        (
            "availableAt",
            {
                "value": _D + 1250,
                "unit": "MICROSECOND",
                "clockId": "local-capture",
                "sequence": 18,
            },
        ),
        ("availabilityEvidenceId", "receipt:usdm-ws-mark-price:alternate"),
        ("availabilityEvidenceDigest", "f" * 64),
    ],
)
def test_duplicate_requires_identical_availability_evidence(
    field: str,
    value: object,
) -> None:
    frame = _frame()
    duplicate = copy.deepcopy(_observations(frame)[1])
    duplicate["recordId"] = f"mark-different-{field}"
    duplicate[field] = value
    _list(frame["observations"]).append(duplicate)
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.UNKNOWN
    assert receipt.reason_codes == ("CONTRADICTORY_ASOF_RECORDS",)


def test_duplicate_requires_identical_availability_basis() -> None:
    frame = _frame()
    duplicate = copy.deepcopy(_observations(frame)[3])
    duplicate["recordId"] = "funding-frozen-copy"
    duplicate["availabilityBasis"] = "FROZEN_RELEASE_EVIDENCE"
    _list(frame["observations"]).append(duplicate)
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.UNKNOWN
    assert receipt.reason_codes == ("CONTRADICTORY_ASOF_RECORDS",)


def test_same_effective_conflicting_payload_is_unknown_despite_sequence() -> None:
    frame = _frame()
    original = _observations(frame)[1]
    _stamp(original, "eventAt")["sequence"] = 1
    conflicting = copy.deepcopy(original)
    conflicting["recordId"] = "mark-sequenced-conflict"
    conflicting["payloadDigest"] = "f" * 64
    _stamp(conflicting, "eventAt")["sequence"] = 2
    _list(frame["observations"]).append(conflicting)
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.UNKNOWN
    assert receipt.reason_codes == ("CONTRADICTORY_ASOF_RECORDS",)


def test_cyclic_asof_dominance_is_total_and_unknown() -> None:
    frame = _frame()
    frame["requirements"] = [_requirements(frame)[1]]
    base = copy.deepcopy(_observations(frame)[1])
    observations: list[dict[str, object]] = []
    for record_id, raw_ms, sequence in (
        ("cycle-a", 1_735_689_660_000, 3),
        ("cycle-b", 1_735_689_660_001, 2),
        ("cycle-c", 1_735_689_660_003, 1),
    ):
        item = copy.deepcopy(base)
        item["recordId"] = record_id
        _stamp(item, "eventAt").update(
            {
                "value": raw_ms,
                "maxErrorUs": 1000,
                "sequence": sequence,
            }
        )
        _stamp(item, "availableAt").update({"value": _D + 6000, "sequence": 18})
        observations.append(item)
    frame["observations"] = observations
    _stamp(frame, "decisionAt")["value"] = _D + 8000
    _stamp(frame, "fillAt")["value"] = _D + 9000
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.UNKNOWN
    assert receipt.reason_codes == ("ASOF_ORDER_CYCLE",)


def _mark_contender(frame: dict[str, object], record_id: str) -> dict[str, object]:
    contender = copy.deepcopy(_observations(frame)[1])
    contender["recordId"] = record_id
    contender["payloadDigest"] = "f" * 64
    _list(frame["observations"]).append(contender)
    return contender


def test_causally_present_unplaceable_contender_poisons_feed() -> None:
    frame = _frame()
    contender = _mark_contender(frame, "mark-unplaceable")
    contender["availableAt"] = {
        "value": 1_735_689_660_003,
        "unit": "MILLISECOND",
        "clockId": "peer-capture",
    }
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.UNKNOWN
    assert receipt.reason_codes == ("AVAILABILITY_DECISION_ORDER_AMBIGUOUS",)
    selection = next(item for item in receipt.selections if item.key_id.endswith(":MARK_PRICE:-"))
    assert selection.status is ValidationStatus.UNKNOWN
    assert selection.selected_record_ids == ()


def test_causally_present_contradictory_contender_poisons_feed() -> None:
    frame = _frame()
    contender = _mark_contender(frame, "mark-eventless")
    contender["eventAt"] = None
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.UNKNOWN
    assert receipt.reason_codes == ("EVENT_TIME_MISSING",)
    selection = next(item for item in receipt.selections if item.key_id.endswith(":MARK_PRICE:-"))
    assert selection.selected_record_ids == ()


def test_internally_contradictory_contender_poisons_feed() -> None:
    frame = _frame()
    contender = _mark_contender(frame, "mark-after-receipt")
    _stamp(contender, "eventAt")["value"] = 1_735_689_660_002
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.UNKNOWN
    assert receipt.reason_codes == ("EVENT_AFTER_AVAILABILITY",)


def test_ambiguous_interval_completeness_contender_poisons_feed() -> None:
    frame = _frame()
    contender = copy.deepcopy(_observations(frame)[6])
    contender["recordId"] = "mark-kline-rest-ambiguous"
    contender["payloadDigest"] = "f" * 64
    contender["availableAt"] = {
        "value": _D + 500,
        "unit": "MICROSECOND",
        "clockId": "peer-capture",
        "maxErrorUs": 1000,
    }
    _list(frame["observations"]).append(contender)
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.UNKNOWN
    assert receipt.reason_codes == ("INTERVAL_AVAILABILITY_END_ORDER_AMBIGUOUS",)


@pytest.mark.parametrize(
    ("record_id", "field", "value"),
    [
        ("mark-future", "availableAt", {"value": _D + 5000, "unit": "MICROSECOND", "clockId": "x"}),
        (
            "mark-stale",
            "eventAt",
            {"value": 1_735_689_480_000, "unit": "MILLISECOND", "clockId": "binance-usdm"},
        ),
    ],
)
def test_provably_unusable_contender_leaves_valid_predecessor_untouched(
    record_id: str,
    field: str,
    value: dict[str, object],
) -> None:
    baseline = validate_causal_asof_mapping_v1(_frame())
    frame = _frame()
    contender = _mark_contender(frame, record_id)
    contender[field] = value
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.VALID
    assert receipt.reason_codes == ()
    assert receipt.receipt_digest == baseline.receipt_digest
    selection = next(item for item in receipt.selections if item.key_id.endswith(":MARK_PRICE:-"))
    assert selection.selected_record_ids == ("mark-instant",)


def test_partial_stream_kline_contender_is_ignored_with_final_predecessor() -> None:
    baseline = validate_causal_asof_mapping_v1(_frame())
    frame = _frame()
    partial = copy.deepcopy(_observations(frame)[0])
    partial["recordId"] = "spot-kline-partial"
    partial["payloadDigest"] = "f" * 64
    partial["isFinal"] = False
    _list(frame["observations"]).append(partial)
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.VALID
    assert receipt.receipt_digest == baseline.receipt_digest


def test_spot_archive_cutover_profile_is_enforced() -> None:
    frame = _archive_kline(interval_id="1m@UTC", expected_interval_us=60_000_000)
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("SPOT_ARCHIVE_UNIT_EPOCH_INVALID",)


def test_pre_cutover_spot_archive_ms_is_valid() -> None:
    frame = _archive_kline(interval_id="1d@UTC", expected_interval_us=86_400_000_000)
    observation = _observations(frame)[0]
    _stamp(observation, "intervalOpen")["value"] = 1_735_603_200_000
    _stamp(observation, "intervalCloseInclusive")["value"] = 1_735_689_599_999
    _stamp(observation, "availableAt")["value"] = 1_735_689_600_002_500
    _stamp(frame, "decisionAt")["value"] = 1_735_689_600_003_000
    _stamp(frame, "fillAt")["value"] = 1_735_689_600_004_000
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.VALID
    assert receipt.selections[0].interval_end_exclusive_us == 1_735_689_600_000_000
    assert receipt.selections[0].event_bounds is None


def test_rest_interval_completeness_comes_from_availability_not_a_final_flag() -> None:
    frame = _frame()
    early = _stamp(_observations(frame)[6], "availableAt")
    early["value"] = 1_735_689_659_999_000
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.UNKNOWN
    assert receipt.reason_codes == ("INTERVAL_INCOMPLETE_AT_AVAILABILITY",)


def test_stream_interval_does_not_require_event_after_close() -> None:
    frame = _single_kline(milliseconds=False)
    _stamp(_observations(frame)[0], "eventAt")["value"] = _D - 1
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.VALID
    assert receipt.selections[0].interval_end_exclusive_us == _D


def test_stream_interval_still_requires_availability_after_exclusive_end() -> None:
    frame = _single_kline(milliseconds=False)
    _stamp(_observations(frame)[0], "availableAt")["value"] = _D - 1
    _stamp(_observations(frame)[0], "eventAt")["value"] = _D - 2
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.UNKNOWN
    assert receipt.reason_codes == ("INTERVAL_INCOMPLETE_AT_AVAILABILITY",)


def _calendar_month_frame(
    *,
    interval_id: str,
    expected_interval_us: int,
    open_us: int,
    close_inclusive_us: int,
    decision_us: int,
) -> dict[str, object]:
    frame = _single_kline(milliseconds=False)
    requirement = _requirements(frame)[0]
    _dict(requirement["key"])["intervalId"] = interval_id
    requirement["expectedIntervalUs"] = expected_interval_us
    observation = _observations(frame)[0]
    _dict(observation["key"])["intervalId"] = interval_id
    _stamp(observation, "intervalOpen")["value"] = open_us
    _stamp(observation, "intervalCloseInclusive")["value"] = close_inclusive_us
    _stamp(observation, "eventAt")["value"] = decision_us - 2000
    _stamp(observation, "availableAt")["value"] = decision_us - 1000
    _stamp(frame, "decisionAt")["value"] = decision_us
    _stamp(frame, "fillAt")["value"] = decision_us + 1000
    return frame


def test_calendar_month_interval_binds_exact_utc_month_edges() -> None:
    frame = _calendar_month_frame(
        interval_id="1M@UTC",
        expected_interval_us=2_678_400_000_000,
        open_us=1_733_011_200_000_000,
        close_inclusive_us=1_735_689_599_999_999,
        decision_us=1_735_689_600_003_000,
    )
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.VALID
    assert receipt.selections[0].interval_open_us == 1_733_011_200_000_000
    assert receipt.selections[0].interval_end_exclusive_us == 1_735_689_600_000_000


def test_calendar_month_interval_rejects_non_month_edges() -> None:
    frame = _calendar_month_frame(
        interval_id="1M@UTC",
        expected_interval_us=2_592_000_000_000,
        open_us=1_733_097_600_000_000,
        close_inclusive_us=1_735_689_599_999_999,
        decision_us=1_735_689_600_003_000,
    )
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("INTERVAL_CALENDAR_EDGE_INVALID",)


def test_calendar_month_edges_are_validated_under_the_declared_zone() -> None:
    shifted_edges = {
        "expected_interval_us": 2_678_400_000_000,
        "open_us": 1_732_982_400_000_000,
        "close_inclusive_us": 1_735_660_799_999_999,
        "decision_us": 1_735_660_800_003_000,
    }
    local = validate_causal_asof_mapping_v1(
        _calendar_month_frame(interval_id="1M@UTC+08:00", **shifted_edges)
    )
    assert local.status is ValidationStatus.VALID
    utc = validate_causal_asof_mapping_v1(
        _calendar_month_frame(interval_id="1M@UTC", **shifted_edges)
    )
    assert utc.status is ValidationStatus.INVALID
    assert utc.reason_codes == ("INTERVAL_CALENDAR_EDGE_INVALID",)


def _fixed_interval_frame(
    *,
    step: str,
    duration_us: int,
    zone: str,
    phase_us: int,
    misalignment_us: int = 0,
) -> dict[str, object]:
    offset_us = 0 if zone == "UTC" else 8 * 3_600_000_000
    local_anchor = 1_735_689_600_000_000 + offset_us
    aligned_local = (local_anchor - phase_us) // duration_us * duration_us + phase_us
    open_us = aligned_local - offset_us + misalignment_us
    end_us = open_us + duration_us
    return _calendar_month_frame(
        interval_id=f"{step}@{zone}",
        expected_interval_us=duration_us,
        open_us=open_us,
        close_inclusive_us=end_us - 1,
        decision_us=end_us + 3000,
    )


@pytest.mark.parametrize("zone", ["UTC", "UTC+08:00"])
@pytest.mark.parametrize(
    ("step", "duration_us", "phase_us"),
    [
        ("1s", 1_000_000, 0),
        ("1m", 60_000_000, 0),
        ("3m", 180_000_000, 0),
        ("5m", 300_000_000, 0),
        ("15m", 900_000_000, 0),
        ("30m", 1_800_000_000, 0),
        ("1h", 3_600_000_000, 0),
        ("2h", 7_200_000_000, 0),
        ("4h", 14_400_000_000, 0),
        ("6h", 21_600_000_000, 0),
        ("8h", 28_800_000_000, 0),
        ("12h", 43_200_000_000, 0),
        ("1d", 86_400_000_000, 0),
        ("3d", 259_200_000_000, 86_400_000_000),
        ("1w", 604_800_000_000, 345_600_000_000),
    ],
)
def test_every_fixed_interval_obeys_declared_zone_phase(
    step: str,
    duration_us: int,
    phase_us: int,
    zone: str,
) -> None:
    receipt = validate_causal_asof_mapping_v1(
        _fixed_interval_frame(
            step=step,
            duration_us=duration_us,
            zone=zone,
            phase_us=phase_us,
        )
    )
    assert receipt.status is ValidationStatus.VALID


def test_spot_rest_shifted_kline_is_profile_supported() -> None:
    frame = _fixed_interval_frame(
        step="1d",
        duration_us=86_400_000_000,
        zone="UTC+08:00",
        phase_us=0,
    )
    observation = _observations(frame)[0]
    observation["sourceProfile"] = "SPOT_REST_KLINES_US"
    observation["eventAt"] = None
    observation["isFinal"] = None
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.VALID


def test_spot_ws_shifted_kline_is_documented_profile_exception() -> None:
    receipt = validate_causal_asof_mapping_v1(
        _fixed_interval_frame(
            step="1d",
            duration_us=86_400_000_000,
            zone="UTC+08:00",
            phase_us=0,
        )
    )
    assert receipt.status is ValidationStatus.VALID


def test_spot_archive_shifted_kline_is_profile_contradiction() -> None:
    frame = _fixed_interval_frame(
        step="1d",
        duration_us=86_400_000_000,
        zone="UTC+08:00",
        phase_us=0,
    )
    observation = _observations(frame)[0]
    observation["sourceProfile"] = "SPOT_ARCHIVE_KLINES_FROM_2025_US"
    observation["eventAt"] = None
    observation["isFinal"] = None
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("SOURCE_INTERVAL_ZONE_CONTRADICTION",)


@pytest.mark.parametrize("kind", ["KLINE", "MARK_PRICE", "INDEX_PRICE"])
def test_usdm_shifted_interval_requirement_is_unserviceable(kind: str) -> None:
    frame = _single_kline(milliseconds=False)
    requirement_key = _dict(_requirements(frame)[0]["key"])
    requirement_key.update(
        {
            "product": "USD_M",
            "kind": kind,
            "intervalId": "1m@UTC+08:00",
        }
    )
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("INTERVAL_ZONE_PROFILE_UNSERVICEABLE",)


@pytest.mark.parametrize("zone", ["UTC", "UTC+08:00"])
@pytest.mark.parametrize(
    ("step", "duration_us", "phase_us"),
    [
        ("1d", 86_400_000_000, 0),
        ("3d", 259_200_000_000, 86_400_000_000),
        ("1w", 604_800_000_000, 345_600_000_000),
    ],
)
def test_fixed_interval_phase_shift_fails_closed(
    step: str,
    duration_us: int,
    phase_us: int,
    zone: str,
) -> None:
    receipt = validate_causal_asof_mapping_v1(
        _fixed_interval_frame(
            step=step,
            duration_us=duration_us,
            zone=zone,
            phase_us=phase_us,
            misalignment_us=1,
        )
    )
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("INTERVAL_PHASE_INVALID",)


def test_utc_and_utc_plus_eight_identities_never_collide() -> None:
    frame = _single_kline(milliseconds=False)
    requirement = _requirements(frame)[0]
    _dict(requirement["key"])["intervalId"] = "1d@UTC"
    requirement["expectedIntervalUs"] = 86_400_000_000
    shifted = copy.deepcopy(requirement)
    _dict(shifted["key"])["intervalId"] = "1d@UTC+08:00"
    frame["requirements"] = [requirement, shifted]
    observation = _observations(frame)[0]
    _dict(observation["key"])["intervalId"] = "1d@UTC"
    _stamp(observation, "intervalOpen")["value"] = 1_735_603_200_000_000
    _stamp(observation, "intervalCloseInclusive")["value"] = 1_735_689_599_999_999
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.UNKNOWN
    assert receipt.reason_codes == ("MISSING_REQUIRED_FEED",)
    by_key = {selection.key_id: selection.status for selection in receipt.selections}
    assert by_key["BINANCE:SPOT:BTCUSDT:KLINE:1d@UTC"] is ValidationStatus.VALID
    assert by_key["BINANCE:SPOT:BTCUSDT:KLINE:1d@UTC+08:00"] is ValidationStatus.UNKNOWN


@pytest.mark.parametrize(
    ("interval_id", "reason"),
    [
        ("7m@UTC", "INTERVAL_STEP_UNSUPPORTED"),
        ("2m@UTC", "INTERVAL_STEP_UNSUPPORTED"),
        ("1M@UTC+05:45", "INTERVAL_ZONE_UNSUPPORTED"),
        ("1m@utc", "INTERVAL_ZONE_UNSUPPORTED"),
        ("1m", "INTERVAL_ID_INVALID"),
        ("1m@", "INTERVAL_ZONE_UNSUPPORTED"),
    ],
)
def test_unsupported_interval_identities_fail_closed(interval_id: str, reason: str) -> None:
    frame = _single_kline(milliseconds=False)
    _dict(_requirements(frame)[0]["key"])["intervalId"] = interval_id
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == (reason,)


def test_spot_one_second_kline_is_supported() -> None:
    frame = _single_kline(milliseconds=False)
    requirement = _requirements(frame)[0]
    _dict(requirement["key"])["intervalId"] = "1s@UTC"
    requirement["expectedIntervalUs"] = 1_000_000
    observation = _observations(frame)[0]
    _dict(observation["key"])["intervalId"] = "1s@UTC"
    _stamp(observation, "intervalOpen")["value"] = 1_735_689_659_000_000
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.VALID


def test_usdm_one_second_interval_is_rejected() -> None:
    frame = _frame()
    requirement = _requirements(frame)[6]
    _dict(requirement["key"])["intervalId"] = "1s@UTC"
    requirement["expectedIntervalUs"] = 1_000_000
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("USD_M_SECOND_INTERVAL_UNSUPPORTED",)


@pytest.mark.parametrize(
    ("expected_interval_us", "reason"),
    [
        (None, "INTERVAL_DURATION_MISSING"),
        (30_000_000, "INTERVAL_DURATION_DECLARATION_INVALID"),
    ],
)
def test_every_interval_must_declare_its_exact_duration(
    expected_interval_us: int | None,
    reason: str,
) -> None:
    frame = _single_kline(milliseconds=False)
    _requirements(frame)[0]["expectedIntervalUs"] = expected_interval_us
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == (reason,)


def test_calendar_duration_declaration_must_be_a_real_month() -> None:
    frame = _calendar_month_frame(
        interval_id="1M@UTC",
        expected_interval_us=2_419_200_000_001,
        open_us=1_733_011_200_000_000,
        close_inclusive_us=1_735_689_599_999_999,
        decision_us=1_735_689_600_003_000,
    )
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("INTERVAL_DURATION_DECLARATION_INVALID",)


@pytest.mark.parametrize("index", [4, 5])
def test_current_snapshots_require_observed_receipt(index: int) -> None:
    frame = _frame()
    _observations(frame)[index]["availabilityBasis"] = "FROZEN_RELEASE_EVIDENCE"
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("CURRENT_SNAPSHOT_RECEIPT_REQUIRED",)


def test_stream_observation_requires_observed_receipt() -> None:
    frame = _frame()
    _observations(frame)[1]["availabilityBasis"] = "FROZEN_RELEASE_EVIDENCE"
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("STREAM_RECEIPT_REQUIRED",)


@pytest.mark.parametrize("profile", ["USDM_REST_PREMIUM_INDEX_MS", "USDM_WS_MARK_PRICE_MS"])
def test_projected_rate_cannot_become_settled_funding(profile: str) -> None:
    frame = _frame()
    _observations(frame)[3]["sourceProfile"] = profile
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("SETTLED_FUNDING_SOURCE_INVALID",)


@pytest.mark.parametrize(
    ("index", "profile"),
    [
        (0, "SPOT_REST_EXCHANGE_INFO_MS"),
        (1, "USDM_REST_KLINES_MS"),
        (4, "USDM_REST_FUNDING_INFO_MS"),
        (5, "USDM_REST_EXCHANGE_INFO_MS"),
        (6, "USDM_REST_INDEX_PRICE_KLINES_MS"),
    ],
)
def test_endpoint_schema_combinations_are_exact(index: int, profile: str) -> None:
    frame = _frame()
    _observations(frame)[index]["sourceProfile"] = profile
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("SOURCE_ENDPOINT_CONTRADICTION",)


def test_unserviceable_requirement_fails_closed() -> None:
    frame = _frame()
    _dict(_requirements(frame)[3]["key"])["product"] = "SPOT"
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("REQUIREMENT_UNSERVICEABLE",)


def test_no_fill_decision_is_valid_without_fabricated_fill_clock() -> None:
    frame = _frame()
    frame["fillState"] = "NO_FILL"
    frame["fillAt"] = None
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.VALID
    assert receipt.fill_bounds is None


@pytest.mark.parametrize("bad_value", [-1, 1.5, True, "1735689660003000"])
def test_invalid_timestamp_lexemes_fail_closed(bad_value: object) -> None:
    frame = _frame()
    _stamp(frame, "decisionAt")["value"] = bad_value
    receipt = validate_causal_asof_mapping_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes[0] in {"INTEGER_INVALID", "INTEGER_OUT_OF_RANGE"}


def test_extra_and_missing_mapping_keys_fail_closed() -> None:
    extra = _frame()
    extra["surprise"] = "forbidden"
    extra_receipt = validate_causal_asof_mapping_v1(extra)
    assert extra_receipt.status is ValidationStatus.INVALID
    assert extra_receipt.reason_codes == ("KEYSET_INVALID",)

    missing = _frame()
    del missing["fillState"]
    missing_receipt = validate_causal_asof_mapping_v1(missing)
    assert missing_receipt.status is ValidationStatus.INVALID
    assert missing_receipt.reason_codes == ("KEYSET_INVALID",)


def test_object_and_mapping_entrypoints_agree() -> None:
    assert dq13.validate_causal_asof_v1(_object_frame()) == validate_causal_asof_mapping_v1(
        _frame()
    )


def test_object_entrypoint_rejects_non_frame_input() -> None:
    receipt = dq13.validate_causal_asof_v1({"schema": dq13.SCHEMA_V1})
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("FRAME_INVALID",)


def test_object_entrypoint_rejects_look_alike_fill_state() -> None:
    frame = dataclasses.replace(
        _object_frame(),
        fill_state=cast(dq13.FillState, "EXECUTED"),
        fill_at=None,
    )
    receipt = dq13.validate_causal_asof_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("ENUM_INVALID",)
    assert receipt.failure_path == "$.fillState"


def test_object_entrypoint_rejects_retired_source_profile() -> None:
    frame = _with_observation(
        _object_frame(),
        0,
        {"source_profile": "SPOT_WS_US"},
    )
    receipt = dq13.validate_causal_asof_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("ENUM_INVALID",)
    assert receipt.failure_path == "$.observations[0].sourceProfile"


@pytest.mark.parametrize(
    ("field", "reason"),
    [
        ("record_id", "ID_INVALID"),
        ("key", "KEY_INVALID"),
        ("shape", "ENUM_INVALID"),
        ("availability_basis", "ENUM_INVALID"),
        ("payload_digest", "DIGEST_INVALID"),
        ("availability_evidence_id", "ID_INVALID"),
        ("availability_evidence_digest", "DIGEST_INVALID"),
        ("event_at", "STAMP_INVALID"),
        ("available_at", "STAMP_INVALID"),
        ("interval_open", "STAMP_INVALID"),
        ("interval_close_inclusive", "STAMP_INVALID"),
        ("is_final", "BOOLEAN_INVALID"),
    ],
)
def test_object_entrypoint_rejects_wrong_observation_field_types(field: str, reason: str) -> None:
    frame = _with_observation(_object_frame(), 0, {field: object()})
    receipt = dq13.validate_causal_asof_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == (reason,)


@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ({"requirements": ("nope",)}, "REQUIREMENT_INVALID"),
        ({"observations": ("nope",)}, "OBSERVATION_INVALID"),
        ({"requirements": []}, "SEQUENCE_REQUIRED"),
        ({"observations": []}, "SEQUENCE_REQUIRED"),
        ({"requirements": ()}, "REQUIREMENT_COUNT_INVALID"),
        ({"schema": "other"}, "SCHEMA_MISMATCH"),
        ({"decision_id": ""}, "ID_INVALID"),
        ({"decision_at": object()}, "STAMP_INVALID"),
    ],
)
def test_object_entrypoint_rejects_malformed_frames(
    changes: dict[str, object],
    reason: str,
) -> None:
    frame = _forced_replace(_object_frame(), changes)
    receipt = dq13.validate_causal_asof_v1(frame)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == (reason,)


def test_object_entrypoint_rejects_duplicate_requirement_keys() -> None:
    frame = _object_frame()
    duplicated = dataclasses.replace(
        frame,
        requirements=(frame.requirements[0], frame.requirements[0]),
    )
    receipt = dq13.validate_causal_asof_v1(duplicated)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("DUPLICATE_REQUIREMENT",)


def test_object_entrypoint_rejects_out_of_range_requirement_ages() -> None:
    frame = _object_frame()
    requirements = list(frame.requirements)
    requirements[0] = dataclasses.replace(requirements[0], max_availability_age_us=0)
    receipt = dq13.validate_causal_asof_v1(
        dataclasses.replace(frame, requirements=tuple(requirements))
    )
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("INTEGER_OUT_OF_RANGE",)


@pytest.mark.parametrize(
    ("payload", "reason"),
    [
        (b'{"schema":"x","schema":"y"}', "JSON_DUPLICATE_KEY"),
        (b'{"value":NaN}', "JSON_NONFINITE"),
        (b"\xff", "JSON_INVALID"),
        (b"[]", "MAPPING_REQUIRED"),
        (b"", "JSON_SIZE_INVALID"),
    ],
)
def test_json_boundary_is_bounded_and_strict(payload: bytes, reason: str) -> None:
    receipt = validate_causal_asof_json_v1(payload)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == (reason,)


def test_json_boundary_rejects_nonbytes_and_oversize() -> None:
    nonbytes = validate_causal_asof_json_v1("{}")
    assert nonbytes.reason_codes == ("JSON_BYTES_INVALID",)
    oversize = validate_causal_asof_json_v1(b" " * 2_097_153)
    assert oversize.reason_codes == ("JSON_SIZE_INVALID",)


def test_mapping_cardinality_caps_are_replayed() -> None:
    too_many_requirements = _frame()
    too_many_requirements["requirements"] = [
        copy.deepcopy(_requirements(too_many_requirements)[0]) for _ in range(65)
    ]
    requirement_receipt = validate_causal_asof_mapping_v1(too_many_requirements)
    assert requirement_receipt.reason_codes == ("REQUIREMENT_COUNT_INVALID",)

    too_many_observations = _frame()
    too_many_observations["observations"] = [
        copy.deepcopy(_observations(too_many_observations)[0]) for _ in range(4097)
    ]
    observation_receipt = validate_causal_asof_mapping_v1(too_many_observations)
    assert observation_receipt.reason_codes == ("OBSERVATION_COUNT_INVALID",)


def test_json_boundary_catches_nesting_recursion() -> None:
    payload = b"[" * 20_000 + b"0" + b"]" * 20_000
    receipt = validate_causal_asof_json_v1(payload)
    assert receipt.status is ValidationStatus.INVALID
    assert receipt.reason_codes == ("JSON_NESTING_INVALID",)


def test_unexpected_validator_exception_returns_invalid_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def explode(*_args: object, **_kwargs: object) -> object:
        raise RuntimeError("deliberate test failure")

    monkeypatch.setattr(validator_module, "_select_requirement", explode)
    frame = _frame()
    object_frame = dq13.frame_from_mapping_v1(frame)
    payload = canonical_json_bytes_v1(frame)
    for receipt in (
        dq13.validate_causal_asof_v1(object_frame),
        validate_causal_asof_mapping_v1(frame),
        validate_causal_asof_json_v1(payload),
    ):
        assert receipt.status is ValidationStatus.INVALID
        assert receipt.reason_codes == ("VALIDATOR_EXCEPTION",)
        assert receipt.failure_path == "$"


def test_mapping_and_json_entrypoints_are_byte_identical() -> None:
    frame = _frame()
    mapping_receipt = validate_causal_asof_mapping_v1(frame)
    data = canonical_json_bytes_v1(frame)
    json_receipt = validate_causal_asof_json_v1(data)
    assert json_receipt == mapping_receipt
    assert json_receipt.canonical_bytes() == mapping_receipt.canonical_bytes()


def test_canonical_json_rejects_nonfinite_values() -> None:
    with pytest.raises(dq13.ClockContractError, match="CANONICAL_JSON_INVALID"):
        canonical_json_bytes_v1({"bad": float("nan")})


def test_receipt_is_canonical_lf_terminated_and_self_bound() -> None:
    receipt = validate_causal_asof_mapping_v1(_frame())
    data = receipt.canonical_bytes()
    assert data.endswith(b"\n")
    assert data.count(b"\n") == 1
    decoded = _dict(json.loads(data))
    assert decoded["receiptDigest"] == receipt.receipt_digest
    assert len(receipt.receipt_digest) == 64
    changed = _frame()
    _stamp(changed, "fillAt")["value"] = _D + 5000
    assert validate_causal_asof_mapping_v1(changed).receipt_digest != receipt.receipt_digest
