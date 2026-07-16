import pytest

from quant_edge.canonical import (
    canonical_json_bytes,
    parse_canonical_object,
    require_exact_keys,
)
from quant_edge.errors import CanonicalJsonError


def test_canonical_json_sorts_keys_and_terminates_once() -> None:
    value = {"z": [3, None], "a": {"ok": True, "text": "edge"}}
    assert canonical_json_bytes(value) == b'{"a":{"ok":true,"text":"edge"},"z":[3,null]}\n'
    assert parse_canonical_object(canonical_json_bytes(value)) == value


@pytest.mark.parametrize(
    "value",
    [
        1.5,
        {"float": float("nan")},
        {1: "not-a-string-key"},
        {"set": {1}},
        {"text": chr(0xD800)},
        {chr(0xD800): "invalid-key"},
    ],
)
def test_canonical_json_rejects_lossy_or_unsupported_values(value: object) -> None:
    with pytest.raises(CanonicalJsonError):
        canonical_json_bytes(value)


@pytest.mark.parametrize(
    "raw",
    [
        b'{"a":1,"a":2}\n',
        b'{"a":1.0}\n',
        b'{"a":1}',
        b' {"a":1}\n',
        b"[]\n",
        b"\xff",
        b"not-json\n",
        rb'{"x":"\ud800"}' + b"\n",
    ],
)
def test_parse_canonical_object_fails_closed(raw: bytes) -> None:
    with pytest.raises(CanonicalJsonError):
        parse_canonical_object(raw)


def test_parse_canonical_object_rejects_excessive_nesting_deterministically() -> None:
    raw = b'{"x":' + (b"[" * 2_000) + b"0" + (b"]" * 2_000) + b"}\n"
    with pytest.raises(CanonicalJsonError, match="nesting"):
        parse_canonical_object(raw)


def test_require_exact_keys_reports_missing_and_extra() -> None:
    require_exact_keys({"a": 1}, expected=("a",), path="$")
    with pytest.raises(CanonicalJsonError, match=r"missing=.*b.*extra=.*c"):
        require_exact_keys({"a": 1, "c": 2}, expected=("a", "b"), path="$")
