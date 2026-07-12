"""Q14 trial ledger, CSCV PBO, Benjamini-Hochberg and bootstrap interval law."""

from __future__ import annotations

from dataclasses import replace
from math import comb

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.validation.bootstrap import (
    BootstrapIntervalV1,
    BootstrapSpecV1,
    BootstrapStatus,
    block_bootstrap_interval,
)
from quant_edge.validation.multiplicity import (
    BhReportV1,
    PboReportV1,
    PboStatus,
    TrialLedgerV1,
    TrialRecordV1,
    TrialStatus,
    benjamini_hochberg,
    distinct_trial_count,
    pbo_cscv,
)

SCALE = 10**12


def _trial(index: int, status: TrialStatus = TrialStatus.COMPLETED) -> TrialRecordV1:
    return TrialRecordV1(
        trial_id=f"t-{index:03d}",
        family_id="family-h1",
        model_id=f"model-{index:03d}",
        metric_id="pr_auc",
        status=status,
        note="synthetic trial",
    )


def test_trial_record_contract_law() -> None:
    with pytest.raises(ContractValueError, match="trial_id"):
        TrialRecordV1(
            trial_id="bad id",
            family_id="f",
            model_id="m",
            metric_id="x",
            status=TrialStatus.COMPLETED,
            note="",
        )
    with pytest.raises(ContractValueError, match="TrialStatus"):
        TrialRecordV1(
            trial_id="t",
            family_id="f",
            model_id="m",
            metric_id="x",
            status="COMPLETED",  # type: ignore[arg-type]
            note="",
        )
    with pytest.raises(ContractValueError, match="note"):
        TrialRecordV1(
            trial_id="t",
            family_id="f",
            model_id="m",
            metric_id="x",
            status=TrialStatus.COMPLETED,
            note="x" * 201,
        )


def test_trial_ledger_law() -> None:
    ledger = TrialLedgerV1(
        trials=(
            _trial(0),
            _trial(1, TrialStatus.FAILED),
            _trial(2, TrialStatus.ABANDONED),
        )
    )
    assert ledger.attempted_count == 3
    assert ledger.count_by_status(TrialStatus.FAILED) == 1
    assert ledger.digest() == ledger.digest()
    assert ledger.as_mapping()["schema"] == "Q14TrialLedgerV1"
    with pytest.raises(ContractValueError, match="TrialStatus"):
        ledger.count_by_status("FAILED")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="non-empty"):
        TrialLedgerV1(trials=())
    with pytest.raises(ContractValueError, match="TrialRecordV1"):
        TrialLedgerV1(trials=("t",))  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="sorted"):
        TrialLedgerV1(trials=(_trial(1), _trial(0)))
    with pytest.raises(ContractValueError, match="sorted"):
        TrialLedgerV1(trials=(_trial(0), _trial(0)))


def test_trial_ledger_bound_law(monkeypatch: pytest.MonkeyPatch) -> None:
    import quant_edge.validation.multiplicity as multiplicity_module

    monkeypatch.setattr(multiplicity_module, "MAX_TRIALS", 2)
    with pytest.raises(ContractValueError, match="MAX_TRIALS"):
        TrialLedgerV1(trials=(_trial(0), _trial(1), _trial(2)))


def _blocks(*rows: list[int]) -> tuple[tuple[ExactRatioV1, ...], ...]:
    return tuple(tuple(make_ratio(value, 100) for value in row) for row in rows)


