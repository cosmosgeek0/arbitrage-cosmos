from __future__ import annotations

import json
import re
from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.fee_truth import KnownOrUnknownRateV1, parse_receipt_bytes
from quant_edge.fee_truth.conversion import convert_receipt_to_n3_inputs

_RESEARCH = Path(__file__).resolve().parent / "fixtures"
_RECEIPT_SCHEMA = _RESEARCH / "sanitized_fee_receipt.v1.schema.json"
_N3_SCHEMA = _RESEARCH / "n3_fee_scenario_inputs.v1.schema.json"
_UNKNOWN_EXAMPLE = _RESEARCH / "unknown_receipt.example.v1.json"
_JSON_ARTIFACTS = (
    _N3_SCHEMA,
    _RESEARCH / "official_sources.v1.json",
    _RECEIPT_SCHEMA,
    _UNKNOWN_EXAMPLE,
)
_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema"
_SCENARIO_IDS = (
    "ACCOUNT_EFFECTIVE_SANITIZED",
    "ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG",
    "BNB_OR_PROMOTION_SENSITIVITY_ONLY",
    "PUBLIC_REGULAR_NO_BNB",
)


def _object_without_duplicates(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _load_json_bytes(raw: bytes) -> dict[str, object]:
    parsed = cast(
        object,
        json.loads(raw.decode("utf-8"), object_pairs_hook=_object_without_duplicates),
    )
    if not isinstance(parsed, dict):
        raise ValueError("artifact root must be an object")
    return cast(dict[str, object], parsed)


def _load_json(path: Path) -> dict[str, object]:
    return _load_json_bytes(path.read_bytes())


def _mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _sequence(value: object) -> list[object]:
    assert isinstance(value, list)
    return cast(list[object], value)


def _walk(value: object, *, path: str = "$") -> Iterator[tuple[str, dict[str, object]]]:
    if isinstance(value, dict):
        mapping = cast(dict[str, object], value)
        yield path, mapping
        for key, child in mapping.items():
            yield from _walk(child, path=f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _walk(child, path=f"{path}[{index}]")


def _assert_declared_fields_and_literals(
    value: dict[str, object],
    schema: dict[str, object],
) -> None:
    properties = _mapping(schema["properties"])
    required = cast(list[str], schema.get("required", []))
    assert set(required) <= set(value)
    assert set(value) <= set(properties)
    for field, actual in value.items():
        declaration = _mapping(properties[field])
        if "const" in declaration:
            assert actual == declaration["const"]
        if "enum" in declaration:
            assert actual in _sequence(declaration["enum"])


@pytest.mark.parametrize("artifact", _JSON_ARTIFACTS, ids=lambda path: path.name)
def test_research_json_artifacts_load_with_duplicate_rejection(artifact: Path) -> None:
    assert _load_json(artifact)


def test_artifact_loader_proves_duplicate_keys_are_rejected() -> None:
    with pytest.raises(ValueError, match=r"^duplicate JSON key: schema$"):
        _load_json_bytes(b'{"schema":"one","schema":"two"}')


@pytest.mark.parametrize("schema_path", [_RECEIPT_SCHEMA, _N3_SCHEMA])
def test_schemas_use_draft_2020_12_and_close_every_object(schema_path: Path) -> None:
    schema = _load_json(schema_path)

    assert schema["$schema"] == _DRAFT_2020_12
    unclosed = [
        path
        for path, candidate in _walk(schema)
        if candidate.get("type") == "object" and candidate.get("additionalProperties") is not False
    ]
    assert unclosed == []


@pytest.mark.parametrize("schema_path", [_RECEIPT_SCHEMA, _N3_SCHEMA])
def test_schema_root_required_and_property_names_have_exact_parity(schema_path: Path) -> None:
    schema = _load_json(schema_path)

    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False
    assert set(cast(list[str], schema["required"])) == set(_mapping(schema["properties"]))


@pytest.mark.parametrize(
    "decimal",
    [
        "-1",
        "-1.000000000000000000",
        "-0.1",
        "-0.000000000000000001",
        "0",
        "0.0",
        "0.000000000000000001",
        "1",
        "1.000000000000000000",
    ],
)
def test_receipt_signed_rate_regex_accepts_contract_boundaries(decimal: str) -> None:
    schema = _load_json(_RECEIPT_SCHEMA)
    definitions = _mapping(schema["$defs"])
    declaration = _mapping(definitions["plainRateDecimal"])
    pattern = cast(str, declaration["pattern"])

    assert re.fullmatch(pattern, decimal) is not None
    assert KnownOrUnknownRateV1.known(decimal).decimal == decimal


@pytest.mark.parametrize(
    "decimal",
    [
        "-1.000000000000000001",
        "-0",
        "-0.0",
        "-0.0000000000000000001",
        "+0.1",
        ".1",
        "0.",
        "0.0000000000000000001",
        "1.000000000000000001",
        "1.1",
        "1e-3",
    ],
)
def test_receipt_signed_rate_regex_rejects_contract_boundaries(decimal: str) -> None:
    schema = _load_json(_RECEIPT_SCHEMA)
    definitions = _mapping(schema["$defs"])
    declaration = _mapping(definitions["plainRateDecimal"])
    pattern = cast(str, declaration["pattern"])

    assert re.fullmatch(pattern, decimal) is None
    with pytest.raises(ContractValueError):
        KnownOrUnknownRateV1.known(decimal)


def test_unknown_example_is_canonical_lf_terminated_and_boundary_accepted() -> None:
    raw = _UNKNOWN_EXAMPLE.read_bytes()
    parsed = _load_json_bytes(raw)

    assert raw.endswith(b"\n")
    assert not raw.endswith(b"\n\n")
    assert canonical_json_bytes(parsed) == raw
    receipt = parse_receipt_bytes(raw, expected_symbols=frozenset({"BTCUSDT"}))
    assert receipt.as_mapping() == parsed


def test_generated_n3_output_matches_declared_root_provenance_units_and_scenarios() -> None:
    receipt = parse_receipt_bytes(
        _UNKNOWN_EXAMPLE.read_bytes(),
        expected_symbols=frozenset({"BTCUSDT"}),
    )
    generated = convert_receipt_to_n3_inputs(
        receipt,
        as_of_utc="2026-07-28T00:01:00Z",
    )
    schema = _load_json(_N3_SCHEMA)
    definitions = _mapping(schema["$defs"])

    assert set(generated) == set(_mapping(schema["properties"]))
    assert set(generated) == set(cast(list[str], schema["required"]))
    _assert_declared_fields_and_literals(generated, schema)

    provenance = _mapping(generated["provenance"])
    _assert_declared_fields_and_literals(provenance, _mapping(definitions["provenance"]))
    units = _mapping(generated["units"])
    _assert_declared_fields_and_literals(
        units,
        _mapping(_mapping(schema["properties"])["units"]),
    )

    scenarios = [_mapping(item) for item in _sequence(generated["scenarios"])]
    assert tuple(cast(str, item["scenarioId"]) for item in scenarios) == _SCENARIO_IDS
    assert tuple(cast(str, item["scenarioId"]) for item in scenarios) == tuple(
        sorted(_SCENARIO_IDS)
    )

    scenario_declaration = _mapping(_mapping(schema["properties"])["scenarios"])
    prefix_items = _sequence(scenario_declaration["prefixItems"])
    for scenario, prefix in zip(scenarios, prefix_items, strict=True):
        prefix_schema = _mapping(prefix)
        all_of = _sequence(prefix_schema["allOf"])
        patch = _mapping(all_of[-1])
        base_schema = (
            _mapping(definitions["adverseScenario"])
            if "stressRate" in scenario
            else _mapping(definitions["scenario"])
        )
        _assert_declared_fields_and_literals(scenario, base_schema)
        patch_properties = _mapping(patch["properties"])
        for field, declaration_value in patch_properties.items():
            declaration = _mapping(declaration_value)
            if "const" in declaration:
                assert scenario[field] == declaration["const"]
            if "enum" in declaration:
                assert scenario[field] in _sequence(declaration["enum"])

        rate_schema = _mapping(definitions["rateRow"])
        for row_value in _sequence(scenario["rateRows"]):
            row = _mapping(row_value)
            _assert_declared_fields_and_literals(row, rate_schema)
            components = _mapping(row["components"])
            _assert_declared_fields_and_literals(
                components,
                _mapping(definitions["components"]),
            )
