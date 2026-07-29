"""Deterministic structural validator for research-economics truth.

This module is deliberately network-free and authority-free. It validates one
frozen public-research document, emits one canonical receipt, and never upgrades
scenario inputs into account-effective or executable-capacity claims.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from datetime import datetime, timedelta
from decimal import ROUND_HALF_EVEN, Context, Decimal, InvalidOperation, localcontext
from typing import NoReturn, cast

REQUEST_SCHEMA = "cosmos.dq6.research-economics-truth.v1"
RECEIPT_SCHEMA = "cosmos.dq6.research-economics-truth-receipt.v1"

_MAX_DOCUMENT_BYTES = 262_144
_MAX_ENTRY_LEGS = 8
_MAX_ABS_AMOUNT = Decimal("1000000000000000")
_PER_1000_QUANTUM = Decimal("0.00000001")
# V1 inputs have at most 28 significant digits; proxy multiplication can have 56.
# A private context prevents caller precision, rounding, or traps from changing truth.
_ARITHMETIC_CONTEXT = Context(prec=80, rounding=ROUND_HALF_EVEN)
_DECIMAL_PATTERN = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,12})?")
_ID_PATTERN = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?")
_SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")
_UTC_PATTERN = re.compile(
    r"[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])"
    r"T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z"
)

_TOP_LEVEL_KEYS = frozenset(
    {
        "schema",
        "researchId",
        "evidence",
        "capital",
        "economics",
        "accountFee",
        "capacity",
        "reporting",
        "authority",
        "consumers",
    }
)
_EVIDENCE_KEYS = frozenset({"sourceClass", "artifactSha256", "observedAtUtc"})
_CAPITAL_KEYS = frozenset({"entryLegs", "capitalDenominator", "declaredGrossEntryNotional"})
_ENTRY_LEG_KEYS = frozenset({"legId", "direction", "notionalAmount", "notionalAsset"})
_CAPITAL_DENOMINATOR_KEYS = frozenset({"kind", "amount", "asset"})
_GROSS_ENTRY_NOTIONAL_KEYS = frozenset({"amount", "asset"})
_ECONOMICS_KEYS = frozenset(
    {
        "grossPnl",
        "feeCost",
        "slippageCost",
        "fundingPnl",
        "fundingSignConvention",
        "declaredScenarioNetPnl",
    }
)
_COMPONENT_KEYS = frozenset({"amount", "asset", "truthState"})
_ACCOUNT_FEE_KEYS = frozenset({"state", "amount", "asset", "reasonCode"})
_CAPACITY_KEYS = frozenset(
    {
        "state",
        "proxyKind",
        "sourceMetricAmount",
        "proxyFraction",
        "proxyAmount",
        "asset",
        "observedAtUtc",
        "sourceArtifactSha256",
        "executableCapacityState",
    }
)
_REPORTING_KEYS = frozenset(
    {
        "nativeAsset",
        "scenarioNetPer1000ReturnDenominator",
        "unit",
        "rounding",
        "usdConversion",
    }
)
_USD_CONVERSION_KEYS = frozenset(
    {
        "state",
        "usdAmount",
        "rateUsdPerUsdt",
        "observedAtUtc",
        "sourceArtifactSha256",
        "reasonCode",
    }
)

_GROSS_TRUTH_STATES = frozenset({"PUBLIC_REPLAY", "SENSITIVITY_ONLY"})
_FEE_TRUTH_STATES = frozenset({"PUBLIC_SCHEDULE_SCENARIO", "SENSITIVITY_ONLY"})
_SLIPPAGE_TRUTH_STATES = frozenset({"PUBLIC_BOOK_REPLAY", "SENSITIVITY_ONLY"})
_FUNDING_TRUTH_STATES = frozenset({"PUBLIC_FUNDING_REPLAY", "SENSITIVITY_ONLY"})
_PROXY_KINDS = frozenset({"PUBLIC_ORDER_BOOK_DEPTH_HAIRCUT", "PUBLIC_QUOTE_VOLUME_PARTICIPATION"})
_CONSUMERS = ("N3", "FUTURE_RESEARCH_INTAKE")


class TruthValidationError(ValueError):
    """Stable coded error raised when a truth invariant fails."""

    def __init__(self, code: str, path: str, detail: str) -> None:
        self.code = code
        self.path = path
        self.detail = detail
        super().__init__(f"{code} at {path}: {detail}")


def _fail(code: str, path: str, detail: str) -> NoReturn:
    raise TruthValidationError(code, path, detail)


def _object(value: object, path: str, expected_keys: frozenset[str]) -> dict[str, object]:
    if type(value) is not dict:
        _fail("E_OBJECT", path, "must be a JSON object")
    raw = cast(dict[object, object], value)
    if any(type(key) is not str for key in raw):
        _fail("E_KEYS", path, "all keys must be strings")
    result = {cast(str, key): item for key, item in raw.items()}
    actual_keys = frozenset(result)
    if actual_keys != expected_keys:
        missing = ",".join(sorted(expected_keys - actual_keys)) or "-"
        extra = ",".join(sorted(actual_keys - expected_keys)) or "-"
        _fail("E_KEYS", path, f"missing={missing};extra={extra}")
    return result


def _list(value: object, path: str) -> list[object]:
    if type(value) is not list:
        _fail("E_LIST", path, "must be a JSON array")
    return cast(list[object], value)


def _text(value: object, path: str) -> str:
    if type(value) is not str:
        _fail("E_TEXT", path, "must be a string")
    return value


def _exact_text(value: object, path: str, expected: str, code: str = "E_ENUM") -> str:
    text = _text(value, path)
    if text != expected:
        _fail(code, path, f"must equal {expected}")
    return text


def _choice(value: object, path: str, allowed: frozenset[str], code: str) -> str:
    text = _text(value, path)
    if text not in allowed:
        _fail(code, path, f"unsupported value {text}")
    return text


def _research_id(value: object, path: str) -> str:
    text = _text(value, path)
    if _ID_PATTERN.fullmatch(text) is None:
        _fail("E_RESEARCH_ID", path, "must be a bounded lowercase slug")
    return text


def _sha256(value: object, path: str) -> str:
    text = _text(value, path)
    if _SHA256_PATTERN.fullmatch(text) is None:
        _fail("E_SHA256", path, "must be 64 lowercase hexadecimal characters")
    return text


def _utc_timestamp(value: object, path: str) -> str:
    text = _text(value, path)
    if _UTC_PATTERN.fullmatch(text) is None:
        _fail("E_TIMESTAMP", path, "must be UTC second precision ending in Z")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        _fail("E_TIMESTAMP", path, "must be a real calendar timestamp")
    if parsed.utcoffset() != timedelta(0):
        _fail("E_TIMESTAMP", path, "must have a zero UTC offset")
    return text


def _decimal(value: object, path: str) -> Decimal:
    text = _text(value, path)
    if _DECIMAL_PATTERN.fullmatch(text) is None:
        _fail("E_DECIMAL", path, "must be a canonical decimal string with at most 12 decimals")
    try:
        parsed = Decimal(text)
    except InvalidOperation:
        _fail("E_DECIMAL", path, "must be a finite decimal")
    if parsed == 0 and text.startswith("-"):
        _fail("E_DECIMAL", path, "negative zero is not canonical")
    if parsed.copy_abs() > _MAX_ABS_AMOUNT:
        _fail("E_DECIMAL_RANGE", path, "absolute amount exceeds the v1 bound")
    return parsed


def _positive_decimal(value: object, path: str) -> Decimal:
    parsed = _decimal(value, path)
    if parsed <= 0:
        _fail("E_DECIMAL_RANGE", path, "must be greater than zero")
    return parsed


def _nonnegative_decimal(value: object, path: str) -> Decimal:
    parsed = _decimal(value, path)
    if parsed < 0:
        _fail("E_DECIMAL_RANGE", path, "must be nonnegative")
    return parsed


def _format_decimal(value: Decimal) -> str:
    if value == 0:
        return "0"
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def _usdt(value: object, path: str, code: str = "E_ASSET_MISMATCH") -> str:
    return _exact_text(value, path, "USDT", code)


def _component(
    value: object,
    path: str,
    allowed_truth_states: frozenset[str],
    *,
    nonnegative: bool,
) -> tuple[Decimal, str]:
    component = _object(value, path, _COMPONENT_KEYS)
    amount = (
        _nonnegative_decimal(component["amount"], f"{path}.amount")
        if nonnegative
        else _decimal(component["amount"], f"{path}.amount")
    )
    _usdt(component["asset"], f"{path}.asset")
    truth_state = _choice(
        component["truthState"],
        f"{path}.truthState",
        allowed_truth_states,
        "E_COMPONENT_TRUTH",
    )
    return amount, truth_state


def _bounded_document(document: object) -> dict[str, object]:
    root = _object(document, "$", _TOP_LEVEL_KEYS)
    try:
        encoded = json.dumps(
            root,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    except (TypeError, ValueError):
        _fail("E_JSON", "$", "must contain only finite JSON-compatible values")
    if len(encoded) > _MAX_DOCUMENT_BYTES:
        _fail("E_DOCUMENT_SIZE", "$", "canonical JSON exceeds the v1 byte bound")
    return root


def _validate_evidence(value: object) -> tuple[str, str]:
    evidence = _object(value, "$.evidence", _EVIDENCE_KEYS)
    _exact_text(
        evidence["sourceClass"],
        "$.evidence.sourceClass",
        "PUBLIC_RESEARCH_ARTIFACT",
        "E_PUBLIC_EVIDENCE",
    )
    artifact_sha256 = _sha256(evidence["artifactSha256"], "$.evidence.artifactSha256")
    observed_at = _utc_timestamp(evidence["observedAtUtc"], "$.evidence.observedAtUtc")
    return artifact_sha256, observed_at


def _validate_capital(
    value: object,
) -> tuple[str, str, list[dict[str, str]]]:
    capital = _object(value, "$.capital", _CAPITAL_KEYS)
    raw_legs = _list(capital["entryLegs"], "$.capital.entryLegs")
    if not 1 <= len(raw_legs) <= _MAX_ENTRY_LEGS:
        _fail("E_ENTRY_LEGS", "$.capital.entryLegs", "must contain between 1 and 8 legs")

    legs: list[dict[str, str]] = []
    leg_amounts: dict[str, Decimal] = {}
    for index, raw_leg in enumerate(raw_legs):
        path = f"$.capital.entryLegs[{index}]"
        leg = _object(raw_leg, path, _ENTRY_LEG_KEYS)
        leg_id = _research_id(leg["legId"], f"{path}.legId")
        direction = _choice(
            leg["direction"],
            f"{path}.direction",
            frozenset({"LONG", "SHORT"}),
            "E_ENTRY_DIRECTION",
        )
        amount = _positive_decimal(leg["notionalAmount"], f"{path}.notionalAmount")
        _usdt(leg["notionalAsset"], f"{path}.notionalAsset")
        if leg_id in leg_amounts:
            _fail("E_DUPLICATE", f"{path}.legId", "entry leg ids must be unique")
        leg_amounts[leg_id] = amount
        legs.append(
            {
                "legId": leg_id,
                "direction": direction,
                "notionalAmount": _format_decimal(amount),
                "notionalAsset": "USDT",
            }
        )

    leg_ids = [leg["legId"] for leg in legs]
    if leg_ids != sorted(leg_ids):
        _fail("E_ORDER", "$.capital.entryLegs", "legs must be sorted by legId")

    denominator = _object(
        capital["capitalDenominator"],
        "$.capital.capitalDenominator",
        _CAPITAL_DENOMINATOR_KEYS,
    )
    _exact_text(
        denominator["kind"],
        "$.capital.capitalDenominator.kind",
        "INITIAL_RESEARCH_CAPITAL",
        "E_CAPITAL_DENOMINATOR",
    )
    denominator_amount = _positive_decimal(
        denominator["amount"], "$.capital.capitalDenominator.amount"
    )
    _usdt(denominator["asset"], "$.capital.capitalDenominator.asset")

    declared_gross = _object(
        capital["declaredGrossEntryNotional"],
        "$.capital.declaredGrossEntryNotional",
        _GROSS_ENTRY_NOTIONAL_KEYS,
    )
    gross_entry_notional = _positive_decimal(
        declared_gross["amount"], "$.capital.declaredGrossEntryNotional.amount"
    )
    _usdt(declared_gross["asset"], "$.capital.declaredGrossEntryNotional.asset")
    with localcontext(_ARITHMETIC_CONTEXT):
        expected_gross = sum(leg_amounts.values(), start=Decimal(0))
    if gross_entry_notional != expected_gross:
        _fail(
            "E_GROSS_ENTRY_NOTIONAL",
            "$.capital.declaredGrossEntryNotional.amount",
            "must equal the exact sum of every entry-leg notional",
        )
    return (
        _format_decimal(denominator_amount),
        _format_decimal(gross_entry_notional),
        legs,
    )


def _validate_economics(
    value: object,
) -> tuple[dict[str, dict[str, str]], Decimal]:
    economics = _object(value, "$.economics", _ECONOMICS_KEYS)
    gross, gross_truth = _component(
        economics["grossPnl"], "$.economics.grossPnl", _GROSS_TRUTH_STATES, nonnegative=False
    )
    fee, fee_truth = _component(
        economics["feeCost"], "$.economics.feeCost", _FEE_TRUTH_STATES, nonnegative=True
    )
    slippage, slippage_truth = _component(
        economics["slippageCost"],
        "$.economics.slippageCost",
        _SLIPPAGE_TRUTH_STATES,
        nonnegative=True,
    )
    funding, funding_truth = _component(
        economics["fundingPnl"],
        "$.economics.fundingPnl",
        _FUNDING_TRUTH_STATES,
        nonnegative=False,
    )
    _exact_text(
        economics["fundingSignConvention"],
        "$.economics.fundingSignConvention",
        "RECEIVED_POSITIVE_PAID_NEGATIVE",
        "E_FUNDING_SIGN",
    )
    declared_net, declared_truth = _component(
        economics["declaredScenarioNetPnl"],
        "$.economics.declaredScenarioNetPnl",
        frozenset({"PUBLIC_SCENARIO", "SENSITIVITY_SCENARIO"}),
        nonnegative=False,
    )
    component_truth_states = (gross_truth, fee_truth, slippage_truth, funding_truth)
    expected_scenario_truth = (
        "SENSITIVITY_SCENARIO"
        if "SENSITIVITY_ONLY" in component_truth_states
        else "PUBLIC_SCENARIO"
    )
    if declared_truth != expected_scenario_truth:
        _fail(
            "E_SCENARIO_TRUTH",
            "$.economics.declaredScenarioNetPnl.truthState",
            "must inherit SENSITIVITY_SCENARIO when any component is sensitivity-only",
        )
    with localcontext(_ARITHMETIC_CONTEXT):
        expected_net = gross - fee - slippage + funding
    if declared_net != expected_net:
        _fail(
            "E_ECONOMICS_DECOMPOSITION",
            "$.economics.declaredScenarioNetPnl.amount",
            "must equal grossPnl - feeCost - slippageCost + signed fundingPnl",
        )
    components = {
        "grossPnl": {
            "amount": _format_decimal(gross),
            "asset": "USDT",
            "truthState": gross_truth,
        },
        "feeCost": {
            "amount": _format_decimal(fee),
            "asset": "USDT",
            "truthState": fee_truth,
        },
        "slippageCost": {
            "amount": _format_decimal(slippage),
            "asset": "USDT",
            "truthState": slippage_truth,
        },
        "fundingPnl": {
            "amount": _format_decimal(funding),
            "asset": "USDT",
            "truthState": funding_truth,
        },
        "scenarioNetPnl": {
            "amount": _format_decimal(declared_net),
            "asset": "USDT",
            "truthState": declared_truth,
        },
    }
    return components, declared_net


def _validate_account_fee(value: object) -> None:
    account_fee = _object(value, "$.accountFee", _ACCOUNT_FEE_KEYS)
    if account_fee["state"] != "UNKNOWN" or account_fee["amount"] is not None:
        _fail(
            "E_ACCOUNT_FEE_UNKNOWN",
            "$.accountFee",
            "account-effective fee must be UNKNOWN with a null amount",
        )
    _usdt(account_fee["asset"], "$.accountFee.asset")
    _exact_text(
        account_fee["reasonCode"],
        "$.accountFee.reasonCode",
        "SIGNED_ACCOUNT_FEE_EVIDENCE_ABSENT",
        "E_ACCOUNT_FEE_UNKNOWN",
    )


def _validate_capacity(value: object) -> dict[str, object]:
    capacity = _object(value, "$.capacity", _CAPACITY_KEYS)
    state = _text(capacity["state"], "$.capacity.state")
    if state not in {"PUBLIC_MARKET_CAPACITY_PROXY", "UNMEASURED"}:
        _fail(
            "E_CAPACITY_PROXY_LABEL",
            "$.capacity.state",
            "must remain a public proxy or UNMEASURED",
        )
    _usdt(capacity["asset"], "$.capacity.asset")
    _exact_text(
        capacity["executableCapacityState"],
        "$.capacity.executableCapacityState",
        "UNMEASURED",
        "E_CAPACITY_PROXY_LABEL",
    )

    nullable_fields = (
        "proxyKind",
        "sourceMetricAmount",
        "proxyFraction",
        "proxyAmount",
        "observedAtUtc",
        "sourceArtifactSha256",
    )
    if state == "UNMEASURED":
        if any(capacity[field] is not None for field in nullable_fields):
            _fail(
                "E_CAPACITY_PROXY_LABEL",
                "$.capacity",
                "UNMEASURED must not carry proxy values or source claims",
            )
        return {
            "state": "UNMEASURED",
            "proxyKind": None,
            "sourceMetricAmount": None,
            "proxyFraction": None,
            "proxyAmount": None,
            "asset": "USDT",
            "observedAtUtc": None,
            "sourceArtifactSha256": None,
            "executableCapacityState": "UNMEASURED",
        }

    proxy_kind = _choice(
        capacity["proxyKind"],
        "$.capacity.proxyKind",
        _PROXY_KINDS,
        "E_CAPACITY_PROXY_LABEL",
    )
    source_metric = _positive_decimal(
        capacity["sourceMetricAmount"], "$.capacity.sourceMetricAmount"
    )
    proxy_fraction = _positive_decimal(capacity["proxyFraction"], "$.capacity.proxyFraction")
    if proxy_fraction > 1:
        _fail("E_CAPACITY_PROXY_MATH", "$.capacity.proxyFraction", "must not exceed one")
    proxy_amount = _nonnegative_decimal(capacity["proxyAmount"], "$.capacity.proxyAmount")
    with localcontext(_ARITHMETIC_CONTEXT):
        expected_proxy_amount = source_metric * proxy_fraction
    if proxy_amount != expected_proxy_amount:
        _fail(
            "E_CAPACITY_PROXY_MATH",
            "$.capacity.proxyAmount",
            "must equal sourceMetricAmount multiplied by proxyFraction",
        )
    observed_at = _utc_timestamp(capacity["observedAtUtc"], "$.capacity.observedAtUtc")
    source_sha256 = _sha256(capacity["sourceArtifactSha256"], "$.capacity.sourceArtifactSha256")
    return {
        "state": "PUBLIC_MARKET_CAPACITY_PROXY",
        "proxyKind": proxy_kind,
        "sourceMetricAmount": _format_decimal(source_metric),
        "proxyFraction": _format_decimal(proxy_fraction),
        "proxyAmount": _format_decimal(proxy_amount),
        "asset": "USDT",
        "observedAtUtc": observed_at,
        "sourceArtifactSha256": source_sha256,
        "executableCapacityState": "UNMEASURED",
    }


def _validate_reporting(
    value: object,
    scenario_net: Decimal,
    denominator_amount: Decimal,
) -> str:
    reporting = _object(value, "$.reporting", _REPORTING_KEYS)
    if reporting["nativeAsset"] != "USDT":
        _fail(
            "E_USDT_USD_OVERCLAIM",
            "$.reporting.nativeAsset",
            "native economics must remain denominated in USDT",
        )
    _exact_text(
        reporting["unit"],
        "$.reporting.unit",
        "NOMINAL_USDT_PER_1000_USDT_RETURN_DENOMINATOR",
        "E_USDT_USD_OVERCLAIM",
    )
    _exact_text(
        reporting["rounding"],
        "$.reporting.rounding",
        "ROUND_HALF_EVEN_8_DP",
        "E_RETURN_PER_1000",
    )
    declared_per_1000 = _decimal(
        reporting["scenarioNetPer1000ReturnDenominator"],
        "$.reporting.scenarioNetPer1000ReturnDenominator",
    )
    with localcontext(_ARITHMETIC_CONTEXT):
        expected_per_1000 = (scenario_net * Decimal(1000) / denominator_amount).quantize(
            _PER_1000_QUANTUM,
            rounding=ROUND_HALF_EVEN,
        )
    if declared_per_1000 != expected_per_1000:
        _fail(
            "E_RETURN_PER_1000",
            "$.reporting.scenarioNetPer1000ReturnDenominator",
            "does not match the validated denominator and scenario net",
        )

    conversion = _object(
        reporting["usdConversion"], "$.reporting.usdConversion", _USD_CONVERSION_KEYS
    )
    expected_unknown = {
        "state": "UNKNOWN",
        "usdAmount": None,
        "rateUsdPerUsdt": None,
        "observedAtUtc": None,
        "sourceArtifactSha256": None,
        "reasonCode": "NO_TIME_ALIGNED_USDT_USD_CONVERSION_EVIDENCE",
    }
    if conversion != expected_unknown:
        _fail(
            "E_USDT_USD_OVERCLAIM",
            "$.reporting.usdConversion",
            "v1 forbids a USD claim without a separately validated conversion artifact",
        )
    return _format_decimal(expected_per_1000)


def _canonical_json_bytes(value: Mapping[str, object]) -> bytes:
    serialized = json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return f"{serialized}\n".encode()


def canonical_receipt_json(receipt: Mapping[str, object]) -> bytes:
    """Render a receipt as sorted compact UTF-8 JSON with one trailing newline."""

    return _canonical_json_bytes(receipt)


def validate_research_economics_truth_v1(document: object) -> dict[str, object]:
    """Validate one v1 document and return a deterministic JSON-native receipt."""

    root = _bounded_document(document)
    _exact_text(root["schema"], "$.schema", REQUEST_SCHEMA, "E_SCHEMA")
    research_id = _research_id(root["researchId"], "$.researchId")
    evidence_sha256, evidence_observed_at = _validate_evidence(root["evidence"])
    denominator_text, gross_entry_notional_text, legs = _validate_capital(root["capital"])
    components, scenario_net = _validate_economics(root["economics"])
    _validate_account_fee(root["accountFee"])
    capacity = _validate_capacity(root["capacity"])
    denominator_amount = Decimal(denominator_text)
    per_1000 = _validate_reporting(root["reporting"], scenario_net, denominator_amount)
    _exact_text(
        root["authority"],
        "$.authority",
        "RESEARCH_ONLY_NO_CAPITAL_AUTHORITY",
        "E_AUTHORITY",
    )
    consumers = _list(root["consumers"], "$.consumers")
    if consumers != list(_CONSUMERS):
        _fail(
            "E_CONSUMERS",
            "$.consumers",
            "must be exactly N3 then FUTURE_RESEARCH_INTAKE",
        )

    receipt_without_digest: dict[str, object] = {
        "schema": RECEIPT_SCHEMA,
        "researchId": research_id,
        "evidence": {
            "sourceClass": "PUBLIC_RESEARCH_ARTIFACT",
            "artifactSha256": evidence_sha256,
            "observedAtUtc": evidence_observed_at,
        },
        "capitalDenominator": {
            "kind": "INITIAL_RESEARCH_CAPITAL",
            "amount": denominator_text,
            "asset": "USDT",
            "capitalAuthority": "NONE",
        },
        "grossEntryNotional": {
            "amount": gross_entry_notional_text,
            "asset": "USDT",
            "entryLegs": legs,
        },
        "grossExposureRatio": {
            "grossEntryNotional": gross_entry_notional_text,
            "initialResearchCapital": denominator_text,
        },
        "economics": {
            **components,
            "decompositionFormula": (
                "grossPnl-feeCost-slippageCost+signedFundingPnl=scenarioNetPnl"
            ),
            "fundingSignConvention": "RECEIVED_POSITIVE_PAID_NEGATIVE",
            "accountEffectiveNetPnlState": "UNKNOWN",
        },
        "accountFee": {
            "state": "UNKNOWN",
            "amount": None,
            "asset": "USDT",
            "reasonCode": "SIGNED_ACCOUNT_FEE_EVIDENCE_ABSENT",
        },
        "capacity": capacity,
        "reporting": {
            "nativeAsset": "USDT",
            "scenarioNetPer1000ReturnDenominator": per_1000,
            "unit": "NOMINAL_USDT_PER_1000_USDT_RETURN_DENOMINATOR",
            "rounding": "ROUND_HALF_EVEN_8_DP",
            "usdConversionState": "UNKNOWN",
        },
        "authority": "RESEARCH_ONLY_NO_CAPITAL_AUTHORITY",
        "consumers": list(_CONSUMERS),
    }
    receipt_digest = hashlib.sha256(_canonical_json_bytes(receipt_without_digest)).hexdigest()
    return {**receipt_without_digest, "receiptDigestSha256": receipt_digest}
