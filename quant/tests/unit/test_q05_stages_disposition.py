from __future__ import annotations

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.labels.disposition import (
    DispositionRecordV1,
    DispositionSource,
    EventDisposition,
    WindowQualityFactsV1,
    derive_disposition,
)
from quant_edge.labels.rational import make_ratio
from quant_edge.labels.stages import (
    StageAssignmentV1,
    StageDefinitionV1,
    StageEvidenceV1,
    StageLabel,
    generate_stage,
)
from quant_edge.lake.contracts import DigestV1


def _definition() -> StageDefinitionV1:
    return StageDefinitionV1(
        definition_version="stage-v1",
        dormant_max_count=1,
        ignition_ratio=make_ratio(3, 1),
        continuation_floor_ratio=make_ratio(2, 1),
        fade_ceiling_ratio=make_ratio(1, 2),
    )


def _evidence(
    window: tuple[int, ...],
    *,
    baseline: tuple[int, ...] = (2, 2, 2),
    net_return_sign: int = 1,
    window_complete: bool = True,
    disorder_observed: bool = False,
) -> StageEvidenceV1:
    return StageEvidenceV1(
        baseline_bucket_counts=baseline,
        window_bucket_counts=window,
        net_return_sign=net_return_sign,
        window_complete=window_complete,
        disorder_observed=disorder_observed,
    )


class TestStageClassifier:
    @pytest.mark.parametrize(
        ("evidence", "expected", "rationale"),
        [
            (
                _evidence((6, 6, 6), disorder_observed=True),
                StageLabel.DISORDER,
                "DISORDER_EVIDENCE_OBSERVED",
            ),
            (
                _evidence((6, 6, 6), window_complete=False),
                StageLabel.UNKNOWN,
                "WINDOW_INCOMPLETE",
            ),
            (
                _evidence((1, 0, 1), baseline=(1, 1, 0)),
                StageLabel.DORMANT,
                "ACTIVITY_BELOW_DORMANT_MAX",
            ),
            (
                _evidence((2, 3, 2)),
                StageLabel.NO_EVENT,
                "ACTIVITY_NEVER_IGNITED",
            ),
            (
                _evidence((2, 2, 8)),
                StageLabel.IGNITION,
                "IGNITION_AT_WINDOW_END",
            ),
            (
                _evidence((6, 8, 12)),
                StageLabel.EARLY_EXPANSION,
                "ACTIVITY_STILL_GROWING_AT_WINDOW_END",
            ),
            (
                _evidence((8, 12, 0)),
                StageLabel.FADE,
                "ACTIVITY_COLLAPSED_BELOW_FADE_CEILING",
            ),
            (
                _evidence((8, 12, 6), net_return_sign=-1),
                StageLabel.UNWIND,
                "SUSTAINED_ACTIVITY_WITH_NEGATIVE_REVERSAL",
            ),
            (
                _evidence((8, 12, 6)),
                StageLabel.CONTINUATION,
                "ACTIVITY_SUSTAINED_ABOVE_CONTINUATION_FLOOR",
            ),
            (
                _evidence((8, 12, 3)),
                StageLabel.EXHAUSTION,
                "ACTIVITY_DECAYING_BETWEEN_FLOORS",
            ),
        ],
    )
    def test_versioned_rules_cover_the_full_vocabulary(
        self,
        evidence: StageEvidenceV1,
        expected: StageLabel,
        rationale: str,
    ) -> None:
        assignment = generate_stage(evidence, _definition())

        assert assignment.stage is expected
        assert assignment.rationale_code == rationale
        assert assignment.definition_version == "stage-v1"
        assert assignment.evidence_digest == evidence.evidence_digest()

    def test_zero_baseline_ignites_on_any_activity(self) -> None:
        assignment = generate_stage(
            _evidence((0, 0, 4), baseline=(0, 0, 0)),
            _definition(),
        )

        assert assignment.stage is StageLabel.IGNITION

    def test_identical_evidence_reproduces_identical_assignments(self) -> None:
        evidence = _evidence((8, 12, 6))
        first = generate_stage(evidence, _definition())
        second = generate_stage(evidence, _definition())

        assert first == second

    def test_no_relabeling_path_exists(self) -> None:
        assignment = generate_stage(_evidence((8, 12, 6)), _definition())
        with pytest.raises(AttributeError):
            assignment.stage = StageLabel.CONTINUATION  # type: ignore[misc]

    def test_input_contracts(self) -> None:
        with pytest.raises(ContractValueError):
            generate_stage("evidence", _definition())  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            generate_stage(_evidence((1, 2, 3)), "definition")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            _evidence(())
        with pytest.raises(ContractValueError):
            _evidence((1, -2))
        with pytest.raises(ContractValueError):
            _evidence((1, 2), net_return_sign=2)
        with pytest.raises(ContractValueError):
            _evidence((1, 2), window_complete="yes")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            StageEvidenceV1(
                baseline_bucket_counts=(None,) * 5_000,  # type: ignore[arg-type]
                window_bucket_counts=(1,),
                net_return_sign=0,
                window_complete=True,
                disorder_observed=False,
            )

    def test_definition_contracts(self) -> None:
        with pytest.raises(ContractValueError):
            StageDefinitionV1(
                definition_version="v1",
                dormant_max_count=0,
                ignition_ratio=make_ratio(1, 1),
                continuation_floor_ratio=make_ratio(2, 1),
                fade_ceiling_ratio=make_ratio(1, 2),
            )
        with pytest.raises(ContractValueError):
            StageDefinitionV1(
                definition_version="v1",
                dormant_max_count=0,
                ignition_ratio=make_ratio(3, 1),
                continuation_floor_ratio=make_ratio(1, 2),
                fade_ceiling_ratio=make_ratio(2, 1),
            )
        with pytest.raises(ContractValueError):
            StageDefinitionV1(
                definition_version="v1",
                dormant_max_count=0,
                ignition_ratio="fast",  # type: ignore[arg-type]
                continuation_floor_ratio=make_ratio(2, 1),
                fade_ceiling_ratio=make_ratio(1, 2),
            )
        with pytest.raises(ContractValueError):
            StageDefinitionV1(
                definition_version="v1",
                dormant_max_count=0,
                ignition_ratio=make_ratio(3, 1),
                continuation_floor_ratio=make_ratio(-2, 1),
                fade_ceiling_ratio=make_ratio(1, 2),
            )

    def test_assignment_contracts(self) -> None:
        digest = _evidence((1, 2)).evidence_digest()
        with pytest.raises(ContractValueError):
            StageAssignmentV1(
                definition_version="v1",
                stage="DORMANT",  # type: ignore[arg-type]
                rationale_code="X",
                evidence_digest=digest,
            )
        with pytest.raises(ContractValueError):
            StageAssignmentV1(
                definition_version="v1",
                stage=StageLabel.DORMANT,
                rationale_code="X",
                evidence_digest="digest",  # type: ignore[arg-type]
            )
        assert isinstance(digest, DigestV1)