def test_pbo_report_contract_law() -> None:
    with pytest.raises(ContractValueError, match="PboStatus"):
        PboReportV1(
            status="AVAILABLE",  # type: ignore[arg-type]
            reason=None,
            trial_count=2,
            block_count=4,
            split_count=6,
            underperform_count=3,
            pbo=FixedPointV1(SCALE // 2),
        )
    with pytest.raises(ContractValueError, match="pbo and no reason"):
        PboReportV1(
            status=PboStatus.AVAILABLE,
            reason=None,
            trial_count=2,
            block_count=4,
            split_count=6,
            underperform_count=3,
            pbo=None,
        )
    with pytest.raises(ContractValueError, match="reason and no pbo"):
        PboReportV1(
            status=PboStatus.INVALID,
            reason="SOME_REASON",
            trial_count=2,
            block_count=4,
            split_count=6,
            underperform_count=3,
            pbo=FixedPointV1(SCALE // 2),
        )
    with pytest.raises(ContractValueError, match="underperform_count"):
        PboReportV1(
            status=PboStatus.INVALID,
            reason="SOME_REASON",
            trial_count=2,
            block_count=4,
            split_count=6,
            underperform_count=7,
            pbo=None,
        )


def test_pbo_validity_gates() -> None:
    with pytest.raises(ContractValueError, match="tuple"):
        pbo_cscv("nope")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="same block tuple"):
        pbo_cscv(_blocks([1, 2, 3, 4], [1, 2, 3]))
    with pytest.raises(ContractValueError, match="ExactRatioV1"):
        pbo_cscv(((0.5, 0.5, 0.5, 0.5),))  # type: ignore[arg-type]
    assert pbo_cscv(_blocks([1, 2, 3, 4])).reason == "FEWER_THAN_TWO_TRIALS"
    assert pbo_cscv(_blocks([1, 2], [2, 1])).reason == "BLOCK_COUNT_OUT_OF_RANGE"
    eighteen = list(range(18))
    assert pbo_cscv(_blocks(eighteen, eighteen)).reason == "BLOCK_COUNT_OUT_OF_RANGE"
    five = [1, 2, 3, 4, 5]
    assert pbo_cscv(_blocks(five, five)).reason == "ODD_BLOCK_COUNT"


def test_pbo_bound_law(monkeypatch: pytest.MonkeyPatch) -> None:
    import quant_edge.validation.multiplicity as multiplicity_module

    monkeypatch.setattr(multiplicity_module, "MAX_PBO_TRIALS", 2)
    rows = _blocks([1, 2, 3, 4], [4, 3, 2, 1], [2, 2, 2, 2])
    with pytest.raises(ContractValueError, match="MAX_PBO_TRIALS"):
        pbo_cscv(rows)


def test_pbo_detects_selection_noise_and_persistent_skill() -> None:
    # Persistent leader: trial 0 wins every block, so the in-sample champion
    # never underperforms out of sample.
    persistent = pbo_cscv(_blocks([9, 9, 9, 9, 9, 9], [1, 1, 1, 1, 1, 1], [2, 1, 2, 1, 2, 1]))
    assert persistent.status is PboStatus.AVAILABLE
    assert persistent.split_count == comb(6, 3)
    assert persistent.underperform_count == 0
    assert persistent.pbo == FixedPointV1(0)

    # Anti-persistent pair: whoever wins in sample loses out of sample.
    flippy = pbo_cscv(_blocks([9, 1, 9, 1], [1, 9, 1, 9]))
    assert flippy.status is PboStatus.AVAILABLE
    assert flippy.underperform_count > flippy.split_count // 2

    # Identical trials: selection is pure noise and the conservative tie law
    # counts every split, an honest signal that picking among clones overfits.
    clones = pbo_cscv(_blocks([3, 3, 3, 3], [3, 3, 3, 3]))
    assert clones.status is PboStatus.AVAILABLE
    assert clones.pbo == FixedPointV1(SCALE)
    mapping = clones.as_mapping()
    assert mapping["splitCount"] == comb(4, 2)


def test_benjamini_hochberg_law() -> None:
    p_values = (
        ("t-a", make_ratio(1, 1000)),
        ("t-b", make_ratio(2, 100)),
        ("t-c", make_ratio(3, 100)),
        ("t-d", make_ratio(90, 100)),
    )
    report = benjamini_hochberg(p_values, fdr_per_myriad=500)
    assert isinstance(report, BhReportV1)
    assert report.tested_count == 4
    assert report.rejected_trial_ids == ("t-a", "t-b", "t-c")
    assert report.as_mapping()["fdrPerMyriad"] == 500

    none_rejected = benjamini_hochberg((("t-a", make_ratio(9, 10)),), fdr_per_myriad=500)
    assert none_rejected.rejected_trial_ids == ()

    with pytest.raises(ContractValueError, match="fdr_per_myriad"):
        benjamini_hochberg(p_values, fdr_per_myriad=0)
    with pytest.raises(ContractValueError, match="non-empty"):
        benjamini_hochberg((), fdr_per_myriad=500)
    with pytest.raises(ContractValueError, match="trial_id, ExactRatioV1"):
        benjamini_hochberg((("t-a",),), fdr_per_myriad=500)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="duplicate"):
        benjamini_hochberg(
            (("t-a", make_ratio(1, 10)), ("t-a", make_ratio(2, 10))),
            fdr_per_myriad=500,
        )
    with pytest.raises(ContractValueError, match="ExactRatioV1"):
        benjamini_hochberg((("t-a", 0.5),), fdr_per_myriad=500)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="lie in"):
        benjamini_hochberg((("t-a", make_ratio(3, 2)),), fdr_per_myriad=500)


