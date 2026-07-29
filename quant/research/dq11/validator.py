"""Portable, fail-closed DQ-11 sample/admission denominator validator."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from enum import StrEnum
from typing import cast

SCHEMA_V1 = "cosmos.dq11.sample-admission-denominator.v1"
RECEIPT_SCHEMA_V1 = "cosmos.dq11.sample-admission-denominator-receipt.v1"
PUBLIC_API_V1 = (
    SCHEMA_V1,
    RECEIPT_SCHEMA_V1,
    "ContractError",
    "IdentityV1",
    "StageV1",
    "ValidationReceiptV1",
    "canonical_json_bytes_v1",
    "identity_set_digest_v1",
    "receipt_json_bytes_v1",
    "validate_bytes_v1",
    "validate_document_v1",
)

MAX_INPUT_BYTES = 1_048_576
MAX_IDENTITIES = 100_000
MAX_DISPOSITIONS = 100_000

STAGE_NAMES = (
    "available",
    "eligible",
    "quarantined",
    "admitted",
    "signaled",
    "filled",
    "scored",
)
DISPOSITION_AFTER_STAGES = (
    "AVAILABLE",
    "ELIGIBLE",
    "ADMITTED",
    "SIGNALED",
    "FILLED",
)

_FLOW_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}\Z")
_SAMPLE_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}\Z")
_SHA256_RE = re.compile(r"[0-9a-f]{64}\Z")
_REASON_CODE_RE = re.compile(r"[A-Z][A-Z0-9_]{0,63}\Z")


class AdmissionStatus(StrEnum):
    """Whether the frozen admitted-sample denominator can be consumed."""

    READY = "READY"
    UNMEASURED_ZERO_DENOMINATOR = "UNMEASURED_ZERO_DENOMINATOR"


class OutcomeStatus(StrEnum):
    """Whether at least one admitted sample reached the scored stage."""

    OBSERVED_SCORED_SAMPLES = "OBSERVED_SCORED_SAMPLES"
    UNMEASURED_NO_SCORED_SAMPLES = "UNMEASURED_NO_SCORED_SAMPLES"


class ContractError(ValueError):
    """Stable, machine-readable fail-closed validation error."""

    def __init__(self, code: str, path: str, detail: str) -> None:
        self.code = code
        self.path = path
        self.detail = detail
        super().__init__(f"{code} at {path}: {detail}")

    def to_object(self) -> dict[str, str]:
        return {
            "schema": "cosmos.dq11.error.v1",
            "code": self.code,
            "path": self.path,
            "detail": self.detail,
        }


@dataclass(frozen=True, slots=True, order=True)
class IdentityV1:
    """One immutable unit of analysis."""

    sample_id: str
    origin_digest: str

    def to_object(self) -> dict[str, str]:
        return {
            "sampleId": self.sample_id,
            "originDigest": self.origin_digest,
        }


@dataclass(frozen=True, slots=True)
class StageV1:
    """One fully observed sample-funnel stage."""

    name: str
    declared_count: int
    declared_identity_digest: str
    identities: tuple[IdentityV1, ...]

    @property
    def identity_map(self) -> dict[str, IdentityV1]:
        return {identity.sample_id: identity for identity in self.identities}

    def receipt_object(self) -> dict[str, int | str]:
        return {
            "count": self.declared_count,
            "identityDigest": self.declared_identity_digest,
            "observation": "OBSERVED",
        }


@dataclass(frozen=True, slots=True)
class DispositionV1:
    """Observed terminal reason for an identity leaving a parent stage."""

    identity: IdentityV1
    after_stage: str
    reason_code: str

    def to_object(self) -> dict[str, object]:
        return {
            "identity": self.identity.to_object(),
            "afterStage": self.after_stage,
            "reasonCode": self.reason_code,
            "evidenceState": "OBSERVED",
        }


@dataclass(frozen=True, slots=True)
class ExactRateV1:
    """An exact numerator/denominator pair; deliberately not a float."""

    numerator: int
    denominator: int
    status: str

    def to_object(self) -> dict[str, int | str]:
        return {
            "numerator": self.numerator,
            "denominator": self.denominator,
            "status": self.status,
        }


@dataclass(frozen=True, slots=True)
class ValidationReceiptV1:
    """Deterministic receipt emitted only after every invariant reconciles."""

    flow_id: str
    source_sha256: str
    flow_digest: str
    admission_status: AdmissionStatus
    outcome_status: OutcomeStatus
    stages: tuple[StageV1, ...]
    rates: tuple[tuple[str, ExactRateV1], ...]
    frozen_admission_count: int
    frozen_admission_digest: str

    @property
    def denominator_usable(self) -> bool:
        return self.admission_status is AdmissionStatus.READY

    def to_object(self) -> dict[str, object]:
        return {
            "schema": RECEIPT_SCHEMA_V1,
            "inputSchema": SCHEMA_V1,
            "flowId": self.flow_id,
            "sourceSha256": self.source_sha256,
            "flowDigest": self.flow_digest,
            "authority": "NONE",
            "validationStatus": "VALID",
            "coverageStatus": "COMPLETE",
            "admissionStatus": self.admission_status.value,
            "outcomeStatus": self.outcome_status.value,
            "denominatorUsable": self.denominator_usable,
            "stages": {stage.name: stage.receipt_object() for stage in self.stages},
            "frozenAdmissionDenominator": {
                "count": self.frozen_admission_count,
                "identityDigest": self.frozen_admission_digest,
                "matched": True,
            },
            "ratesAgainstAdmission": {name: rate.to_object() for name, rate in self.rates},
            "reconciliations": {
                "availableToEligible": True,
                "eligibleToQuarantinedAndAdmitted": True,
                "admittedToSignaled": True,
                "signaledToFilled": True,
                "filledToScored": True,
            },
        }


def canonical_json_bytes_v1(value: object) -> bytes:
    """Return deterministic JSON bytes without a trailing newline."""

    try:
        return json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    except (TypeError, ValueError, RecursionError) as exc:
        raise ContractError("NON_CANONICAL_VALUE", "$", str(exc)) from exc


def _domain_digest(domain: str, value: object) -> str:
    payload = domain.encode("ascii") + b"\0" + canonical_json_bytes_v1(value)
    return hashlib.sha256(payload).hexdigest()


def identity_set_digest_v1(identities: tuple[IdentityV1, ...]) -> str:
    """Hash a set of immutable identities independently of input order."""

    ordered = sorted(identities)
    return _domain_digest(
        "cosmos.dq11.identity-set.v1",
        [identity.to_object() for identity in ordered],
    )


def receipt_json_bytes_v1(receipt: ValidationReceiptV1) -> bytes:
    """Return byte-stable receipt JSON with exactly one trailing newline."""

    return canonical_json_bytes_v1(receipt.to_object()) + b"\n"


def _reject_non_finite(token: str) -> object:
    raise ContractError("NON_FINITE_NUMBER", "$", f"forbidden JSON token {token}")


def _parse_bounded_json_int(token: str) -> int:
    digits = token[1:] if token.startswith("-") else token
    if len(digits) > 20:
        raise ContractError(
            "JSON_INTEGER_BOUND_EXCEEDED",
            "$",
            "JSON integer exceeds 20 decimal digits",
        )
    return int(token)


def _strict_object_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ContractError("DUPLICATE_JSON_KEY", "$", f"duplicate key {key!r}")
        result[key] = value
    return result


def _load_json_bytes(raw: bytes) -> object:
    if len(raw) > MAX_INPUT_BYTES:
        raise ContractError(
            "INPUT_BOUND_EXCEEDED",
            "$",
            f"{len(raw)} bytes exceeds {MAX_INPUT_BYTES}",
        )
    if raw.startswith(b"\xef\xbb\xbf"):
        raise ContractError("UTF8_BOM_FORBIDDEN", "$", "UTF-8 BOM is not accepted")
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise ContractError("INVALID_UTF8", "$", str(exc)) from exc
    try:
        return cast(
            object,
            json.loads(
                text,
                object_pairs_hook=_strict_object_pairs,
                parse_constant=_reject_non_finite,
                parse_int=_parse_bounded_json_int,
            ),
        )
    except ContractError:
        raise
    except RecursionError as exc:
        raise ContractError(
            "JSON_DEPTH_EXCEEDED",
            "$",
            "JSON nesting exceeds the parser depth bound",
        ) from exc
    except json.JSONDecodeError as exc:
        raise ContractError(
            "MALFORMED_JSON",
            "$",
            f"line {exc.lineno} column {exc.colno}: {exc.msg}",
        ) from exc
    except ValueError as exc:
        raise ContractError("JSON_VALUE_BOUND_EXCEEDED", "$", str(exc)) from exc


def _require_object(value: object, path: str) -> dict[str, object]:
    if type(value) is not dict:
        raise ContractError("OBJECT_TYPE", path, "expected JSON object")
    return cast(dict[str, object], value)


def _require_list(value: object, path: str) -> list[object]:
    if type(value) is not list:
        raise ContractError("ARRAY_TYPE", path, "expected JSON array")
    return cast(list[object], value)


def _exact_keys(
    value: dict[str, object],
    expected: frozenset[str],
    path: str,
) -> None:
    actual = set(value)
    missing = sorted(expected - actual)
    if missing:
        raise ContractError("FIELD_MISSING", path, f"missing {missing[0]!r}")
    unknown = sorted(actual - expected)
    if unknown:
        raise ContractError("UNKNOWN_FIELD", path, f"unknown {unknown[0]!r}")


def _require_string(
    value: object,
    path: str,
    pattern: re.Pattern[str],
    label: str,
) -> str:
    if type(value) is not str:
        raise ContractError("STRING_TYPE", path, f"{label} must be a string")
    result = value
    if pattern.fullmatch(result) is None:
        raise ContractError("STRING_FORMAT", path, f"invalid {label}")
    return result


def _require_count(value: object, path: str) -> int:
    if type(value) is not int:
        raise ContractError("COUNT_TYPE", path, "count must be a nonnegative integer")
    result = value
    if result < 0:
        raise ContractError("COUNT_RANGE", path, "count must be nonnegative")
    if result > MAX_IDENTITIES:
        raise ContractError(
            "COUNT_BOUND_EXCEEDED",
            path,
            f"{result} exceeds {MAX_IDENTITIES}",
        )
    return result


def _parse_identity(value: object, path: str) -> IdentityV1:
    record = _require_object(value, path)
    _exact_keys(record, frozenset({"sampleId", "originDigest"}), path)
    return IdentityV1(
        sample_id=_require_string(
            record["sampleId"],
            f"{path}.sampleId",
            _SAMPLE_ID_RE,
            "sampleId",
        ),
        origin_digest=_require_string(
            record["originDigest"],
            f"{path}.originDigest",
            _SHA256_RE,
            "originDigest",
        ),
    )


def _parse_stage(name: str, value: object) -> StageV1:
    path = f"$.stages.{name}"
    record = _require_object(value, path)
    _exact_keys(
        record,
        frozenset(
            {
                "observation",
                "declaredCount",
                "declaredIdentityDigest",
                "identities",
            }
        ),
        path,
    )
    observation = record["observation"]
    if observation == "MISSING":
        if any(
            record[field] is not None
            for field in ("declaredCount", "declaredIdentityDigest", "identities")
        ):
            raise ContractError(
                "MISSING_STAGE_HAS_VALUES",
                path,
                "a MISSING stage must use null count, digest, and identities",
            )
        raise ContractError(
            "STAGE_EVIDENCE_MISSING",
            path,
            "missing stage evidence cannot be interpreted as zero",
        )
    if observation != "OBSERVED":
        raise ContractError(
            "OBSERVATION_STATE",
            f"{path}.observation",
            "expected OBSERVED or explicit MISSING",
        )

    declared_count = _require_count(record["declaredCount"], f"{path}.declaredCount")
    declared_digest = _require_string(
        record["declaredIdentityDigest"],
        f"{path}.declaredIdentityDigest",
        _SHA256_RE,
        "identity digest",
    )
    raw_identities = _require_list(record["identities"], f"{path}.identities")
    if len(raw_identities) > MAX_IDENTITIES:
        raise ContractError(
            "IDENTITY_BOUND_EXCEEDED",
            f"{path}.identities",
            f"{len(raw_identities)} exceeds {MAX_IDENTITIES}",
        )

    identities: list[IdentityV1] = []
    by_id: dict[str, IdentityV1] = {}
    by_origin: dict[str, str] = {}
    for index, raw_identity in enumerate(raw_identities):
        identity = _parse_identity(raw_identity, f"{path}.identities[{index}]")
        if identity.sample_id in by_id:
            raise ContractError(
                "DUPLICATE_ID",
                f"{path}.identities[{index}].sampleId",
                f"duplicate sampleId {identity.sample_id!r}",
            )
        other_id = by_origin.get(identity.origin_digest)
        if other_id is not None:
            raise ContractError(
                "DUPLICATE_ORIGIN_IDENTITY",
                f"{path}.identities[{index}].originDigest",
                f"origin is already bound to sampleId {other_id!r}",
            )
        by_id[identity.sample_id] = identity
        by_origin[identity.origin_digest] = identity.sample_id
        identities.append(identity)

    frozen_identities = tuple(sorted(identities))
    if declared_count != len(frozen_identities):
        raise ContractError(
            "COUNT_ID_MISMATCH",
            f"{path}.declaredCount",
            f"declared {declared_count}, observed {len(frozen_identities)}",
        )
    observed_digest = identity_set_digest_v1(frozen_identities)
    if declared_digest != observed_digest:
        raise ContractError(
            "STAGE_IDENTITY_DIGEST_MISMATCH",
            f"{path}.declaredIdentityDigest",
            f"declared {declared_digest}, observed {observed_digest}",
        )
    return StageV1(
        name=name,
        declared_count=declared_count,
        declared_identity_digest=declared_digest,
        identities=frozen_identities,
    )


def _parse_stages(value: object) -> tuple[StageV1, ...]:
    record = _require_object(value, "$.stages")
    for name in STAGE_NAMES:
        if name not in record:
            raise ContractError("STAGE_MISSING", "$.stages", f"missing stage {name!r}")
    unknown = sorted(set(record) - set(STAGE_NAMES))
    if unknown:
        raise ContractError("UNKNOWN_STAGE", "$.stages", f"unknown stage {unknown[0]!r}")
    return tuple(_parse_stage(name, record[name]) for name in STAGE_NAMES)


def _parse_dispositions(value: object) -> tuple[DispositionV1, ...]:
    raw_dispositions = _require_list(value, "$.dispositions")
    if len(raw_dispositions) > MAX_DISPOSITIONS:
        raise ContractError(
            "DISPOSITION_BOUND_EXCEEDED",
            "$.dispositions",
            f"{len(raw_dispositions)} exceeds {MAX_DISPOSITIONS}",
        )
    dispositions: list[DispositionV1] = []
    seen_ids: set[str] = set()
    for index, raw_disposition in enumerate(raw_dispositions):
        path = f"$.dispositions[{index}]"
        record = _require_object(raw_disposition, path)
        _exact_keys(
            record,
            frozenset({"identity", "afterStage", "reasonCode", "evidenceState"}),
            path,
        )
        identity = _parse_identity(record["identity"], f"{path}.identity")
        if identity.sample_id in seen_ids:
            raise ContractError(
                "DUPLICATE_DISPOSITION",
                f"{path}.identity.sampleId",
                f"sampleId {identity.sample_id!r} has multiple dispositions",
            )
        seen_ids.add(identity.sample_id)
        after_stage = record["afterStage"]
        if type(after_stage) is not str or after_stage not in DISPOSITION_AFTER_STAGES:
            raise ContractError(
                "DISPOSITION_STAGE",
                f"{path}.afterStage",
                f"expected one of {DISPOSITION_AFTER_STAGES}",
            )
        reason_code = _require_string(
            record["reasonCode"],
            f"{path}.reasonCode",
            _REASON_CODE_RE,
            "reasonCode",
        )
        evidence_state = record["evidenceState"]
        if evidence_state == "MISSING":
            raise ContractError(
                "DISPOSITION_EVIDENCE_MISSING",
                f"{path}.evidenceState",
                "missing transition evidence cannot be interpreted as a zero event",
            )
        if evidence_state != "OBSERVED":
            raise ContractError(
                "EVIDENCE_STATE",
                f"{path}.evidenceState",
                "expected OBSERVED or explicit MISSING",
            )
        dispositions.append(
            DispositionV1(
                identity=identity,
                after_stage=after_stage,
                reason_code=reason_code,
            )
        )
    stage_rank = {stage: index for index, stage in enumerate(DISPOSITION_AFTER_STAGES)}
    return tuple(
        sorted(
            dispositions,
            key=lambda item: (stage_rank[item.after_stage], item.identity.sample_id),
        )
    )


def _assert_identity_origin(
    identity: IdentityV1,
    available: dict[str, IdentityV1],
    path: str,
) -> None:
    origin = available.get(identity.sample_id)
    if origin is None:
        raise ContractError("ORPHAN_ID", path, f"unknown sampleId {identity.sample_id!r}")
    if origin.origin_digest != identity.origin_digest:
        raise ContractError(
            "IDENTITY_MUTATION",
            path,
            f"sampleId {identity.sample_id!r} changed originDigest",
        )


def _assert_subset(
    child: StageV1,
    parent: StageV1,
    code: str,
) -> None:
    parent_ids = set(parent.identity_map)
    for sample_id in child.identity_map:
        if sample_id not in parent_ids:
            raise ContractError(
                code,
                f"$.stages.{child.name}",
                f"sampleId {sample_id!r} is absent from {parent.name}",
            )


def _assert_exact_dispositions(
    after_stage: str,
    expected_ids: set[str],
    dispositions: tuple[DispositionV1, ...],
) -> None:
    actual_ids = {
        disposition.identity.sample_id
        for disposition in dispositions
        if disposition.after_stage == after_stage
    }
    if actual_ids == expected_ids:
        return
    missing = sorted(expected_ids - actual_ids)
    spurious = sorted(actual_ids - expected_ids)
    detail_parts: list[str] = []
    if missing:
        detail_parts.append(f"missing={missing}")
    if spurious:
        detail_parts.append(f"spurious={spurious}")
    raise ContractError(
        "DISPOSITION_DRIFT",
        "$.dispositions",
        f"afterStage {after_stage}: {', '.join(detail_parts)}",
    )


def _rate(numerator: int, denominator: int) -> ExactRateV1:
    if denominator == 0:
        return ExactRateV1(
            numerator=numerator,
            denominator=denominator,
            status=AdmissionStatus.UNMEASURED_ZERO_DENOMINATOR.value,
        )
    return ExactRateV1(
        numerator=numerator,
        denominator=denominator,
        status="OBSERVED_ZERO" if numerator == 0 else "OBSERVED",
    )


def _validate_document(document: object, source_sha256: str) -> ValidationReceiptV1:
    root = _require_object(document, "$")
    _exact_keys(
        root,
        frozenset(
            {
                "schema",
                "flowId",
                "stages",
                "dispositions",
                "frozenAdmissionDenominator",
            }
        ),
        "$",
    )
    if root["schema"] != SCHEMA_V1:
        raise ContractError(
            "SCHEMA_MISMATCH",
            "$.schema",
            f"expected {SCHEMA_V1!r}",
        )
    flow_id = _require_string(root["flowId"], "$.flowId", _FLOW_ID_RE, "flowId")
    stages = _parse_stages(root["stages"])
    stage_by_name = {stage.name: stage for stage in stages}
    dispositions = _parse_dispositions(root["dispositions"])

    available = stage_by_name["available"]
    available_map = available.identity_map
    for stage in stages[1:]:
        for identity in stage.identities:
            _assert_identity_origin(
                identity,
                available_map,
                f"$.stages.{stage.name}.{identity.sample_id}",
            )
    for disposition in dispositions:
        _assert_identity_origin(
            disposition.identity,
            available_map,
            f"$.dispositions.{disposition.identity.sample_id}",
        )

    eligible = stage_by_name["eligible"]
    quarantined = stage_by_name["quarantined"]
    admitted = stage_by_name["admitted"]
    signaled = stage_by_name["signaled"]
    filled = stage_by_name["filled"]
    scored = stage_by_name["scored"]

    _assert_subset(eligible, available, "ELIGIBILITY_ORPHAN")
    _assert_subset(quarantined, eligible, "QUARANTINE_ORPHAN")
    _assert_subset(admitted, eligible, "ADMISSION_WITHOUT_ELIGIBILITY")
    _assert_subset(signaled, admitted, "SIGNAL_WITHOUT_ADMISSION")
    _assert_subset(filled, signaled, "FILL_WITHOUT_SIGNAL")
    _assert_subset(scored, filled, "SCORE_WITHOUT_FILL")

    eligible_ids = set(eligible.identity_map)
    quarantined_ids = set(quarantined.identity_map)
    admitted_ids = set(admitted.identity_map)
    overlap = quarantined_ids & admitted_ids
    if overlap:
        raise ContractError(
            "QUARANTINE_ADMISSION_OVERLAP",
            "$.stages",
            f"sampleId {sorted(overlap)[0]!r} is both quarantined and admitted",
        )
    if quarantined_ids | admitted_ids != eligible_ids:
        missing = sorted(eligible_ids - quarantined_ids - admitted_ids)
        raise ContractError(
            "QUARANTINE_PARTITION_DRIFT",
            "$.stages",
            f"eligible identities are not exactly quarantined plus admitted; missing={missing}",
        )

    _assert_exact_dispositions(
        "AVAILABLE",
        set(available.identity_map) - eligible_ids,
        dispositions,
    )
    _assert_exact_dispositions("ELIGIBLE", quarantined_ids, dispositions)
    _assert_exact_dispositions(
        "ADMITTED",
        admitted_ids - set(signaled.identity_map),
        dispositions,
    )
    _assert_exact_dispositions(
        "SIGNALED",
        set(signaled.identity_map) - set(filled.identity_map),
        dispositions,
    )
    _assert_exact_dispositions(
        "FILLED",
        set(filled.identity_map) - set(scored.identity_map),
        dispositions,
    )

    frozen = _require_object(
        root["frozenAdmissionDenominator"],
        "$.frozenAdmissionDenominator",
    )
    _exact_keys(
        frozen,
        frozenset({"declaredCount", "identityDigest"}),
        "$.frozenAdmissionDenominator",
    )
    frozen_count = _require_count(
        frozen["declaredCount"],
        "$.frozenAdmissionDenominator.declaredCount",
    )
    frozen_digest = _require_string(
        frozen["identityDigest"],
        "$.frozenAdmissionDenominator.identityDigest",
        _SHA256_RE,
        "identity digest",
    )
    if (
        frozen_count != admitted.declared_count
        or frozen_digest != admitted.declared_identity_digest
    ):
        raise ContractError(
            "FROZEN_DENOMINATOR_DRIFT",
            "$.frozenAdmissionDenominator",
            "frozen count/digest does not exactly match the admitted identity set",
        )

    semantic_flow = {
        "schema": SCHEMA_V1,
        "flowId": flow_id,
        "stages": {stage.name: stage.receipt_object() for stage in stages},
        "dispositions": [item.to_object() for item in dispositions],
        "frozenAdmissionDenominator": {
            "declaredCount": frozen_count,
            "identityDigest": frozen_digest,
        },
    }
    flow_digest = _domain_digest("cosmos.dq11.flow.v1", semantic_flow)
    admission_status = (
        AdmissionStatus.READY
        if admitted.declared_count > 0
        else AdmissionStatus.UNMEASURED_ZERO_DENOMINATOR
    )
    outcome_status = (
        OutcomeStatus.OBSERVED_SCORED_SAMPLES
        if scored.declared_count > 0
        else OutcomeStatus.UNMEASURED_NO_SCORED_SAMPLES
    )
    rates = tuple(
        (
            name,
            _rate(stage.declared_count, admitted.declared_count),
        )
        for name, stage in (
            ("signaled", signaled),
            ("filled", filled),
            ("scored", scored),
        )
    )
    return ValidationReceiptV1(
        flow_id=flow_id,
        source_sha256=source_sha256,
        flow_digest=flow_digest,
        admission_status=admission_status,
        outcome_status=outcome_status,
        stages=stages,
        rates=rates,
        frozen_admission_count=frozen_count,
        frozen_admission_digest=frozen_digest,
    )


def validate_bytes_v1(raw: bytes) -> ValidationReceiptV1:
    """Strictly parse and validate one raw UTF-8 JSON packet."""

    document = _load_json_bytes(raw)
    return _validate_document(document, hashlib.sha256(raw).hexdigest())


def validate_document_v1(document: object) -> ValidationReceiptV1:
    """Validate an in-memory packet using canonical bytes as its source identity."""

    canonical = canonical_json_bytes_v1(document)
    return _validate_document(document, hashlib.sha256(canonical).hexdigest())
