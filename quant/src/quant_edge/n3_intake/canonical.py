"""Strict canonical parsing and semantic hashing for N3-I1 intake.

This module deliberately reuses the repository canonical JSON profile.  It does
not implement or claim RFC 8785/JCS compatibility.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from collections.abc import Iterable
from pathlib import PurePosixPath
from typing import Final, cast

from quant_edge.canonical import (
    canonical_json_bytes,
    parse_canonical_object,
    require_exact_keys,
)
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import (
    INT64_MAX,
    INT64_MIN,
    DigestV1,
    require_strict_int,
)
from quant_edge.n3_intake.contracts import MAX_DOCUMENT_BYTES, PinnedDocumentV1

SEMANTIC_DIGEST_PROFILE: Final = "N3I1_CANONICAL_SHA256_V1"
SEMANTIC_DIGEST_DOMAINS: Final = frozenset(
    {
        "REGISTRY:S_META1",
        "BRIDGE:S_META1_TO_N3",
        "RESULT:E1",
        "RESULT:S1C",
        "RESULT:S1D",
        "RESULT:S1E",
        "RESULT:VE1",
    }
)
MAX_STRUCTURE_DEPTH: Final = 32
MAX_CONTAINER_ENTRIES: Final = 10_000
MAX_STRING_BYTES: Final = 4_096
MAX_TOTAL_NODES: Final = 100_000

_GIT_OID_PATTERN: Final = re.compile(r"^[0-9a-f]{40}$")


def parse_document(document: PinnedDocumentV1) -> dict[str, object]:
    """Verify the exact raw-byte pin before parsing repository-canonical JSON."""

    if not isinstance(document, PinnedDocumentV1):
        raise ContractValueError("document must be PinnedDocumentV1")
    if type(document.raw) is not bytes:
        raise ContractValueError("document raw value must be bytes")
    if not 1 <= len(document.raw) <= MAX_DOCUMENT_BYTES:
        raise ContractValueError("document raw bytes must contain 1..1048576 bytes")
    if len(document.raw) != document.pin.byte_length:
        raise ContractValueError("document raw byte length does not match its pin")

    observed = hashlib.sha256(document.raw).hexdigest()
    expected = document.pin.raw_sha256.hexdigest
    if not hmac.compare_digest(observed, expected):
        raise ContractValueError("document raw SHA-256 does not match its pin")
    parsed = parse_canonical_object(document.raw)
    _require_structural_bounds(parsed)
    return parsed


def semantic_digest(domain: str, body: dict[str, object]) -> DigestV1:
    """Hash an N3-I1 semantic body under its exact allowed domain."""

    exact_domain = require_str(domain, field="domain")
    if exact_domain not in SEMANTIC_DIGEST_DOMAINS:
        raise ContractValueError("domain is not an allowed N3-I1 artifact domain")
    exact_body = require_dict(body, field="body")
    raw = canonical_json_bytes(
        {
            "body": exact_body,
            "domain": exact_domain,
            "profile": SEMANTIC_DIGEST_PROFILE,
        }
    )
    return DigestV1(hashlib.sha256(raw).hexdigest())


def require_dict(value: object, *, field: str) -> dict[str, object]:
    """Return an exact plain string-keyed dictionary."""

    if type(value) is not dict or not all(type(key) is str for key in value):
        raise ContractValueError(f"{field} must be a plain string-keyed object")
    return cast(dict[str, object], value)


def require_list(value: object, *, field: str) -> list[object]:
    """Return an exact plain list."""

    if type(value) is not list:
        raise ContractValueError(f"{field} must be an array")
    return cast(list[object], value)


def require_str(value: object, *, field: str) -> str:
    """Return strict UTF-8 text without accepting string-like values."""

    if type(value) is not str:
        raise ContractValueError(f"{field} must be a string")
    try:
        value.encode("utf-8", errors="strict")
    except UnicodeEncodeError as error:
        raise ContractValueError(f"{field} must encode as strict UTF-8") from error
    return value


def require_bool_or_none(value: object, *, field: str) -> bool | None:
    """Return an exact boolean or ``None``."""

    if value is None:
        return None
    if type(value) is not bool:
        raise ContractValueError(f"{field} must be boolean or null")
    return value


def require_int_or_none(
    value: object,
    *,
    field: str,
    minimum: int = INT64_MIN,
    maximum: int = INT64_MAX,
) -> int | None:
    """Return a bounded exact integer or ``None``; booleans are never integers."""

    if value is None:
        return None
    return require_strict_int(value, field=field, minimum=minimum, maximum=maximum)


def require_digest(value: object, *, field: str) -> DigestV1:
    """Parse a lowercase SHA-256 digest value."""

    try:
        return DigestV1(require_str(value, field=field))
    except ContractValueError as error:
        raise ContractValueError(f"{field} must be a lowercase SHA-256 digest") from error


def require_git_oid(value: object, *, field: str) -> str:
    """Parse the repository's lowercase 40-hex Git object identity."""

    text = require_str(value, field=field)
    if _GIT_OID_PATTERN.fullmatch(text) is None:
        raise ContractValueError(f"{field} must be a lowercase 40-hex Git object id")
    return text


def require_safe_relative_path(value: object, *, field: str) -> str:
    """Parse one canonical relative POSIX path without filesystem access."""

    text = require_str(value, field=field)
    parsed = PurePosixPath(text)
    if (
        not text
        or "\x00" in text
        or "\\" in text
        or "://" in text
        or parsed.is_absolute()
        or not parsed.parts
        or any(part in ("", ".", "..") for part in parsed.parts)
        or parsed.as_posix() != text
    ):
        raise ContractValueError(f"{field} must be a canonical safe relative POSIX path")
    return text


def require_keys(
    value: dict[str, object],
    *,
    expected: Iterable[str],
    field: str,
) -> None:
    """Require one exact object key set under the repository canonical error law."""

    exact = require_dict(value, field=field)
    require_exact_keys(exact, expected=expected, path=field)


def _require_structural_bounds(value: dict[str, object]) -> None:
    stack: list[tuple[object, int, str]] = [(value, 0, "$")]
    total_nodes = 0
    while stack:
        node, depth, path = stack.pop()
        total_nodes += 1
        if total_nodes > MAX_TOTAL_NODES:
            raise ContractValueError("document exceeds the N3-I1 total-node bound")
        if depth > MAX_STRUCTURE_DEPTH:
            raise ContractValueError(f"{path} exceeds the N3-I1 nesting-depth bound")
        if type(node) is str:
            if len(node.encode("utf-8")) > MAX_STRING_BYTES:
                raise ContractValueError(f"{path} exceeds the N3-I1 string-byte bound")
        elif type(node) is list:
            items = cast(list[object], node)
            if len(items) > MAX_CONTAINER_ENTRIES:
                raise ContractValueError(f"{path} exceeds the N3-I1 container-entry bound")
            stack.extend(
                (item, depth + 1, f"{path}[{index}]")
                for index, item in reversed(tuple(enumerate(items)))
            )
        elif type(node) is dict:
            mapping = cast(dict[str, object], node)
            if len(mapping) > MAX_CONTAINER_ENTRIES:
                raise ContractValueError(f"{path} exceeds the N3-I1 container-entry bound")
            for key, item in reversed(tuple(mapping.items())):
                if len(key.encode("utf-8")) > MAX_STRING_BYTES:
                    raise ContractValueError(f"{path}.<key> exceeds the N3-I1 string-byte bound")
                stack.append((item, depth + 1, f"{path}.{key}"))