def test_distinct_trial_count_collapses_exact_clones() -> None:
    rows = _blocks([1, 2, 3, 4], [1, 2, 3, 4], [4, 3, 2, 1])
    assert distinct_trial_count(rows) == 2
    with pytest.raises(ContractValueError, match="bounded tuple"):
        distinct_trial_count("nope")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="tuple"):
        distinct_trial_count(([1, 2],))  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="ExactRatioV1"):
        distinct_trial_count(((0.5,),))  # type: ignore[arg-type]


def _spec(**overrides: object) -> BootstrapSpecV1:
    base = BootstrapSpecV1(
        seed=20260712,
        block_length=2,
        replicates=64,
        coverage_per_myriad=9_500,
    )
    return replace(base, **overrides)  # type: ignore[arg-type]


def test_bootstrap_spec_and_interval_contract_law() -> None:
    with pytest.raises(ContractValueError, match="coverage_per_myriad"):
        _spec(coverage_per_myriad=4_000)
    with pytest.raises(ContractValueError, match="replicates"):
        _spec(replicates=4)
    spec = _spec()
    with pytest.raises(ContractValueError, match="BootstrapStatus"):
        BootstrapIntervalV1(
            status="AVAILABLE",  # type: ignore[arg-type]
            reason=None,
            point_estimate=FixedPointV1(0),
            lower=FixedPointV1(0),
            upper=FixedPointV1(0),
            value_count=8,
            spec=spec,
        )
    with pytest.raises(ContractValueError, match="endpoints and no reason"):
        BootstrapIntervalV1(
            status=BootstrapStatus.AVAILABLE,
            reason=None,
            point_estimate=None,
            lower=None,
            upper=None,
            value_count=8,
            spec=spec,
        )
    with pytest.raises(ContractValueError, match="no endpoints"):
        BootstrapIntervalV1(
            status=BootstrapStatus.INVALID,
            reason="SOME_REASON",
            point_estimate=FixedPointV1(0),
            lower=None,
            upper=None,
            value_count=8,
            spec=spec,
        )
    with pytest.raises(ContractValueError, match="carry a reason"):
        BootstrapIntervalV1(
            status=BootstrapStatus.INVALID,
            reason=None,
            point_estimate=None,
            lower=None,
            upper=None,
            value_count=8,
            spec=spec,
        )
    with pytest.raises(ContractValueError, match="spec"):
        BootstrapIntervalV1(
            status=BootstrapStatus.INVALID,
            reason="SOME_REASON",
            point_estimate=None,
            lower=None,
            upper=None,
            value_count=8,
            spec="spec",  # type: ignore[arg-type]
        )


def test_bootstrap_interval_gates_and_geometry() -> None:
    spec = _spec()
    with pytest.raises(ContractValueError, match="BootstrapSpecV1"):
        block_bootstrap_interval((), "nope")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="tuple"):
        block_bootstrap_interval([make_ratio(1, 2)], spec)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="ExactRatioV1"):
        block_bootstrap_interval((0.5,), spec)  # type: ignore[arg-type]

    short = block_bootstrap_interval((make_ratio(1, 2),) * 3, spec)
    assert short.status is BootstrapStatus.INVALID
    assert short.reason == "INSUFFICIENT_VALUES"

    long_block = block_bootstrap_interval((make_ratio(1, 2),) * 6, _spec(block_length=7))
    assert long_block.reason == "BLOCK_LONGER_THAN_SERIES"

    values = tuple(make_ratio(index - 4, 10) for index in range(12))
    interval = block_bootstrap_interval(values, spec)
    assert interval.status is BootstrapStatus.AVAILABLE
    assert interval.lower is not None
    assert interval.upper is not None
    assert interval.point_estimate is not None
    assert interval.lower.mantissa <= interval.point_estimate.mantissa
    assert interval.point_estimate.mantissa <= interval.upper.mantissa
    assert interval.as_mapping()["valueCount"] == 12

    replay = block_bootstrap_interval(values, spec)
    assert replay == interval

    uneven = block_bootstrap_interval(values[:11], _spec(block_length=3))
    assert uneven.status is BootstrapStatus.AVAILABLE

    constant = block_bootstrap_interval((make_ratio(1, 2),) * 8, spec)
    assert constant.lower == constant.upper == constant.point_estimate


def test_bootstrap_values_bound_law(monkeypatch: pytest.MonkeyPatch) -> None:
    import quant_edge.validation.bootstrap as bootstrap_module

    monkeypatch.setattr(bootstrap_module, "MAX_VALUES", 4)
    with pytest.raises(ContractValueError, match="MAX_VALUES"):
        block_bootstrap_interval((make_ratio(1, 2),) * 5, _spec())