class TestDispositionLaw:
    def test_quality_law_overrides_everything(self) -> None:
        gapped = WindowQualityFactsV1(
            gap_row_count=1,
            duplicate_row_count=0,
            completeness_known=True,
        )
        record = derive_disposition(
            sample_id="sample-1",
            event_id="event-1",
            quality=gapped,
            is_control_window=False,
        )

        assert record.disposition is EventDisposition.DATA_INVALID
        assert record.source is DispositionSource.QUALITY_LAW
        assert record.record_id.startswith("q05disposition:")

    def test_unknown_completeness_is_never_a_normal_negative(self) -> None:
        unknown = WindowQualityFactsV1(
            gap_row_count=0,
            duplicate_row_count=0,
            completeness_known=False,
        )
        record = derive_disposition(
            sample_id="sample-1",
            event_id="event-1",
            quality=unknown,
            is_control_window=True,
        )

        assert record.disposition is EventDisposition.DATA_INVALID

    def test_operational_assertions_and_defaults(self) -> None:
        clean = WindowQualityFactsV1(
            gap_row_count=0,
            duplicate_row_count=0,
            completeness_known=True,
        )
        acted = derive_disposition(
            sample_id="sample-1",
            event_id="event-1",
            quality=clean,
            is_control_window=False,
            asserted=EventDisposition.ACTED,
        )
        control = derive_disposition(
            sample_id="sample-2",
            event_id="event-2",
            quality=clean,
            is_control_window=True,
        )
        missed = derive_disposition(
            sample_id="sample-3",
            event_id="event-3",
            quality=clean,
            is_control_window=False,
        )

        assert acted.disposition is EventDisposition.ACTED
        assert acted.source is DispositionSource.OPERATIONAL_RECORD
        assert control.disposition is EventDisposition.QUIET_CONTROL
        assert missed.disposition is EventDisposition.MISSED
        assert missed.as_mapping()["schema"] == "Q05DispositionRecordV1"

    def test_assertion_contracts(self) -> None:
        clean = WindowQualityFactsV1(
            gap_row_count=0,
            duplicate_row_count=0,
            completeness_known=True,
        )
        with pytest.raises(ContractValueError):
            derive_disposition(
                sample_id="sample-1",
                event_id="event-1",
                quality=clean,
                is_control_window=False,
                asserted=EventDisposition.QUIET_CONTROL,
            )
        with pytest.raises(ContractValueError):
            derive_disposition(
                sample_id="sample-1",
                event_id="event-1",
                quality=clean,
                is_control_window=True,
                asserted=EventDisposition.ACTED,
            )
        with pytest.raises(ContractValueError):
            derive_disposition(
                sample_id="sample-1",
                event_id="event-1",
                quality="clean",  # type: ignore[arg-type]
                is_control_window=False,
            )
        with pytest.raises(ContractValueError):
            derive_disposition(
                sample_id="sample-1",
                event_id="event-1",
                quality=clean,
                is_control_window="no",  # type: ignore[arg-type]
            )

    def test_record_contract_rejects_incoherent_or_forged_records(self) -> None:
        clean = WindowQualityFactsV1(
            gap_row_count=0,
            duplicate_row_count=0,
            completeness_known=True,
        )
        record = derive_disposition(
            sample_id="sample-1",
            event_id="event-1",
            quality=clean,
            is_control_window=False,
        )
        with pytest.raises(ContractValueError):
            DispositionRecordV1(
                record_id=record.record_id,
                sample_id=record.sample_id,
                event_id=record.event_id,
                disposition=EventDisposition.DATA_INVALID,
                source=record.source,
                quality=clean,
                reason_code=record.reason_code,
            )
        with pytest.raises(ContractValueError):
            DispositionRecordV1(
                record_id="q05disposition:forged",
                sample_id=record.sample_id,
                event_id=record.event_id,
                disposition=record.disposition,
                source=record.source,
                quality=clean,
                reason_code=record.reason_code,
            )
        with pytest.raises(ContractValueError):
            DispositionRecordV1(
                record_id=record.record_id,
                sample_id=record.sample_id,
                event_id=record.event_id,
                disposition="MISSED",  # type: ignore[arg-type]
                source=record.source,
                quality=clean,
                reason_code=record.reason_code,
            )
        with pytest.raises(ContractValueError):
            DispositionRecordV1(
                record_id=record.record_id,
                sample_id=record.sample_id,
                event_id=record.event_id,
                disposition=record.disposition,
                source="FACTORY",  # type: ignore[arg-type]
                quality=clean,
                reason_code=record.reason_code,
            )
        with pytest.raises(ContractValueError):
            DispositionRecordV1(
                record_id=record.record_id,
                sample_id=record.sample_id,
                event_id=record.event_id,
                disposition=record.disposition,
                source=record.source,
                quality="clean",  # type: ignore[arg-type]
                reason_code=record.reason_code,
            )
        with pytest.raises(ContractValueError):
            DispositionRecordV1(
                record_id=record.record_id,
                sample_id=record.sample_id,
                event_id=record.event_id,
                disposition=record.disposition,
                source=record.source,
                quality=clean,
                reason_code="lower case",
            )

    def test_quality_fact_contracts(self) -> None:
        with pytest.raises(ContractValueError):
            WindowQualityFactsV1(
                gap_row_count=-1,
                duplicate_row_count=0,
                completeness_known=True,
            )
        with pytest.raises(ContractValueError):
            WindowQualityFactsV1(
                gap_row_count=0,
                duplicate_row_count=-1,
                completeness_known=True,
            )
        with pytest.raises(ContractValueError):
            WindowQualityFactsV1(
                gap_row_count=0,
                duplicate_row_count=0,
                completeness_known="yes",  # type: ignore[arg-type]
            )
        duplicated = WindowQualityFactsV1(
            gap_row_count=0,
            duplicate_row_count=2,
            completeness_known=True,
        )
        assert duplicated.invalid
