"""Q10 transparent-and-boosted model battery (§14.1-§14.3).

Pure deterministic advisory research machinery: calibrated linear baselines,
honest controls, the Q01-selected XGBoost challengers and bounded fully-logged
Optuna studies over synthetic planted-structure datasets. Binary64 exists only
inside the engine and dies at the single quantization boundary; every public
numeric contract is exact. All proofs are honest SYNTHETIC fixtures; nothing
here claims a model is predictive, validated or economically valuable, and the
Q14-owned validation factory is recorded WAITING_Q14, never reimplemented.
"""

from quant_edge.models.contracts import (
    BatteryDisposition,
    BatteryDispositionRecordV1,
    CalibrationMethod,
    ComparisonReportV1,
    MetricDerivation,
    MetricDirection,
    MetricValueV1,
    ModelResultV1,
    ModelRole,
    ProbabilitySemantics,
    TargetKind,
    disposition_table_digest,
    make_comparison_report,
    prediction_digest,
)
from quant_edge.models.quantize import (
    quantize_binary64,
    quantize_probability,
    quantize_probability_vector,
    quantize_vector,
)
from quant_edge.models.split import SPLIT_AUTHORITY, InternalChronologicalSplitV1
from quant_edge.models.synthetic import (
    BATTERY_DATASET_ID,
    QUANTILE_LEVELS,
    TARGET_BINARY_ID,
    TARGET_QUANTILE_ID,
    TARGET_RANK_ID,
    TARGET_REGRESSION_ID,
    FeatureRole,
    SyntheticDatasetV1,
    SyntheticFeatureSpecV1,
    SyntheticTargetV1,
    battery_split,
    build_battery_dataset,
    require_learnable_binary,
)

__all__ = [
    "BATTERY_DATASET_ID",
    "QUANTILE_LEVELS",
    "SPLIT_AUTHORITY",
    "TARGET_BINARY_ID",
    "TARGET_QUANTILE_ID",
    "TARGET_RANK_ID",
    "TARGET_REGRESSION_ID",
    "BatteryDisposition",
    "BatteryDispositionRecordV1",
    "CalibrationMethod",
    "ComparisonReportV1",
    "FeatureRole",
    "InternalChronologicalSplitV1",
    "MetricDerivation",
    "MetricDirection",
    "MetricValueV1",
    "ModelResultV1",
    "ModelRole",
    "ProbabilitySemantics",
    "SyntheticDatasetV1",
    "SyntheticFeatureSpecV1",
    "SyntheticTargetV1",
    "TargetKind",
    "battery_split",
    "build_battery_dataset",
    "disposition_table_digest",
    "make_comparison_report",
    "prediction_digest",
    "quantize_binary64",
    "quantize_probability",
    "quantize_probability_vector",
    "quantize_vector",
    "require_learnable_binary",
]
