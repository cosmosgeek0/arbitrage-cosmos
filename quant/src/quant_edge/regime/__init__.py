"""Deterministic §13.4/§14.5/§14.7 change, regime, anomaly and analog layer (Q09).

Pure library: quality-gated observation contracts, two-sided CUSUM and Page-Hinkley,
offline PELT over a declared quantized SSE objective, bounded-run-length BOCPD over a
robust alphabet, a soft-regime filter behind the stable `RegimeModel` interface, the
robust MAD anomaly baseline with a fused disorder/OOD state, an earlier-only left
Matrix Profile with exact correlation-order comparisons, earlier-only analog retrieval
with measured exclusions, and the detection/segmentation/anomaly measurement harness.
All executable proofs are honest SYNTHETIC fixtures; nothing here claims a detector,
regime, anomaly score or analogue is predictive, calibrated or economically valuable.
"""

from quant_edge.regime.alphabet import (
    AlphabetConfigV1,
    RobustDiscretizer,
)
from quant_edge.regime.analog import (
    AnalogExclusionReason,
    AnalogNeighborV1,
    AnalogQueryV1,
    AnalogRecordV1,
    AnalogRetrievalV1,
    AnalogStatus,
    retrieve_analogs,
)
from quant_edge.regime.anomaly import (
    SCORE_SEMANTICS,
    AnomalyReason,
    AnomalyStepV1,
    DisorderAssessmentV1,
    DisorderConfigV1,
    DisorderReason,
    DisorderState,
    RobustAnomalyConfigV1,
    RobustAnomalyScorer,
    fuse_disorder,
)
from quant_edge.regime.bocpd import (
    BocpdConfigV1,
    BocpdDetector,
    BocpdStepV1,
)
from quant_edge.regime.contracts import (
    AlarmDirection,
    InputDisposition,
    ObservationSeriesV1,
    ObservationV1,
    OrdinalGuard,
    SequentialDetector,
    StepStatus,
    alarm_ordinals,
    disposition_from_quality,
    normalize_to_scale,
    require_fixed_point,
    run_series,
)
from quant_edge.regime.cusum import (
    CusumConfigV1,
    CusumStepV1,
    TwoSidedCusum,
)
from quant_edge.regime.matrix_profile import (
    EventIntervalV1,
    ExclusionCountsV1,
    ExclusionReason,
    MatrixProfileConfigV1,
    MatrixProfileEntryV1,
    MatrixProfileV1,
    compute_left_profile,
)
from quant_edge.regime.metrics import (
    AnomalyMeasurementV1,
    DetectionBudgetV1,
    DetectionReportV1,
    SegmentationReportV1,
    evaluate_anomaly_flags,
    evaluate_detection,
    evaluate_segmentation,
)
from quant_edge.regime.page_hinkley import (
    PageHinkleyConfigV1,
    PageHinkleyStepV1,
    TwoSidedPageHinkley,
)
from quant_edge.regime.pelt import (
    PeltConfigV1,
    SegmentationV1,
    SegmentV1,
    segment_pelt,
)
from quant_edge.regime.soft_regime import (
    V1_REGIME_STATES,
    RegimeModel,
    RegimeSpecV1,
    RegimeStepV1,
    SoftRegimeFilter,
    v1_regime_spec,
)

__all__ = [
    "SCORE_SEMANTICS",
    "V1_REGIME_STATES",
    "AlarmDirection",
    "AlphabetConfigV1",
    "AnalogExclusionReason",
    "AnalogNeighborV1",
    "AnalogQueryV1",
    "AnalogRecordV1",
    "AnalogRetrievalV1",
    "AnalogStatus",
    "AnomalyMeasurementV1",
    "AnomalyReason",
    "AnomalyStepV1",
    "BocpdConfigV1",
    "BocpdDetector",
    "BocpdStepV1",
    "CusumConfigV1",
    "CusumStepV1",
    "DetectionBudgetV1",
    "DetectionReportV1",
    "DisorderAssessmentV1",
    "DisorderConfigV1",
    "DisorderReason",
    "DisorderState",
    "EventIntervalV1",
    "ExclusionCountsV1",
    "ExclusionReason",
    "InputDisposition",
    "MatrixProfileConfigV1",
    "MatrixProfileEntryV1",
    "MatrixProfileV1",
    "ObservationSeriesV1",
    "ObservationV1",
    "OrdinalGuard",
    "PageHinkleyConfigV1",
    "PageHinkleyStepV1",
    "PeltConfigV1",
    "RegimeModel",
    "RegimeSpecV1",
    "RegimeStepV1",
    "RobustAnomalyConfigV1",
    "RobustAnomalyScorer",
    "RobustDiscretizer",
    "SegmentV1",
    "SegmentationReportV1",
    "SegmentationV1",
    "SequentialDetector",
    "SoftRegimeFilter",
    "StepStatus",
    "TwoSidedCusum",
    "TwoSidedPageHinkley",
    "alarm_ordinals",
    "compute_left_profile",
    "disposition_from_quality",
    "evaluate_anomaly_flags",
    "evaluate_detection",
    "evaluate_segmentation",
    "fuse_disorder",
    "normalize_to_scale",
    "require_fixed_point",
    "retrieve_analogs",
    "run_series",
    "segment_pelt",
    "v1_regime_spec",
]
