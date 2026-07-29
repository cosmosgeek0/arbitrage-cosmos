#!/usr/bin/env python3
"""Independent, repeatable verifier for a sealed S-1T research packet.

``experiment.py`` writes the packet and carries its own ``verify`` stage.  This
module is the second pair of eyes: it re-derives every checkable claim from the
three committed static contracts (``protocol.v1.json``, ``source_plan.v1.json``,
``trial_ledger.v1.json``) and from the packet bytes alone, without importing the
engine and without trusting any number the engine reported about itself.

What it proves, in the order of the mandate::

    1  static family count ....  twelve trials, exactly the frozen product
    2  canonical base .........  one pinned 40-hex commit, everywhere
    3  directed artifact digests  every ``*_file_sha256`` link points backwards
    4  O_EXCL marker ordering ..  create-once evidence for the three markers
    5  custody states .........  screen / development / holdout member-state law
    6  result identities ......  the result is re-derivable from its documents
    7  required fields ........  ``result_contract.required_fields``, null-safe
    8  verdict law ............  the four verdicts and the capital ceiling
    9  SHA256SUMS .............  byte-exact, complete, self-excluding
    10 forbidden authority ....  no live, private, order, money, or URL effect

Hard boundaries, enforced statically by :func:`audit_self_source` and
structurally by the checks themselves:

*   no ZIP member is ever opened -- archive files are hashed as opaque bytes,
    which the holdout law explicitly permits for sealed months;
*   no network, credential, subprocess, or private surface is touched;
*   nothing inside the packet is written, renamed, chmod-ed, or deleted;
*   the outcome is a pure function of (static contracts, packet bytes), so the
    verifier is repeatable and safe to run any number of times.

Usage::

    python3 verifier.py --packet-root /private/tmp/cosmos-s1t-...-v1
    python3 verifier.py --self-check          # synthetic fixtures only
    python3 verifier.py --self-check --json   # machine-readable
"""

from __future__ import annotations

import sys

if sys.version_info < (3, 13):
    raise SystemExit(
        "S1T_PYTHON_VERSION_UNSUPPORTED:Python 3.13 or newer is required, "
        f"found {sys.version_info.major}.{sys.version_info.minor}"
    )

import argparse
import ast
import hashlib
import json
import math
import os
import re
import tempfile
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import (
    ROUND_CEILING,
    Context,
    Decimal,
    InvalidOperation,
    ROUND_HALF_EVEN,
    setcontext,
)
from pathlib import Path, PurePosixPath
from typing import Any, Final

if not hasattr(os, "O_NOFOLLOW"):
    raise SystemExit(
        "S1T_O_NOFOLLOW_UNAVAILABLE:the verifier cannot safely authenticate packet paths"
    )

# The same pinned arithmetic context the engine seals its numbers with; every
# re-derived identity below is exact under it.
setcontext(Context(prec=50, rounding=ROUND_HALF_EVEN))

HERE: Final = Path(__file__).resolve().parent
VERIFIER_ID: Final = "s1t-verifier.v1"

CANONICAL_BASE: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
PROTOCOL_ID: Final = "s1t-binance-usdm-funding-interval-transition-v1"
STRATEGY_ID: Final = "S-1T"
SCHEMA_PREFIX: Final = "cosmos.quant.research.s1t"

# The corrected preseal contract binds the entire S-1T static implementation,
# including this verifier, by repository path, Git blob, raw SHA-256 and an
# immutable packet copy.  A verifier that is not inside that seal could be
# swapped independently of the packet it is supposed to authenticate.
SEALED_STATIC_FILES: Final = (
    "DISTINCTNESS.md",
    "OFFICIAL_SOURCE_RESEARCH.md",
    "README.md",
    "experiment.py",
    "protocol.v1.json",
    "source_plan.v1.json",
    "trial_ledger.v1.json",
    "verifier.py",
)
STATIC_REPOSITORY_PREFIX: Final = "quant/research/s1t"
PACKET_STATIC_PREFIX: Final = "static/quant/research/s1t"

STATIC_CONTRACTS: Final = ("protocol.v1.json", "source_plan.v1.json", "trial_ledger.v1.json")

SCENARIOS: Final = ("base", "stress", "severe")
SORTED_SCENARIOS: Final = tuple(sorted(SCENARIOS))
WHITE_SCENARIOS: Final = ("base", "stress")
HOUR_MS: Final = 3_600_000
DAY_MS: Final = 86_400_000
FAMILY_SIZE: Final = 12
CSCV_BLOCKS: Final = 12
CSCV_BLOCK_DAYS: Final = 22
CSCV_PURGED_DAYS: Final = 2
BOOTSTRAP_REPLICATES: Final = 4096
CAPITAL: Final = Decimal(1000)
ARCHIVE_HOST_PREFIX: Final = "https://data.binance.vision/"
RANK_CUTOFF_N: Final = 100
SCREEN_MONTHS: Final = ("2025-06",)
DEVELOPMENT_MONTHS: Final = (
    "2025-07",
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
)
HOLDOUT_MONTHS: Final = ("2026-04", "2026-05", "2026-06")

# Tolerance for the p-value / PBO rank lattice.  A stored p is a 50-significant
# digit quotient, so p * (B + 1) misses its integer by ~1e-47 at most.
LATTICE_TOLERANCE: Final = Decimal("1e-30")

SHA256_RE: Final = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE: Final = re.compile(r"^[0-9a-f]{40}$")
SUMS_LINE_RE: Final = re.compile(r"^([0-9a-f]{64})  (\S.*)$")
URL_RE: Final = re.compile(r"(?i)\b(?:https?|wss?|ftp)://[^\s\"',)\\]+")
TRIAL_ID_RE: Final = re.compile(r"^c[12]-l[12]-h(?:04|08|12)$")
SCREEN_SYMBOL_RE: Final = re.compile(r"^[A-Z0-9]+USDT$")
CANONICAL_UNSIGNED_DECIMAL_RE: Final = re.compile(
    r"^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$"
)
# A screen artifact may not carry an outcome-shaped field name.
OUTCOME_WORD_RE: Final = re.compile(
    r"(?:^|_)(?:net|pnl|profit|return|returns|realized|outcome|equity|drawdown|forward)(?:_|$)"
)
CREDENTIAL_RE: Final = re.compile(
    r"(?i)(?:api[_-]?key|x-mbx-apikey|listen[_-]?key|secret|passphrase|private[_-]?key"
    r"|authorization:|bearer\s|signature=|&signature|/sapi/|/dapi/|recvwindow)"
)

SEVERITY_FAIL: Final = "FAIL"
SEVERITY_ADVISORY: Final = "ADVISORY"
SEVERITY_SKIP: Final = "SKIP"


class VerifierAbort(RuntimeError):
    """A precondition failed so hard that further checking would be noise."""


@dataclass(frozen=True, slots=True)
class Finding:
    section: str
    severity: str
    code: str
    detail: str

    def line(self) -> str:
        tail = f" {self.detail}" if self.detail else ""
        return f"{self.severity} {self.section} {self.code}{tail}"


@dataclass
class Report:
    """Deterministic, ordered ledger of every check the verifier performed."""

    strict: bool = False
    findings: list[Finding] = field(default_factory=list)
    notes: dict[str, Any] = field(default_factory=dict)
    checks: int = 0
    _section: str = "startup"

    @contextmanager
    def stage(self, section: str) -> Iterator[None]:
        previous = self._section
        self._section = section
        try:
            yield
        finally:
            self._section = previous

    def _add(self, severity: str, code: str, detail: str) -> None:
        self.findings.append(Finding(self._section, severity, code, str(detail)))

    def fail(self, code: str, detail: str = "") -> None:
        self._add(SEVERITY_FAIL, code, detail)

    def advise(self, code: str, detail: str = "") -> None:
        self._add(SEVERITY_FAIL if self.strict else SEVERITY_ADVISORY, code, detail)

    def skip(self, code: str, detail: str = "") -> None:
        self._add(SEVERITY_SKIP, code, detail)

    def check(self, ok: bool, code: str, detail: str = "") -> bool:
        """Record one check; return whether it held, so callers can branch."""

        self.checks += 1
        if not ok:
            self.fail(code, detail)
        return ok

    def soft_check(self, ok: bool, code: str, detail: str = "") -> bool:
        self.checks += 1
        if not ok:
            self.advise(code, detail)
        return ok

    def equal(self, observed: Any, expected: Any, code: str, detail: str = "") -> bool:
        joined = f"{detail} observed={observed!r} expected={expected!r}".strip()
        return self.check(observed == expected, code, joined)

    def numeric(self, observed: Any, expected: Any, code: str, detail: str = "") -> bool:
        """Compare two frozen decimal strings by value, not by spelling."""

        self.checks += 1
        left = as_decimal(observed)
        right = as_decimal(expected)
        if left is None or right is None or left != right:
            self.fail(code, f"{detail} observed={observed!r} expected={expected!r}".strip())
            return False
        return True

    @property
    def failures(self) -> tuple[Finding, ...]:
        return tuple(item for item in self.findings if item.severity == SEVERITY_FAIL)

    @property
    def status(self) -> str:
        return "FAIL" if self.failures else "PASS"

    def summary(self) -> dict[str, Any]:
        counts = {
            severity: sum(1 for item in self.findings if item.severity == severity)
            for severity in (SEVERITY_FAIL, SEVERITY_ADVISORY, SEVERITY_SKIP)
        }
        return {
            "checks": self.checks,
            "counts": counts,
            "findings": [
                {
                    "code": item.code,
                    "detail": item.detail,
                    "section": item.section,
                    "severity": item.severity,
                }
                for item in self.findings
            ],
            "notes": dict(sorted(self.notes.items())),
            "status": self.status,
            "verifier_id": VERIFIER_ID,
        }


# --------------------------------------------------------------------------
# byte, JSON, and decimal primitives -- byte-identical to the engine's
# --------------------------------------------------------------------------


def canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        + b"\n"
    )


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    """Hash a file as opaque bytes.  A ZIP is never opened as an archive."""

    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def as_decimal(value: Any) -> Decimal | None:
    """Parse a frozen numeric field.  Booleans and non-finites are not numbers."""

    if isinstance(value, bool) or not isinstance(value, int | float | str | Decimal):
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return number if number.is_finite() else None


def decimal_string(value: Decimal) -> str:
    return "0" if value == 0 else format(value, "f")


def as_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


def is_hex_digest(value: Any) -> bool:
    return isinstance(value, str) and SHA256_RE.fullmatch(value) is not None


def parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    text = f"{value[:-1]}+00:00" if value.endswith("Z") else value
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


def iso_to_ms(value: Any) -> int | None:
    moment = parse_iso(value)
    return None if moment is None else int(moment.timestamp() * 1000)


def month_span(month: str) -> tuple[int, int] | None:
    try:
        start = datetime.strptime(month, "%Y-%m").replace(tzinfo=UTC)
    except ValueError:
        return None
    end = (
        start.replace(year=start.year + 1, month=1)
        if start.month == 12
        else start.replace(month=start.month + 1)
    )
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def day_count(start_ms: int, end_ms: int) -> int:
    return (end_ms - end_ms % DAY_MS - (start_ms - start_ms % DAY_MS)) // DAY_MS


def on_lattice(value: Decimal, denominator: int) -> bool:
    """Is ``value`` a ``k / denominator`` point, to the pinned precision?"""

    scaled = value * Decimal(denominator)
    nearest = scaled.to_integral_value()
    return abs(scaled - nearest) <= LATTICE_TOLERANCE * Decimal(denominator)


def parse_sidecar(raw: bytes, filename: str) -> str | None:
    """Read an official ``.CHECKSUM`` sidecar: a two-field text line, not a ZIP."""

    if not raw or len(raw) > 4096:
        return None
    try:
        fields = raw.decode("ascii").strip().split()
    except UnicodeDecodeError:
        return None
    if len(fields) != 2 or SHA256_RE.fullmatch(fields[0].lower()) is None:
        return None
    bound = fields[1].lstrip("*")
    if bound != filename or "/" in bound or "\\" in bound:
        return None
    return fields[0].lower()


def holm_adjusted(raw: Mapping[str, Decimal]) -> dict[str, Decimal]:
    """Step-down Holm with a running maximum -- the engine's exact procedure."""

    adjusted: dict[str, Decimal] = {}
    running = Decimal(0)
    ordered = sorted(raw.items(), key=lambda item: (item[1], item[0]))
    total = len(ordered)
    for index, (key, value) in enumerate(ordered):
        running = max(running, min(Decimal(1), value * Decimal(total - index)))
        adjusted[key] = running
    return adjusted


# --------------------------------------------------------------------------
# static self-audit: the boundary is a property of this source file
# --------------------------------------------------------------------------

FORBIDDEN_IMPORT_ROOTS: Final = frozenset(
    {
        "asyncio",
        "bz2",
        "ctypes",
        "ftplib",
        "gzip",
        "http",
        "imaplib",
        "lzma",
        "multiprocessing",
        "pickle",
        "poplib",
        "requests",
        "selectors",
        "shutil",
        "smtplib",
        "socket",
        "sqlite3",
        "ssl",
        "subprocess",
        "tarfile",
        "telnetlib",
        "urllib",
        "webbrowser",
        "xmlrpc",
        "zipfile",
        "zlib",
    }
)
MUTATING_CALLS: Final = frozenset(
    {
        "chmod",
        "copy2",
        "copyfile",
        "fdopen",
        "link",
        "mkdir",
        "move",
        "remove",
        "removedirs",
        "rename",
        "rmdir",
        "rmtree",
        "symlink_to",
        "touch",
        "truncate",
        "unlink",
        "write_bytes",
        "write_text",
    }
)
# The only write chokepoints build synthetic fixtures below an interpreter-owned
# TemporaryDirectory.  Production packet verification has no write call path.
WRITE_ALLOWED_FUNCTIONS: Final = frozenset(
    {
        "_fixture_write_bytes",
        "_fixture_write_json",
        "_build_self_check_fixture",
        "_build_terminal_packet_fixture",
        "_rebind_terminal_fixture",
        "_rewrite_fixture_sums",
        "run_self_check",
    }
)


def _call_label(node: ast.Call) -> str:
    func = node.func
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return ""


def _is_write_open(node: ast.Call, label: str) -> bool:
    if label != "open":
        return False
    modes = [
        argument.value
        for argument in [*node.args, *(keyword.value for keyword in node.keywords)]
        if isinstance(argument, ast.Constant) and isinstance(argument.value, str)
    ]
    return any(character in mode for mode in modes for character in "wax+")


def _scoped_calls(tree: ast.AST) -> list[tuple[str, ast.Call]]:
    found: list[tuple[str, ast.Call]] = []

    def walk(node: ast.AST, scope: str) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef):
                walk(child, child.name)
                continue
            if isinstance(child, ast.Call):
                found.append((scope, child))
            walk(child, scope)

    walk(tree, "<module>")
    return found


def audit_self_source(report: Report, source_path: Path | None = None) -> None:
    """Prove the boundary from this file's own syntax tree, not from a promise."""

    path = HERE / "verifier.py" if source_path is None else source_path
    if not path.is_file():
        report.skip("SELF_SOURCE_UNAVAILABLE", str(path))
        return
    raw = path.read_bytes()
    report.notes["verifier_sha256"] = sha256_bytes(raw)
    try:
        tree = ast.parse(raw.decode("utf-8"), filename=str(path))
    except (SyntaxError, UnicodeDecodeError) as exc:  # pragma: no cover - unparsable self
        report.fail("SELF_SOURCE_UNPARSABLE", str(exc))
        return

    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            imported.add(node.module.split(".")[0])
    banned = sorted(imported & FORBIDDEN_IMPORT_ROOTS)
    report.check(not banned, "SELF_FORBIDDEN_IMPORT", ",".join(banned))

    offenders = sorted(
        {
            f"{scope}:{_call_label(call)}"
            for scope, call in _scoped_calls(tree)
            if (_call_label(call) in MUTATING_CALLS or _is_write_open(call, _call_label(call)))
            and scope not in WRITE_ALLOWED_FUNCTIONS
        }
    )
    report.check(not offenders, "SELF_UNEXPECTED_MUTATION", ",".join(offenders))
    report.check(
        "verifier.py" in SEALED_STATIC_FILES,
        "SELF_NOT_IN_STATIC_SEAL",
        "verifier.py must be part of the exact static allowlist",
    )


def _function_by_name(tree: ast.AST, name: str) -> ast.FunctionDef | None:
    matches = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == name
    ]
    return matches[0] if len(matches) == 1 else None


def _calls_in(function: ast.FunctionDef | None, label: str) -> tuple[ast.Call, ...]:
    if function is None:
        return ()
    return tuple(
        node
        for node in ast.walk(function)
        if isinstance(node, ast.Call) and _call_label(node) == label
    )


def _attribute_names(node: ast.AST) -> set[str]:
    return {
        child.attr
        for child in ast.walk(node)
        if isinstance(child, ast.Attribute)
    }


def _has_integer_argument(call: ast.Call, value: int) -> bool:
    return any(
        isinstance(node, ast.Constant)
        and isinstance(node.value, int)
        and not isinstance(node.value, bool)
        and node.value == value
        for argument in (*call.args, *(item.value for item in call.keywords))
        for node in ast.walk(argument)
    )


def audit_engine_source(report: Report, packet: "Packet") -> None:
    """Authenticate the sealed producer's create-once implementation.

    This is deliberately a narrow static proof.  Runtime packet modes, exact
    bytes, inode/root identity, chain ordering, and source reconciliation are
    checked independently; here we prove that the sealed producer routes its
    writes through the required O_EXCL primitives.
    """

    with report.stage("sealed_engine_source"):
        relative = f"{PACKET_STATIC_PREFIX}/experiment.py"
        try:
            raw, _ = _read_regular_file(packet.root / relative)
            tree = ast.parse(raw.decode("utf-8"), filename=relative)
        except (OSError, VerifierAbort, SyntaxError, UnicodeDecodeError) as exc:
            report.fail("ENGINE_SOURCE_UNAVAILABLE", str(exc))
            return

        exclusive = _function_by_name(tree, "exclusive_create")
        report.check(exclusive is not None, "ENGINE_EXCLUSIVE_CREATE_MISSING")
        exclusive_opens = _calls_in(exclusive, "open")
        report.equal(len(exclusive_opens), 1, "ENGINE_EXCLUSIVE_OPEN_COUNT_INVALID")
        if exclusive_opens:
            names = _attribute_names(exclusive_opens[0])
            report.check(
                {"O_WRONLY", "O_CREAT", "O_EXCL", "O_NOFOLLOW"} <= names,
                "ENGINE_EXCLUSIVE_OPEN_FLAGS_INVALID",
                ",".join(sorted(names)),
            )
            report.check(
                _has_integer_argument(exclusive_opens[0], 0o600),
                "ENGINE_EXCLUSIVE_OPEN_MODE_INVALID",
            )
        report.check(bool(_calls_in(exclusive, "fsync")), "ENGINE_EXCLUSIVE_FSYNC_MISSING")

        for function_name in ("write_artifact", "write_packet_text"):
            function = _function_by_name(tree, function_name)
            report.check(function is not None, "ENGINE_WRITE_ROUTER_MISSING", function_name)
            report.check(
                bool(_calls_in(function, "exclusive_create")),
                "ENGINE_WRITE_ROUTER_NOT_EXCLUSIVE",
                function_name,
            )

        stream_copy = _function_by_name(tree, "_stream_copy")
        report.check(stream_copy is not None, "ENGINE_STREAM_COPY_MISSING")
        stream_opens = _calls_in(stream_copy, "open")
        report.equal(len(stream_opens), 1, "ENGINE_STREAM_COPY_OPEN_COUNT_INVALID")
        if stream_opens:
            names = _attribute_names(stream_opens[0])
            report.check(
                {"O_WRONLY", "O_CREAT", "O_EXCL", "O_NOFOLLOW"} <= names,
                "ENGINE_STREAM_COPY_FLAGS_INVALID",
                ",".join(sorted(names)),
            )
            report.check(
                _has_integer_argument(stream_opens[0], 0o600),
                "ENGINE_STREAM_COPY_OPEN_MODE_INVALID",
            )
        fchmods = _calls_in(stream_copy, "fchmod")
        report.check(
            any(_has_integer_argument(call, 0o444) for call in fchmods),
            "ENGINE_STREAM_COPY_FINAL_MODE_INVALID",
        )

        create_root = _function_by_name(tree, "create_packet_root")
        report.check(create_root is not None, "ENGINE_PACKET_ROOT_CREATE_MISSING")
        mkdirs = _calls_in(create_root, "mkdir")
        report.check(
            len(mkdirs) == 1 and _has_integer_argument(mkdirs[0], 0o700),
            "ENGINE_PACKET_ROOT_MODE_INVALID",
        )
        make_directory = _function_by_name(tree, "make_packet_directory")
        directory_mkdirs = _calls_in(make_directory, "mkdir")
        report.check(
            len(directory_mkdirs) == 1
            and _has_integer_argument(directory_mkdirs[0], 0o700),
            "ENGINE_PACKET_DIRECTORY_MODE_INVALID",
        )


# --------------------------------------------------------------------------
# the artifact chain, and which links each artifact must declare
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ChainEntry:
    name: str
    schema: str
    required: bool


PACKET_CHAIN: Final = (
    ChainEntry("preseal.v1.json", "preseal.v1", True),
    ChainEntry("screen_consumed.v1.json", "screen_consumed.v1", True),
    ChainEntry("screen_universe.v1.json", "screen_universe.v1", False),
    ChainEntry("source_manifest.v1.json", "source_manifest.v1", False),
    ChainEntry("freeze.v1.json", "freeze.v1", False),
    ChainEntry("run_consumed.v1.json", "run_consumed.v1", False),
    ChainEntry("event_universe.v1.json", "event_universe.v1", False),
    ChainEntry("opened_source_ledger.v1.json", "opened_source_ledger.v1", False),
    ChainEntry("development.v1.json", "development.v1", False),
    ChainEntry("candidate_seal.v1.json", "candidate_seal.v1", False),
    ChainEntry("holdout_open.v1.json", "holdout_open.v1", False),
    ChainEntry("holdout.v1.json", "holdout.v1", False),
    ChainEntry("result.v1.json", "result.v1", True),
)
CHAIN_ORDER: Final = (*STATIC_CONTRACTS, *(entry.name for entry in PACKET_CHAIN))
MARKER_FILES: Final = (
    "screen_consumed.v1.json",
    "run_consumed.v1.json",
    "holdout_open.v1.json",
)

# Every ``*_file_sha256`` field name the packet is allowed to use, and the file
# it must address.  ``result.v1.json`` is listed so that a link *to* the result
# is caught as a forward reference rather than as an unknown field.
LINK_FIELDS: Final = {
    "candidate_seal_file_sha256": "candidate_seal.v1.json",
    "development_file_sha256": "development.v1.json",
    "event_universe_file_sha256": "event_universe.v1.json",
    "freeze_file_sha256": "freeze.v1.json",
    "holdout_file_sha256": "holdout.v1.json",
    "holdout_open_file_sha256": "holdout_open.v1.json",
    "preseal_file_sha256": "preseal.v1.json",
    "protocol_file_sha256": "protocol.v1.json",
    "result_file_sha256": "result.v1.json",
    "run_consumed_file_sha256": "run_consumed.v1.json",
    "screen_consumed_file_sha256": "screen_consumed.v1.json",
    "screen_universe_file_sha256": "screen_universe.v1.json",
    "source_manifest_file_sha256": "source_manifest.v1.json",
    "opened_source_ledger_file_sha256": "opened_source_ledger.v1.json",
    "source_plan_file_sha256": "source_plan.v1.json",
    "trial_ledger_file_sha256": "trial_ledger.v1.json",
}
REQUIRED_LINKS: Final = {
    "screen_consumed.v1.json": ("preseal_file_sha256", "protocol_file_sha256"),
    "screen_universe.v1.json": ("preseal_file_sha256", "screen_consumed_file_sha256"),
    "source_manifest.v1.json": ("screen_universe_file_sha256",),
    "freeze.v1.json": (
        "preseal_file_sha256",
        "protocol_file_sha256",
        "screen_consumed_file_sha256",
        "screen_universe_file_sha256",
        "source_manifest_file_sha256",
        "source_plan_file_sha256",
        "trial_ledger_file_sha256",
    ),
    "run_consumed.v1.json": (
        "freeze_file_sha256",
        "protocol_file_sha256",
        "source_manifest_file_sha256",
        "trial_ledger_file_sha256",
    ),
    "event_universe.v1.json": ("freeze_file_sha256", "run_consumed_file_sha256"),
    "opened_source_ledger.v1.json": (
        "freeze_file_sha256",
        "run_consumed_file_sha256",
    ),
    "development.v1.json": (
        "event_universe_file_sha256",
        "freeze_file_sha256",
        "opened_source_ledger_file_sha256",
        "run_consumed_file_sha256",
    ),
    "candidate_seal.v1.json": (
        "development_file_sha256",
        "freeze_file_sha256",
        "run_consumed_file_sha256",
    ),
    "holdout_open.v1.json": ("candidate_seal_file_sha256", "development_file_sha256"),
    "holdout.v1.json": ("candidate_seal_file_sha256", "holdout_open_file_sha256"),
    "result.v1.json": (
        "event_universe_file_sha256",
        "freeze_file_sha256",
        "preseal_file_sha256",
        "protocol_file_sha256",
        "run_consumed_file_sha256",
        "screen_consumed_file_sha256",
        "source_manifest_file_sha256",
        "trial_ledger_file_sha256",
    ),
}
# Links whose value is ``null`` exactly when the target artifact was never
# created.  Every other declared link must resolve.
NULLABLE_LINKS: Final = {
    "result.v1.json": (
        "candidate_seal_file_sha256",
        "development_file_sha256",
        "holdout_file_sha256",
        "holdout_open_file_sha256",
    )
}

ACTIVITY_COUNTER_FIELDS: Final = (
    "active_cohorts",
    "active_weeks",
    "candidate_decision_hours",
    "cash_decision_hours",
    "cooldown_cash_hours",
    "distinct_traded_symbols",
    "overlap_cash_hours",
    "traded_members",
    "zero_signal_cash_hours",
)
VERDICTS: Final = (
    "NO_GO",
    "NO_GO_DEVELOPMENT_HOLDOUT_UNOPENED",
    "PUBLIC_PROXY_PASS_CAPITAL_NO_GO",
    "UNMEASURED_RUN_CONSUMED_NO_RERUN",
)
EXPECTED_EFFECTS: Final = {
    "credentials_used": False,
    "host_effects": False,
    "live_trading": False,
    "money_moved_usd": 0,
    "network_calls": 0,
    "orders_placed": 0,
    "private_api_used": False,
    "provider_mutation": False,
    "transfers": 0,
    "ui_effects": False,
    "withdrawals": 0,
}
DATASET_TEMPLATE_KEYS: Final = {
    "fundingRate": "fundingRate",
    "klines/1h": "klines_1h",
    "markPriceKlines/1h": "markPriceKlines_1h",
}


# --------------------------------------------------------------------------
# static contracts
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Statics:
    directory: Path
    protocol: Mapping[str, Any]
    plan: Mapping[str, Any]
    ledger: Mapping[str, Any]
    digests: Mapping[str, str]

    def section(self, name: str) -> Mapping[str, Any]:
        value = self.protocol.get(name)
        return value if isinstance(value, dict) else {}

    def plan_section(self, name: str) -> Mapping[str, Any]:
        value = self.plan.get(name)
        return value if isinstance(value, dict) else {}


def _read_json_object(path: Path) -> Mapping[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise VerifierAbort(f"JSON_READ_FAILED {path.name}: {exc}") from exc
    if not isinstance(value, dict):
        raise VerifierAbort(f"JSON_OBJECT_REQUIRED {path.name}")
    return value


def load_statics(report: Report, directory: Path) -> Statics:
    """Load the three committed contracts and digest all seven sealed files."""

    if not directory.is_dir():
        raise VerifierAbort(f"PROTOCOL_DIR_UNAVAILABLE {directory}")
    digests: dict[str, str] = {}
    for name in SEALED_STATIC_FILES:
        path = directory / name
        if not path.is_file() or path.is_symlink():
            raise VerifierAbort(f"STATIC_FILE_MISSING {name}")
        digests[name] = sha256_file(path)
    statics = Statics(
        directory=directory,
        protocol=_read_json_object(directory / "protocol.v1.json"),
        plan=_read_json_object(directory / "source_plan.v1.json"),
        ledger=_read_json_object(directory / "trial_ledger.v1.json"),
        digests=digests,
    )
    report.notes["protocol_dir"] = str(directory)
    report.notes["protocol_sha256"] = digests["protocol.v1.json"]
    report.notes["verifier.py_sha256"] = digests["verifier.py"]

    with report.stage("static_contract_identity"):
        report.equal(statics.protocol.get("protocol_id"), PROTOCOL_ID, "PROTOCOL_ID_INVALID")
        report.equal(statics.protocol.get("strategy_id"), STRATEGY_ID, "PROTOCOL_STRATEGY_INVALID")
        report.equal(statics.plan.get("protocol_id"), PROTOCOL_ID, "PLAN_ID_INVALID")
        report.equal(statics.ledger.get("protocol_id"), PROTOCOL_ID, "LEDGER_ID_INVALID")
        report.equal(
            statics.plan.get("schema"), f"{SCHEMA_PREFIX}.source_plan.v1", "PLAN_SCHEMA_INVALID"
        )
        report.equal(
            statics.ledger.get("schema"),
            f"{SCHEMA_PREFIX}.trial_ledger.v1",
            "LEDGER_SCHEMA_INVALID",
        )
        report.check(statics.plan.get("public_only") is True, "PLAN_NOT_PUBLIC_ONLY")
    return statics


def check_static_family_count(report: Report, statics: Statics) -> tuple[str, ...]:
    """Mandate 1: the family is exactly twelve, and exactly the frozen product."""

    family = statics.section("trial_family")
    multiplicity = statics.section("multiplicity")
    confirmations = tuple(family.get("confirmation_rows") or ())
    lags = tuple(family.get("entry_lag_hours") or ())
    holds = tuple(family.get("hold_hours") or ())

    report.equal(confirmations, (1, 2), "FAMILY_CONFIRMATION_ROWS_DRIFT")
    report.equal(lags, (1, 2), "FAMILY_ENTRY_LAG_DRIFT")
    report.equal(holds, (4, 8, 12), "FAMILY_HOLD_HOURS_DRIFT")
    report.check(family.get("cartesian_product") is True, "FAMILY_NOT_CARTESIAN")
    report.equal(family.get("ledger"), "trial_ledger.v1.json", "FAMILY_LEDGER_NAME_DRIFT")

    product = len(confirmations) * len(lags) * len(holds)
    report.equal(product, FAMILY_SIZE, "FAMILY_PRODUCT_NOT_TWELVE")
    report.equal(family.get("count"), FAMILY_SIZE, "FAMILY_COUNT_DRIFT")
    report.equal(multiplicity.get("family_size"), FAMILY_SIZE, "MULTIPLICITY_FAMILY_SIZE_DRIFT")
    report.equal(statics.ledger.get("family_size"), FAMILY_SIZE, "LEDGER_FAMILY_SIZE_DRIFT")

    rows = statics.ledger.get("trials")
    if not isinstance(rows, list) or not report.check(
        len(rows) == FAMILY_SIZE, "LEDGER_ROW_COUNT_DRIFT", f"rows={len(rows) if rows else 0}"
    ):
        return ()

    expected = {
        (confirmation, lag, hold): f"c{confirmation}-l{lag}-h{hold:02d}"
        for confirmation in confirmations
        for lag in lags
        for hold in holds
    }
    observed: dict[tuple[Any, Any, Any], str] = {}
    for row in rows:
        if not isinstance(row, dict):
            report.fail("LEDGER_ROW_INVALID", repr(row))
            continue
        key = (row.get("confirmation_rows"), row.get("entry_lag_hours"), row.get("hold_hours"))
        trial_id = row.get("trial_id")
        report.check(
            isinstance(trial_id, str) and TRIAL_ID_RE.fullmatch(trial_id) is not None,
            "LEDGER_TRIAL_ID_MALFORMED",
            repr(trial_id),
        )
        report.check(key not in observed, "LEDGER_DUPLICATE_PARAMETERS", repr(key))
        observed[key] = str(trial_id)
    report.equal(observed, expected, "LEDGER_NOT_FROZEN_PRODUCT")

    # The PBO split count is a pure function of the family size; the protocol
    # states 924, and C(12, 6) is 924.
    report.equal(math.comb(CSCV_BLOCKS, CSCV_BLOCKS // 2), 924, "PBO_SPLIT_ARITHMETIC_DRIFT")
    pbo_text = str(multiplicity.get("pbo", ""))
    report.check("924" in pbo_text and "12" in pbo_text, "PBO_DECLARATION_DRIFT", pbo_text)
    return tuple(sorted(expected.values()))


def check_canonical_base(report: Report, statics: Statics, expected: str | None) -> str:
    """Mandate 2: one pinned commit, shaped like a commit, declared everywhere."""

    base = statics.protocol.get("canonical_base")
    report.check(
        isinstance(base, str) and COMMIT_RE.fullmatch(base) is not None,
        "CANONICAL_BASE_MALFORMED",
        repr(base),
    )
    report.equal(base, CANONICAL_BASE, "CANONICAL_BASE_DRIFT")
    report.equal(statics.plan.get("canonical_base"), base, "PLAN_CANONICAL_BASE_DRIFT")
    if expected is not None:
        report.equal(base, expected, "CANONICAL_BASE_NOT_EXPECTED")
    report.notes["canonical_base"] = str(base)
    return str(base)


# --------------------------------------------------------------------------
# packet loading
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Packet:
    root: Path
    statics: Statics
    artifacts: Mapping[str, Mapping[str, Any]]
    digests: Mapping[str, str]
    files: tuple[str, ...]
    modes: Mapping[str, int]
    mtimes: Mapping[str, float]

    def get(self, name: str) -> Mapping[str, Any] | None:
        return self.artifacts.get(name)

    def has(self, name: str) -> bool:
        return name in self.artifacts

    def digest_of(self, name: str) -> str | None:
        return self.digests.get(name)


REPAIR_SUFFIX_RE: Final = re.compile(
    r"(?:~|\.(?:bak|orig|old|new|tmp|temp|partial|part|lock|swp|rej|save|copy|[0-9]+))$"
)


def _packet_relative_files(root: Path, report: Report) -> tuple[str, ...]:
    names: list[str] = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            report.fail("PACKET_SYMLINK_PRESENT", relative)
            continue
        if path.is_dir():
            continue
        if not path.is_file():
            report.fail("PACKET_IRREGULAR_FILE", relative)
            continue
        names.append(relative)
    return tuple(sorted(names))


def load_packet(report: Report, root: Path, statics: Statics) -> Packet:
    """Read every chain artifact once, requiring exact canonical bytes."""

    if not root.is_absolute():
        raise VerifierAbort(f"PACKET_ROOT_NOT_ABSOLUTE {root}")
    if root.is_symlink() or not root.is_dir():
        raise VerifierAbort(f"PACKET_ROOT_UNAVAILABLE {root}")
    report.notes["packet_root"] = str(root)

    with report.stage("packet_surface"):
        worktree = statics.directory.parents[2]
        report.check(
            not str(root.resolve()).startswith(f"{worktree}{os.sep}") and root.resolve() != worktree,
            "PACKET_ROOT_INSIDE_GIT",
            str(root),
        )
        files = _packet_relative_files(root, report)
        for name in files:
            if name.startswith("sources/"):
                report.check(
                    name.endswith(".zip") or name.endswith(".zip.CHECKSUM"),
                    "EXTRACTED_MEMBER_PRESENT",
                    name,
                )
                continue
            stem = name.split("/")[0]
            if stem in CHAIN_ORDER or stem in ("SHA256SUMS", "REPORT.md"):
                continue
            base = REPAIR_SUFFIX_RE.sub("", name)
            report.check(
                base not in CHAIN_ORDER and base not in ("SHA256SUMS", "REPORT.md"),
                "REPAIR_ARTIFACT_PRESENT",
                name,
            )

    artifacts: dict[str, Mapping[str, Any]] = {}
    digests: dict[str, str] = {name: statics.digests[name] for name in STATIC_CONTRACTS}
    modes: dict[str, int] = {}
    mtimes: dict[str, float] = {}

    with report.stage("artifact_bytes"):
        for entry in PACKET_CHAIN:
            path = root / entry.name
            if not path.exists():
                if entry.required:
                    report.fail("ARTIFACT_MISSING", entry.name)
                continue
            if not report.check(
                path.is_file() and not path.is_symlink(), "ARTIFACT_NOT_REGULAR_FILE", entry.name
            ):
                continue
            try:
                raw, status = _read_regular_file(path)
            except (OSError, VerifierAbort) as exc:
                report.fail("ARTIFACT_READ_FAILED", f"{entry.name}:{exc}")
                continue
            digests[entry.name] = sha256_bytes(raw)
            modes[entry.name] = status.st_mode & 0o777
            mtimes[entry.name] = status.st_mtime
            try:
                value = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                report.fail("ARTIFACT_JSON_INVALID", f"{entry.name}: {exc}")
                continue
            if not report.check(isinstance(value, dict), "ARTIFACT_NOT_OBJECT", entry.name):
                continue
            report.check(
                raw == canonical_bytes(value), "ARTIFACT_CANONICAL_BYTES_INVALID", entry.name
            )
            report.equal(
                value.get("schema"),
                f"{SCHEMA_PREFIX}.{entry.schema}",
                "ARTIFACT_SCHEMA_INVALID",
                entry.name,
            )
            report.check(
                "artifact_sha256" not in value and "artifactSha256" not in value,
                "ARTIFACT_SELF_DIGEST_PRESENT",
                entry.name,
            )
            artifacts[entry.name] = value

    for name in ("SHA256SUMS", "REPORT.md"):
        path = root / name
        if path.is_file() and not path.is_symlink():
            status = path.stat()
            modes[name] = status.st_mode & 0o777
            mtimes[name] = status.st_mtime

    return Packet(
        root=root,
        statics=statics,
        artifacts=artifacts,
        digests=digests,
        files=files,
        modes=modes,
        mtimes=mtimes,
    )


# --------------------------------------------------------------------------
# mandate 3: directed artifact digests
# --------------------------------------------------------------------------


def check_artifact_digests(report: Report, packet: Packet) -> None:
    """Every ``*_file_sha256`` must address a real, earlier, matching file.

    Direction is the whole point: a link may only bind something already sealed,
    so the chain cannot contain a cycle and no artifact can claim a descendant.
    """

    order = {name: index for index, name in enumerate(CHAIN_ORDER)}
    for name, value in sorted(packet.artifacts.items()):
        position = order[name]
        nullable = NULLABLE_LINKS.get(name, ())
        declared = sorted(key for key in value if key.endswith(("_sha256", "_sha256s")))
        for key in declared:
            if key in ("manifest_sha256",):  # the upstream cache witness, handled elsewhere
                continue
            if not key.endswith("_file_sha256"):
                report.fail("LINK_FIELD_UNRECOGNISED", f"{name}:{key}")
                continue
            target = LINK_FIELDS.get(key)
            if not report.check(target is not None, "LINK_FIELD_UNKNOWN", f"{name}:{key}"):
                continue
            assert target is not None
            report.check(
                order[target] < position,
                "LINK_DIRECTION_INVALID",
                f"{name}:{key} -> {target}",
            )
            claimed = value[key]
            present = target in packet.digests
            if claimed is None:
                report.check(key in nullable, "LINK_NULL_FORBIDDEN", f"{name}:{key}")
                report.check(not present, "LINK_NULL_BUT_TARGET_PRESENT", f"{name}:{key}")
                continue
            if not report.check(is_hex_digest(claimed), "LINK_DIGEST_MALFORMED", f"{name}:{key}"):
                continue
            if not report.check(present, "LINK_TARGET_MISSING", f"{name}:{key} -> {target}"):
                continue
            report.equal(
                claimed, packet.digests[target], "LINK_DIGEST_INVALID", f"{name}:{key} -> {target}"
            )
        for key in REQUIRED_LINKS.get(name, ()):
            report.check(key in value, "LINK_REQUIRED_ABSENT", f"{name}:{key}")

    # bound_files: the seven sealed static names, by digest, twice over.
    for name in ("preseal.v1.json", "freeze.v1.json"):
        artifact = packet.get(name)
        if artifact is None:
            continue
        bound = artifact.get("bound_files")
        if not report.check(isinstance(bound, dict), "BOUND_FILES_INVALID", name):
            continue
        assert isinstance(bound, dict)
        report.equal(
            tuple(sorted(bound)), tuple(sorted(SEALED_STATIC_FILES)), "BOUND_FILES_SET_DRIFT", name
        )
        for static_name in sorted(set(bound) & set(SEALED_STATIC_FILES)):
            report.equal(
                bound[static_name],
                packet.statics.digests[static_name],
                "BOUND_FILE_DIGEST_INVALID",
                f"{name}:{static_name}",
            )


def check_cache_witness(report: Report, packet: Packet, rehash: bool) -> None:
    """The upstream cache manifest is a provenance witness, never an outcome."""

    preseal = packet.get("preseal.v1.json")
    if preseal is None:
        return
    attestation = preseal.get("cache_manifest_attestation")
    if not report.check(isinstance(attestation, dict), "CACHE_ATTESTATION_MISSING"):
        return
    assert isinstance(attestation, dict)
    cache = packet.statics.plan_section("cache")
    report.equal(
        attestation.get("declared_schema"),
        "S1DBinancePublicArchiveManifestV1",
        "CACHE_ATTESTATION_SCHEMA_DRIFT",
    )
    report.equal(
        attestation.get("manifest_path"), cache.get("manifest"), "CACHE_ATTESTATION_PATH_DRIFT"
    )
    report.check(
        attestation.get("upstream_outcomes_read") is False, "CACHE_UPSTREAM_OUTCOMES_READ"
    )
    report.equal(cache.get("upstream_outcomes"), "FORBIDDEN", "PLAN_UPSTREAM_OUTCOMES_ALLOWED")
    report.check(is_hex_digest(attestation.get("manifest_sha256")), "CACHE_ATTESTATION_DIGEST_BAD")
    report.equal(preseal.get("cache_root"), cache.get("root"), "PRESEAL_CACHE_ROOT_DRIFT")
    report.check(preseal.get("engine_network_access") is False, "PRESEAL_NETWORK_ACCESS_DECLARED")

    declared_root = cache.get("root")
    if isinstance(declared_root, str):
        worktree = packet.statics.directory.parents[2]
        report.check(
            not declared_root.startswith(f"{worktree}{os.sep}"),
            "CACHE_ROOT_INSIDE_GIT",
            declared_root,
        )
    if not rehash:
        report.skip("CACHE_MANIFEST_REHASH_SKIPPED", "pass --check-cache-manifest to re-hash")
        return
    path = Path(str(attestation.get("manifest_path")))
    if not path.is_file() or path.is_symlink():
        report.skip("CACHE_MANIFEST_ABSENT", str(path))
        return
    report.equal(
        sha256_file(path), attestation.get("manifest_sha256"), "CACHE_MANIFEST_DIGEST_DRIFT"
    )


# --------------------------------------------------------------------------
# mandate 4: O_EXCL marker ordering evidence
# --------------------------------------------------------------------------


def filesystem_ordering_severity_is_fatal() -> bool:
    """Policy hook: how strict should filesystem-derived ordering evidence be?

    ``created_at`` ordering is sealed inside canonical bytes and is always
    fatal.  Modification times are corroborating evidence only: a faithful
    ``cp -r`` of an intact packet can reorder them, so by default a disagreement
    is reported as ADVISORY rather than failing the packet.  Flip this to
    ``True`` if packets are only ever verified in place, on the host that wrote
    them -- then a reordered mtime is real tamper evidence.
    """

    return False


def check_marker_ordering(report: Report, packet: Packet) -> None:
    present_chain = [name for name in CHAIN_ORDER[3:] if packet.has(name)]

    for name in MARKER_FILES:
        artifact = packet.get(name)
        if artifact is None:
            continue
        mode = packet.modes.get(name)
        report.check(mode == 0o444, "MARKER_NOT_READ_ONLY", f"{name} mode={mode:o}" if mode else name)

    screen = packet.get("screen_consumed.v1.json")
    preseal = packet.get("preseal.v1.json")
    if screen is not None:
        report.equal(screen.get("screen_ordinal"), 1, "SCREEN_ORDINAL_INVALID")
        report.equal(screen.get("allowed_screen_count"), 1, "SCREEN_ALLOWANCE_INVALID")
        report.check(
            screen.get("marker_created_before_first_member") is True,
            "SCREEN_MARKER_ORDER_UNDECLARED",
        )
        report.equal(
            screen.get("screen_archive_member_open_count_before"),
            0,
            "SCREEN_PRE_OPEN_COUNT_INVALID",
        )
        report.equal(
            screen.get("screen_month"),
            packet.statics.plan_section("partition_custody").get("screen", {}).get("month"),
            "SCREEN_MONTH_DRIFT",
        )
        count = as_int(screen.get("candidate_directory_count"))
        report.check(count is not None and count >= 0, "SCREEN_CANDIDATE_COUNT_INVALID")
    if preseal is not None:
        report.equal(preseal.get("allowed_screen_count"), 1, "PRESEAL_ALLOWANCE_INVALID")
        report.equal(
            preseal.get("policy"),
            "CREATED_BEFORE_ANY_SCREEN_MEMBER_OPEN",
            "PRESEAL_POLICY_DRIFT",
        )
        report.soft_check(
            preseal.get("packet_root") == str(packet.root),
            "PACKET_RELOCATED",
            f"declared={preseal.get('packet_root')!r}",
        )

    universe = packet.get("event_universe.v1.json")
    if universe is not None and screen is not None:
        opened = as_int(universe.get("screen_archive_member_open_count"))
        if report.check(opened is not None, "SCREEN_OPEN_COUNT_INVALID"):
            assert opened is not None
            # The marker recorded zero opens before it existed; the screen then
            # opened members.  That ordering is the create-once evidence.
            report.check(opened >= 1, "SCREEN_OPENED_NO_MEMBER", f"count={opened}")
        attempts = universe.get("screen_attempts")
        if isinstance(attempts, list):
            report.equal(
                universe.get("screen_attempt_count"), len(attempts), "SCREEN_ATTEMPT_COUNT_DRIFT"
            )
            reconciled = 0
            for attempt in attempts:
                value = as_int(attempt.get("archive_member_open_count")) if isinstance(
                    attempt, dict
                ) else None
                if value is None or value < 0:
                    report.fail("SCREEN_ATTEMPT_OPEN_COUNT_INVALID", repr(attempt)[:120])
                    reconciled = -1
                    break
                reconciled += value
            if reconciled >= 0:
                report.equal(
                    universe.get("screen_archive_member_open_count"),
                    reconciled,
                    "SCREEN_OPEN_RECONCILIATION_INVALID",
                )

    freeze = packet.get("freeze.v1.json")
    if freeze is not None:
        report.equal(freeze.get("allowed_run_count"), 1, "FREEZE_ALLOWANCE_INVALID")
        report.equal(
            freeze.get("development_archive_member_open_count"),
            0,
            "FREEZE_DEVELOPMENT_OPENED_EARLY",
        )
        report.equal(
            freeze.get("holdout_archive_member_open_count"), 0, "FREEZE_HOLDOUT_OPENED_EARLY"
        )

    run_marker = packet.get("run_consumed.v1.json")
    if run_marker is not None:
        report.equal(run_marker.get("run_ordinal"), 1, "RUN_ORDINAL_INVALID")
        report.check(
            run_marker.get("marker_created_before_development_valuation") is True,
            "RUN_MARKER_ORDER_UNDECLARED",
        )
        report.equal(
            run_marker.get("development_archive_member_open_count_before"),
            0,
            "RUN_PRE_OPEN_COUNT_INVALID",
        )
        report.equal(
            run_marker.get("holdout_archive_member_open_count_before"),
            0,
            "RUN_HOLDOUT_PRE_OPEN_COUNT_INVALID",
        )

    open_marker = packet.get("holdout_open.v1.json")
    if open_marker is not None:
        report.equal(open_marker.get("holdout_open_ordinal"), 1, "HOLDOUT_OPEN_ORDINAL_INVALID")
        report.equal(
            open_marker.get("allowed_holdout_open_count"), 1, "HOLDOUT_OPEN_ALLOWANCE_INVALID"
        )
        report.check(
            open_marker.get("marker_created_before_first_member") is True,
            "HOLDOUT_MARKER_ORDER_UNDECLARED",
        )
        report.equal(
            open_marker.get("holdout_archive_member_open_count_before"),
            0,
            "HOLDOUT_PRE_OPEN_COUNT_INVALID",
        )
        report.equal(
            open_marker.get("reserved_holdout_path"), "holdout.v1.json", "HOLDOUT_PATH_DRIFT"
        )
        report.equal(
            open_marker.get("reserved_result_path"), "result.v1.json", "RESULT_PATH_DRIFT"
        )
        report.check(
            packet.has("candidate_seal.v1.json"),
            "HOLDOUT_OPENED_WITHOUT_CANDIDATE_SEAL",
        )

    # created_at is sealed inside canonical bytes: it must not go backwards.
    previous_name = ""
    previous_moment: datetime | None = None
    for name in present_chain:
        moment = parse_iso(packet.artifacts[name].get("created_at"))
        if not report.check(moment is not None, "CREATED_AT_INVALID", name):
            continue
        assert moment is not None
        if previous_moment is not None:
            report.check(
                previous_moment <= moment,
                "CHAIN_CREATED_AT_OUT_OF_ORDER",
                f"{previous_name} -> {name}",
            )
        previous_name, previous_moment = name, moment

    fatal = filesystem_ordering_severity_is_fatal()
    previous_name = ""
    previous_mtime = -1.0
    for name in present_chain:
        stamp = packet.mtimes.get(name)
        if stamp is None:
            continue
        if previous_mtime >= 0 and stamp + 1e-6 < previous_mtime:
            detail = f"{previous_name} -> {name}"
            if fatal:
                report.fail("CHAIN_MTIME_OUT_OF_ORDER", detail)
            else:
                report.advise("CHAIN_MTIME_OUT_OF_ORDER", detail)
        report.checks += 1
        previous_name, previous_mtime = name, stamp


# --------------------------------------------------------------------------
# mandate 5: custody states
# --------------------------------------------------------------------------


def _partition_months(statics: Statics) -> tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    custody = statics.plan_section("partition_custody")
    screen = custody.get("screen", {})
    development = custody.get("development", {})
    holdout = custody.get("holdout", {})
    screen_months = (str(screen.get("month")),) if isinstance(screen, dict) else ()
    dev_months = tuple(
        str(item) for item in (development.get("months") or ()) if isinstance(development, dict)
    )
    hold_months = tuple(
        str(item) for item in (holdout.get("months") or ()) if isinstance(holdout, dict)
    )
    return screen_months, dev_months, hold_months


def expected_member_state(
    dataset: str,
    month: str,
    holdout: Sequence[str],
    screen: Sequence[str],
    symbol: str = "",
) -> str:
    if month in holdout:
        if symbol == "BTCUSDT" and month == "2026-06":
            return "HEADER_ONLY_SCHEMA_EXPOSED"
        return "SEALED_UNOPENED"
    if month in screen:
        return "SCREEN_OPENED_ONCE"
    if dataset == "fundingRate":
        return "DEVELOPMENT_SIGNAL_OPENED_ONCE"
    return "DEVELOPMENT_HASHED_UNOPENED_AT_MANIFEST"


def check_frozen_top100_ranking(
    report: Report,
    screen_universe: Mapping[str, Any],
    statics: Statics,
) -> None:
    """Re-derive the one permitted June rank selection from packet evidence.

    The current engine records the selection structurally rather than carrying a
    redundant ``rank_selection`` boolean.  If an older producer does carry that
    field it must say true; in every schema the ledger itself must prove exact
    descending contract quote-volume rank, raw-ASCII tie breaking, and selection
    of precisely ranks 1..min(100, eligible_count).
    """

    protocol_screen = statics.section("screen")
    plan_screen = statics.plan_section("screen_custody")
    report.equal(
        protocol_screen.get("rank_cutoff_n"),
        RANK_CUTOFF_N,
        "STATIC_SCREEN_RANK_CUTOFF_DRIFT",
    )
    report.check(
        "N=100 is the only permitted cutoff"
        in str(protocol_screen.get("rank_cutoff_trials")),
        "STATIC_SCREEN_ALTERNATE_CUTOFF_ALLOWED",
    )
    report.check(
        "N=100 only" in str(plan_screen.get("rank_cutoff")),
        "STATIC_PLAN_ALTERNATE_CUTOFF_ALLOWED",
    )
    report.check(
        screen_universe.get("rank_selection", True) is True,
        "SCREEN_RANK_SELECTION_FALSE",
    )
    report.equal(
        screen_universe.get("rank_cutoff_n"),
        RANK_CUTOFF_N,
        "SCREEN_RANK_CUTOFF_INVALID",
    )
    report.equal(
        screen_universe.get("tested_rank_cutoffs"),
        [RANK_CUTOFF_N],
        "SCREEN_ALTERNATE_RANK_CUTOFF",
    )
    report.equal(
        screen_universe.get("ranking_order"),
        "exact_quote_volume_total_desc_then_ascii_symbol_asc",
        "SCREEN_RANKING_ORDER_DRIFT",
    )
    report.equal(
        screen_universe.get("selection_rule"),
        "first min(100, eligible_count); never padded, never replaced",
        "SCREEN_SELECTION_RULE_DRIFT",
    )

    raw_ledger = _value_first(
        screen_universe, "screen_ledger", "screen_attempts"
    )
    if not report.check(isinstance(raw_ledger, list), "SCREEN_RANK_LEDGER_INVALID"):
        return
    assert isinstance(raw_ledger, list)

    candidate_count = as_int(screen_universe.get("candidate_count"))
    eligible_declared = as_int(screen_universe.get("eligible_count"))
    ineligible_declared = as_int(screen_universe.get("ineligible_count"))
    report.equal(candidate_count, len(raw_ledger), "SCREEN_CANDIDATE_COUNT_DRIFT")
    report.check(
        eligible_declared is not None and eligible_declared >= 0,
        "SCREEN_ELIGIBLE_COUNT_INVALID",
    )
    report.check(
        ineligible_declared is not None and ineligible_declared >= 0,
        "SCREEN_INELIGIBLE_COUNT_INVALID",
    )

    eligible_fields = {
        "eligibility",
        "june_contract_quote_volume_total",
        "june_funding_rows",
        "june_hourly_rows",
        "june_member_open_count",
        "june_zip_sha256_by_dataset",
        "rank",
        "reason_code",
        "selection_status",
        "source_bindings",
        "symbol",
    }
    ineligible_fields = {
        "eligibility",
        "june_contract_quote_volume_total",
        "june_member_open_count",
        "rank",
        "reason_code",
        "selection_status",
        "source_bindings",
        "symbol",
    }
    observed_symbols: list[str] = []
    ranked: list[tuple[int, Decimal, str, str]] = []
    eligible_observed = 0
    ineligible_observed = 0
    for raw_row in raw_ledger:
        if not report.check(isinstance(raw_row, dict), "SCREEN_RANK_ROW_NOT_OBJECT"):
            continue
        assert isinstance(raw_row, dict)
        symbol = raw_row.get("symbol")
        valid_symbol = (
            isinstance(symbol, str)
            and SCREEN_SYMBOL_RE.fullmatch(symbol) is not None
        )
        report.check(valid_symbol, "SCREEN_RANK_SYMBOL_INVALID", repr(symbol))
        if valid_symbol:
            assert isinstance(symbol, str)
            observed_symbols.append(symbol)

        eligibility = raw_row.get("eligibility")
        report.check(
            eligibility in ("ELIGIBLE", "INELIGIBLE"),
            "SCREEN_RANK_ELIGIBILITY_INVALID",
            str(symbol),
        )
        expected_fields = (
            eligible_fields if eligibility == "ELIGIBLE" else ineligible_fields
        )
        report.equal(
            set(raw_row),
            expected_fields,
            "SCREEN_RANK_ROW_FIELD_SET_INVALID",
            str(symbol),
        )
        member_opens = as_int(raw_row.get("june_member_open_count"))
        report.check(
            member_opens is not None and member_opens >= 0,
            "SCREEN_RANK_MEMBER_OPEN_COUNT_INVALID",
            str(symbol),
        )
        report.check(
            isinstance(raw_row.get("source_bindings"), list),
            "SCREEN_RANK_SOURCE_BINDINGS_INVALID",
            str(symbol),
        )

        if eligibility == "INELIGIBLE":
            ineligible_observed += 1
            report.check(
                isinstance(raw_row.get("reason_code"), str)
                and bool(raw_row.get("reason_code")),
                "SCREEN_RANK_INELIGIBLE_REASON_MISSING",
                str(symbol),
            )
            report.equal(
                raw_row.get("june_contract_quote_volume_total"),
                None,
                "SCREEN_RANK_INELIGIBLE_HAS_TOTAL",
                str(symbol),
            )
            report.equal(
                raw_row.get("rank"),
                None,
                "SCREEN_RANK_INELIGIBLE_HAS_RANK",
                str(symbol),
            )
            report.equal(
                raw_row.get("selection_status"),
                None,
                "SCREEN_RANK_INELIGIBLE_SELECTED",
                str(symbol),
            )
            continue
        if eligibility != "ELIGIBLE":
            continue

        eligible_observed += 1
        report.equal(
            raw_row.get("reason_code"),
            None,
            "SCREEN_RANK_ELIGIBLE_HAS_REASON",
            str(symbol),
        )
        report.equal(
            raw_row.get("june_funding_rows"),
            90,
            "SCREEN_RANK_FUNDING_ROWS_INVALID",
            str(symbol),
        )
        report.equal(
            raw_row.get("june_hourly_rows"),
            720,
            "SCREEN_RANK_HOURLY_ROWS_INVALID",
            str(symbol),
        )
        digests = raw_row.get("june_zip_sha256_by_dataset")
        if report.check(
            isinstance(digests, dict),
            "SCREEN_RANK_JUNE_DIGESTS_INVALID",
            str(symbol),
        ):
            assert isinstance(digests, dict)
            report.equal(
                set(digests),
                {"fundingRate", "klines/1h", "markPriceKlines/1h"},
                "SCREEN_RANK_JUNE_DIGEST_SET_INVALID",
                str(symbol),
            )
            for dataset, digest in digests.items():
                report.check(
                    is_hex_digest(digest),
                    "SCREEN_RANK_JUNE_DIGEST_INVALID",
                    f"{symbol}:{dataset}",
                )

        raw_total = raw_row.get("june_contract_quote_volume_total")
        total_valid = (
            isinstance(raw_total, str)
            and CANONICAL_UNSIGNED_DECIMAL_RE.fullmatch(raw_total) is not None
        )
        report.check(
            total_valid,
            "SCREEN_RANK_TOTAL_NOT_CANONICAL",
            f"{symbol}:{raw_total!r}",
        )
        total = as_decimal(raw_total) if total_valid else None
        rank = as_int(raw_row.get("rank"))
        status = raw_row.get("selection_status")
        report.check(
            rank is not None and rank >= 1,
            "SCREEN_RANK_VALUE_INVALID",
            f"{symbol}:{rank!r}",
        )
        report.check(
            status in ("SELECTED", "REJECTED_BY_RANK"),
            "SCREEN_RANK_STATUS_INVALID",
            f"{symbol}:{status!r}",
        )
        if (
            valid_symbol
            and total is not None
            and rank is not None
            and rank >= 1
            and isinstance(status, str)
        ):
            ranked.append((rank, total, str(symbol), status))

    report.equal(
        observed_symbols,
        sorted(set(observed_symbols)),
        "SCREEN_RANK_LEDGER_NOT_COMPLETE_SORTED_UNIQUE",
    )
    report.equal(
        eligible_declared,
        eligible_observed,
        "SCREEN_ELIGIBLE_COUNT_DRIFT",
    )
    report.equal(
        ineligible_declared,
        ineligible_observed,
        "SCREEN_INELIGIBLE_COUNT_DRIFT",
    )
    report.equal(
        candidate_count,
        eligible_observed + ineligible_observed,
        "SCREEN_CANDIDATE_DISPOSITION_INCOMPLETE",
    )
    if eligible_declared is None:
        return

    ranked.sort(key=lambda row: row[0])
    report.equal(
        [row[0] for row in ranked],
        list(range(1, eligible_declared + 1)),
        "SCREEN_RANKS_NOT_CONTIGUOUS",
    )
    for previous, current in zip(ranked, ranked[1:], strict=False):
        previous_total, current_total = previous[1], current[1]
        if previous_total == current_total:
            report.check(
                previous[2].encode("ascii") < current[2].encode("ascii"),
                "SCREEN_RANK_TIE_ASCII_INVALID",
                f"{previous[2]}->{current[2]}",
            )
        else:
            report.check(
                previous_total > current_total,
                "SCREEN_RANK_TOTAL_ORDER_INVALID",
                f"{previous[2]}->{current[2]}",
            )

    cutoff = min(RANK_CUTOFF_N, eligible_declared)
    expected_selected: list[str] = []
    for rank, _total, symbol, status in ranked:
        expected_status = "SELECTED" if rank <= cutoff else "REJECTED_BY_RANK"
        report.equal(
            status,
            expected_status,
            "SCREEN_RANK_SELECTION_STATUS_INVALID",
            f"{symbol}:rank={rank}",
        )
        if rank <= cutoff:
            expected_selected.append(symbol)

    fixed_universe = screen_universe.get("fixed_universe")
    if report.check(
        isinstance(fixed_universe, list),
        "SCREEN_FIXED_UNIVERSE_INVALID",
    ):
        assert isinstance(fixed_universe, list)
        report.equal(
            fixed_universe,
            sorted(set(expected_selected)),
            "SCREEN_FIXED_UNIVERSE_NOT_TOP100",
        )
    report.equal(
        screen_universe.get("selected_count"),
        cutoff,
        "SCREEN_SELECTED_COUNT_INVALID",
    )
    report.equal(
        screen_universe.get("rejected_by_rank_count"),
        eligible_declared - cutoff,
        "SCREEN_REJECTED_BY_RANK_COUNT_INVALID",
    )


def check_custody_states(report: Report, packet: Packet) -> None:
    statics = packet.statics
    screen_months, dev_months, hold_months = _partition_months(statics)
    all_months = (*screen_months, *dev_months, *hold_months)
    datasets = tuple(str(item) for item in (statics.plan_section("selected_source").get("datasets") or ()))

    report.equal(
        tuple(str(item) for item in (statics.plan.get("months") or ())),
        all_months,
        "PLAN_MONTHS_DRIFT",
    )
    report.equal(len(all_months), 13, "PLAN_MONTH_COUNT_DRIFT")
    report.equal(tuple(sorted(datasets)), tuple(sorted(DATASET_TEMPLATE_KEYS)), "PLAN_DATASETS_DRIFT")
    run_custody = statics.plan_section("run_custody")
    report.check(run_custody.get("one_run") is True, "PLAN_ONE_RUN_DISABLED")
    report.check(run_custody.get("repair") is False, "PLAN_REPAIR_ALLOWED")
    report.check(run_custody.get("rerun") is False, "PLAN_RERUN_ALLOWED")
    report.equal(run_custody.get("second_invocation"), "REFUSE", "PLAN_SECOND_INVOCATION_DRIFT")
    network = statics.plan_section("network_policy")
    for flag in ("credentials", "engine_network_access", "private_endpoints", "rest_fallback", "signed_endpoints"):
        report.check(network.get(flag) is False, "PLAN_NETWORK_POLICY_DRIFT", flag)

    # --- source manifest: the sealed-months law ---------------------------
    manifest = packet.get("source_manifest.v1.json")
    screen_universe = packet.get("screen_universe.v1.json")
    universe = packet.get("event_universe.v1.json")
    if screen_universe is not None:
        check_frozen_top100_ranking(report, screen_universe, statics)
    if manifest is not None:
        report.equal(
            manifest.get("development_archive_member_open_count"),
            0,
            "MANIFEST_DEVELOPMENT_OPENED",
        )
        report.equal(
            manifest.get("holdout_archive_member_open_count"), 0, "MANIFEST_HOLDOUT_OPENED"
        )
        report.equal(
            manifest.get("holdout_outcome_rows_opened_before_gates"),
            0,
            "MANIFEST_HOLDOUT_OUTCOME_ROWS_OPENED",
        )
        report.check(
            manifest.get("remote_revision_equality_claim") is False,
            "MANIFEST_REMOTE_EQUALITY_CLAIMED",
        )
        report.equal(manifest.get("packet_source_prefix"), "sources", "MANIFEST_PREFIX_DRIFT")
        report.check(
            manifest.get("status") in ("COMPLETE", "INVALID_EVIDENCE"),
            "MANIFEST_STATUS_INVALID",
            repr(manifest.get("status")),
        )

        entries = manifest.get("entries")
        if report.check(isinstance(entries, list), "MANIFEST_ENTRIES_INVALID"):
            assert isinstance(entries, list)
            report.equal(manifest.get("entry_count"), len(entries), "MANIFEST_ENTRY_COUNT_DRIFT")
            seen: set[tuple[str, str, str]] = set()
            symbols: set[str] = set()
            sealed = 0
            templates = statics.plan_section("templates")
            for entry in entries:
                if not isinstance(entry, dict):
                    report.fail("MANIFEST_ENTRY_NOT_OBJECT", repr(entry)[:120])
                    continue
                symbol = str(entry.get("symbol"))
                month = str(entry.get("month"))
                dataset = str(entry.get("dataset"))
                key = (symbol, month, dataset)
                report.check(key not in seen, "MANIFEST_DUPLICATE_ENTRY", ":".join(key))
                seen.add(key)
                symbols.add(symbol)
                report.check(month in all_months, "MANIFEST_MONTH_UNPLANNED", ":".join(key))
                report.check(dataset in datasets, "MANIFEST_DATASET_UNPLANNED", ":".join(key))
                for required in (
                    "byte_count",
                    "dataset",
                    "member_state",
                    "month",
                    "official_zip_sha256",
                    "relative_path",
                    "sidecar_sha256",
                    "source_url",
                    "symbol",
                    "zip_sha256",
                ):
                    report.check(required in entry, "MANIFEST_FIELD_MISSING", f"{':'.join(key)}:{required}")
                template = templates.get(DATASET_TEMPLATE_KEYS.get(dataset, ""))
                if isinstance(template, str):
                    report.equal(
                        entry.get("relative_path"),
                        template.format(symbol=symbol, month=month),
                        "MANIFEST_RELATIVE_PATH_DRIFT",
                        ":".join(key),
                    )
                report.equal(
                    entry.get("source_url"),
                    f"{ARCHIVE_HOST_PREFIX}{entry.get('relative_path')}",
                    "MANIFEST_SOURCE_URL_DRIFT",
                    ":".join(key),
                )
                for digest_field in ("official_zip_sha256", "sidecar_sha256", "zip_sha256"):
                    report.check(
                        is_hex_digest(entry.get(digest_field)),
                        "MANIFEST_DIGEST_MALFORMED",
                        f"{':'.join(key)}:{digest_field}",
                    )
                state = entry.get("member_state")
                report.equal(
                    state,
                    expected_member_state(dataset, month, hold_months, screen_months, symbol),
                    "CUSTODY_MEMBER_STATE_INVALID",
                    ":".join(key),
                )
                sealed += int(state == "SEALED_UNOPENED")
            report.equal(
                manifest.get("sealed_unopened_count"), sealed, "MANIFEST_SEALED_COUNT_DRIFT"
            )
            report.equal(
                manifest.get("event_symbol_count"), len(symbols), "MANIFEST_SYMBOL_COUNT_DRIFT"
            )
            expected_entries = len(symbols) * len(all_months) * len(datasets)
            if manifest.get("status") == "COMPLETE":
                report.equal(len(entries), expected_entries, "MANIFEST_INCOMPLETE_GRID")
            report.equal(
                sealed,
                len(symbols) * len(hold_months) * len(datasets)
                - (len(datasets) if "BTCUSDT" in symbols and "2026-06" in hold_months else 0),
                "CUSTODY_SEALED_GRID_INCOMPLETE",
            )
            if universe is not None:
                declared = universe.get("event_symbols")
                if isinstance(declared, list):
                    report.equal(
                        tuple(sorted(symbols)),
                        tuple(sorted(str(item) for item in declared)),
                        "MANIFEST_SYMBOLS_NOT_EVENT_UNIVERSE",
                    )

    # --- event universe: screen purity and the causal clock ---------------
    if universe is not None:
        report.check(universe.get("outcome_scoring") is False, "SCREEN_OUTCOME_SCORING_DECLARED")
        report.check(
            universe.get("forward_returns_included") is False, "SCREEN_FORWARD_RETURNS_DECLARED"
        )
        report.check(
            universe.get("status") in ("FROZEN", "INVALID_EVIDENCE"),
            "UNIVERSE_STATUS_INVALID",
            repr(universe.get("status")),
        )
        symbols_declared = universe.get("universe_symbols")
        events_declared = universe.get("event_symbols")
        if isinstance(symbols_declared, list) and isinstance(events_declared, list):
            report.equal(
                universe.get("universe_symbol_count"),
                len(symbols_declared),
                "UNIVERSE_SYMBOL_COUNT_DRIFT",
            )
            report.equal(
                universe.get("event_symbol_count"),
                len(events_declared),
                "UNIVERSE_EVENT_COUNT_DRIFT",
            )
            report.check(
                list(symbols_declared) == sorted(str(item) for item in symbols_declared),
                "UNIVERSE_SYMBOLS_UNSORTED",
            )
            report.check(
                set(events_declared) <= set(symbols_declared), "EVENT_SYMBOLS_NOT_IN_UNIVERSE"
            )
        check_transition_identities(report, packet, universe)


def check_transition_identities(
    report: Report, packet: Packet, universe: Mapping[str, Any]
) -> None:
    """Re-derive the signal, the normalization, and the lag-safe decision hour."""

    statics = packet.statics
    event = statics.section("event")
    signal_intervals = tuple(event.get("eligible_new_interval_hours") or ())
    cooldown_days = as_decimal(event.get("cooldown_days_per_symbol"))
    lags = tuple(statics.section("trial_family").get("entry_lag_hours") or ())
    streams = universe.get("development_transitions_by_confirmation_rows")
    counts = universe.get("transition_count_by_confirmation_rows")
    if not isinstance(streams, dict) or not isinstance(counts, dict):
        report.fail("UNIVERSE_STREAMS_INVALID")
        return
    expected_keys = tuple(
        str(item) for item in (statics.section("trial_family").get("confirmation_rows") or ())
    )
    report.equal(tuple(sorted(streams)), tuple(sorted(expected_keys)), "UNIVERSE_STREAM_KEYS_DRIFT")
    report.equal(tuple(sorted(counts)), tuple(sorted(expected_keys)), "UNIVERSE_COUNT_KEYS_DRIFT")

    for key in sorted(streams):
        rows = streams[key]
        if not isinstance(rows, list):
            report.fail("UNIVERSE_STREAM_NOT_LIST", key)
            continue
        report.equal(counts.get(key), len(rows), "UNIVERSE_STREAM_COUNT_DRIFT", key)
        last_event_by_symbol: dict[str, int] = {}
        previous_event = -1
        for row in rows:
            if not isinstance(row, dict):
                report.fail("UNIVERSE_ROW_NOT_OBJECT", key)
                continue
            label = f"{key}:{row.get('symbol')}:{row.get('event_calc_time')}"
            outcome_keys = sorted(
                name for name in row if OUTCOME_WORD_RE.search(name) is not None
            )
            report.check(not outcome_keys, "SCREEN_OUTCOME_FIELD_PRESENT", f"{label}:{outcome_keys}")

            interval = as_int(row.get("new_interval_hours"))
            report.check(
                interval in signal_intervals, "TRANSITION_INTERVAL_INELIGIBLE", f"{label}:{interval}"
            )
            event_ms = as_int(row.get("event_calc_time_ms"))
            confirm_ms = as_int(row.get("confirm_calc_time_ms"))
            if event_ms is None or confirm_ms is None:
                report.fail("TRANSITION_TIMESTAMP_INVALID", label)
                continue
            report.equal(iso_to_ms(row.get("event_calc_time")), event_ms, "TRANSITION_EVENT_ISO_DRIFT", label)
            report.equal(
                iso_to_ms(row.get("confirm_calc_time")), confirm_ms, "TRANSITION_CONFIRM_ISO_DRIFT", label
            )
            report.check(confirm_ms >= event_ms, "TRANSITION_CONFIRM_BEFORE_EVENT", label)
            report.check(previous_event <= event_ms, "TRANSITION_STREAM_UNSORTED", label)
            previous_event = event_ms

            rate = as_decimal(row.get("confirm_rate"))
            normalized = as_decimal(row.get("confirm_normalized_rate_8h"))
            side = as_int(row.get("contrarian_side"))
            if rate is None or normalized is None or side is None or interval is None:
                report.fail("TRANSITION_SIGNAL_INVALID", label)
                continue
            # rate_normalization: funding_rate * 8 / funding_interval_hours
            report.check(
                normalized == rate * Decimal(8) / Decimal(interval),
                "TRANSITION_NORMALIZATION_INVALID",
                label,
            )
            # direction: negative sign of the confirming settled rate
            expected_side = 0 if rate == 0 else (-1 if rate > 0 else 1)
            report.equal(side, expected_side, "TRANSITION_SIDE_INVALID", label)

            # Corrected retrospective simulation clock:
            # ceil_hour(confirm_calc_time + entry_lag_hours).  This deliberately
            # makes no live-availability or lag-safe claim.
            decisions = row.get("decision_hour_by_entry_lag")
            if not isinstance(decisions, dict):
                report.fail("TRANSITION_DECISION_MAP_INVALID", label)
                continue
            report.equal(
                tuple(sorted(decisions)),
                tuple(sorted(str(lag) for lag in lags)),
                "TRANSITION_DECISION_LAGS_DRIFT",
                label,
            )
            for lag in lags:
                shifted = confirm_ms + int(lag) * HOUR_MS
                expected_ms = ((shifted + HOUR_MS - 1) // HOUR_MS) * HOUR_MS
                observed_ms = iso_to_ms(decisions.get(str(lag)))
                report.equal(
                    observed_ms,
                    expected_ms,
                    "DECISION_HOUR_FORMULA_INVALID",
                    f"{label}:lag{lag}",
                )
                if observed_ms is not None:
                    report.check(
                        observed_ms >= confirm_ms + int(lag) * HOUR_MS,
                        "DECISION_HOUR_BEFORE_SIMULATION_LAG",
                        f"{label}:lag{lag}",
                    )

            symbol = str(row.get("symbol"))
            if cooldown_days is not None:
                previous = last_event_by_symbol.get(symbol)
                if previous is not None:
                    span = Decimal(event_ms - previous)
                    report.check(
                        span >= cooldown_days * Decimal(DAY_MS),
                        "COOLDOWN_VIOLATED",
                        f"{label}:gap_ms={span}",
                    )
            last_event_by_symbol[symbol] = event_ms


def check_custody_document(report: Report, packet: Packet, result: Mapping[str, Any]) -> None:
    """The result's custody block must state the same law the plan froze."""

    statics = packet.statics
    screen_months, dev_months, hold_months = _partition_months(statics)
    custody = result.get("development_and_holdout_custody")
    if not report.check(isinstance(custody, dict), "CUSTODY_BLOCK_MISSING"):
        return
    assert isinstance(custody, dict)
    report.check(custody.get("one_run") is True, "CUSTODY_ONE_RUN_INVALID")
    report.check(custody.get("repair_or_rerun") is False, "CUSTODY_REPAIR_DECLARED")

    screen = custody.get("screen")
    if report.check(isinstance(screen, dict), "CUSTODY_SCREEN_MISSING"):
        assert isinstance(screen, dict)
        report.equal(screen.get("month"), screen_months[0] if screen_months else None, "CUSTODY_SCREEN_MONTH_DRIFT")
        report.equal(screen.get("open_count"), 1, "CUSTODY_SCREEN_OPEN_COUNT_INVALID")
        report.check(screen.get("outcome_scoring") is False, "CUSTODY_SCREEN_SCORING_DECLARED")
        report.equal(
            screen.get("state"),
            "OPENED_ONCE_JUNE_MEMBERSHIP_AND_DEVELOPMENT_SIGNAL",
            "CUSTODY_SCREEN_STATE_INVALID",
        )

    development = custody.get("development")
    if report.check(isinstance(development, dict), "CUSTODY_DEVELOPMENT_MISSING"):
        assert isinstance(development, dict)
        report.equal(
            tuple(str(item) for item in (development.get("months") or ())),
            dev_months,
            "CUSTODY_DEVELOPMENT_MONTHS_DRIFT",
        )
        report.check(
            development.get("state") in ("MEASURED_ONCE", "RUN_CONSUMED_UNMEASURED"),
            "CUSTODY_DEVELOPMENT_STATE_INVALID",
            repr(development.get("state")),
        )
        opened = as_int(development.get("archive_member_open_count"))
        report.check(opened is not None and opened >= 0, "CUSTODY_DEVELOPMENT_OPEN_COUNT_INVALID")

    holdout = custody.get("holdout")
    if report.check(isinstance(holdout, dict), "CUSTODY_HOLDOUT_MISSING"):
        assert isinstance(holdout, dict)
        report.equal(
            tuple(str(item) for item in (holdout.get("months") or ())),
            hold_months,
            "CUSTODY_HOLDOUT_MONTHS_DRIFT",
        )
        report.equal(
            holdout.get("outcome_rows_opened_before_gates"),
            0,
            "CUSTODY_HOLDOUT_OUTCOME_ROWS_EARLY",
        )
        plan_holdout = statics.plan_section("partition_custody").get("holdout", {})
        if isinstance(plan_holdout, dict):
            report.equal(
                holdout.get("scored_start"),
                plan_holdout.get("scored_start"),
                "CUSTODY_HOLDOUT_SCORED_START_DRIFT",
            )
            report.check(plan_holdout.get("reselection") is False, "PLAN_RESELECTION_ALLOWED")
        state = holdout.get("state")
        open_count = as_int(holdout.get("open_count"))
        report.check(
            state in ("UNOPENED", "OPENED_ONCE_CHAMPION_ONLY"),
            "CUSTODY_HOLDOUT_STATE_INVALID",
            repr(state),
        )
        report.equal(state, result.get("holdout_state"), "CUSTODY_HOLDOUT_STATE_MISMATCH")
        expected_count = 1 if state == "OPENED_ONCE_CHAMPION_ONLY" else 0
        report.equal(open_count, expected_count, "CUSTODY_HOLDOUT_OPEN_COUNT_INVALID")
        # The seal opens only with a champion and an O_EXCL open marker.
        opened_files = (
            packet.has("candidate_seal.v1.json"),
            packet.has("holdout_open.v1.json"),
            packet.has("holdout.v1.json"),
        )
        if state == "UNOPENED":
            report.check(not any(opened_files), "SEAL_ARTIFACT_WITHOUT_OPEN_STATE", str(opened_files))
        else:
            report.check(all(opened_files), "SEAL_OPENED_WITHOUT_ARTIFACTS", str(opened_files))
    probe = custody.get("schema_only_probe")
    if isinstance(probe, dict):
        report.check(probe.get("disclosed") is True, "PROBE_NOT_DISCLOSED")
        report.equal(probe.get("outcome_rows_opened"), 0, "PROBE_OUTCOME_ROWS_OPENED")
        report.check(
            probe.get("outside_selected_source_root") is True, "PROBE_INSIDE_SOURCE_ROOT"
        )


# --------------------------------------------------------------------------
# mandate 6: result identities
# --------------------------------------------------------------------------


def _thresholds(section: Mapping[str, Any]) -> dict[str, Decimal]:
    values: dict[str, Decimal] = {}
    for key, raw in section.items():
        number = as_decimal(raw)
        if number is not None:
            values[key] = number
    return values


def _net(summary: Mapping[str, Any], scenario: str) -> Decimal | None:
    nets = summary.get("net_usd_per_1000_by_scenario")
    return as_decimal(nets.get(scenario)) if isinstance(nets, dict) else None


def _capacity_minimum(summary: Mapping[str, Any]) -> Decimal:
    capacity = summary.get("public_capacity_proxy_usd")
    if not isinstance(capacity, dict):
        return Decimal(-1)
    minimum = capacity.get("minimum")
    if minimum == "UNMEASURED":
        return Decimal(-1)
    value = as_decimal(minimum)
    return Decimal(-1) if value is None else value


def _decimal_or_low(value: Any) -> Decimal:
    parsed = as_decimal(value)
    return Decimal(-1) if parsed is None else parsed


def _count(summary: Mapping[str, Any], key: str) -> Decimal:
    value = as_int(summary.get(key))
    return Decimal(-1) if value is None else Decimal(value)


def recompute_development_gates(
    summary: Mapping[str, Any],
    white: Mapping[str, Any],
    pbo: Mapping[str, Any],
    thresholds: Mapping[str, Decimal],
) -> dict[str, bool]:
    return {
        "active_cohorts_min": _count(summary, "active_cohorts") >= thresholds["active_cohorts_min"],
        "active_weeks_min": _count(summary, "active_weeks") >= thresholds["active_weeks_min"],
        "base_capacity_min_usd_gte": _capacity_minimum(summary)
        >= thresholds["base_capacity_min_usd_gte"],
        "base_net_usd_per_1000_gt": _decimal_or_low(
            (summary.get("net_usd_per_1000_by_scenario") or {}).get("base")
        )
        > thresholds["base_net_usd_per_1000_gt"],
        "bonferroni_base_lower_bound_gt": _decimal_or_low(summary.get("base_bonferroni_lcb"))
        > thresholds["bonferroni_base_lower_bound_gt"],
        "bonferroni_stress_lower_bound_gt": _decimal_or_low(summary.get("stress_bonferroni_lcb"))
        > thresholds["bonferroni_stress_lower_bound_gt"],
        "champion_holm_p_lte": _decimal_or_low(summary.get("holm_adjusted_p"))
        <= thresholds["champion_holm_p_lte"],
        "distinct_traded_symbols_min": _count(summary, "distinct_traded_symbols")
        >= thresholds["distinct_traded_symbols_min"],
        "pbo_lte": _decimal_or_low(pbo.get("pbo")) <= thresholds["pbo_lte"],
        "remove_best_month_stress_net_usd_per_1000_gt": _decimal_or_low(
            summary.get("remove_best_month_stress_net_usd_per_1000")
        )
        > thresholds["remove_best_month_stress_net_usd_per_1000_gt"],
        "remove_best_symbol_stress_net_usd_per_1000_gt": _decimal_or_low(
            summary.get("remove_best_symbol_stress_net_usd_per_1000")
        )
        > thresholds["remove_best_symbol_stress_net_usd_per_1000_gt"],
        "severe_hourly_marked_equity_max_drawdown_lte": _decimal_or_low(
            summary.get("severe_hourly_marked_equity_max_drawdown")
        )
        <= thresholds["severe_hourly_marked_equity_max_drawdown_lte"],
        "stress_net_usd_per_1000_gt": _decimal_or_low(
            (summary.get("net_usd_per_1000_by_scenario") or {}).get("stress")
        )
        > thresholds["stress_net_usd_per_1000_gt"],
        "white_reality_check_base_p_lte": _decimal_or_low(white.get("base"))
        <= thresholds["white_reality_check_base_p_lte"],
        "white_reality_check_stress_p_lte": _decimal_or_low(white.get("stress"))
        <= thresholds["white_reality_check_stress_p_lte"],
    }


def recompute_holdout_gates(
    summary: Mapping[str, Any], thresholds: Mapping[str, Decimal]
) -> dict[str, bool]:
    lcb = summary.get("pointwise_lcb")
    lcb = lcb if isinstance(lcb, dict) else {}
    return {
        "active_cohorts_min": _count(summary, "active_cohorts") >= thresholds["active_cohorts_min"],
        "active_weeks_min": _count(summary, "active_weeks") >= thresholds["active_weeks_min"],
        "base_capacity_min_usd_gte": _capacity_minimum(summary)
        >= thresholds["base_capacity_min_usd_gte"],
        "base_net_usd_per_1000_gt": _decimal_or_low(
            (summary.get("net_usd_per_1000_by_scenario") or {}).get("base")
        )
        > thresholds["base_net_usd_per_1000_gt"],
        "distinct_traded_symbols_min": _count(summary, "distinct_traded_symbols")
        >= thresholds["distinct_traded_symbols_min"],
        "pointwise_base_lower_bound_gt": _decimal_or_low(lcb.get("base"))
        > thresholds["pointwise_base_lower_bound_gt"],
        "pointwise_stress_lower_bound_gt": _decimal_or_low(lcb.get("stress"))
        > thresholds["pointwise_stress_lower_bound_gt"],
        "remove_best_month_stress_net_usd_per_1000_gt": _decimal_or_low(
            summary.get("remove_best_month_stress_net_usd_per_1000")
        )
        > thresholds["remove_best_month_stress_net_usd_per_1000_gt"],
        "remove_best_symbol_stress_net_usd_per_1000_gt": _decimal_or_low(
            summary.get("remove_best_symbol_stress_net_usd_per_1000")
        )
        > thresholds["remove_best_symbol_stress_net_usd_per_1000_gt"],
        "severe_hourly_marked_equity_max_drawdown_lte": _decimal_or_low(
            summary.get("severe_hourly_marked_equity_max_drawdown")
        )
        <= thresholds["severe_hourly_marked_equity_max_drawdown_lte"],
        "stress_net_usd_per_1000_gt": _decimal_or_low(
            (summary.get("net_usd_per_1000_by_scenario") or {}).get("stress")
        )
        > thresholds["stress_net_usd_per_1000_gt"],
    }


def selection_key(summary: Mapping[str, Any]) -> tuple[Decimal, Decimal, Decimal, str]:
    """maximise min(base, stress) Bonferroni LCB, then the frozen tie-breaks."""

    base = _decimal_or_low(summary.get("base_bonferroni_lcb"))
    stress = _decimal_or_low(summary.get("stress_bonferroni_lcb"))
    stress_net = _net(summary, "stress")
    return (
        -min(base, stress),
        -(stress_net if stress_net is not None else Decimal(-1)),
        _decimal_or_low(summary.get("severe_hourly_marked_equity_max_drawdown")),
        str(summary.get("trial_id")),
    )


def check_summary_identities(
    report: Report,
    summary: Mapping[str, Any],
    label: str,
    intervals_key: str,
    event_symbol_count: int | None,
) -> None:
    """Arithmetic that must hold inside any measured trial or holdout summary."""

    # attribution: net is exactly price + funding + fee + adverse (costs signed)
    attribution = summary.get("attribution")
    if report.check(isinstance(attribution, dict), "ATTRIBUTION_MISSING", label):
        assert isinstance(attribution, dict)
        report.equal(
            tuple(sorted(attribution)),
            SORTED_SCENARIOS,
            "ATTRIBUTION_SCENARIOS_DRIFT",
            label,
        )
        for scenario in SCENARIOS:
            row = attribution.get(scenario)
            if not isinstance(row, dict):
                report.fail("ATTRIBUTION_ROW_INVALID", f"{label}:{scenario}")
                continue
            parts = {
                key: as_decimal(row.get(key))
                for key in ("adverse_usd", "fee_usd", "funding_usd", "net_usd", "price_usd")
            }
            if any(value is None for value in parts.values()):
                report.fail("ATTRIBUTION_FIELD_INVALID", f"{label}:{scenario}")
                continue
            report.check(
                parts["net_usd"]
                == parts["price_usd"] + parts["funding_usd"] + parts["fee_usd"] + parts["adverse_usd"],
                "ATTRIBUTION_IDENTITY_INVALID",
                f"{label}:{scenario}",
            )
            report.check(
                (parts["fee_usd"] or Decimal(0)) <= 0 and (parts["adverse_usd"] or Decimal(0)) <= 0,
                "ATTRIBUTION_COST_SIGN_INVALID",
                f"{label}:{scenario}",
            )
            report.numeric(
                (summary.get("net_usd_per_1000_by_scenario") or {}).get(scenario),
                row.get("net_usd"),
                "NET_ATTRIBUTION_MISMATCH",
                f"{label}:{scenario}",
            )

    nets = summary.get("net_usd_per_1000_by_scenario")
    if report.check(isinstance(nets, dict), "NET_MAP_MISSING", label):
        assert isinstance(nets, dict)
        report.equal(tuple(sorted(nets)), SORTED_SCENARIOS, "NET_SCENARIOS_DRIFT", label)

    intervals = summary.get(intervals_key)
    if report.check(isinstance(intervals, dict), "INTERVALS_MISSING", f"{label}:{intervals_key}"):
        assert isinstance(intervals, dict)
        report.equal(
            tuple(sorted(intervals)),
            SORTED_SCENARIOS,
            "INTERVAL_SCENARIOS_DRIFT",
            label,
        )
        for scenario in SCENARIOS:
            pair = intervals.get(scenario)
            if not isinstance(pair, list) or len(pair) != 2:
                report.fail("INTERVAL_SHAPE_INVALID", f"{label}:{scenario}")
                continue
            lower, upper = as_decimal(pair[0]), as_decimal(pair[1])
            if lower is None or upper is None:
                report.fail("INTERVAL_VALUE_INVALID", f"{label}:{scenario}")
                continue
            report.check(lower <= upper, "INTERVAL_ORDER_INVALID", f"{label}:{scenario}")

    # counters: every causal decision epoch became a cohort or a cash epoch
    counters = {key: as_int(summary.get(key)) for key in ACTIVITY_COUNTER_FIELDS}
    if all(value is not None for value in counters.values()):
        cohorts = counters["active_cohorts"] or 0
        cash = counters["cash_decision_hours"] or 0
        report.equal(
            cash,
            (counters["zero_signal_cash_hours"] or 0)
            + (counters["overlap_cash_hours"] or 0)
            + (counters["cooldown_cash_hours"] or 0),
            "CASH_EPOCH_DECOMPOSITION_INVALID",
            label,
        )
        report.equal(
            counters["candidate_decision_hours"],
            cohorts + cash,
            "DECISION_EPOCH_IDENTITY_INVALID",
            label,
        )
        report.check(
            (counters["traded_members"] or 0) >= cohorts,
            "TRADED_MEMBERS_BELOW_COHORTS",
            label,
        )
        report.check(
            (counters["distinct_traded_symbols"] or 0) <= (counters["traded_members"] or 0),
            "DISTINCT_SYMBOLS_ABOVE_MEMBERS",
            label,
        )
        report.check((counters["active_weeks"] or 0) <= cohorts, "ACTIVE_WEEKS_ABOVE_COHORTS", label)
        if event_symbol_count is not None:
            report.check(
                (counters["distinct_traded_symbols"] or 0) <= event_symbol_count,
                "DISTINCT_SYMBOLS_ABOVE_UNIVERSE",
                label,
            )
    else:
        missing = sorted(key for key, value in counters.items() if value is None)
        report.fail("ACTIVITY_COUNTER_INVALID", f"{label}:{missing}")

    capacity = summary.get("public_capacity_proxy_usd")
    if report.check(isinstance(capacity, dict), "CAPACITY_MISSING", label):
        assert isinstance(capacity, dict)
        minimum, p05 = capacity.get("minimum"), capacity.get("p05")
        if minimum == "UNMEASURED" or p05 == "UNMEASURED":
            report.equal(minimum, p05, "CAPACITY_PARTIAL_UNMEASURED", label)
        else:
            report.equal(
                capacity.get("label"),
                "PUBLIC_COARSE_PRIOR_VOLUME_PARTICIPATION_PROXY",
                "CAPACITY_LABEL_DRIFT",
                label,
            )
            low, high = as_decimal(minimum), as_decimal(p05)
            if low is None or high is None:
                report.fail("CAPACITY_VALUE_INVALID", label)
            else:
                report.check(high >= low, "CAPACITY_PERCENTILE_BELOW_MINIMUM", label)

    drawdown = as_decimal(summary.get("severe_hourly_marked_equity_max_drawdown"))
    if report.check(drawdown is not None, "DRAWDOWN_INVALID", label):
        assert drawdown is not None
        report.check(drawdown >= 0, "DRAWDOWN_NEGATIVE", f"{label}:{drawdown}")


def check_development_document(
    report: Report, packet: Packet, trial_ids: Sequence[str]
) -> Mapping[str, Any] | None:
    development = packet.get("development.v1.json")
    if development is None:
        report.skip("DEVELOPMENT_DOCUMENT_ABSENT", "terminal-unmeasured packet")
        return None
    statics = packet.statics
    universe = packet.get("event_universe.v1.json")
    event_symbol_count = as_int((universe or {}).get("event_symbol_count"))

    report.equal(development.get("outcome_state"), "MEASURED", "DEVELOPMENT_OUTCOME_STATE_INVALID")
    report.equal(
        development.get("selection_metric"),
        "max_min_base_stress_bonferroni_lcb",
        "SELECTION_METRIC_DRIFT",
    )
    report.equal(
        development.get("holdout_archive_member_open_count"), 0, "DEVELOPMENT_TOUCHED_HOLDOUT"
    )
    opened = as_int(development.get("development_archive_member_open_count"))
    report.check(opened is not None and opened >= 1, "DEVELOPMENT_OPENED_NO_MEMBER", str(opened))

    window = statics.section("window")
    start_ms = iso_to_ms(window.get("development_start"))
    end_ms = iso_to_ms(window.get("development_end"))
    if start_ms is not None and end_ms is not None:
        expected_days = day_count(start_ms, end_ms)
        report.equal(development.get("scored_days"), expected_days, "DEVELOPMENT_SCORED_DAYS_DRIFT")
        report.check(
            expected_days >= CSCV_BLOCKS * CSCV_BLOCK_DAYS,
            "CSCV_WINDOW_TOO_SHORT",
            str(expected_days),
        )

    white = development.get("white_reality_check_p_by_scenario")
    if report.check(isinstance(white, dict), "WHITE_MAP_INVALID"):
        assert isinstance(white, dict)
        report.equal(tuple(sorted(white)), WHITE_SCENARIOS, "WHITE_SCENARIOS_DRIFT")
        for scenario in sorted(white):
            value = as_decimal(white.get(scenario))
            if report.check(value is not None, "WHITE_P_INVALID", scenario):
                assert value is not None
                report.check(
                    Decimal(0) < value <= Decimal(1) and on_lattice(value, BOOTSTRAP_REPLICATES + 1),
                    "WHITE_P_OFF_LATTICE",
                    f"{scenario}:{value}",
                )
    white = white if isinstance(white, dict) else {}

    pbo = development.get("pbo")
    if report.check(isinstance(pbo, dict), "PBO_BLOCK_INVALID"):
        assert isinstance(pbo, dict)
        report.equal(pbo.get("blocks"), CSCV_BLOCKS, "PBO_BLOCKS_DRIFT")
        report.equal(pbo.get("splits"), math.comb(CSCV_BLOCKS, CSCV_BLOCKS // 2), "PBO_SPLITS_DRIFT")
        report.equal(pbo.get("authority"), "DIAGNOSTIC_ONLY", "PBO_AUTHORITY_DRIFT")
        report.equal(pbo.get("loss_rule"), "lambda_le_zero_worst_ties", "PBO_LOSS_RULE_DRIFT")
        report.equal(pbo.get("purged_days_per_block"), CSCV_PURGED_DAYS, "PBO_PURGE_DRIFT")
        report.equal(
            pbo.get("score_days_per_block"),
            CSCV_BLOCK_DAYS - CSCV_PURGED_DAYS,
            "PBO_SCORE_DAYS_DRIFT",
        )
        value = as_decimal(pbo.get("pbo"))
        splits = as_int(pbo.get("splits"))
        if value is not None and splits:
            report.check(
                Decimal(0) <= value <= Decimal(1) and on_lattice(value, splits),
                "PBO_OFF_LATTICE",
                str(value),
            )
    pbo = pbo if isinstance(pbo, dict) else {}

    rows = development.get("trials")
    if not report.check(isinstance(rows, list), "DEVELOPMENT_TRIALS_INVALID"):
        return development
    assert isinstance(rows, list)
    report.equal(len(rows), FAMILY_SIZE, "DEVELOPMENT_FAMILY_INCOMPLETE")
    ids = [str(row.get("trial_id")) for row in rows if isinstance(row, dict)]
    report.equal(tuple(sorted(ids)), tuple(sorted(trial_ids)), "DEVELOPMENT_TRIAL_IDS_DRIFT")
    report.check(ids == sorted(ids), "DEVELOPMENT_TRIALS_UNSORTED")

    thresholds = _thresholds(statics.section("development_gates"))
    raw_p: dict[str, Decimal] = {}
    eligible: list[Mapping[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            report.fail("DEVELOPMENT_ROW_INVALID")
            continue
        label = str(row.get("trial_id"))
        check_summary_identities(
            report, row, label, "bootstrap_interval_usd_per_1000", event_symbol_count
        )
        base_p = as_decimal(row.get("base_p_value"))
        stress_p = as_decimal(row.get("stress_p_value"))
        if base_p is None or stress_p is None:
            report.fail("TRIAL_P_VALUE_INVALID", label)
        else:
            for name, value in (("base", base_p), ("stress", stress_p)):
                report.check(
                    Decimal(0) < value <= Decimal(1)
                    and on_lattice(value, BOOTSTRAP_REPLICATES + 1),
                    "TRIAL_P_OFF_LATTICE",
                    f"{label}:{name}:{value}",
                )
            raw_p[label] = max(base_p, stress_p)
        for scenario, lcb_key in (("base", "base_bonferroni_lcb"), ("stress", "stress_bonferroni_lcb")):
            lcb = as_decimal(row.get(lcb_key))
            intervals = row.get("bootstrap_interval_usd_per_1000")
            pair = intervals.get(scenario) if isinstance(intervals, dict) else None
            lower = as_decimal(pair[0]) if isinstance(pair, list) and pair else None
            if lcb is not None and lower is not None:
                # A Bonferroni bound uses alpha/12, so it cannot sit above the
                # 2.5% pointwise bound built from the same resamples.
                report.check(lcb <= lower, "BONFERRONI_ABOVE_POINTWISE", f"{label}:{scenario}")

        gates = row.get("development_gates")
        if report.check(isinstance(gates, dict), "TRIAL_GATES_MISSING", label):
            assert isinstance(gates, dict)
            recomputed = recompute_development_gates(row, white, pbo, thresholds)
            report.equal(dict(sorted(gates.items())), recomputed, "DEVELOPMENT_GATE_RECOMPUTE_MISMATCH", label)
            report.equal(
                row.get("passes_all_development_gates"),
                all(recomputed.values()),
                "TRIAL_PASS_FLAG_INVALID",
                label,
            )
            if all(recomputed.values()):
                eligible.append(row)

    if len(raw_p) == FAMILY_SIZE:
        recomputed_holm = holm_adjusted(raw_p)
        for row in rows:
            if not isinstance(row, dict):
                continue
            label = str(row.get("trial_id"))
            report.numeric(
                row.get("holm_adjusted_p"),
                recomputed_holm[label],
                "HOLM_IDENTITY_INVALID",
                label,
            )

    champion = min((row for row in eligible), key=selection_key, default=None)
    expected_champion = None if champion is None else str(champion.get("trial_id"))
    report.equal(
        development.get("champion_trial_id"), expected_champion, "CHAMPION_SELECTION_INVALID"
    )
    report.equal(
        development.get("admitted_to_holdout"),
        expected_champion is not None,
        "ADMISSION_FLAG_INVALID",
    )
    valid_rows = [row for row in rows if isinstance(row, dict)]
    fallback = min(valid_rows, key=selection_key, default=None)
    expected_reported = expected_champion or (None if fallback is None else str(fallback.get("trial_id")))
    report.equal(
        development.get("reported_trial_id"), expected_reported, "REPORTED_TRIAL_SELECTION_INVALID"
    )
    reported_row = next(
        (row for row in valid_rows if str(row.get("trial_id")) == development.get("reported_trial_id")),
        None,
    )
    if reported_row is not None:
        report.equal(
            development.get("holdout_open_gates"),
            reported_row.get("development_gates"),
            "HOLDOUT_OPEN_GATES_MISMATCH",
        )
    return development


def check_holdout_document(report: Report, packet: Packet) -> Mapping[str, Any] | None:
    holdout = packet.get("holdout.v1.json")
    if holdout is None:
        return None
    statics = packet.statics
    universe = packet.get("event_universe.v1.json")
    seal = packet.get("candidate_seal.v1.json")
    champion = holdout.get("champion_trial_id")

    report.check(holdout.get("reselection") is False, "HOLDOUT_RESELECTION_DECLARED")
    report.check(
        holdout.get("outcome_state") in ("MEASURED", "UNMEASURED"),
        "HOLDOUT_OUTCOME_STATE_INVALID",
        repr(holdout.get("outcome_state")),
    )
    if seal is not None:
        report.equal(seal.get("champion_trial_id"), champion, "HOLDOUT_CHAMPION_MISMATCH")
        report.check(seal.get("reselection_forbidden") is True, "SEAL_RESELECTION_ALLOWED")
        development = packet.get("development.v1.json")
        if development is not None:
            report.equal(
                development.get("champion_trial_id"), champion, "SEAL_CHAMPION_NOT_DEVELOPMENT"
            )
        parameters = seal.get("trial_parameters")
        if report.check(isinstance(parameters, dict), "SEAL_PARAMETERS_MISSING"):
            assert isinstance(parameters, dict)
            expected_id = (
                f"c{parameters.get('confirmation_rows')}-l{parameters.get('entry_lag_hours')}"
                f"-h{as_int(parameters.get('hold_hours')) or 0:02d}"
            )
            report.equal(expected_id, str(champion), "SEAL_PARAMETERS_NOT_CHAMPION")
    open_marker = packet.get("holdout_open.v1.json")
    if open_marker is not None:
        report.equal(open_marker.get("champion_trial_id"), champion, "OPEN_MARKER_CHAMPION_MISMATCH")

    summary = holdout.get("summary")
    gates = holdout.get("gates")
    if not isinstance(summary, dict) or not isinstance(gates, dict):
        report.fail("HOLDOUT_SUMMARY_OR_GATES_INVALID")
        return holdout
    thresholds = _thresholds(statics.section("holdout_gates_if_opened"))
    report.equal(tuple(sorted(gates)), tuple(sorted(thresholds)), "HOLDOUT_GATE_SET_DRIFT")

    if holdout.get("outcome_state") == "UNMEASURED":
        report.check(
            all(value is None for value in summary.values()),
            "HOLDOUT_UNMEASURED_SUMMARY_FABRICATED",
        )
        report.check(
            all(value is False for value in gates.values()), "HOLDOUT_UNMEASURED_GATE_PASSED"
        )
        report.check(holdout.get("all_gates_pass") is False, "HOLDOUT_UNMEASURED_ALL_PASS")
        report.check(bool(holdout.get("reason_code")), "HOLDOUT_UNMEASURED_REASON_MISSING")
        return holdout

    check_summary_identities(
        report,
        summary,
        f"holdout:{champion}",
        "bootstrap_intervals",
        as_int((universe or {}).get("event_symbol_count")),
    )
    lcb = summary.get("pointwise_lcb")
    if report.check(isinstance(lcb, dict), "HOLDOUT_LCB_MISSING"):
        assert isinstance(lcb, dict)
        report.equal(tuple(sorted(lcb)), SORTED_SCENARIOS, "HOLDOUT_LCB_SCENARIOS_DRIFT")
    recomputed = recompute_holdout_gates(summary, thresholds)
    report.equal(dict(sorted(gates.items())), recomputed, "HOLDOUT_GATE_RECOMPUTE_MISMATCH")
    report.equal(holdout.get("all_gates_pass"), all(recomputed.values()), "HOLDOUT_ALL_PASS_INVALID")
    opened = as_int(holdout.get("holdout_archive_member_open_count"))
    report.check(opened is not None and opened >= 1, "HOLDOUT_OPENED_NO_MEMBER", str(opened))
    return holdout


UNMEASURED_NULL_FIELDS: Final = (
    "activity_counters",
    "bootstrap_intervals",
    "holm_p_values",
    "pbo",
    "price_funding_fee_and_adverse_attribution",
    "public_capacity_proxy",
    "remove_best_symbol_and_month_stress_net",
    "severe_hourly_marked_equity_max_drawdown",
    "white_reality_check_p_by_scenario",
)


def check_result_identities(
    report: Report,
    packet: Packet,
    result: Mapping[str, Any],
    development: Mapping[str, Any] | None,
    holdout: Mapping[str, Any] | None,
) -> None:
    """The result may only restate what its own sealed documents already say."""

    outcome = result.get("outcome_state")
    measured_holdout = holdout is not None and holdout.get("outcome_state") == "MEASURED"

    if outcome == "TERMINAL_UNMEASURED":
        return
    if development is None:
        report.fail("RESULT_MEASURED_WITHOUT_DEVELOPMENT", repr(outcome))
        return

    rows = development.get("trials")
    rows = [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []
    reported = result.get("reported_trial_id")

    if measured_holdout:
        assert holdout is not None
        source = holdout.get("summary")
        intervals_key = "bootstrap_intervals"
        report.equal(reported, holdout.get("champion_trial_id"), "RESULT_REPORTED_NOT_CHAMPION")
    else:
        source = next((row for row in rows if str(row.get("trial_id")) == reported), None)
        intervals_key = "bootstrap_interval_usd_per_1000"
        report.equal(
            reported, development.get("reported_trial_id"), "RESULT_REPORTED_TRIAL_MISMATCH"
        )
    if not report.check(isinstance(source, dict), "RESULT_SOURCE_SUMMARY_MISSING", repr(reported)):
        return
    assert isinstance(source, dict)

    report.equal(
        result.get("net_usd_per_1000_by_scenario"),
        source.get("net_usd_per_1000_by_scenario"),
        "RESULT_NET_IDENTITY_INVALID",
    )
    report.equal(
        result.get("bootstrap_intervals"), source.get(intervals_key), "RESULT_INTERVAL_IDENTITY_INVALID"
    )
    report.equal(
        result.get("price_funding_fee_and_adverse_attribution"),
        source.get("attribution"),
        "RESULT_ATTRIBUTION_IDENTITY_INVALID",
    )
    report.equal(
        result.get("public_capacity_proxy"),
        source.get("public_capacity_proxy_usd"),
        "RESULT_CAPACITY_IDENTITY_INVALID",
    )
    report.equal(
        result.get("remove_best_symbol_and_month_stress_net"),
        {
            "best_stress_month": source.get("best_stress_month"),
            "best_stress_symbol": source.get("best_stress_symbol"),
            "remove_best_month_stress_net_usd_per_1000": source.get(
                "remove_best_month_stress_net_usd_per_1000"
            ),
            "remove_best_symbol_stress_net_usd_per_1000": source.get(
                "remove_best_symbol_stress_net_usd_per_1000"
            ),
        },
        "RESULT_ROBUSTNESS_IDENTITY_INVALID",
    )
    report.equal(
        result.get("severe_hourly_marked_equity_max_drawdown"),
        source.get("severe_hourly_marked_equity_max_drawdown"),
        "RESULT_DRAWDOWN_IDENTITY_INVALID",
    )
    report.equal(
        result.get("activity_counters"),
        {key: source.get(key) for key in ACTIVITY_COUNTER_FIELDS},
        "RESULT_COUNTER_IDENTITY_INVALID",
    )
    report.equal(
        result.get("holm_p_values"),
        {str(row.get("trial_id")): row.get("holm_adjusted_p") for row in rows},
        "RESULT_HOLM_IDENTITY_INVALID",
    )
    report.equal(
        result.get("white_reality_check_p_by_scenario"),
        development.get("white_reality_check_p_by_scenario"),
        "RESULT_WHITE_IDENTITY_INVALID",
    )
    report.equal(result.get("pbo"), development.get("pbo"), "RESULT_PBO_IDENTITY_INVALID")
    report.equal(
        result.get("development_file_sha256"),
        packet.digest_of("development.v1.json"),
        "RESULT_DEVELOPMENT_LINK_INVALID",
    )


def check_required_fields(report: Report, packet: Packet, result: Mapping[str, Any]) -> None:
    """Mandate 7: every contracted field is present, and never a fabricated zero."""

    contract = packet.statics.section("result_contract")
    required = contract.get("required_fields")
    if not report.check(isinstance(required, list) and required, "RESULT_CONTRACT_MISSING"):
        return
    assert isinstance(required, list)
    missing = sorted(str(field_name) for field_name in required if field_name not in result)
    report.check(not missing, "RESULT_FIELD_MISSING", ",".join(missing))
    report.equal(
        contract.get("null_numeric_semantics"),
        "UNMEASURED, never fabricated zero",
        "NULL_SEMANTICS_DRIFT",
    )

    outcome = result.get("outcome_state")
    nets = result.get("net_usd_per_1000_by_scenario")
    if outcome == "TERMINAL_UNMEASURED":
        for field_name in UNMEASURED_NULL_FIELDS:
            if field_name not in result:
                continue
            value = result[field_name]
            if value is None:
                report.checks += 1
                continue
            zeroed = as_decimal(value)
            code = (
                "UNMEASURED_ZERO_FABRICATED"
                if zeroed is not None and zeroed == 0
                else "UNMEASURED_FIELD_NOT_NULL"
            )
            report.check(False, code, f"{field_name}={value!r}")
        if report.check(isinstance(nets, dict), "UNMEASURED_NET_MAP_INVALID"):
            assert isinstance(nets, dict)
            report.equal(
                tuple(sorted(nets)),
                SORTED_SCENARIOS,
                "UNMEASURED_NET_SCENARIOS_DRIFT",
            )
            for scenario in sorted(nets):
                value = nets[scenario]
                if value is None:
                    report.checks += 1
                    continue
                zeroed = as_decimal(value)
                report.check(
                    False,
                    "UNMEASURED_ZERO_FABRICATED"
                    if zeroed is not None and zeroed == 0
                    else "UNMEASURED_NET_NOT_NULL",
                    f"{scenario}={value!r}",
                )
        report.check(bool(result.get("reason_code")), "UNMEASURED_REASON_CODE_MISSING")
    else:
        for field_name in UNMEASURED_NULL_FIELDS:
            report.check(
                result.get(field_name) is not None, "MEASURED_FIELD_NULL", field_name
            )

    limitations = result.get("limitations")
    if report.check(
        isinstance(limitations, list) and all(isinstance(item, str) for item in limitations),
        "LIMITATIONS_INVALID",
    ):
        assert isinstance(limitations, list)
        text = " ".join(limitations).lower()
        for theme, needle in (
            ("publication_latency", "latency"),
            ("proxy_not_fill", "proxy"),
            ("account_fee_unknown", "account-effective"),
            ("no_policy_effect", "policy"),
            ("endogeneity", "endogeneity"),
            ("frozen_bytes", "frozen cached official bytes"),
        ):
            report.check(needle in text, "LIMITATION_THEME_MISSING", theme)


def check_verdict_law(
    report: Report,
    packet: Packet,
    result: Mapping[str, Any],
    development: Mapping[str, Any] | None,
    holdout: Mapping[str, Any] | None,
) -> None:
    """Mandate 8: the four verdicts, and the capital ceiling under all of them."""

    law = packet.statics.section("verdict_law")
    report.equal(
        law.get("all_public_proxy_gates_pass"),
        "PUBLIC_PROXY_PASS_CAPITAL_NO_GO",
        "VERDICT_LAW_PASS_DRIFT",
    )
    report.equal(
        law.get("development_gate_failure"),
        "NO_GO_DEVELOPMENT_HOLDOUT_UNOPENED",
        "VERDICT_LAW_DEVELOPMENT_DRIFT",
    )
    report.equal(law.get("holdout_gate_failure"), "NO_GO", "VERDICT_LAW_HOLDOUT_DRIFT")
    report.equal(
        law.get("source_or_semantic_failure_after_marker"),
        "UNMEASURED_RUN_CONSUMED_NO_RERUN",
        "VERDICT_LAW_UNMEASURED_DRIFT",
    )
    report.check(
        law.get("verified_causal_policy_claim_allowed") is False, "VERDICT_LAW_CAUSAL_CLAIM_ALLOWED"
    )
    report.equal(law.get("capital_authority"), None, "VERDICT_LAW_CAPITAL_UNEXPECTED") if False else None

    verdict = result.get("verdict")
    outcome = result.get("outcome_state")
    report.check(verdict in VERDICTS, "VERDICT_UNKNOWN", repr(verdict))
    report.check(
        outcome
        in ("MEASURED_HOLDOUT", "MEASURED_DEVELOPMENT_REJECTED", "TERMINAL_UNMEASURED"),
        "OUTCOME_STATE_UNKNOWN",
        repr(outcome),
    )

    expected: str | None = None
    if outcome == "TERMINAL_UNMEASURED":
        expected = "UNMEASURED_RUN_CONSUMED_NO_RERUN"
        report.equal(result.get("strategy_verdict"), "UNMEASURED", "STRATEGY_VERDICT_INVALID")
    elif outcome == "MEASURED_HOLDOUT":
        if report.check(holdout is not None, "HOLDOUT_OUTCOME_WITHOUT_DOCUMENT"):
            assert holdout is not None
            report.equal(holdout.get("outcome_state"), "MEASURED", "HOLDOUT_OUTCOME_NOT_MEASURED")
            expected = (
                "PUBLIC_PROXY_PASS_CAPITAL_NO_GO"
                if holdout.get("all_gates_pass") is True
                else "NO_GO"
            )
        report.equal(result.get("strategy_verdict"), "NO_GO", "STRATEGY_VERDICT_INVALID")
        report.equal(
            result.get("holdout_state"), "OPENED_ONCE_CHAMPION_ONLY", "HOLDOUT_STATE_INVALID"
        )
    elif outcome == "MEASURED_DEVELOPMENT_REJECTED":
        expected = "NO_GO_DEVELOPMENT_HOLDOUT_UNOPENED"
        report.equal(result.get("strategy_verdict"), "NO_GO", "STRATEGY_VERDICT_INVALID")
        report.equal(result.get("holdout_state"), "UNOPENED", "HOLDOUT_STATE_INVALID")
        if report.check(development is not None, "REJECTION_WITHOUT_DEVELOPMENT"):
            assert development is not None
            report.check(
                development.get("admitted_to_holdout") is False,
                "REJECTION_WITH_ADMITTED_CHAMPION",
            )
        report.check(
            not packet.has("candidate_seal.v1.json") and not packet.has("holdout_open.v1.json"),
            "REJECTION_WITH_SEAL_ARTIFACTS",
        )
    if expected is not None:
        report.equal(verdict, expected, "VERDICT_LAW_INVALID")

    # The ceiling: a statistical pass is never a capital decision.
    report.equal(result.get("capital_authority"), "NO_GO", "CAPITAL_AUTHORITY_INVALID")
    report.equal(result.get("account_effective_fees"), "UNKNOWN", "ACCOUNT_FEE_CLAIMED")
    report.equal(result.get("executable_capacity"), "UNKNOWN", "EXECUTABLE_CAPACITY_CLAIMED")
    report.check(
        str(law.get("capital_authority", "")).startswith("NO_GO"), "VERDICT_LAW_CAPITAL_DRIFT"
    )


# --------------------------------------------------------------------------
# corrected sealed-chain acceptance
# --------------------------------------------------------------------------


CORRECTED_PREDECESSOR: Final = {
    "screen_consumed.v1.json": "preseal.v1.json",
    "screen_universe.v1.json": "screen_consumed.v1.json",
    "source_manifest.v1.json": "screen_universe.v1.json",
    "freeze.v1.json": "source_manifest.v1.json",
    "run_consumed.v1.json": "freeze.v1.json",
    "event_universe.v1.json": "run_consumed.v1.json",
    "opened_source_ledger.v1.json": "event_universe.v1.json",
    "development.v1.json": "opened_source_ledger.v1.json",
    "candidate_seal.v1.json": "development.v1.json",
    "holdout_open.v1.json": "candidate_seal.v1.json",
    "holdout.v1.json": "holdout_open.v1.json",
}

CORRECTED_REQUIRED_INPUTS: Final = {
    "screen_consumed.v1.json": ("preseal.v1.json",),
    "screen_universe.v1.json": ("screen_consumed.v1.json",),
    "source_manifest.v1.json": ("screen_universe.v1.json",),
    "freeze.v1.json": (
        "preseal.v1.json",
        "screen_consumed.v1.json",
        "screen_universe.v1.json",
        "source_manifest.v1.json",
    ),
    "run_consumed.v1.json": ("freeze.v1.json",),
    "event_universe.v1.json": ("run_consumed.v1.json",),
    "opened_source_ledger.v1.json": (
        "event_universe.v1.json",
        "run_consumed.v1.json",
    ),
    "development.v1.json": (
        "event_universe.v1.json",
        "opened_source_ledger.v1.json",
        "run_consumed.v1.json",
    ),
    "candidate_seal.v1.json": ("development.v1.json",),
    "holdout_open.v1.json": ("candidate_seal.v1.json",),
    "holdout.v1.json": ("holdout_open.v1.json",),
}

STATIC_REPOSITORY_PATHS: Final = tuple(
    f"{STATIC_REPOSITORY_PREFIX}/{name}" for name in SEALED_STATIC_FILES
)
STATIC_PACKET_PATHS: Final = tuple(
    f"{PACKET_STATIC_PREFIX}/{name}" for name in SEALED_STATIC_FILES
)


def _path_is_safe_relative(value: Any) -> bool:
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and ".." not in path.parts and "." not in path.parts


def _read_regular_file(path: Path) -> tuple[bytes, os.stat_result]:
    """Read one nonsymlink regular file through one descriptor.

    The before/after fstat equality prevents a path replacement or in-place
    mutation from being mistaken for stable sealed evidence.
    """

    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        before = os.fstat(descriptor)
        # POSIX regular-file type bits; this avoids any path-level re-stat.
        if before.st_mode & 0o170000 != 0o100000:
            raise VerifierAbort(f"NOT_REGULAR {path}")
        chunks: list[bytes] = []
        while True:
            chunk = os.read(descriptor, 1 << 20)
            if not chunk:
                break
            chunks.append(chunk)
        after = os.fstat(descriptor)
        identity_before = (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        )
        identity_after = (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        )
        if identity_before != identity_after:
            raise VerifierAbort(f"FILE_CHANGED_DURING_READ {path}")
        payload = b"".join(chunks)
        if len(payload) != before.st_size:
            raise VerifierAbort(f"FILE_SIZE_DRIFT {path}")
        return payload, before
    finally:
        os.close(descriptor)


def _digest_regular_file(path: Path) -> tuple[str, int, os.stat_result]:
    payload, status = _read_regular_file(path)
    return sha256_bytes(payload), len(payload), status


def _git_blob_oid(payload: bytes) -> str:
    header = f"blob {len(payload)}\0".encode("ascii")
    return hashlib.sha1(header + payload, usedforsecurity=False).hexdigest()


def _value_first(mapping: Mapping[str, Any], *names: str) -> Any:
    for name in names:
        if name in mapping:
            return mapping[name]
    return None


def _static_entry_normalized(entry: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "repository_relative_path": _value_first(
            entry, "repository_relative_path", "path", "repo_path"
        ),
        "git_mode": _value_first(entry, "git_mode", "mode"),
        "git_blob_oid": _value_first(
            entry, "git_blob_object_id", "git_blob_oid", "blob_oid", "git_blob"
        ),
        "raw_sha256": _value_first(entry, "raw_sha256", "file_sha256", "sha256"),
        "byte_count": _value_first(entry, "byte_count", "size"),
        "immutable_copy_relative_path": _value_first(
            entry,
            "packet_copy_relative_path",
            "immutable_copy_relative_path",
            "packet_relative_path",
            "copy_path",
        ),
        "immutable_copy_raw_sha256": _value_first(
            entry,
            "packet_copy_raw_sha256",
            "immutable_copy_raw_sha256",
            "packet_copy_sha256",
            "copy_sha256",
        ),
    }


def check_static_provenance(
    report: Report,
    packet: Packet,
    expected_commit: str | None,
    expected_tree: str | None,
) -> None:
    """Authenticate Git/static-copy custody from a caller-pinned producer."""

    with report.stage("static_git_and_copy_binding"):
        preseal = packet.get("preseal.v1.json")
        if not report.check(isinstance(preseal, dict), "PRESEAL_MISSING"):
            return
        assert isinstance(preseal, dict)
        lineage = preseal.get("git_lineage")
        lineage = lineage if isinstance(lineage, dict) else {}
        commit = _value_first(preseal, "static_producer_commit", "producer_commit")
        if commit is None:
            commit = _value_first(lineage, "static_producer_commit", "producer_commit", "commit")
        parent = _value_first(
            preseal,
            "producer_first_parent_commit",
            "static_producer_parent",
            "producer_parent",
        )
        if parent is None:
            parent = _value_first(lineage, "static_producer_parent", "producer_parent", "parent")
        tree = _value_first(preseal, "static_producer_tree", "producer_tree")
        if tree is None:
            tree = _value_first(lineage, "static_producer_tree", "producer_tree", "tree")

        report.check(
            isinstance(commit, str) and COMMIT_RE.fullmatch(commit) is not None,
            "STATIC_PRODUCER_COMMIT_INVALID",
            repr(commit),
        )
        report.equal(parent, CANONICAL_BASE, "STATIC_PRODUCER_PARENT_INVALID")
        report.check(commit != CANONICAL_BASE, "STATIC_PRODUCER_IS_BASE")
        report.check(
            isinstance(tree, str) and COMMIT_RE.fullmatch(tree) is not None,
            "STATIC_PRODUCER_TREE_INVALID",
            repr(tree),
        )
        if expected_commit is None:
            report.fail(
                "EXPECTED_PRODUCER_COMMIT_REQUIRED",
                "supply --expected-producer-commit from the clean static freeze",
            )
        else:
            report.equal(commit, expected_commit, "STATIC_PRODUCER_COMMIT_NOT_PINNED")
        if expected_tree is None:
            report.fail(
                "EXPECTED_PRODUCER_TREE_REQUIRED",
                "supply --expected-producer-tree from the clean static freeze",
            )
        else:
            report.equal(tree, expected_tree, "STATIC_PRODUCER_TREE_NOT_PINNED")
        report.notes["static_producer_commit"] = commit
        report.notes["static_producer_tree"] = tree

        root_identity = _value_first(preseal, "packet_identity", "packet_root_identity")
        if not report.check(isinstance(root_identity, dict), "PACKET_ROOT_IDENTITY_MISSING"):
            root_identity = {}
        root_status = packet.root.stat()
        report.equal(root_identity.get("device"), root_status.st_dev, "PACKET_ROOT_DEVICE_DRIFT")
        report.equal(root_identity.get("inode"), root_status.st_ino, "PACKET_ROOT_INODE_DRIFT")
        report.equal(preseal.get("packet_root"), str(packet.root), "PACKET_ROOT_PATH_DRIFT")
        report.equal(
            root_status.st_mode & 0o777,
            0o700,
            "PACKET_ROOT_MODE_INVALID",
        )

        rows = _value_first(preseal, "static_files", "git_static_files", "static_file_bindings")
        if not report.check(isinstance(rows, list), "STATIC_FILE_BINDINGS_MISSING"):
            return
        assert isinstance(rows, list)
        normalized: dict[str, dict[str, Any]] = {}
        for raw in rows:
            if not isinstance(raw, dict):
                report.fail("STATIC_FILE_BINDING_NOT_OBJECT", repr(raw)[:120])
                continue
            row = _static_entry_normalized(raw)
            path_value = row["repository_relative_path"]
            if not isinstance(path_value, str):
                report.fail("STATIC_FILE_PATH_INVALID", repr(path_value))
                continue
            report.check(path_value not in normalized, "STATIC_FILE_DUPLICATE", path_value)
            normalized[path_value] = row
        report.equal(
            tuple(sorted(normalized)),
            tuple(sorted(STATIC_REPOSITORY_PATHS)),
            "STATIC_FILE_PATH_SET_DRIFT",
        )

        for repo_path in STATIC_REPOSITORY_PATHS:
            row = normalized.get(repo_path)
            if row is None:
                continue
            filename = PurePosixPath(repo_path).name
            expected_copy = f"{PACKET_STATIC_PREFIX}/{filename}"
            report.equal(
                row["immutable_copy_relative_path"],
                expected_copy,
                "STATIC_COPY_PATH_INVALID",
                repo_path,
            )
            packet_path = packet.root / expected_copy
            if not report.check(
                packet_path.is_file() and not packet_path.is_symlink(),
                "STATIC_COPY_MISSING",
                expected_copy,
            ):
                continue
            try:
                payload, copy_status = _read_regular_file(packet_path)
            except (OSError, VerifierAbort) as exc:
                report.fail("STATIC_COPY_READ_FAILED", f"{expected_copy}:{exc}")
                continue
            raw_digest = sha256_bytes(payload)
            report.equal(row["raw_sha256"], raw_digest, "STATIC_RAW_DIGEST_INVALID", repo_path)
            report.equal(
                row["immutable_copy_raw_sha256"],
                raw_digest,
                "STATIC_COPY_DIGEST_INVALID",
                repo_path,
            )
            report.equal(row["byte_count"], len(payload), "STATIC_BYTE_COUNT_INVALID", repo_path)
            report.equal(
                row["git_blob_oid"], _git_blob_oid(payload), "STATIC_GIT_BLOB_INVALID", repo_path
            )
            report.check(
                row["git_mode"] in ("100644", "100755"),
                "STATIC_GIT_MODE_INVALID",
                f"{repo_path}:{row['git_mode']!r}",
            )
            expected_copy_mode = 0o555 if row["git_mode"] == "100755" else 0o444
            report.equal(
                copy_status.st_mode & 0o777,
                expected_copy_mode,
                "STATIC_COPY_MODE_INVALID",
                repo_path,
            )
            local_path = packet.statics.directory / filename
            try:
                local_digest, local_size, _ = _digest_regular_file(local_path)
            except (OSError, VerifierAbort) as exc:
                report.fail("RUNTIME_STATIC_READ_FAILED", f"{filename}:{exc}")
                continue
            report.equal(local_digest, raw_digest, "RUNTIME_STATIC_COPY_DRIFT", filename)
            report.equal(local_size, len(payload), "RUNTIME_STATIC_SIZE_DRIFT", filename)

        protocol_digest = packet.statics.digests["protocol.v1.json"]
        report.equal(
            preseal.get("protocol_raw_sha256"),
            protocol_digest,
            "PRESEAL_PROTOCOL_DIGEST_INVALID",
        )
        for artifact_name in ("freeze.v1.json", "result.v1.json"):
            artifact = packet.get(artifact_name)
            if artifact is None:
                continue
            report.equal(
                artifact.get("static_producer_commit"),
                commit,
                "ARTIFACT_PRODUCER_COMMIT_DRIFT",
                artifact_name,
            )
            report.equal(
                artifact.get("static_producer_tree"),
                tree,
                "ARTIFACT_PRODUCER_TREE_DRIFT",
                artifact_name,
            )
        run_marker = packet.get("run_consumed.v1.json")
        if run_marker is not None:
            report.equal(
                run_marker.get("static_producer_commit"),
                commit,
                "RUN_PRODUCER_COMMIT_DRIFT",
            )
        result = packet.get("result.v1.json")
        if result is not None:
            report.equal(
                result.get("protocol_raw_sha256"),
                protocol_digest,
                "RESULT_PROTOCOL_DIGEST_DRIFT",
            )


def check_cache_manifest_attestation(report: Report, packet: Packet) -> None:
    """Authenticate the frozen public-cache provenance witness without reading outcomes."""

    with report.stage("cache_manifest_attestation"):
        preseal = packet.get("preseal.v1.json")
        if not isinstance(preseal, dict):
            return
        cache = packet.statics.plan_section("cache")
        attestation = preseal.get("cache_manifest_attestation")
        if not report.check(
            isinstance(attestation, dict),
            "CACHE_MANIFEST_ATTESTATION_MISSING",
        ):
            return
        assert isinstance(attestation, dict)
        report.equal(
            attestation.get("declared_schema"),
            cache.get("manifest_expected_schema"),
            "CACHE_MANIFEST_SCHEMA_INVALID",
        )
        declaring_keys = attestation.get("declaring_keys")
        report.check(
            isinstance(declaring_keys, list)
            and bool(declaring_keys)
            and declaring_keys == sorted(set(declaring_keys)),
            "CACHE_MANIFEST_DECLARING_KEYS_INVALID",
        )
        report.equal(
            attestation.get("manifest_absolute_path"),
            cache.get("manifest"),
            "CACHE_MANIFEST_PATH_INVALID",
        )
        report.check(
            is_hex_digest(attestation.get("manifest_raw_sha256")),
            "CACHE_MANIFEST_DIGEST_INVALID",
        )
        report.check(
            attestation.get("upstream_outcomes_read") is False,
            "CACHE_UPSTREAM_OUTCOMES_READ",
        )
        report.equal(
            cache.get("upstream_outcomes"),
            "FORBIDDEN",
            "CACHE_UPSTREAM_OUTCOMES_ALLOWED",
        )
        report.equal(preseal.get("cache_root"), cache.get("root"), "CACHE_ROOT_DRIFT")
        report.check(
            preseal.get("engine_network_access") is False,
            "PRESEAL_NETWORK_ACCESS_DECLARED",
        )
        for field_name in ("root", "manifest"):
            value = cache.get(field_name)
            report.check(
                isinstance(value, str)
                and Path(value).is_absolute()
                and ".." not in Path(value).parts,
                "CACHE_PATH_INVALID",
                field_name,
            )
            if isinstance(value, str):
                report.check(
                    not value.startswith(f"{packet.root}{os.sep}"),
                    "CACHE_PATH_INSIDE_PACKET",
                    field_name,
                )


def _expected_packet_surface(packet: Packet) -> tuple[str, ...]:
    allowed: list[str] = []
    chain_names = {entry.name for entry in PACKET_CHAIN}
    for name in packet.files:
        if name in chain_names or name in ("REPORT.md", "SHA256SUMS"):
            allowed.append(name)
            continue
        if name in STATIC_PACKET_PATHS:
            allowed.append(name)
            continue
        if name.startswith("sources/") and (
            name.endswith(".zip") or name.endswith(".zip.CHECKSUM")
        ):
            allowed.append(name)
    return tuple(sorted(allowed))


def _parse_sums(report: Report, raw: bytes) -> dict[str, str]:
    rows: dict[str, str] = {}
    try:
        text_value = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        report.fail("SHA256SUMS_NOT_UTF8", str(exc))
        return rows
    report.check(text_value.endswith("\n"), "SHA256SUMS_NO_FINAL_LF")
    for ordinal, line in enumerate(text_value.splitlines(), 1):
        match = SUMS_LINE_RE.fullmatch(line)
        if match is None:
            report.fail("SHA256SUMS_LINE_INVALID", f"line={ordinal}")
            continue
        digest, name = match.groups()
        report.check(_path_is_safe_relative(name), "SHA256SUMS_PATH_INVALID", name)
        report.check(name != "SHA256SUMS", "SHA256SUMS_SELF_INCLUDED")
        report.check(name not in rows, "SHA256SUMS_DUPLICATE", name)
        rows[name] = digest
    report.equal(
        tuple(rows),
        tuple(sorted(rows, key=lambda value: value.encode("utf-8"))),
        "SHA256SUMS_NOT_BYTEWISE_SORTED",
    )
    return rows


def check_packet_surface_and_sums(report: Report, packet: Packet) -> Mapping[str, str]:
    with report.stage("packet_surface_and_sha256sums"):
        allowed = _expected_packet_surface(packet)
        report.equal(packet.files, allowed, "PACKET_FORBIDDEN_OR_UNKNOWN_FILE")
        sums_path = packet.root / "SHA256SUMS"
        if not report.check(
            sums_path.is_file() and not sums_path.is_symlink(), "SHA256SUMS_MISSING"
        ):
            return {}
        try:
            sums_raw, sums_status = _read_regular_file(sums_path)
        except (OSError, VerifierAbort) as exc:
            report.fail("SHA256SUMS_READ_FAILED", str(exc))
            return {}
        report.equal(sums_status.st_mode & 0o777, 0o444, "SHA256SUMS_MODE_INVALID")
        rows = _parse_sums(report, sums_raw)
        expected = tuple(name for name in packet.files if name != "SHA256SUMS")
        report.equal(tuple(sorted(rows)), tuple(sorted(expected)), "SHA256SUMS_FILE_SET_DRIFT")
        for name in expected:
            path = packet.root / name
            try:
                digest, byte_count, _ = _digest_regular_file(path)
            except (OSError, VerifierAbort) as exc:
                report.fail("SHA256SUMS_TARGET_READ_FAILED", f"{name}:{exc}")
                continue
            report.equal(rows.get(name), digest, "SHA256SUMS_DIGEST_INVALID", name)
            report.check(byte_count >= 0, "SHA256SUMS_TARGET_SIZE_INVALID", name)
        return rows


def _binding_map(report: Report, artifact_name: str, value: Any) -> dict[str, tuple[str, int]]:
    bindings: dict[str, tuple[str, int]] = {}
    if not isinstance(value, list):
        report.fail("INPUT_BINDINGS_MISSING", artifact_name)
        return bindings
    observed_order: list[str] = []
    for raw in value:
        if not isinstance(raw, dict):
            report.fail("INPUT_BINDING_NOT_OBJECT", f"{artifact_name}:{raw!r}")
            continue
        path_value = raw.get("relative_path")
        digest = raw.get("raw_sha256")
        count = raw.get("byte_count")
        if not isinstance(path_value, str) or not _path_is_safe_relative(path_value):
            report.fail("INPUT_BINDING_PATH_INVALID", f"{artifact_name}:{path_value!r}")
            continue
        report.check(path_value not in bindings, "INPUT_BINDING_DUPLICATE", path_value)
        report.check(is_hex_digest(digest), "INPUT_BINDING_DIGEST_INVALID", path_value)
        report.check(
            isinstance(count, int) and not isinstance(count, bool) and count >= 0,
            "INPUT_BINDING_SIZE_INVALID",
            path_value,
        )
        observed_order.append(path_value)
        bindings[path_value] = (str(digest), int(count) if isinstance(count, int) else -1)
    report.equal(
        observed_order,
        sorted(observed_order, key=lambda item: item.encode("utf-8")),
        "INPUT_BINDINGS_NOT_SORTED",
        artifact_name,
    )
    return bindings


def _validate_bound_file(
    report: Report,
    packet: Packet,
    artifact_name: str,
    relative_path: str,
    claimed: tuple[str, int],
) -> None:
    path = packet.root / relative_path
    if relative_path in STATIC_CONTRACTS:
        path = packet.statics.directory / relative_path
    if not report.check(path.is_file() and not path.is_symlink(), "BOUND_INPUT_MISSING", relative_path):
        return
    try:
        digest, count, _ = _digest_regular_file(path)
    except (OSError, VerifierAbort) as exc:
        report.fail("BOUND_INPUT_READ_FAILED", f"{artifact_name}:{relative_path}:{exc}")
        return
    report.equal(claimed[0], digest, "BOUND_INPUT_DIGEST_INVALID", relative_path)
    report.equal(claimed[1], count, "BOUND_INPUT_SIZE_INVALID", relative_path)


def check_corrected_bindings(report: Report, packet: Packet) -> None:
    """Enforce exact predecessor and sorted multi-input bindings."""

    with report.stage("corrected_directed_bindings"):
        for name, predecessor in CORRECTED_PREDECESSOR.items():
            artifact = packet.get(name)
            if artifact is None:
                continue
            report.equal(
                artifact.get("predecessor_relative_path"),
                predecessor,
                "PREDECESSOR_PATH_INVALID",
                name,
            )
            predecessor_digest = packet.digest_of(predecessor)
            report.equal(
                artifact.get("predecessor_raw_sha256"),
                predecessor_digest,
                "PREDECESSOR_DIGEST_INVALID",
                name,
            )
            required = CORRECTED_REQUIRED_INPUTS[name]
            binding_value = artifact.get("input_bindings")
            if len(required) > 1:
                bindings = _binding_map(report, name, binding_value)
                report.equal(
                    tuple(sorted(bindings)),
                    tuple(sorted(required)),
                    "INPUT_BINDING_SET_DRIFT",
                    name,
                )
                for relative_path in required:
                    if relative_path in bindings:
                        _validate_bound_file(
                            report, packet, name, relative_path, bindings[relative_path]
                        )
            else:
                report.check(
                    binding_value is None,
                    "SINGLE_PREDECESSOR_HAS_REDUNDANT_BINDINGS",
                    name,
                )

        result = packet.get("result.v1.json")
        if result is None:
            return
        latest = "screen_consumed.v1.json"
        for candidate in (
            "screen_universe.v1.json",
            "source_manifest.v1.json",
            "freeze.v1.json",
            "run_consumed.v1.json",
            "event_universe.v1.json",
            "opened_source_ledger.v1.json",
            "development.v1.json",
            "candidate_seal.v1.json",
            "holdout_open.v1.json",
            "holdout.v1.json",
        ):
            if packet.has(candidate):
                latest = candidate
        report.equal(
            result.get("predecessor_relative_path"),
            latest,
            "RESULT_PREDECESSOR_PATH_INVALID",
        )
        report.equal(
            result.get("predecessor_raw_sha256"),
            packet.digest_of(latest),
            "RESULT_PREDECESSOR_DIGEST_INVALID",
        )
        required_result = tuple(
            entry.name
            for entry in PACKET_CHAIN
            if entry.name != "result.v1.json" and packet.has(entry.name)
        )
        if result.get("input_bindings") is not None:
            result_bindings = _binding_map(
                report, "result.v1.json", result.get("input_bindings")
            )
            for relative_path, claimed in result_bindings.items():
                _validate_bound_file(
                    report, packet, "result.v1.json", relative_path, claimed
                )

        unmeasured = result.get("verdict") == "UNMEASURED_RUN_CONSUMED_NO_RERUN"
        failure = result.get("failure_binding")
        if unmeasured:
            if report.check(isinstance(failure, dict), "FAILURE_BINDING_MISSING"):
                assert isinstance(failure, dict)
                report.check(bool(failure.get("stage")), "FAILURE_STAGE_MISSING")
                report.check(bool(failure.get("error_code")), "FAILURE_ERROR_CODE_MISSING")
                failure_inputs = _binding_map(
                    report,
                    "result.v1.json:failure_binding",
                    _value_first(
                        failure,
                        "completed_artifact_bindings",
                        "input_bindings",
                    ),
                )
                report.equal(
                    tuple(sorted(failure_inputs)),
                    tuple(sorted(required_result)),
                    "FAILURE_BINDING_SET_DRIFT",
                )
                for relative_path in required_result:
                    if relative_path in failure_inputs:
                        _validate_bound_file(
                            report,
                            packet,
                            "result.v1.json:failure_binding",
                            relative_path,
                            failure_inputs[relative_path],
                        )
        else:
            report.equal(failure, None, "FAILURE_BINDING_ON_MEASURED_RESULT")


def check_conditional_chain(report: Report, packet: Packet) -> None:
    with report.stage("conditional_chain"):
        result = packet.get("result.v1.json")
        if not report.check(isinstance(result, dict), "RESULT_MISSING"):
            return
        assert isinstance(result, dict)
        verdict = result.get("verdict")
        outcome = result.get("outcome_state")
        present = {name for name in CHAIN_ORDER if packet.has(name)}
        prefix = (
            "preseal.v1.json",
            "screen_consumed.v1.json",
            "screen_universe.v1.json",
            "source_manifest.v1.json",
            "freeze.v1.json",
            "run_consumed.v1.json",
        )
        last_seen = -1
        gap_seen = False
        for index, name in enumerate(prefix):
            if name in present:
                report.check(not gap_seen, "CHAIN_PREFIX_GAP", name)
                last_seen = index
            else:
                gap_seen = True
        report.check(last_seen >= 1, "SCREEN_MARKER_NOT_CONSUMED")

        run_present = "run_consumed.v1.json" in present
        development_present = "development.v1.json" in present
        event_present = "event_universe.v1.json" in present
        opened_present = "opened_source_ledger.v1.json" in present
        seal_present = "candidate_seal.v1.json" in present
        holdout_open_present = "holdout_open.v1.json" in present
        holdout_present = "holdout.v1.json" in present

        report.equal(
            event_present,
            opened_present,
            "RUN_OUTPUT_PAIR_INCOMPLETE",
            "event_universe/opened_source_ledger",
        )
        if development_present:
            report.check(run_present and event_present and opened_present, "DEVELOPMENT_WITHOUT_RUN_INPUTS")
        if seal_present:
            report.check(development_present, "CANDIDATE_SEAL_WITHOUT_DEVELOPMENT")
        if holdout_open_present:
            report.check(seal_present, "HOLDOUT_OPEN_WITHOUT_SEAL")
        if holdout_present:
            report.check(holdout_open_present and seal_present, "HOLDOUT_WITHOUT_OPEN_CHAIN")

        if verdict == "NO_GO_DEVELOPMENT_HOLDOUT_UNOPENED":
            report.check(development_present, "DEVELOPMENT_REJECTION_WITHOUT_DEVELOPMENT")
            report.check(
                not seal_present and not holdout_open_present and not holdout_present,
                "DEVELOPMENT_REJECTION_OPENED_HOLDOUT",
            )
            report.equal(outcome, "MEASURED_DEVELOPMENT_REJECTED", "REJECTION_OUTCOME_STATE_INVALID")
        elif verdict in ("NO_GO", "PUBLIC_PROXY_PASS_CAPITAL_NO_GO"):
            report.check(
                development_present and seal_present and holdout_open_present and holdout_present,
                "HOLDOUT_VERDICT_WITHOUT_FULL_HOLDOUT_CHAIN",
            )
            report.equal(outcome, "MEASURED_HOLDOUT", "HOLDOUT_OUTCOME_STATE_INVALID")
        elif verdict == "UNMEASURED_RUN_CONSUMED_NO_RERUN":
            report.equal(outcome, "TERMINAL_UNMEASURED", "UNMEASURED_OUTCOME_STATE_INVALID")
            report.check(
                packet.has("screen_consumed.v1.json") or run_present,
                "UNMEASURED_WITHOUT_CONSUMED_MARKER",
            )
        else:
            report.fail("VERDICT_UNKNOWN", repr(verdict))

        if run_present:
            run = packet.get("run_consumed.v1.json") or {}
            report.equal(run.get("run_ordinal"), 1, "RUN_ORDINAL_INVALID")
            report.equal(
                run.get("development_archive_member_open_count_before"),
                0,
                "RUN_MARKER_AFTER_DEVELOPMENT_OPEN",
            )
            report.equal(
                run.get("holdout_archive_member_open_count_before"),
                0,
                "RUN_MARKER_AFTER_HOLDOUT_OPEN",
            )
            report.check(
                run.get("marker_created_before_any_development_member") is True
                or run.get("marker_created_before_first_member") is True
                or run.get("marker_created_before_development_valuation") is True,
                "RUN_MARKER_ORDER_UNPROVEN",
            )
        screen = packet.get("screen_consumed.v1.json") or {}
        report.equal(screen.get("screen_ordinal"), 1, "SCREEN_ORDINAL_INVALID")
        report.equal(
            screen.get("screen_archive_member_open_count_before"),
            0,
            "SCREEN_MARKER_AFTER_MEMBER_OPEN",
        )
        report.check(
            screen.get("marker_created_before_first_june_member") is True
            or screen.get("marker_created_before_first_member") is True,
            "SCREEN_MARKER_ORDER_UNPROVEN",
        )
        if holdout_open_present:
            opened = packet.get("holdout_open.v1.json") or {}
            report.equal(opened.get("holdout_open_ordinal"), 1, "HOLDOUT_OPEN_ORDINAL_INVALID")
            report.equal(
                opened.get("holdout_archive_member_open_count_before"),
                0,
                "HOLDOUT_MARKER_AFTER_MEMBER_OPEN",
            )
            report.check(
                opened.get("marker_created_before_first_holdout_member") is True
                or opened.get("marker_created_before_first_member") is True,
                "HOLDOUT_MARKER_ORDER_UNPROVEN",
            )
        for artifact_name in sorted(packet.artifacts):
            report.equal(
                packet.modes.get(artifact_name),
                0o444,
                "ARTIFACT_MODE_NOT_IMMUTABLE",
                artifact_name,
            )
        previous_name = ""
        previous_time: datetime | None = None
        for entry in PACKET_CHAIN:
            artifact = packet.get(entry.name)
            if artifact is None:
                continue
            moment = parse_iso(artifact.get("created_at"))
            if not report.check(moment is not None, "ARTIFACT_CREATED_AT_INVALID", entry.name):
                continue
            assert moment is not None
            if previous_time is not None:
                report.check(
                    moment >= previous_time,
                    "ARTIFACT_CREATED_AT_OUT_OF_ORDER",
                    f"{previous_name}->{entry.name}",
                )
            previous_name, previous_time = entry.name, moment


def _manifest_expected_state(symbol: str, month: str, dataset: str) -> str | None:
    if month in SCREEN_MONTHS:
        return "SCREEN_OPENED_ONCE"
    if month in DEVELOPMENT_MONTHS:
        return "DEVELOPMENT_UNOPENED_AT_INVENTORY"
    if month in HOLDOUT_MONTHS:
        if symbol == "BTCUSDT" and month == "2026-06":
            return "HEADER_ONLY_SCHEMA_EXPOSED"
        return "SEALED_UNOPENED"
    return None


def check_corrected_custody(report: Report, packet: Packet) -> None:
    with report.stage("corrected_custody"):
        screen_universe = packet.get("screen_universe.v1.json")
        manifest = packet.get("source_manifest.v1.json")
        freeze = packet.get("freeze.v1.json")
        result = packet.get("result.v1.json") or {}

        if screen_universe is not None:
            report.equal(screen_universe.get("screen_month"), "2025-06", "SCREEN_MONTH_INVALID")
            report.check(screen_universe.get("outcome_scoring") is False, "SCREEN_OUTCOME_SCORING")
            check_frozen_top100_ranking(report, screen_universe, packet.statics)
            report.check(
                _value_first(
                    screen_universe,
                    "later_month_availability_used",
                    "later_month_evidence_used",
                )
                is False,
                "SCREEN_USED_FUTURE_EVIDENCE",
            )
            accepted = _value_first(
                screen_universe, "fixed_universe", "universe_symbols"
            )
            attempts = _value_first(
                screen_universe, "screen_ledger", "screen_attempts"
            )
            if report.check(isinstance(accepted, list), "SCREEN_UNIVERSE_SYMBOLS_INVALID"):
                assert isinstance(accepted, list)
                report.equal(accepted, sorted(set(accepted)), "SCREEN_UNIVERSE_NOT_SORTED_UNIQUE")
            if report.check(isinstance(attempts, list), "SCREEN_ATTEMPTS_INVALID"):
                assert isinstance(attempts, list)
                attempt_symbols = [
                    row.get("symbol") for row in attempts if isinstance(row, dict)
                ]
                report.equal(
                    attempt_symbols,
                    sorted(set(attempt_symbols)),
                    "SCREEN_ATTEMPTS_NOT_COMPLETE_SORTED_UNIQUE",
                )

        if manifest is not None:
            report.equal(
                manifest.get("development_archive_member_open_count"),
                0,
                "MANIFEST_OPENED_DEVELOPMENT",
            )
            report.equal(
                manifest.get("holdout_archive_member_open_count"),
                0,
                "MANIFEST_OPENED_HOLDOUT",
            )
            report.equal(
                manifest.get("holdout_outcome_rows_opened_before_gates"),
                0,
                "MANIFEST_OPENED_HOLDOUT_OUTCOME",
            )
            rows = manifest.get("entries")
            universe = (
                _value_first(screen_universe, "fixed_universe", "universe_symbols")
                if isinstance(screen_universe, dict)
                else None
            )
            if report.check(isinstance(rows, list), "MANIFEST_ENTRIES_INVALID") and isinstance(
                universe, list
            ):
                assert isinstance(rows, list)
                keyed: dict[tuple[str, str, str], Mapping[str, Any]] = {}
                for raw in rows:
                    if not isinstance(raw, dict):
                        report.fail("MANIFEST_ENTRY_NOT_OBJECT", repr(raw)[:120])
                        continue
                    key = (str(raw.get("symbol")), str(raw.get("month")), str(raw.get("dataset")))
                    report.check(key not in keyed, "MANIFEST_ENTRY_DUPLICATE", ":".join(key))
                    keyed[key] = raw
                    report.check(
                        raw.get("inventory_state") in ("PRESENT", "MISSING"),
                        "MANIFEST_INVENTORY_STATE_INVALID",
                        ":".join(key),
                    )
                    expected_state = (
                        _manifest_expected_state(*key)
                        if raw.get("inventory_state") == "PRESENT"
                        else "ABSENT_AT_INVENTORY"
                    )
                    report.equal(
                        raw.get("member_state"),
                        expected_state,
                        "MANIFEST_MEMBER_STATE_INVALID",
                        ":".join(key),
                    )
                    if raw.get("inventory_state") == "PRESENT":
                        for field_name in (
                            "cache_zip_sha256",
                            "cache_sidecar_sha256",
                            "official_zip_sha256",
                        ):
                            report.check(
                                is_hex_digest(raw.get(field_name)),
                                "MANIFEST_PRESENT_DIGEST_INVALID",
                                f"{':'.join(key)}:{field_name}",
                            )
                        relative_path = raw.get("relative_path")
                        if report.check(
                            isinstance(relative_path, str)
                            and _path_is_safe_relative(relative_path)
                            and relative_path.startswith("data/futures/um/monthly/"),
                            "MANIFEST_RELATIVE_PATH_INVALID",
                            ":".join(key),
                        ):
                            assert isinstance(relative_path, str)
                            packet_zip = f"sources/{relative_path}"
                            packet_sidecar = f"{packet_zip}.CHECKSUM"
                            report.equal(
                                raw.get("packet_relative_path", packet_zip),
                                packet_zip,
                                "MANIFEST_PACKET_PATH_INVALID",
                                ":".join(key),
                            )
                            zip_path = packet.root / packet_zip
                            sidecar_path = packet.root / packet_sidecar
                            if zip_path.exists():
                                report.check(
                                    zip_path.is_file() and not zip_path.is_symlink(),
                                    "MANIFEST_PACKET_ZIP_INVALID",
                                    packet_zip,
                                )
                                try:
                                    zip_digest, zip_size, _ = _digest_regular_file(zip_path)
                                except (OSError, VerifierAbort) as exc:
                                    report.fail("MANIFEST_PACKET_ZIP_READ_FAILED", f"{packet_zip}:{exc}")
                                else:
                                    report.equal(
                                        zip_digest,
                                        str(raw.get("official_zip_sha256")).lower(),
                                        "MANIFEST_PACKET_ZIP_DIGEST_INVALID",
                                        packet_zip,
                                    )
                                    report.equal(
                                        raw.get("byte_count"),
                                        zip_size,
                                        "MANIFEST_PACKET_ZIP_SIZE_INVALID",
                                        packet_zip,
                                    )
                                report.check(
                                    sidecar_path.is_file() and not sidecar_path.is_symlink(),
                                    "MANIFEST_PACKET_SIDECAR_MISSING",
                                    packet_sidecar,
                                )
                                try:
                                    sidecar_raw, _ = _read_regular_file(sidecar_path)
                                except (OSError, VerifierAbort) as exc:
                                    report.fail(
                                        "MANIFEST_PACKET_SIDECAR_READ_FAILED",
                                        f"{packet_sidecar}:{exc}",
                                    )
                                else:
                                    report.equal(
                                        sha256_bytes(sidecar_raw),
                                        str(raw.get("cache_sidecar_sha256")).lower(),
                                        "MANIFEST_PACKET_SIDECAR_DIGEST_INVALID",
                                        packet_sidecar,
                                    )
                                    report.equal(
                                        parse_sidecar(sidecar_raw, PurePosixPath(relative_path).name),
                                        str(raw.get("official_zip_sha256")).lower(),
                                        "MANIFEST_OFFICIAL_SIDECAR_BINDING_INVALID",
                                        packet_sidecar,
                                    )
                    else:
                        for field_name in (
                            "cache_zip_sha256",
                            "cache_sidecar_sha256",
                            "official_zip_sha256",
                        ):
                            report.equal(
                                raw.get(field_name),
                                None,
                                "MANIFEST_MISSING_HAS_DIGEST",
                                f"{':'.join(key)}:{field_name}",
                            )
                expected_keys = {
                    (str(symbol), month, dataset)
                    for symbol in universe
                    for month in (*SCREEN_MONTHS, *DEVELOPMENT_MONTHS, *HOLDOUT_MONTHS)
                    for dataset in ("fundingRate", "markPriceKlines/1h", "klines/1h")
                }
                report.equal(set(keyed), expected_keys, "MANIFEST_NOT_EXHAUSTIVE_FIXED_GRID")

        if freeze is not None:
            report.equal(
                freeze.get("development_archive_member_open_count"),
                0,
                "FREEZE_OPENED_DEVELOPMENT",
            )
            report.equal(
                freeze.get("holdout_archive_member_open_count"),
                0,
                "FREEZE_OPENED_HOLDOUT",
            )
            disclosure = freeze.get("header_only_schema_exposed")
            expected_disclosure = (
                "data/futures/um/monthly/fundingRate/BTCUSDT/BTCUSDT-fundingRate-2026-06.zip",
                "data/futures/um/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2026-06.zip",
                "data/futures/um/monthly/markPriceKlines/BTCUSDT/1h/BTCUSDT-1h-2026-06.zip",
            )
            if isinstance(disclosure, list):
                report.equal(
                    tuple(sorted(str(item) for item in disclosure)),
                    tuple(sorted(expected_disclosure)),
                    "HEADER_ONLY_DISCLOSURE_DRIFT",
                )
            else:
                report.fail("HEADER_ONLY_DISCLOSURE_MISSING")

        custody = result.get("development_and_holdout_custody")
        if report.check(isinstance(custody, dict), "RESULT_CUSTODY_MISSING"):
            assert isinstance(custody, dict)
            report.check(custody.get("one_run") is True, "RESULT_ONE_RUN_INVALID")
            report.check(custody.get("repair_or_rerun") is False, "RESULT_RERUN_ALLOWED")
            holdout = custody.get("holdout")
            if report.check(isinstance(holdout, dict), "RESULT_HOLDOUT_CUSTODY_MISSING"):
                assert isinstance(holdout, dict)
                report.equal(
                    holdout.get("outcome_rows_opened_before_gates"),
                    0,
                    "RESULT_HOLDOUT_OPENED_EARLY",
                )
                if result.get("holdout_state") == "UNOPENED":
                    report.equal(holdout.get("open_count"), 0, "RESULT_HOLDOUT_COUNT_INVALID")
                elif result.get("holdout_state") == "OPENED_ONCE_CHAMPION_ONLY":
                    report.equal(holdout.get("open_count"), 1, "RESULT_HOLDOUT_COUNT_INVALID")


def check_opened_source_ledger(report: Report, packet: Packet) -> None:
    with report.stage("opened_source_ledger"):
        ledger = packet.get("opened_source_ledger.v1.json")
        if ledger is None:
            return
        manifest = packet.get("source_manifest.v1.json") or {}
        manifest_rows = manifest.get("entries")
        manifest_by_packet_path: dict[str, Mapping[str, Any]] = {}
        if isinstance(manifest_rows, list):
            for raw in manifest_rows:
                if not isinstance(raw, dict) or raw.get("inventory_state") != "PRESENT":
                    continue
                relative_path = raw.get("relative_path")
                if isinstance(relative_path, str):
                    manifest_by_packet_path[f"sources/{relative_path}"] = raw
        rows = ledger.get("entries")
        if rows is None:
            rows = ledger.get("rows")
        if rows is None:
            rows = ledger.get("opened_members")
        if not report.check(isinstance(rows, list), "OPENED_LEDGER_ROWS_INVALID"):
            return
        assert isinstance(rows, list)
        seen: set[str] = set()
        for ordinal, row in enumerate(rows, 1):
            if not isinstance(row, dict):
                report.fail("OPENED_LEDGER_ROW_NOT_OBJECT", repr(row)[:120])
                continue
            path_value = row.get("packet_relative_path")
            report.equal(
                row.get("member_open_ordinal"), ordinal, "OPENED_LEDGER_ORDINAL_INVALID"
            )
            report.check(
                isinstance(path_value, str)
                and path_value.startswith("sources/")
                and path_value.endswith(".zip")
                and _path_is_safe_relative(path_value),
                "OPENED_LEDGER_PATH_INVALID",
                repr(path_value),
            )
            if not isinstance(path_value, str):
                continue
            report.check(path_value not in seen, "OPENED_LEDGER_DUPLICATE", path_value)
            seen.add(path_value)
            path = packet.root / path_value
            if not report.check(path.is_file() and not path.is_symlink(), "OPENED_SOURCE_MISSING", path_value):
                continue
            try:
                digest, count, _ = _digest_regular_file(path)
            except (OSError, VerifierAbort) as exc:
                report.fail("OPENED_SOURCE_READ_FAILED", f"{path_value}:{exc}")
                continue
            report.equal(row.get("packet_zip_sha256"), digest, "OPENED_SOURCE_DIGEST_INVALID", path_value)
            report.equal(row.get("zip_byte_count"), count, "OPENED_SOURCE_SIZE_INVALID", path_value)
            stage = row.get("stage")
            report.check(stage in ("development", "holdout"), "OPENED_SOURCE_STAGE_INVALID")
            manifest_row = manifest_by_packet_path.get(path_value)
            report.check(
                manifest_row is not None,
                "OPENED_SOURCE_NOT_MANIFEST_BOUND",
                path_value,
            )
            if manifest_row is not None:
                month = manifest_row.get("month")
                if stage == "development":
                    report.check(
                        month in DEVELOPMENT_MONTHS,
                        "DEVELOPMENT_OPENED_NONDEVELOPMENT_MONTH",
                        path_value,
                    )
                elif stage == "holdout":
                    report.check(
                        month in HOLDOUT_MONTHS,
                        "HOLDOUT_OPENED_NONHOLDOUT_MONTH",
                        path_value,
                    )
            if stage == "holdout":
                report.check(packet.has("holdout_open.v1.json"), "HOLDOUT_SOURCE_WITHOUT_OPEN_MARKER")
        report.equal(
            _value_first(
                ledger,
                "opened_member_count",
                "entry_count",
                "row_count",
            ),
            len(rows),
            "OPENED_LEDGER_COUNT_INVALID",
        )


def check_source_file_reconciliation(report: Report, packet: Packet) -> None:
    """Bind every opaque ZIP and sidecar to the sealed custody documents.

    The exhaustive manifest binds fixed-universe sources.  The June screen
    ledger must separately bind every file materialized for every attempted
    symbol, including rejected candidates which are intentionally absent from
    that fixed-universe manifest.  No ZIP member is opened here.
    """

    with report.stage("source_file_reconciliation"):
        actual = tuple(
            name
            for name in packet.files
            if name.startswith("sources/")
            and (name.endswith(".zip") or name.endswith(".zip.CHECKSUM"))
        )
        actual_set = set(actual)
        screen_bound: dict[str, tuple[str, int, str]] = {}
        screen = packet.get("screen_universe.v1.json")
        attempts = (
            _value_first(screen, "screen_ledger", "screen_attempts")
            if isinstance(screen, dict)
            else None
        )
        if screen is not None and report.check(
            isinstance(attempts, list), "SCREEN_SOURCE_ATTEMPTS_INVALID"
        ):
            assert isinstance(attempts, list)
            for raw_attempt in attempts:
                if not isinstance(raw_attempt, dict):
                    continue
                symbol = raw_attempt.get("symbol")
                bindings = raw_attempt.get("source_bindings")
                detail = str(symbol)
                if not report.check(
                    isinstance(bindings, list),
                    "SCREEN_SOURCE_BINDINGS_MISSING",
                    detail,
                ):
                    continue
                assert isinstance(bindings, list)
                observed_order: list[str] = []
                attempt_paths: set[str] = set()
                for raw_binding in bindings:
                    if not isinstance(raw_binding, dict):
                        report.fail(
                            "SCREEN_SOURCE_BINDING_NOT_OBJECT",
                            f"{detail}:{raw_binding!r}"[:240],
                        )
                        continue
                    relative = raw_binding.get("relative_path")
                    digest = raw_binding.get("raw_sha256")
                    byte_count = raw_binding.get("byte_count")
                    if not report.check(
                        isinstance(relative, str)
                        and _path_is_safe_relative(relative)
                        and relative.startswith("sources/data/futures/um/monthly/")
                        and (
                            relative.endswith(".zip")
                            or relative.endswith(".zip.CHECKSUM")
                        ),
                        "SCREEN_SOURCE_BINDING_PATH_INVALID",
                        f"{detail}:{relative!r}",
                    ):
                        continue
                    assert isinstance(relative, str)
                    observed_order.append(relative)
                    report.check(
                        relative not in attempt_paths,
                        "SCREEN_SOURCE_BINDING_DUPLICATE",
                        relative,
                    )
                    attempt_paths.add(relative)
                    report.check(
                        "/2025-06" in relative or "-2025-06.zip" in relative,
                        "SCREEN_SOURCE_BINDING_NOT_JUNE",
                        relative,
                    )
                    report.check(
                        isinstance(symbol, str) and f"/{symbol}/" in relative,
                        "SCREEN_SOURCE_BINDING_SYMBOL_DRIFT",
                        f"{detail}:{relative}",
                    )
                    report.check(
                        is_hex_digest(digest),
                        "SCREEN_SOURCE_BINDING_DIGEST_INVALID",
                        relative,
                    )
                    report.check(
                        isinstance(byte_count, int)
                        and not isinstance(byte_count, bool)
                        and byte_count >= 0,
                        "SCREEN_SOURCE_BINDING_SIZE_INVALID",
                        relative,
                    )
                    report.check(
                        relative not in screen_bound,
                        "SCREEN_SOURCE_BOUND_BY_MULTIPLE_ATTEMPTS",
                        relative,
                    )
                    screen_bound[relative] = (
                        str(digest),
                        int(byte_count) if isinstance(byte_count, int) else -1,
                        detail,
                    )
                report.equal(
                    observed_order,
                    sorted(observed_order, key=lambda item: item.encode("utf-8")),
                    "SCREEN_SOURCE_BINDINGS_NOT_SORTED",
                    detail,
                )
                if raw_attempt.get("status") == "ADMITTED":
                    report.equal(
                        len(attempt_paths),
                        6,
                        "ADMITTED_SCREEN_SOURCE_BINDING_COUNT_INVALID",
                        detail,
                    )

        manifest_bound: dict[str, Mapping[str, Any]] = {}
        manifest = packet.get("source_manifest.v1.json")
        manifest_rows = manifest.get("entries") if isinstance(manifest, dict) else None
        if isinstance(manifest_rows, list):
            for raw in manifest_rows:
                if (
                    not isinstance(raw, dict)
                    or raw.get("inventory_state") != "PRESENT"
                    or not isinstance(raw.get("relative_path"), str)
                ):
                    continue
                packet_zip = f"sources/{raw['relative_path']}"
                manifest_bound[packet_zip] = raw
                manifest_bound[f"{packet_zip}.CHECKSUM"] = raw

        for relative in actual:
            path = packet.root / relative
            try:
                digest, byte_count, status = _digest_regular_file(path)
            except (OSError, VerifierAbort) as exc:
                report.fail("SOURCE_FILE_READ_FAILED", f"{relative}:{exc}")
                continue
            report.equal(
                status.st_mode & 0o777,
                0o444,
                "SOURCE_FILE_MODE_NOT_IMMUTABLE",
                relative,
            )
            screen_claim = screen_bound.get(relative)
            if screen_claim is not None:
                report.equal(
                    screen_claim[0],
                    digest,
                    "SCREEN_SOURCE_BINDING_DIGEST_MISMATCH",
                    relative,
                )
                report.equal(
                    screen_claim[1],
                    byte_count,
                    "SCREEN_SOURCE_BINDING_SIZE_MISMATCH",
                    relative,
                )
            report.check(
                screen_claim is not None or relative in manifest_bound,
                "SOURCE_FILE_NOT_SEMANTICALLY_BOUND",
                relative,
            )

        for relative in sorted(screen_bound):
            report.check(relative in actual_set, "SCREEN_BOUND_SOURCE_MISSING", relative)

        zip_paths = {name for name in actual if name.endswith(".zip")}
        sidecar_paths = {name for name in actual if name.endswith(".zip.CHECKSUM")}
        report.equal(
            {f"{name}.CHECKSUM" for name in zip_paths},
            sidecar_paths,
            "SOURCE_ZIP_SIDECAR_SET_DRIFT",
        )
        for zip_relative in sorted(zip_paths):
            sidecar_relative = f"{zip_relative}.CHECKSUM"
            try:
                zip_digest, _, _ = _digest_regular_file(packet.root / zip_relative)
                sidecar_raw, _ = _read_regular_file(packet.root / sidecar_relative)
            except (OSError, VerifierAbort) as exc:
                report.fail("SOURCE_PAIR_READ_FAILED", f"{zip_relative}:{exc}")
                continue
            report.equal(
                parse_sidecar(sidecar_raw, PurePosixPath(zip_relative).name),
                zip_digest,
                "SOURCE_OFFICIAL_SIDECAR_MISMATCH",
                zip_relative,
            )


def check_current_event_universe(report: Report, packet: Packet) -> None:
    with report.stage("event_universe"):
        universe = packet.get("event_universe.v1.json")
        if universe is None:
            return
        report.equal(universe.get("partition_id"), "development", "EVENT_PARTITION_INVALID")
        report.equal(universe.get("forward_returns_included"), False, "EVENT_FORWARD_RETURN_PRESENT")
        report.equal(universe.get("lag_safe_claim"), False, "EVENT_LAG_SAFE_CLAIM")
        rows = universe.get("candidates")
        if not report.check(isinstance(rows, list), "EVENT_CANDIDATES_INVALID"):
            return
        assert isinstance(rows, list)
        report.equal(universe.get("candidate_count"), len(rows), "EVENT_CANDIDATE_COUNT_INVALID")
        observed_order: list[tuple[str, str, str]] = []
        seen: set[tuple[str, str, str]] = set()
        ledger = {
            str(row.get("trial_id")): row
            for row in packet.statics.ledger.get("trials", ())
            if isinstance(row, dict)
        }
        start_ms = iso_to_ms(packet.statics.section("window").get("development_start"))
        end_ms = iso_to_ms(packet.statics.section("window").get("development_end"))
        if start_ms is None or end_ms is None:
            report.fail("EVENT_DEVELOPMENT_WINDOW_INVALID")
            return
        for ordinal, raw in enumerate(rows):
            if not isinstance(raw, dict):
                report.fail("EVENT_CANDIDATE_NOT_OBJECT", str(ordinal))
                continue
            trial_id = str(raw.get("trial_id"))
            symbol = str(raw.get("symbol"))
            decision_text = str(raw.get("decision_hour"))
            key = (trial_id, decision_text, symbol)
            observed_order.append(key)
            report.check(key not in seen, "EVENT_CANDIDATE_DUPLICATE", repr(key))
            seen.add(key)
            trial = ledger.get(trial_id)
            if not report.check(trial is not None, "EVENT_TRIAL_UNKNOWN", trial_id):
                continue
            assert trial is not None
            report.equal(
                raw.get("confirmation_rows"),
                trial.get("confirmation_rows"),
                "EVENT_CONFIRMATION_ROWS_INVALID",
                trial_id,
            )
            interval = as_int(raw.get("new_interval_hours"))
            report.check(interval in (1, 4), "EVENT_INTERVAL_INVALID", repr(key))
            rate = _decimal_required(
                report, raw.get("signal_rate"), "EVENT_SIGNAL_RATE_INVALID", repr(key)
            )
            normalized = _decimal_required(
                report,
                raw.get("signal_normalized_rate_8h"),
                "EVENT_NORMALIZED_RATE_INVALID",
                repr(key),
            )
            side = as_int(raw.get("contrarian_side"))
            if rate is not None and normalized is not None and interval is not None:
                report.numeric(
                    normalized,
                    rate * Decimal(8) / Decimal(interval),
                    "EVENT_NORMALIZATION_INVALID",
                    repr(key),
                )
                expected_side = 0 if rate == 0 else (-1 if rate > 0 else 1)
                report.equal(side, expected_side, "EVENT_CONTRARIAN_SIDE_INVALID", repr(key))
            confirmation_ms = iso_to_ms(raw.get("final_confirmation_calc_time"))
            decision_ms = iso_to_ms(raw.get("decision_hour"))
            entry_ms = iso_to_ms(raw.get("entry_hour"))
            exit_ms = iso_to_ms(raw.get("exit_hour"))
            baseline_ms = iso_to_ms(raw.get("baseline_start"))
            event_ms = iso_to_ms(raw.get("event_calc_time"))
            if None in (
                confirmation_ms,
                decision_ms,
                entry_ms,
                exit_ms,
                baseline_ms,
                event_ms,
            ):
                report.fail("EVENT_TIMESTAMP_INVALID", repr(key))
                continue
            assert confirmation_ms is not None
            assert decision_ms is not None
            assert entry_ms is not None
            assert exit_ms is not None
            assert baseline_ms is not None
            assert event_ms is not None
            lag = int(trial.get("entry_lag_hours"))
            hold = int(trial.get("hold_hours"))
            shifted = confirmation_ms + lag * HOUR_MS
            expected_decision = ((shifted + HOUR_MS - 1) // HOUR_MS) * HOUR_MS
            report.equal(
                decision_ms,
                expected_decision,
                "EVENT_DECISION_HOUR_INVALID",
                repr(key),
            )
            report.equal(entry_ms, decision_ms, "EVENT_ENTRY_HOUR_INVALID", repr(key))
            report.equal(exit_ms, entry_ms + hold * HOUR_MS, "EVENT_EXIT_HOUR_INVALID", repr(key))
            report.check(
                start_ms <= baseline_ms <= event_ms <= confirmation_ms
                and entry_ms - 168 * HOUR_MS >= start_ms
                and exit_ms <= end_ms,
                "EVENT_INCOMPLETE_PARTITION_HORIZON",
                repr(key),
            )
            outcome_keys = [
                field_name
                for field_name in raw
                if OUTCOME_WORD_RE.search(field_name) is not None
            ]
            report.check(not outcome_keys, "EVENT_OUTCOME_FIELD_PRESENT", f"{key}:{outcome_keys}")
        report.equal(
            observed_order,
            sorted(observed_order),
            "EVENT_CANDIDATES_NOT_SORTED",
        )


def check_report_and_forbidden_surfaces(report: Report, packet: Packet) -> None:
    with report.stage("report_and_forbidden_surfaces"):
        result = packet.get("result.v1.json")
        if result is None:
            return
        effects = result.get("effects")
        report.equal(effects, EXPECTED_EFFECTS, "FORBIDDEN_EFFECT_CLAIM")
        report.equal(result.get("capital_authority"), "NO_GO", "CAPITAL_AUTHORITY_INVALID")
        report.equal(result.get("account_effective_fees"), "UNKNOWN", "ACCOUNT_FEE_NOT_UNKNOWN")
        report.equal(result.get("executable_capacity"), "UNKNOWN", "EXECUTABLE_CAPACITY_NOT_UNKNOWN")

        report_path = packet.root / "REPORT.md"
        if not report.check(
            report_path.is_file() and not report_path.is_symlink(), "REPORT_MISSING"
        ):
            return
        try:
            payload, status = _read_regular_file(report_path)
        except (OSError, VerifierAbort) as exc:
            report.fail("REPORT_READ_FAILED", str(exc))
            return
        report.equal(status.st_mode & 0o777, 0o444, "REPORT_MODE_INVALID")
        try:
            text_value = payload.decode("utf-8")
        except UnicodeDecodeError as exc:
            report.fail("REPORT_NOT_UTF8", str(exc))
            return
        result_digest = packet.digest_of("result.v1.json")
        matching_lines = [
            line
            for line in text_value.splitlines()
            if "result.v1.json" in line and isinstance(result_digest, str) and result_digest in line
        ]
        report.check(bool(matching_lines), "REPORT_RESULT_DIGEST_MISSING")

        for name, artifact in packet.artifacts.items():
            serialized = canonical_bytes(artifact).decode("utf-8")
            credential = CREDENTIAL_RE.search(serialized)
            report.check(credential is None, "CREDENTIAL_SURFACE_PRESENT", name)
            urls = URL_RE.findall(serialized)
            if name == "source_manifest.v1.json":
                bad_urls = [
                    value
                    for value in urls
                    if not value.startswith(ARCHIVE_HOST_PREFIX)
                ]
            else:
                bad_urls = urls
            report.check(not bad_urls, "FORBIDDEN_URL_PRESENT", f"{name}:{bad_urls[:3]}")


# --------------------------------------------------------------------------
# deterministic economics/statistics re-derivation
# --------------------------------------------------------------------------


def _decimal_required(
    report: Report, value: Any, code: str, detail: str = ""
) -> Decimal | None:
    number = as_decimal(value)
    report.check(number is not None, code, f"{detail}:{value!r}")
    return number


def _decimal_series(
    report: Report, value: Any, expected_length: int, code: str, detail: str
) -> tuple[Decimal, ...]:
    if not report.check(isinstance(value, list), code, f"{detail}:not-list"):
        return ()
    assert isinstance(value, list)
    report.equal(len(value), expected_length, code, f"{detail}:length")
    parsed: list[Decimal] = []
    for index, raw in enumerate(value):
        number = as_decimal(raw)
        if number is None:
            report.fail(code, f"{detail}:index={index}:{raw!r}")
            return ()
        parsed.append(number)
    return tuple(parsed)


def _partition_day_count(start_ms: int, end_ms: int) -> int:
    return (end_ms - start_ms) // DAY_MS


def _bootstrap_indices(partition: str, days: int) -> tuple[tuple[int, ...], ...]:
    draws = (days + 6) // 7
    rows: list[tuple[int, ...]] = []
    for replicate in range(BOOTSTRAP_REPLICATES):
        indices: list[int] = []
        for draw in range(draws):
            material = f"20260729|{partition}|{replicate}|{draw}".encode("ascii")
            start = int.from_bytes(hashlib.sha256(material).digest()[:8], "big") % days
            indices.extend((start + offset) % days for offset in range(7))
        rows.append(tuple(indices[:days]))
    return tuple(rows)


def _nearest_rank(values: Sequence[Decimal], quantile: Decimal) -> Decimal:
    ordered = sorted(values)
    rank = int((quantile * Decimal(len(ordered))).to_integral_value(rounding=ROUND_CEILING))
    return ordered[max(0, rank - 1)]


@dataclass(frozen=True, slots=True)
class BootstrapStats:
    interval: tuple[Decimal, Decimal]
    lower_one_sided: Decimal
    bonferroni_lower: Decimal
    centered_p: Decimal
    totals: tuple[Decimal, ...]


def _bootstrap_stats(
    values: Sequence[Decimal], indices: Sequence[Sequence[int]]
) -> BootstrapStats:
    total = sum(values, Decimal(0))
    mean = total / Decimal(len(values))
    centered = tuple(value - mean for value in values)
    resampled = tuple(
        sum((values[index] for index in row), Decimal(0)) for row in indices
    )
    centered_resampled = tuple(
        sum((centered[index] for index in row), Decimal(0)) for row in indices
    )
    exceed = sum(value >= total for value in centered_resampled)
    centered_p = Decimal(1 + exceed) / Decimal(BOOTSTRAP_REPLICATES + 1)
    return BootstrapStats(
        interval=(
            _nearest_rank(resampled, Decimal("0.025")),
            _nearest_rank(resampled, Decimal("0.975")),
        ),
        lower_one_sided=_nearest_rank(resampled, Decimal("0.05")),
        bonferroni_lower=_nearest_rank(resampled, Decimal(1) / Decimal(480)),
        centered_p=centered_p,
        totals=resampled,
    )


def _white_p(
    daily: Mapping[str, Mapping[str, Sequence[Decimal]]],
    scenario: str,
    indices: Sequence[Sequence[int]],
) -> Decimal:
    totals = {
        trial_id: sum(scenarios[scenario], Decimal(0))
        for trial_id, scenarios in daily.items()
    }
    centered = {
        trial_id: tuple(
            value - totals[trial_id] / Decimal(len(scenarios[scenario]))
            for value in scenarios[scenario]
        )
        for trial_id, scenarios in daily.items()
    }
    observed = max(totals.values())
    exceed = 0
    for row in indices:
        maximum = max(
            sum((series[index] for index in row), Decimal(0))
            for series in centered.values()
        )
        exceed += int(maximum >= observed)
    return Decimal(1 + exceed) / Decimal(BOOTSTRAP_REPLICATES + 1)


def _pbo(
    daily: Mapping[str, Mapping[str, Sequence[Decimal]]]
) -> tuple[Decimal, int]:
    from itertools import combinations

    days = len(next(iter(daily.values()))["base"])
    q, remainder = divmod(days, 12)
    blocks: list[tuple[int, ...]] = []
    cursor = 0
    for index in range(12):
        size = q + (1 if index < remainder else 0)
        full = tuple(range(cursor, cursor + size))
        cursor += size
        blocks.append(full)
    block_scores: dict[str, tuple[Decimal, ...]] = {}
    for trial_id, scenarios in daily.items():
        block_scores[trial_id] = tuple(
            min(
                sum((scenarios["base"][index] for index in block), Decimal(0)),
                sum((scenarios["stress"][index] for index in block), Decimal(0)),
            )
            for block in blocks
        )
    losses = 0
    split_count = 0
    all_blocks = set(range(12))
    for chosen in combinations(range(12), 6):
        split_count += 1
        in_sample = set(chosen)
        out_sample = all_blocks - in_sample
        is_scores = {
            trial_id: sum((scores[index] for index in in_sample), Decimal(0))
            for trial_id, scores in block_scores.items()
        }
        oos_scores = {
            trial_id: sum((scores[index] for index in out_sample), Decimal(0))
            for trial_id, scores in block_scores.items()
        }
        maximum_is = max(is_scores.values())
        candidates = [
            trial_id for trial_id, value in is_scores.items() if value == maximum_is
        ]
        ranks = {
            trial_id: 1
            + sum(other < score for other in oos_scores.values())
            for trial_id, score in oos_scores.items()
        }
        champion = min(candidates, key=lambda trial_id: (ranks[trial_id], trial_id))
        percentile = Decimal(ranks[champion]) / Decimal(FAMILY_SIZE + 1)
        # logit(percentile) <= 0 iff percentile <= 1/2.
        losses += int(percentile <= Decimal("0.5"))
    return Decimal(losses) / Decimal(split_count), split_count


def _scenario_costs(statics: Statics, scenario: str) -> tuple[Decimal, Decimal]:
    row = statics.section("costs").get("scenarios", {})
    row = row.get(scenario, {}) if isinstance(row, dict) else {}
    fee = as_decimal(row.get("public_fee_bp_per_fill"))
    adverse = as_decimal(row.get("adverse_execution_bp_per_fill"))
    if fee is None or adverse is None:
        raise VerifierAbort(f"COST_SCENARIO_INVALID {scenario}")
    return fee / Decimal(10_000), adverse / Decimal(10_000)


def _verify_member(
    report: Report,
    statics: Statics,
    label: str,
    member: Mapping[str, Any],
    entry_ms: int,
    exit_ms: int,
) -> dict[str, dict[str, Decimal]]:
    symbol = member.get("symbol")
    side = as_int(member.get("side_sign"))
    notional = _decimal_required(report, member.get("member_notional_usd"), "MEMBER_NOTIONAL_INVALID", label)
    entry = _decimal_required(report, member.get("entry_mark_price"), "MEMBER_ENTRY_INVALID", label)
    exit_price = _decimal_required(report, member.get("exit_mark_price"), "MEMBER_EXIT_INVALID", label)
    report.check(
        isinstance(symbol, str) and re.fullmatch(r"[A-Z0-9]+USDT", symbol) is not None,
        "MEMBER_SYMBOL_INVALID",
        label,
    )
    report.check(side in (-1, 1), "MEMBER_SIDE_INVALID", label)
    if notional is None or entry is None or exit_price is None or side not in (-1, 1):
        return {}
    report.check(notional > 0 and entry > 0 and exit_price > 0, "MEMBER_PRICE_OR_SIZE_NONPOSITIVE", label)
    quantity = notional / entry
    report.numeric(member.get("quantity"), quantity, "MEMBER_QUANTITY_INVALID", label)
    settlements = member.get("funding_settlements")
    if not report.check(isinstance(settlements, list), "MEMBER_FUNDING_LEDGER_INVALID", label):
        settlements = []
    funding = Decimal(0)
    previous_settlement = -1
    for ordinal, raw in enumerate(settlements):
        if not isinstance(raw, dict):
            report.fail("MEMBER_FUNDING_ROW_INVALID", f"{label}:{ordinal}")
            continue
        calc_time = as_int(raw.get("calc_time_ms"))
        booking_hour = as_int(raw.get("booking_hour_ms"))
        mark = _decimal_required(
            report, raw.get("mark_price"), "MEMBER_FUNDING_MARK_INVALID", f"{label}:{ordinal}"
        )
        rate = _decimal_required(
            report, raw.get("funding_rate"), "MEMBER_FUNDING_RATE_INVALID", f"{label}:{ordinal}"
        )
        report.check(
            calc_time is not None
            and entry_ms < calc_time < exit_ms
            and calc_time > previous_settlement,
            "MEMBER_FUNDING_TIME_INVALID",
            f"{label}:{ordinal}",
        )
        if calc_time is not None:
            previous_settlement = calc_time
            expected_booking = ((calc_time + HOUR_MS - 1) // HOUR_MS) * HOUR_MS
            report.equal(
                booking_hour,
                expected_booking,
                "MEMBER_FUNDING_BOOKING_HOUR_INVALID",
                f"{label}:{ordinal}",
            )
        if mark is not None and rate is not None:
            report.check(mark > 0, "MEMBER_FUNDING_MARK_NONPOSITIVE", f"{label}:{ordinal}")
            amount = -Decimal(side) * quantity * mark * rate
            report.numeric(
                raw.get("amount_usd"),
                amount,
                "MEMBER_FUNDING_AMOUNT_INVALID",
                f"{label}:{ordinal}",
            )
            funding += amount
    scenarios = member.get("scenario_components")
    if not report.check(isinstance(scenarios, dict), "MEMBER_SCENARIOS_INVALID", label):
        return {}
    assert isinstance(scenarios, dict)
    report.equal(
        tuple(sorted(scenarios)),
        SORTED_SCENARIOS,
        "MEMBER_SCENARIO_SET_INVALID",
        label,
    )
    recomputed: dict[str, dict[str, Decimal]] = {}
    price = Decimal(side) * quantity * (exit_price - entry)
    for scenario in SCENARIOS:
        fee_rate, adverse_rate = _scenario_costs(statics, scenario)
        entry_fill = entry * (Decimal(1) + Decimal(side) * adverse_rate)
        exit_fill = exit_price * (Decimal(1) - Decimal(side) * adverse_rate)
        adverse = -quantity * adverse_rate * (entry + exit_price)
        adverse_entry = -quantity * adverse_rate * entry
        adverse_exit = -quantity * adverse_rate * exit_price
        fee_entry = -fee_rate * quantity * abs(entry_fill)
        fee_exit = -fee_rate * quantity * abs(exit_fill)
        fee = fee_entry + fee_exit
        net = price + funding + adverse + fee
        row = scenarios.get(scenario)
        if not isinstance(row, dict):
            report.fail("MEMBER_SCENARIO_ROW_INVALID", f"{label}:{scenario}")
            continue
        expected = {
            "mark_price_pnl_usd": price,
            "funding_usd": funding,
            "adverse_attribution_usd": adverse,
            "fee_usd": fee,
            "net_usd": net,
        }
        for field_name, value in expected.items():
            report.numeric(
                row.get(field_name),
                value,
                "MEMBER_COMPONENT_INVALID",
                f"{label}:{scenario}:{field_name}",
            )
        for field_name, value in (
            ("adverse_entry_usd", adverse_entry),
            ("adverse_exit_usd", adverse_exit),
            ("fee_entry_usd", fee_entry),
            ("fee_exit_usd", fee_exit),
        ):
            report.numeric(
                row.get(field_name),
                value,
                "MEMBER_COMPONENT_SPLIT_INVALID",
                f"{label}:{scenario}:{field_name}",
            )
        report.numeric(
            row.get("entry_fill_proxy"),
            entry_fill,
            "MEMBER_ENTRY_FILL_INVALID",
            f"{label}:{scenario}",
        )
        report.numeric(
            row.get("exit_fill_proxy"),
            exit_fill,
            "MEMBER_EXIT_FILL_INVALID",
            f"{label}:{scenario}",
        )
        recomputed[scenario] = expected
    return recomputed


@dataclass(frozen=True, slots=True)
class LedgerMetrics:
    daily: Mapping[str, tuple[Decimal, ...]]
    attribution: Mapping[str, Mapping[str, Decimal]]
    activity: Mapping[str, int]
    capacity_minimum: Decimal | None
    capacity_p05: Decimal | None
    best_stress_month: str | None
    best_stress_month_contribution: Decimal | None
    best_stress_symbol: str | None
    best_stress_symbol_contribution: Decimal | None
    remove_best_month_stress: Decimal
    remove_best_symbol_stress: Decimal
    severe_drawdown: Decimal


def _ledger_metrics(
    report: Report,
    packet: Packet,
    label: str,
    evidence: Mapping[str, Any],
    start_ms: int,
    end_ms: int,
) -> LedgerMetrics | None:
    days = _partition_day_count(start_ms, end_ms)
    cohorts = evidence.get("cohorts")
    decisions = evidence.get("decisions")
    equity = evidence.get("hourly_equity_severe")
    if not report.check(isinstance(cohorts, list), "EVIDENCE_COHORTS_INVALID", label):
        return None
    if not report.check(isinstance(decisions, list), "EVIDENCE_DECISIONS_INVALID", label):
        return None
    if not report.check(isinstance(equity, list), "EVIDENCE_EQUITY_INVALID", label):
        return None
    assert isinstance(cohorts, list) and isinstance(decisions, list) and isinstance(equity, list)
    daily = {scenario: [Decimal(0)] * days for scenario in SCENARIOS}
    attribution = {
        scenario: {
            "mark_price_pnl_usd": Decimal(0),
            "funding_usd": Decimal(0),
            "adverse_attribution_usd": Decimal(0),
            "fee_usd": Decimal(0),
            "net_usd": Decimal(0),
        }
        for scenario in SCENARIOS
    }
    capacities: list[Decimal] = []
    month_stress: dict[str, Decimal] = {}
    symbol_stress: dict[str, Decimal] = {}
    symbols: set[str] = set()
    weeks: set[tuple[int, int]] = set()
    traded_members = 0
    severe_members: list[dict[str, Any]] = []

    for cohort_index, raw_cohort in enumerate(cohorts):
        if not isinstance(raw_cohort, dict):
            report.fail("EVIDENCE_COHORT_NOT_OBJECT", f"{label}:{cohort_index}")
            continue
        entry_ms = as_int(raw_cohort.get("entry_ms"))
        exit_ms = as_int(raw_cohort.get("exit_ms"))
        members = raw_cohort.get("members")
        capacity = _decimal_required(
            report,
            raw_cohort.get("capacity_proxy_usd"),
            "COHORT_CAPACITY_INVALID",
            f"{label}:{cohort_index}",
        )
        if (
            entry_ms is None
            or exit_ms is None
            or not isinstance(members, list)
            or capacity is None
        ):
            report.fail("COHORT_STRUCTURE_INVALID", f"{label}:{cohort_index}")
            continue
        report.check(
            start_ms <= entry_ms < exit_ms <= end_ms,
            "COHORT_OUTSIDE_PARTITION",
            f"{label}:{cohort_index}",
        )
        report.equal(
            raw_cohort.get("decision_ms"),
            entry_ms,
            "COHORT_DECISION_ENTRY_DRIFT",
            f"{label}:{cohort_index}",
        )
        report.check(capacity >= 0, "COHORT_CAPACITY_NEGATIVE", f"{label}:{cohort_index}")
        exit_day = (exit_ms - start_ms) // DAY_MS
        report.check(0 <= exit_day < days, "COHORT_EXIT_DAY_INVALID", f"{label}:{cohort_index}")
        entry_moment = datetime.fromtimestamp(entry_ms / 1000, tz=UTC)
        iso = entry_moment.isocalendar()
        weeks.add((iso.year, iso.week))
        month_key = f"{entry_moment.year:04d}-{entry_moment.month:02d}"
        cohort_sums = {scenario: Decimal(0) for scenario in SCENARIOS}
        member_capacity_values: list[Decimal] = []
        expected_member_notional = CAPITAL / Decimal(len(members)) if members else None
        observed_member_symbols: list[str] = []
        for member_index, raw_member in enumerate(members):
            if not isinstance(raw_member, dict):
                report.fail("EVIDENCE_MEMBER_NOT_OBJECT", f"{label}:{cohort_index}:{member_index}")
                continue
            member_label = f"{label}:{cohort_index}:{member_index}"
            recomputed = _verify_member(
                report,
                packet.statics,
                member_label,
                raw_member,
                entry_ms,
                exit_ms,
            )
            symbol = str(raw_member.get("symbol"))
            observed_member_symbols.append(symbol)
            symbols.add(symbol)
            traded_members += 1
            if expected_member_notional is not None:
                report.numeric(
                    raw_member.get("member_notional_usd"),
                    expected_member_notional,
                    "MEMBER_EQUAL_WEIGHT_NOTIONAL_INVALID",
                    member_label,
                )
            windows = raw_member.get("capacity_quote_volume_24h_windows_usdt")
            parsed_windows = _decimal_series(
                report,
                windows,
                7,
                "MEMBER_CAPACITY_WINDOWS_INVALID",
                member_label,
            )
            if len(parsed_windows) == 7:
                report.check(
                    all(value >= 0 for value in parsed_windows),
                    "MEMBER_CAPACITY_WINDOW_NEGATIVE",
                    member_label,
                )
                participation = as_decimal(
                    packet.statics.section("capacity").get("participation_rate")
                )
                if participation is None:
                    report.fail("CAPACITY_PARTICIPATION_RATE_INVALID")
                else:
                    member_capacity = (
                        min(parsed_windows[0], sorted(parsed_windows)[3])
                        * participation
                    )
                    report.numeric(
                        raw_member.get("member_capacity_proxy_usd"),
                        member_capacity,
                        "MEMBER_CAPACITY_RECOMPUTE_INVALID",
                        member_label,
                    )
                    member_capacity_values.append(member_capacity)
            for scenario, components in recomputed.items():
                cohort_sums[scenario] += components["net_usd"]
                for field_name, value in components.items():
                    attribution[scenario][field_name] += value
            if "stress" in recomputed:
                symbol_stress[symbol] = symbol_stress.get(symbol, Decimal(0)) + recomputed[
                    "stress"
                ]["net_usd"]
            scenario_rows = raw_member.get("scenario_components")
            severe_row = (
                scenario_rows.get("severe")
                if isinstance(scenario_rows, dict)
                else None
            )
            settlement_rows = raw_member.get("funding_settlements")
            if isinstance(severe_row, dict) and isinstance(settlement_rows, list):
                replay_values = {
                    "quantity": as_decimal(raw_member.get("quantity")),
                    "entry_price": as_decimal(raw_member.get("entry_mark_price")),
                    "realized_price": as_decimal(
                        severe_row.get("mark_price_pnl_usd")
                    ),
                    "adverse_entry": as_decimal(
                        severe_row.get("adverse_entry_usd")
                    ),
                    "adverse_exit": as_decimal(
                        severe_row.get("adverse_exit_usd")
                    ),
                    "fee_entry": as_decimal(severe_row.get("fee_entry_usd")),
                    "fee_exit": as_decimal(severe_row.get("fee_exit_usd")),
                }
                funding_rows = [
                    (
                        as_int(row.get("booking_hour_ms")),
                        as_decimal(row.get("amount_usd")),
                    )
                    for row in settlement_rows
                    if isinstance(row, dict)
                ]
                replay_side = as_int(raw_member.get("side_sign"))
                if all(value is not None for value in replay_values.values()) and all(
                    hour is not None and amount is not None
                    for hour, amount in funding_rows
                ) and replay_side in (-1, 1):
                    severe_members.append(
                        {
                            **replay_values,
                            "entry_ms": entry_ms,
                            "exit_ms": exit_ms,
                            "funding": tuple(
                                (int(hour), amount)
                                for hour, amount in funding_rows
                                if hour is not None and amount is not None
                            ),
                            "side": replay_side,
                            "symbol": symbol,
                        }
                    )
        report.check(bool(members), "COHORT_WITHOUT_MEMBERS", f"{label}:{cohort_index}")
        report.equal(
            observed_member_symbols,
            sorted(set(observed_member_symbols)),
            "COHORT_SYMBOLS_NOT_SORTED_UNIQUE",
            f"{label}:{cohort_index}",
        )
        if len(member_capacity_values) == len(members) and member_capacity_values:
            recomputed_capacity = Decimal(len(members)) * min(member_capacity_values)
            report.numeric(
                capacity,
                recomputed_capacity,
                "COHORT_CAPACITY_RECOMPUTE_INVALID",
                f"{label}:{cohort_index}",
            )
            capacities.append(recomputed_capacity)
        declared = raw_cohort.get("net_usd_by_scenario")
        if not isinstance(declared, dict):
            report.fail("COHORT_NET_MAP_INVALID", f"{label}:{cohort_index}")
        else:
            for scenario in SCENARIOS:
                report.numeric(
                    declared.get(scenario),
                    cohort_sums[scenario],
                    "COHORT_NET_INVALID",
                    f"{label}:{cohort_index}:{scenario}",
                )
        if 0 <= exit_day < days:
            for scenario in SCENARIOS:
                daily[scenario][exit_day] += cohort_sums[scenario]
        month_stress[month_key] = month_stress.get(month_key, Decimal(0)) + cohort_sums["stress"]

    cash_counts = {"ZERO_SIGNAL": 0, "COOLDOWN": 0, "OVERLAP": 0}
    noncash_decisions = 0
    prior_decision = -1
    for ordinal, raw in enumerate(decisions):
        if not isinstance(raw, dict):
            report.fail("EVIDENCE_DECISION_NOT_OBJECT", f"{label}:{ordinal}")
            continue
        decision_ms = as_int(raw.get("decision_ms"))
        state = raw.get("state")
        report.check(decision_ms is not None and decision_ms > prior_decision, "DECISIONS_NOT_SORTED")
        if decision_ms is not None:
            prior_decision = decision_ms
        report.check(state in ("NONCASH", "CASH"), "DECISION_STATE_INVALID", f"{label}:{ordinal}")
        if state == "NONCASH":
            noncash_decisions += 1
            report.equal(raw.get("cash_reason"), None, "NONCASH_HAS_REASON")
        elif state == "CASH":
            reason = raw.get("cash_reason")
            report.check(reason in cash_counts, "CASH_REASON_INVALID", repr(reason))
            if reason in cash_counts:
                cash_counts[str(reason)] += 1
    report.equal(noncash_decisions, len(cohorts), "NONCASH_DECISION_COHORT_COUNT_DRIFT")

    entries_by_hour: dict[int, list[dict[str, Any]]] = {}
    exits_by_hour: dict[int, list[dict[str, Any]]] = {}
    funding_by_hour: dict[int, Decimal] = {}
    for member in severe_members:
        entries_by_hour.setdefault(int(member["entry_ms"]), []).append(member)
        exits_by_hour.setdefault(int(member["exit_ms"]), []).append(member)
        for booking_hour, amount in member["funding"]:
            funding_by_hour[booking_hour] = (
                funding_by_hour.get(booking_hour, Decimal(0)) + amount
            )
    report.check(
        not (set(entries_by_hour) & set(exits_by_hour)),
        "EQUITY_SAME_HOUR_EXIT_AND_ENTRY",
        label,
    )
    realized_price = Decimal(0)
    booked_funding = Decimal(0)
    adverse = Decimal(0)
    fee = Decimal(0)
    open_members: dict[tuple[int, str], dict[str, Any]] = {}
    drawdown = Decimal(0)
    peak = CAPITAL
    expected_hours = (end_ms - start_ms) // HOUR_MS + 1
    report.equal(len(equity), expected_hours, "EQUITY_GRID_LENGTH_INVALID", label)
    for index, raw in enumerate(equity):
        if not isinstance(raw, dict):
            report.fail("EQUITY_ROW_NOT_OBJECT", f"{label}:{index}")
            continue
        timestamp = as_int(raw.get("timestamp_ms"))
        report.equal(timestamp, start_ms + index * HOUR_MS, "EQUITY_GRID_TIMESTAMP_INVALID", label)
        if timestamp is None:
            continue
        booked_funding += funding_by_hour.get(timestamp, Decimal(0))
        for member in exits_by_hour.get(timestamp, ()):
            key = (int(member["entry_ms"]), str(member["symbol"]))
            report.check(key in open_members, "EQUITY_EXIT_NOT_OPEN", f"{label}:{key}")
            open_members.pop(key, None)
            realized_price += member["realized_price"]
            adverse += member["adverse_exit"]
            fee += member["fee_exit"]
        for member in entries_by_hour.get(timestamp, ()):
            key = (int(member["entry_ms"]), str(member["symbol"]))
            report.check(key not in open_members, "EQUITY_DUPLICATE_OPEN", f"{label}:{key}")
            open_members[key] = member
            adverse += member["adverse_entry"]
            fee += member["fee_entry"]

        marks = raw.get("open_member_marks")
        if not report.check(
            isinstance(marks, list),
            "EQUITY_OPEN_MARK_LEDGER_INVALID",
            f"{label}:{index}",
        ):
            marks = []
        mark_by_key: dict[tuple[int, str], Decimal] = {}
        observed_mark_order: list[tuple[int, str]] = []
        for raw_mark in marks:
            if not isinstance(raw_mark, dict):
                report.fail("EQUITY_OPEN_MARK_NOT_OBJECT", f"{label}:{index}")
                continue
            entry_value = as_int(raw_mark.get("cohort_entry_ms"))
            symbol_value = raw_mark.get("symbol")
            mark_price = as_decimal(raw_mark.get("mark_price"))
            if (
                entry_value is None
                or not isinstance(symbol_value, str)
                or mark_price is None
                or mark_price <= 0
            ):
                report.fail("EQUITY_OPEN_MARK_FIELD_INVALID", f"{label}:{index}")
                continue
            key = (entry_value, symbol_value)
            report.check(key not in mark_by_key, "EQUITY_OPEN_MARK_DUPLICATE", f"{label}:{key}")
            mark_by_key[key] = mark_price
            observed_mark_order.append(key)
        report.equal(
            observed_mark_order,
            sorted(observed_mark_order),
            "EQUITY_OPEN_MARKS_NOT_SORTED",
            f"{label}:{index}",
        )
        report.equal(
            set(mark_by_key),
            set(open_members),
            "EQUITY_OPEN_MARK_SET_INVALID",
            f"{label}:{index}",
        )
        open_unrealized = Decimal(0)
        for key, member in open_members.items():
            mark_price = mark_by_key.get(key)
            if mark_price is None:
                continue
            open_unrealized += (
                Decimal(int(member["side"]))
                * member["quantity"]
                * (mark_price - member["entry_price"])
            )
        expected_equity = (
            CAPITAL
            + realized_price
            + booked_funding
            + adverse
            + fee
            + open_unrealized
        )
        for field_name, expected in (
            ("realized_mark_price_pnl_usd", realized_price),
            ("booked_funding_usd", booked_funding),
            ("adverse_attribution_usd", adverse),
            ("fee_usd", fee),
            ("open_unrealized_mark_price_pnl_usd", open_unrealized),
            ("equity_usd", expected_equity),
        ):
            report.numeric(
                raw.get(field_name),
                expected,
                "EQUITY_COMPONENT_RECOMPUTE_INVALID",
                f"{label}:{index}:{field_name}",
            )
        peak = max(peak, expected_equity)
        drawdown = max(drawdown, (peak - expected_equity) / CAPITAL)
    report.check(not open_members, "EQUITY_POSITION_OPEN_AT_END", label)

    total_stress = attribution["stress"]["net_usd"]
    best_month_key = (
        min(month_stress, key=lambda key: (-month_stress[key], key))
        if month_stress
        else None
    )
    best_symbol_key = (
        min(symbol_stress, key=lambda key: (-symbol_stress[key], key))
        if symbol_stress
        else None
    )
    best_month = month_stress[best_month_key] if best_month_key is not None else Decimal(0)
    best_symbol = symbol_stress[best_symbol_key] if best_symbol_key is not None else Decimal(0)
    capacities.sort()
    cap_min = capacities[0] if capacities else None
    cap_p05 = (
        capacities[max(0, int((Decimal("0.05") * len(capacities)).to_integral_value(rounding=ROUND_CEILING)) - 1)]
        if capacities
        else None
    )
    activity = {
        "active_cohorts": len(cohorts),
        "active_weeks": len(weeks),
        "candidate_decision_hours": len(decisions),
        "cash_decision_hours": sum(cash_counts.values()),
        "cooldown_cash_hours": cash_counts["COOLDOWN"],
        "distinct_traded_symbols": len(symbols),
        "overlap_cash_hours": cash_counts["OVERLAP"],
        "traded_members": traded_members,
        "zero_signal_cash_hours": cash_counts["ZERO_SIGNAL"],
    }
    quantized_daily = {
        scenario: tuple(
            value.quantize(Decimal("0.000000000001"), rounding=ROUND_HALF_EVEN)
            for value in values
        )
        for scenario, values in daily.items()
    }
    return LedgerMetrics(
        daily=quantized_daily,
        attribution=attribution,
        activity=activity,
        capacity_minimum=cap_min,
        capacity_p05=cap_p05,
        best_stress_month=best_month_key,
        best_stress_month_contribution=(
            month_stress[best_month_key] if best_month_key is not None else None
        ),
        best_stress_symbol=best_symbol_key,
        best_stress_symbol_contribution=(
            symbol_stress[best_symbol_key] if best_symbol_key is not None else None
        ),
        remove_best_month_stress=total_stress - best_month,
        remove_best_symbol_stress=total_stress - best_symbol,
        severe_drawdown=drawdown,
    )


def _compare_metric_summary(
    report: Report,
    label: str,
    summary: Mapping[str, Any],
    metrics: LedgerMetrics,
    bootstrap: Mapping[str, BootstrapStats],
    holdout: bool,
) -> None:
    nets = summary.get("net_usd_per_1000_by_scenario")
    if not report.check(isinstance(nets, dict), "SUMMARY_NET_MAP_INVALID", label):
        nets = {}
    report.equal(
        tuple(sorted(nets)),
        SORTED_SCENARIOS,
        "SUMMARY_NET_SCENARIO_SET_INVALID",
        label,
    )
    for scenario in SCENARIOS:
        report.numeric(
            nets.get(scenario) if isinstance(nets, dict) else None,
            sum(metrics.daily[scenario], Decimal(0)),
            "SUMMARY_NET_RECOMPUTE_INVALID",
            f"{label}:{scenario}",
        )

    declared_attr = summary.get("attribution")
    if not report.check(isinstance(declared_attr, dict), "SUMMARY_ATTRIBUTION_INVALID", label):
        declared_attr = {}
    report.equal(
        tuple(sorted(declared_attr)),
        SORTED_SCENARIOS,
        "SUMMARY_ATTRIBUTION_SCENARIO_SET_INVALID",
        label,
    )
    for scenario in SCENARIOS:
        row = declared_attr.get(scenario) if isinstance(declared_attr, dict) else None
        if not isinstance(row, dict):
            report.fail("SUMMARY_ATTRIBUTION_ROW_INVALID", f"{label}:{scenario}")
            continue
        report.equal(
            tuple(sorted(row)),
            (
                "adverse_attribution_usd",
                "fee_usd",
                "funding_usd",
                "mark_price_pnl_usd",
                "net_usd",
            ),
            "SUMMARY_ATTRIBUTION_FIELD_SET_INVALID",
            f"{label}:{scenario}",
        )
        for field_name, expected in metrics.attribution[scenario].items():
            report.numeric(
                row.get(field_name),
                expected,
                "SUMMARY_ATTRIBUTION_RECOMPUTE_INVALID",
                f"{label}:{scenario}:{field_name}",
            )

    activity_block = summary.get("activity_counters")
    for field_name, expected in metrics.activity.items():
        observed = (
            activity_block.get(field_name)
            if isinstance(activity_block, dict)
            else summary.get(field_name)
        )
        report.equal(observed, expected, "SUMMARY_ACTIVITY_RECOMPUTE_INVALID", f"{label}:{field_name}")

    capacity = summary.get("public_capacity_proxy_usd")
    if not report.check(isinstance(capacity, dict), "SUMMARY_CAPACITY_INVALID", label):
        capacity = {}
    report.equal(
        tuple(sorted(capacity)),
        ("label", "minimum", "p05", "population", "unit_disclosure"),
        "SUMMARY_CAPACITY_FIELD_SET_INVALID",
        label,
    )
    if metrics.capacity_minimum is None:
        report.equal(capacity.get("minimum"), "UNMEASURED", "CAPACITY_MINIMUM_NOT_UNMEASURED", label)
        report.equal(capacity.get("p05"), "UNMEASURED", "CAPACITY_P05_NOT_UNMEASURED", label)
    else:
        report.numeric(
            capacity.get("minimum"),
            metrics.capacity_minimum,
            "CAPACITY_MINIMUM_RECOMPUTE_INVALID",
            label,
        )
        report.numeric(
            capacity.get("p05"),
            metrics.capacity_p05,
            "CAPACITY_P05_RECOMPUTE_INVALID",
            label,
        )
    report.equal(
        capacity.get("label"),
        "PUBLIC_COARSE_PRIOR_VOLUME_PARTICIPATION_PROXY",
        "CAPACITY_LABEL_INVALID",
        label,
    )
    report.equal(
        capacity.get("population"),
        metrics.activity["active_cohorts"],
        "CAPACITY_POPULATION_INVALID",
        label,
    )
    report.equal(
        capacity.get("unit_disclosure"),
        "nominal 1 USDT = 1 USD proxy; USDT/USD basis unmeasured",
        "CAPACITY_UNIT_DISCLOSURE_INVALID",
        label,
    )
    report.numeric(
        summary.get("remove_best_month_stress_net_usd_per_1000"),
        metrics.remove_best_month_stress,
        "REMOVE_BEST_MONTH_RECOMPUTE_INVALID",
        label,
    )
    report.equal(
        summary.get("best_stress_month"),
        metrics.best_stress_month,
        "BEST_STRESS_MONTH_RECOMPUTE_INVALID",
        label,
    )
    if metrics.best_stress_month_contribution is None:
        report.equal(
            summary.get("best_stress_month_contribution"),
            None,
            "BEST_STRESS_MONTH_CONTRIBUTION_INVALID",
            label,
        )
    else:
        report.numeric(
            summary.get("best_stress_month_contribution"),
            metrics.best_stress_month_contribution,
            "BEST_STRESS_MONTH_CONTRIBUTION_INVALID",
            label,
        )
    report.equal(
        summary.get("best_stress_symbol"),
        metrics.best_stress_symbol,
        "BEST_STRESS_SYMBOL_RECOMPUTE_INVALID",
        label,
    )
    if metrics.best_stress_symbol_contribution is None:
        report.equal(
            summary.get("best_stress_symbol_contribution"),
            None,
            "BEST_STRESS_SYMBOL_CONTRIBUTION_INVALID",
            label,
        )
    else:
        report.numeric(
            summary.get("best_stress_symbol_contribution"),
            metrics.best_stress_symbol_contribution,
            "BEST_STRESS_SYMBOL_CONTRIBUTION_INVALID",
            label,
        )
    report.numeric(
        summary.get("remove_best_symbol_stress_net_usd_per_1000"),
        metrics.remove_best_symbol_stress,
        "REMOVE_BEST_SYMBOL_RECOMPUTE_INVALID",
        label,
    )
    report.numeric(
        summary.get("severe_hourly_marked_equity_max_drawdown"),
        metrics.severe_drawdown,
        "DRAWDOWN_RECOMPUTE_INVALID",
        label,
    )

    interval_field = "bootstrap_intervals" if holdout else "bootstrap_interval_usd_per_1000"
    intervals = summary.get(interval_field)
    if not report.check(isinstance(intervals, dict), "SUMMARY_INTERVALS_INVALID", label):
        intervals = {}
    report.equal(
        tuple(sorted(intervals)),
        SORTED_SCENARIOS,
        "SUMMARY_INTERVAL_SCENARIO_SET_INVALID",
        label,
    )
    for scenario in SCENARIOS:
        pair = intervals.get(scenario) if isinstance(intervals, dict) else None
        if not isinstance(pair, list) or len(pair) != 2:
            report.fail("SUMMARY_INTERVAL_PAIR_INVALID", f"{label}:{scenario}")
        else:
            report.numeric(
                pair[0],
                bootstrap[scenario].interval[0],
                "BOOTSTRAP_LOWER_RECOMPUTE_INVALID",
                f"{label}:{scenario}",
            )
            report.numeric(
                pair[1],
                bootstrap[scenario].interval[1],
                "BOOTSTRAP_UPPER_RECOMPUTE_INVALID",
                f"{label}:{scenario}",
            )
    if holdout:
        pointwise = summary.get("pointwise_lcb")
        if not report.check(isinstance(pointwise, dict), "HOLDOUT_POINTWISE_LCB_INVALID", label):
            pointwise = {}
        report.equal(
            tuple(sorted(pointwise)),
            SORTED_SCENARIOS,
            "HOLDOUT_POINTWISE_SCENARIO_SET_INVALID",
            label,
        )
        for scenario in SCENARIOS:
            report.numeric(
                pointwise.get(scenario) if isinstance(pointwise, dict) else None,
                bootstrap[scenario].lower_one_sided,
                "HOLDOUT_POINTWISE_LCB_RECOMPUTE_INVALID",
                f"{label}:{scenario}",
            )
    else:
        for scenario in ("base", "stress"):
            report.numeric(
                summary.get(f"{scenario}_bonferroni_lcb"),
                bootstrap[scenario].bonferroni_lower,
                "BONFERRONI_LCB_RECOMPUTE_INVALID",
                f"{label}:{scenario}",
            )
            report.numeric(
                _value_first(
                    summary,
                    f"{scenario}_centered_one_sided_p",
                    f"{scenario}_p_value",
                ),
                bootstrap[scenario].centered_p,
                "CENTERED_P_RECOMPUTE_INVALID",
                f"{label}:{scenario}",
            )


def _extract_trial_evidence(
    report: Report, development: Mapping[str, Any]
) -> Mapping[str, Mapping[str, Any]]:
    basis = development.get("verification_evidence")
    if not report.check(isinstance(basis, dict), "DEVELOPMENT_VERIFICATION_EVIDENCE_MISSING"):
        return {}
    assert isinstance(basis, dict)
    trials = basis.get("trials")
    if not report.check(isinstance(trials, dict), "DEVELOPMENT_EVIDENCE_TRIALS_INVALID"):
        return {}
    assert isinstance(trials, dict)
    return {
        str(key): value
        for key, value in trials.items()
        if isinstance(value, dict)
    }


def _trial_summary_map(
    report: Report, development: Mapping[str, Any]
) -> Mapping[str, Mapping[str, Any]]:
    rows = development.get("trials")
    if not report.check(isinstance(rows, list), "DEVELOPMENT_TRIALS_INVALID"):
        return {}
    assert isinstance(rows, list)
    mapped: dict[str, Mapping[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            report.fail("DEVELOPMENT_TRIAL_NOT_OBJECT")
            continue
        trial_id = str(row.get("trial_id"))
        report.check(trial_id not in mapped, "DEVELOPMENT_TRIAL_DUPLICATE", trial_id)
        mapped[trial_id] = row
    return mapped


def _check_evidence_candidates(
    report: Report,
    packet: Packet,
    trial_id: str,
    rows: Sequence[Any],
    start_ms: int,
    end_ms: int,
) -> None:
    trial = next(
        (
            row
            for row in packet.statics.ledger.get("trials", ())
            if isinstance(row, dict) and row.get("trial_id") == trial_id
        ),
        None,
    )
    if not isinstance(trial, dict):
        report.fail("EVIDENCE_CANDIDATE_TRIAL_MISSING", trial_id)
        return
    lag = as_int(trial.get("entry_lag_hours"))
    hold = as_int(trial.get("hold_hours"))
    confirmation_rows = as_int(trial.get("confirmation_rows"))
    if lag is None or hold is None or confirmation_rows is None:
        report.fail("EVIDENCE_CANDIDATE_TRIAL_INVALID", trial_id)
        return
    observed_order: list[tuple[int, str]] = []
    for ordinal, raw in enumerate(rows):
        if not isinstance(raw, dict):
            report.fail("EVIDENCE_CANDIDATE_NOT_OBJECT", f"{trial_id}:{ordinal}")
            continue
        symbol = raw.get("symbol")
        report.equal(raw.get("trial_id"), trial_id, "EVIDENCE_CANDIDATE_TRIAL_DRIFT", str(ordinal))
        report.equal(
            raw.get("confirmation_rows"),
            confirmation_rows,
            "EVIDENCE_CANDIDATE_CONFIRMATION_INVALID",
            str(ordinal),
        )
        interval = as_int(raw.get("new_interval_hours"))
        rate = as_decimal(raw.get("signal_rate"))
        normalized = as_decimal(raw.get("signal_normalized_rate_8h"))
        side = as_int(raw.get("contrarian_side"))
        report.check(interval in (1, 4), "EVIDENCE_CANDIDATE_INTERVAL_INVALID", str(ordinal))
        if interval in (1, 4) and rate is not None and normalized is not None:
            report.numeric(
                normalized,
                rate * Decimal(8) / Decimal(interval),
                "EVIDENCE_CANDIDATE_NORMALIZATION_INVALID",
                str(ordinal),
            )
            report.equal(
                side,
                0 if rate == 0 else (-1 if rate > 0 else 1),
                "EVIDENCE_CANDIDATE_SIDE_INVALID",
                str(ordinal),
            )
        else:
            report.fail("EVIDENCE_CANDIDATE_SIGNAL_INVALID", str(ordinal))
        final_ms = iso_to_ms(raw.get("final_confirmation_calc_time"))
        decision_ms = iso_to_ms(raw.get("decision_hour"))
        entry_ms = iso_to_ms(raw.get("entry_hour"))
        exit_ms = iso_to_ms(raw.get("exit_hour"))
        baseline_ms = iso_to_ms(raw.get("baseline_start"))
        event_ms = iso_to_ms(raw.get("event_calc_time"))
        if None in (final_ms, decision_ms, entry_ms, exit_ms, baseline_ms, event_ms):
            report.fail("EVIDENCE_CANDIDATE_TIMESTAMP_INVALID", str(ordinal))
            continue
        assert final_ms is not None and decision_ms is not None
        assert entry_ms is not None and exit_ms is not None
        assert baseline_ms is not None and event_ms is not None
        expected_decision = (
            (final_ms + lag * HOUR_MS + HOUR_MS - 1) // HOUR_MS
        ) * HOUR_MS
        report.equal(decision_ms, expected_decision, "EVIDENCE_CANDIDATE_DECISION_INVALID", str(ordinal))
        report.equal(entry_ms, decision_ms, "EVIDENCE_CANDIDATE_ENTRY_INVALID", str(ordinal))
        report.equal(exit_ms, entry_ms + hold * HOUR_MS, "EVIDENCE_CANDIDATE_EXIT_INVALID", str(ordinal))
        report.check(
            start_ms <= baseline_ms <= event_ms <= final_ms
            and entry_ms - 168 * HOUR_MS >= start_ms
            and exit_ms <= end_ms,
            "EVIDENCE_CANDIDATE_HORIZON_INVALID",
            str(ordinal),
        )
        report.check(
            isinstance(symbol, str)
            and re.fullmatch(r"[A-Z0-9]+USDT", symbol) is not None,
            "EVIDENCE_CANDIDATE_SYMBOL_INVALID",
            str(ordinal),
        )
        report.check(
            not [
                field_name
                for field_name in raw
                if OUTCOME_WORD_RE.search(field_name) is not None
            ],
            "EVIDENCE_CANDIDATE_OUTCOME_FIELD",
            str(ordinal),
        )
        observed_order.append((decision_ms, str(symbol)))
    report.equal(
        observed_order,
        sorted(set(observed_order)),
        "EVIDENCE_CANDIDATES_NOT_SORTED_UNIQUE",
        trial_id,
    )


def _check_development_schedule(
    report: Report,
    packet: Packet,
    trial_id: str,
    evidence: Mapping[str, Any],
    candidate_rows: Sequence[Any] | None = None,
) -> None:
    """Re-run complete-cohort-or-cash scheduling from the sealed event universe."""

    universe = packet.get("event_universe.v1.json") or {}
    raw_candidates: Any = (
        candidate_rows if candidate_rows is not None else universe.get("candidates")
    )
    decisions = evidence.get("decisions")
    cohorts = evidence.get("cohorts")
    if not isinstance(raw_candidates, list):
        report.fail("SCHEDULE_EVENT_UNIVERSE_MISSING", trial_id)
        return
    if not isinstance(decisions, list) or not isinstance(cohorts, list):
        report.fail("SCHEDULE_EVIDENCE_MISSING", trial_id)
        return
    grouped: dict[int, list[Mapping[str, Any]]] = {}
    for raw in raw_candidates:
        if not isinstance(raw, dict) or raw.get("trial_id") != trial_id:
            continue
        decision_ms = iso_to_ms(raw.get("decision_hour"))
        if decision_ms is None:
            continue
        grouped.setdefault(decision_ms, []).append(raw)
    ordered_hours = sorted(grouped)
    report.equal(len(decisions), len(ordered_hours), "SCHEDULE_DECISION_COUNT_INVALID", trial_id)
    trial = next(
        (
            row
            for row in packet.statics.ledger.get("trials", ())
            if isinstance(row, dict) and row.get("trial_id") == trial_id
        ),
        None,
    )
    if not isinstance(trial, dict):
        report.fail("SCHEDULE_TRIAL_PARAMETERS_MISSING", trial_id)
        return
    hold_hours = as_int(trial.get("hold_hours"))
    cooldown_days = as_int(packet.statics.section("event").get("cooldown_days_per_symbol"))
    if hold_hours is None or cooldown_days is None:
        report.fail("SCHEDULE_STATIC_PARAMETERS_INVALID", trial_id)
        return
    cooldown_ms = cooldown_days * DAY_MS
    cohort_by_entry: dict[int, Mapping[str, Any]] = {}
    for raw in cohorts:
        if not isinstance(raw, dict):
            continue
        entry_ms = as_int(raw.get("entry_ms"))
        if entry_ms is None:
            continue
        report.check(entry_ms not in cohort_by_entry, "SCHEDULE_COHORT_DUPLICATE", f"{trial_id}:{entry_ms}")
        cohort_by_entry[entry_ms] = raw

    blocking_exit = -1
    last_accepted_final: dict[str, int] = {}
    accepted_hours: set[int] = set()
    for ordinal, decision_ms in enumerate(ordered_hours):
        candidates = sorted(grouped[decision_ms], key=lambda row: str(row.get("symbol")))
        symbols = [str(row.get("symbol")) for row in candidates]
        report.equal(symbols, sorted(set(symbols)), "SCHEDULE_CANDIDATE_SYMBOLS_INVALID", f"{trial_id}:{decision_ms}")
        sides = [as_int(row.get("contrarian_side")) for row in candidates]
        final_times = [iso_to_ms(row.get("final_confirmation_calc_time")) for row in candidates]
        if any(value is None for value in sides) or any(value is None for value in final_times):
            report.fail("SCHEDULE_CANDIDATE_FIELD_INVALID", f"{trial_id}:{decision_ms}")
            continue
        reason: str | None = None
        if any(value == 0 for value in sides):
            reason = "ZERO_SIGNAL"
        elif any(
            symbol in last_accepted_final
            and int(final_time) - last_accepted_final[symbol] < cooldown_ms
            for symbol, final_time in zip(symbols, final_times, strict=True)
        ):
            reason = "COOLDOWN"
        elif decision_ms <= blocking_exit:
            reason = "OVERLAP"
        expected_state = "CASH" if reason is not None else "NONCASH"
        decision = decisions[ordinal] if ordinal < len(decisions) else None
        if not isinstance(decision, dict):
            report.fail("SCHEDULE_DECISION_ROW_INVALID", f"{trial_id}:{ordinal}")
            continue
        report.equal(decision.get("decision_ms"), decision_ms, "SCHEDULE_DECISION_TIME_INVALID", trial_id)
        report.equal(decision.get("candidate_symbols"), symbols, "SCHEDULE_DECISION_SYMBOLS_INVALID", f"{trial_id}:{decision_ms}")
        report.equal(decision.get("state"), expected_state, "SCHEDULE_DECISION_STATE_INVALID", f"{trial_id}:{decision_ms}")
        report.equal(decision.get("cash_reason"), reason, "SCHEDULE_CASH_REASON_INVALID", f"{trial_id}:{decision_ms}")
        cohort = cohort_by_entry.get(decision_ms)
        if reason is not None:
            report.equal(cohort, None, "SCHEDULE_CASH_HAS_COHORT", f"{trial_id}:{decision_ms}")
            continue
        if not report.check(isinstance(cohort, dict), "SCHEDULE_NONCASH_COHORT_MISSING", f"{trial_id}:{decision_ms}"):
            continue
        assert isinstance(cohort, dict)
        accepted_hours.add(decision_ms)
        report.equal(cohort.get("decision_ms"), decision_ms, "SCHEDULE_COHORT_DECISION_INVALID", f"{trial_id}:{decision_ms}")
        report.equal(cohort.get("exit_ms"), decision_ms + hold_hours * HOUR_MS, "SCHEDULE_COHORT_EXIT_INVALID", f"{trial_id}:{decision_ms}")
        members = cohort.get("members")
        if isinstance(members, list):
            observed = [
                (str(member.get("symbol")), as_int(member.get("side_sign")))
                for member in members
                if isinstance(member, dict)
            ]
            expected = list(zip(symbols, sides, strict=True))
            report.equal(observed, expected, "SCHEDULE_COHORT_MEMBERS_INVALID", f"{trial_id}:{decision_ms}")
        else:
            report.fail("SCHEDULE_COHORT_MEMBERS_MISSING", f"{trial_id}:{decision_ms}")
        blocking_exit = decision_ms + hold_hours * HOUR_MS
        for symbol, final_time in zip(symbols, final_times, strict=True):
            last_accepted_final[symbol] = int(final_time)
    report.equal(
        set(cohort_by_entry),
        accepted_hours,
        "SCHEDULE_EXTRA_OR_MISSING_COHORT",
        trial_id,
    )


def check_development_economics(report: Report, packet: Packet) -> Mapping[str, Any]:
    """Recompute every development claim from the sealed verification ledger."""

    with report.stage("development_economics"):
        development = packet.get("development.v1.json")
        if development is None:
            return {}
        summaries = _trial_summary_map(report, development)
        evidence = _extract_trial_evidence(report, development)
        trial_ids = tuple(row["trial_id"] for row in packet.statics.ledger.get("trials", ()))
        report.equal(tuple(sorted(summaries)), tuple(sorted(trial_ids)), "DEVELOPMENT_TRIAL_SET_DRIFT")
        report.equal(tuple(sorted(evidence)), tuple(sorted(trial_ids)), "EVIDENCE_TRIAL_SET_DRIFT")
        indices = _bootstrap_indices("development", _partition_day_count(
            iso_to_ms(packet.statics.section("window").get("development_start")) or 0,
            iso_to_ms(packet.statics.section("window").get("development_end")) or 0,
        ))
        start_ms = iso_to_ms(packet.statics.section("window").get("development_start"))
        end_ms = iso_to_ms(packet.statics.section("window").get("development_end"))
        if start_ms is None or end_ms is None:
            report.fail("DEVELOPMENT_WINDOW_INVALID")
            return {}
        daily_all: dict[str, Mapping[str, Sequence[Decimal]]] = {}
        bootstrap_all: dict[str, dict[str, BootstrapStats]] = {}
        metrics_all: dict[str, LedgerMetrics] = {}
        for trial_id in trial_ids:
            summary = summaries.get(trial_id)
            basis = evidence.get(trial_id)
            if summary is None or basis is None:
                continue
            _check_development_schedule(report, packet, trial_id, basis)
            metrics = _ledger_metrics(
                report, packet, f"development:{trial_id}", basis, start_ms, end_ms
            )
            if metrics is None:
                continue
            declared_daily = basis.get("daily_net_usd_per_1000_by_scenario")
            if not report.check(
                isinstance(declared_daily, dict),
                "EVIDENCE_DAILY_MAP_INVALID",
                trial_id,
            ):
                continue
            for scenario in SCENARIOS:
                parsed = _decimal_series(
                    report,
                    declared_daily.get(scenario),
                    len(metrics.daily[scenario]),
                    "EVIDENCE_DAILY_SERIES_INVALID",
                    f"{trial_id}:{scenario}",
                )
                report.equal(
                    parsed,
                    metrics.daily[scenario],
                    "EVIDENCE_DAILY_NOT_LEDGER_DERIVED",
                    f"{trial_id}:{scenario}",
                )
            stats = {
                scenario: _bootstrap_stats(metrics.daily[scenario], indices)
                for scenario in SCENARIOS
            }
            _compare_metric_summary(report, trial_id, summary, metrics, stats, False)
            daily_all[trial_id] = metrics.daily
            bootstrap_all[trial_id] = stats
            metrics_all[trial_id] = metrics

        if set(daily_all) != set(trial_ids):
            return {}
        white = {
            scenario: _white_p(daily_all, scenario, indices)
            for scenario in ("base", "stress")
        }
        declared_white = development.get("white_reality_check_p_by_scenario")
        if not report.check(isinstance(declared_white, dict), "WHITE_RESULT_INVALID"):
            declared_white = {}
        for scenario, expected in white.items():
            report.numeric(
                declared_white.get(scenario) if isinstance(declared_white, dict) else None,
                expected,
                "WHITE_RECOMPUTE_INVALID",
                scenario,
            )
        pbo_value, splits = _pbo(daily_all)
        pbo_block = development.get("pbo")
        if not report.check(isinstance(pbo_block, dict), "PBO_RESULT_INVALID"):
            pbo_block = {}
        report.numeric(
            pbo_block.get("pbo") if isinstance(pbo_block, dict) else None,
            pbo_value,
            "PBO_RECOMPUTE_INVALID",
        )
        report.equal(
            pbo_block.get("splits") if isinstance(pbo_block, dict) else None,
            splits,
            "PBO_SPLIT_COUNT_INVALID",
        )

        raw_p = {
            trial_id: max(
                bootstrap_all[trial_id]["base"].centered_p,
                bootstrap_all[trial_id]["stress"].centered_p,
            )
            for trial_id in trial_ids
        }
        holm = holm_adjusted(raw_p)
        thresholds = _thresholds(packet.statics.section("development_gates"))
        eligible: list[Mapping[str, Any]] = []
        for trial_id in trial_ids:
            summary = summaries[trial_id]
            report.numeric(
                summary.get("holm_adjusted_p"),
                holm[trial_id],
                "HOLM_RECOMPUTE_INVALID",
                trial_id,
            )
            recomputed = recompute_development_gates(
                summary, white, {"pbo": pbo_value}, thresholds
            )
            report.equal(
                summary.get("development_gates"),
                recomputed,
                "DEVELOPMENT_GATES_RECOMPUTE_INVALID",
                trial_id,
            )
            report.equal(
                summary.get("passes_all_development_gates"),
                all(recomputed.values()),
                "DEVELOPMENT_PASS_FLAG_INVALID",
                trial_id,
            )
            if all(recomputed.values()):
                eligible.append(summary)
        champion = min(eligible, key=selection_key, default=None)
        champion_id = str(champion.get("trial_id")) if champion is not None else None
        report.equal(
            development.get("champion_trial_id"),
            champion_id,
            "DEVELOPMENT_CHAMPION_RECOMPUTE_INVALID",
        )
        report.equal(
            development.get("admitted_to_holdout"),
            champion_id is not None,
            "DEVELOPMENT_ADMISSION_RECOMPUTE_INVALID",
        )
        fallback = min(summaries.values(), key=selection_key)
        reported = champion_id or str(fallback.get("trial_id"))
        report.equal(
            development.get("reported_trial_id"),
            reported,
            "DEVELOPMENT_REPORTED_TRIAL_INVALID",
        )
        return {
            "summaries": summaries,
            "metrics": metrics_all,
            "bootstrap": bootstrap_all,
            "white": white,
            "pbo": pbo_value,
            "holm": holm,
            "champion": champion_id,
            "reported": reported,
        }


def check_holdout_economics(
    report: Report, packet: Packet, development_recomputed: Mapping[str, Any]
) -> Mapping[str, Any]:
    with report.stage("holdout_economics"):
        holdout = packet.get("holdout.v1.json")
        if holdout is None:
            return {}
        champion = development_recomputed.get("champion")
        report.equal(holdout.get("champion_trial_id"), champion, "HOLDOUT_CHAMPION_INVALID")
        report.check(holdout.get("reselection") is False, "HOLDOUT_RESELECTION_ALLOWED")
        evidence = holdout.get("verification_evidence")
        summary = holdout.get("summary")
        if not report.check(isinstance(evidence, dict), "HOLDOUT_EVIDENCE_MISSING"):
            return {}
        if not report.check(isinstance(summary, dict), "HOLDOUT_SUMMARY_INVALID"):
            return {}
        assert isinstance(evidence, dict) and isinstance(summary, dict)
        start_ms = iso_to_ms(packet.statics.section("window").get("holdout_start"))
        end_ms = iso_to_ms(packet.statics.section("window").get("holdout_end"))
        if start_ms is None or end_ms is None:
            report.fail("HOLDOUT_WINDOW_INVALID")
            return {}
        candidate_rows = evidence.get("candidates")
        if not report.check(
            isinstance(candidate_rows, list),
            "HOLDOUT_EVIDENCE_CANDIDATES_INVALID",
        ):
            return {}
        assert isinstance(candidate_rows, list)
        if not isinstance(champion, str):
            report.fail("HOLDOUT_RECOMPUTED_CHAMPION_MISSING")
            return {}
        _check_evidence_candidates(
            report,
            packet,
            champion,
            candidate_rows,
            start_ms,
            end_ms,
        )
        _check_development_schedule(
            report,
            packet,
            champion,
            evidence,
            candidate_rows,
        )
        metrics = _ledger_metrics(report, packet, "holdout", evidence, start_ms, end_ms)
        if metrics is None:
            return {}
        declared_daily = evidence.get("daily_net_usd_per_1000_by_scenario")
        if not report.check(isinstance(declared_daily, dict), "HOLDOUT_DAILY_MAP_INVALID"):
            return {}
        for scenario in SCENARIOS:
            parsed = _decimal_series(
                report,
                declared_daily.get(scenario),
                len(metrics.daily[scenario]),
                "HOLDOUT_DAILY_SERIES_INVALID",
                scenario,
            )
            report.equal(parsed, metrics.daily[scenario], "HOLDOUT_DAILY_NOT_LEDGER_DERIVED", scenario)
        indices = _bootstrap_indices("holdout", len(metrics.daily["base"]))
        bootstrap = {
            scenario: _bootstrap_stats(metrics.daily[scenario], indices)
            for scenario in SCENARIOS
        }
        _compare_metric_summary(report, "holdout", summary, metrics, bootstrap, True)
        thresholds = _thresholds(packet.statics.section("holdout_gates_if_opened"))
        recomputed_gates = recompute_holdout_gates(summary, thresholds)
        report.equal(
            holdout.get("gates"),
            recomputed_gates,
            "HOLDOUT_GATES_RECOMPUTE_INVALID",
        )
        all_pass = all(recomputed_gates.values())
        report.equal(holdout.get("all_gates_pass"), all_pass, "HOLDOUT_PASS_FLAG_INVALID")
        return {"metrics": metrics, "bootstrap": bootstrap, "all_pass": all_pass}


def check_result_against_recomputation(
    report: Report,
    packet: Packet,
    development: Mapping[str, Any],
    holdout: Mapping[str, Any],
) -> None:
    with report.stage("result_semantics"):
        result = packet.get("result.v1.json")
        if result is None:
            return
        required = packet.statics.section("result_contract").get("required_fields")
        if report.check(isinstance(required, list), "RESULT_REQUIRED_FIELDS_CONTRACT_INVALID"):
            assert isinstance(required, list)
            missing = [str(name) for name in required if name not in result]
            report.check(not missing, "RESULT_REQUIRED_FIELD_MISSING", ",".join(missing))
        verdict = result.get("verdict")
        report.check(verdict in VERDICTS, "RESULT_VERDICT_INVALID", repr(verdict))
        report.equal(result.get("capital_authority"), "NO_GO", "RESULT_CAPITAL_AUTHORITY_INVALID")
        report.equal(result.get("account_effective_fees"), "UNKNOWN", "RESULT_ACCOUNT_FEES_INVALID")
        report.equal(result.get("executable_capacity"), "UNKNOWN", "RESULT_EXECUTABLE_CAPACITY_INVALID")
        if verdict == "UNMEASURED_RUN_CONSUMED_NO_RERUN":
            failure = result.get("failure_binding")
            report.check(
                isinstance(failure, dict) and bool(failure.get("error_code")),
                "RESULT_UNMEASURED_REASON_MISSING",
            )
            for field_name in UNMEASURED_NULL_FIELDS:
                report.equal(result.get(field_name), None, "RESULT_UNMEASURED_FIELD_NOT_NULL", field_name)
            nets = result.get("net_usd_per_1000_by_scenario")
            report.equal(
                nets,
                {scenario: None for scenario in SCENARIOS},
                "RESULT_UNMEASURED_NETS_NOT_NULL",
            )
            return

        summaries = development.get("summaries")
        reported = development.get("reported")
        if not isinstance(summaries, dict) or not isinstance(reported, str):
            report.fail("RESULT_WITHOUT_RECOMPUTED_DEVELOPMENT")
            return
        measured_holdout = verdict in ("NO_GO", "PUBLIC_PROXY_PASS_CAPITAL_NO_GO")
        if measured_holdout:
            holdout_doc = packet.get("holdout.v1.json")
            source = holdout_doc.get("summary") if isinstance(holdout_doc, dict) else None
            metrics = holdout.get("metrics")
            bootstrap = holdout.get("bootstrap")
            report.equal(result.get("reported_trial_id"), development.get("champion"), "RESULT_HOLDOUT_TRIAL_INVALID")
            expected_verdict = (
                "PUBLIC_PROXY_PASS_CAPITAL_NO_GO"
                if holdout.get("all_pass") is True
                else "NO_GO"
            )
            report.equal(verdict, expected_verdict, "RESULT_HOLDOUT_VERDICT_INVALID")
            report.equal(result.get("holdout_state"), "OPENED_ONCE_CHAMPION_ONLY", "RESULT_HOLDOUT_STATE_INVALID")
        else:
            source = summaries.get(reported)
            metrics = development.get("metrics", {}).get(reported) if isinstance(
                development.get("metrics"), dict
            ) else None
            bootstrap = development.get("bootstrap", {}).get(reported) if isinstance(
                development.get("bootstrap"), dict
            ) else None
            report.equal(result.get("reported_trial_id"), reported, "RESULT_DEVELOPMENT_TRIAL_INVALID")
            report.equal(verdict, "NO_GO_DEVELOPMENT_HOLDOUT_UNOPENED", "RESULT_DEVELOPMENT_VERDICT_INVALID")
            report.equal(result.get("holdout_state"), "UNOPENED", "RESULT_HOLDOUT_STATE_INVALID")
        if not isinstance(source, dict) or not isinstance(metrics, LedgerMetrics) or not isinstance(
            bootstrap, dict
        ):
            report.fail("RESULT_RECOMPUTATION_SOURCE_MISSING")
            return

        expected_nets = {
            scenario: sum(metrics.daily[scenario], Decimal(0)) for scenario in SCENARIOS
        }
        result_nets = result.get("net_usd_per_1000_by_scenario")
        if not report.check(isinstance(result_nets, dict), "RESULT_NET_MAP_INVALID"):
            result_nets = {}
        for scenario, expected in expected_nets.items():
            report.numeric(
                result_nets.get(scenario) if isinstance(result_nets, dict) else None,
                expected,
                "RESULT_NET_RECOMPUTE_INVALID",
                scenario,
            )
        report.equal(
            result.get("activity_counters"),
            dict(metrics.activity),
            "RESULT_ACTIVITY_RECOMPUTE_INVALID",
        )
        result_attr = result.get("price_funding_fee_and_adverse_attribution")
        if not report.check(isinstance(result_attr, dict), "RESULT_ATTRIBUTION_INVALID"):
            result_attr = {}
        for scenario in SCENARIOS:
            observed = result_attr.get(scenario) if isinstance(result_attr, dict) else None
            if not isinstance(observed, dict):
                report.fail("RESULT_ATTRIBUTION_ROW_INVALID", scenario)
                continue
            for field_name, expected in metrics.attribution[scenario].items():
                report.numeric(
                    observed.get(field_name),
                    expected,
                    "RESULT_ATTRIBUTION_RECOMPUTE_INVALID",
                    f"{scenario}:{field_name}",
                )
        intervals = result.get("bootstrap_intervals")
        if not report.check(isinstance(intervals, dict), "RESULT_BOOTSTRAP_INTERVAL_INVALID"):
            intervals = {}
        for scenario in SCENARIOS:
            pair = intervals.get(scenario) if isinstance(intervals, dict) else None
            expected_pair = bootstrap[scenario].interval
            if not isinstance(pair, list) or len(pair) != 2:
                report.fail("RESULT_BOOTSTRAP_PAIR_INVALID", scenario)
            else:
                report.numeric(pair[0], expected_pair[0], "RESULT_BOOTSTRAP_LOWER_INVALID", scenario)
                report.numeric(pair[1], expected_pair[1], "RESULT_BOOTSTRAP_UPPER_INVALID", scenario)
        report.numeric(
            result.get("severe_hourly_marked_equity_max_drawdown"),
            metrics.severe_drawdown,
            "RESULT_DRAWDOWN_RECOMPUTE_INVALID",
        )
        expected_capacity = {
            "label": "PUBLIC_COARSE_PRIOR_VOLUME_PARTICIPATION_PROXY",
            "minimum": metrics.capacity_minimum
            if metrics.capacity_minimum is not None
            else "UNMEASURED",
            "p05": metrics.capacity_p05 if metrics.capacity_p05 is not None else "UNMEASURED",
        }
        result_capacity = result.get("public_capacity_proxy")
        if not report.check(isinstance(result_capacity, dict), "RESULT_CAPACITY_INVALID"):
            result_capacity = {}
        report.equal(
            result_capacity,
            source.get("public_capacity_proxy_usd"),
            "RESULT_CAPACITY_IDENTITY_INVALID",
        )
        report.equal(result_capacity.get("label"), expected_capacity["label"], "RESULT_CAPACITY_LABEL_INVALID")
        if metrics.capacity_minimum is None:
            report.equal(result_capacity.get("minimum"), "UNMEASURED", "RESULT_CAPACITY_MIN_INVALID")
            report.equal(result_capacity.get("p05"), "UNMEASURED", "RESULT_CAPACITY_P05_INVALID")
        else:
            report.numeric(result_capacity.get("minimum"), metrics.capacity_minimum, "RESULT_CAPACITY_MIN_INVALID")
            report.numeric(result_capacity.get("p05"), metrics.capacity_p05, "RESULT_CAPACITY_P05_INVALID")
        report.equal(
            result.get("remove_best_symbol_and_month_stress_net"),
            {
                "best_stress_month": source.get("best_stress_month"),
                "best_stress_symbol": source.get("best_stress_symbol"),
                "remove_best_month_stress_net_usd_per_1000": source.get(
                    "remove_best_month_stress_net_usd_per_1000"
                ),
                "remove_best_symbol_stress_net_usd_per_1000": source.get(
                    "remove_best_symbol_stress_net_usd_per_1000"
                ),
            },
            "RESULT_ROBUSTNESS_RECOMPUTE_INVALID",
        )
        expected_holm = development.get("holm")
        result_holm = result.get("holm_p_values")
        if not report.check(isinstance(result_holm, dict), "RESULT_HOLM_INVALID"):
            result_holm = {}
        if isinstance(expected_holm, dict):
            report.equal(tuple(sorted(result_holm)), tuple(sorted(expected_holm)), "RESULT_HOLM_SET_INVALID")
            for trial_id, expected in expected_holm.items():
                report.numeric(result_holm.get(trial_id), expected, "RESULT_HOLM_RECOMPUTE_INVALID", trial_id)
        result_white = result.get("white_reality_check_p_by_scenario")
        expected_white = development.get("white")
        if not report.check(isinstance(result_white, dict), "RESULT_WHITE_INVALID"):
            result_white = {}
        if isinstance(expected_white, dict):
            report.equal(tuple(sorted(result_white)), tuple(sorted(expected_white)), "RESULT_WHITE_SET_INVALID")
            for scenario, expected in expected_white.items():
                report.numeric(result_white.get(scenario), expected, "RESULT_WHITE_RECOMPUTE_INVALID", scenario)
        pbo_result = result.get("pbo")
        if isinstance(pbo_result, dict):
            report.numeric(pbo_result.get("pbo"), development.get("pbo"), "RESULT_PBO_RECOMPUTE_INVALID")
        else:
            report.fail("RESULT_PBO_INVALID")
        limitations = result.get("limitations")
        if report.check(
            isinstance(limitations, list) and all(isinstance(item, str) for item in limitations),
            "RESULT_LIMITATIONS_INVALID",
        ):
            text_value = " ".join(limitations).lower()
            for theme, needle in (
                ("publication_latency", "latency"),
                ("proxy_not_fill", "proxy"),
                ("account_fee_unknown", "account-effective"),
                ("no_policy_effect", "policy"),
                ("endogeneity", "endogeneity"),
                ("frozen_bytes", "frozen cached official bytes"),
            ):
                report.check(needle in text_value, "RESULT_LIMITATION_MISSING", theme)


def check_corrected_static_contract(report: Report, statics: Statics) -> None:
    with report.stage("corrected_static_contract"):
        report.equal(statics.protocol.get("consumer"), "N3 successor/final convergence", "CONSUMER_DRIFT")
        frozen_months = (SCREEN_MONTHS, DEVELOPMENT_MONTHS, HOLDOUT_MONTHS)
        report.equal(
            _partition_months(statics),
            frozen_months,
            "STATIC_PARTITION_MONTHS_DRIFT",
        )
        report.equal(
            tuple(str(month) for month in (statics.plan.get("months") or ())),
            (*SCREEN_MONTHS, *DEVELOPMENT_MONTHS, *HOLDOUT_MONTHS),
            "STATIC_ALL_MONTHS_DRIFT",
        )
        plan_allowlist = statics.plan_section("git_preseal").get("static_file_allowlist")
        report.equal(
            tuple(plan_allowlist) if isinstance(plan_allowlist, list) else (),
            STATIC_REPOSITORY_PATHS,
            "PLAN_STATIC_ALLOWLIST_DRIFT",
        )
        report.equal(
            statics.plan_section("git_preseal").get("packet_copy_root"),
            PACKET_STATIC_PREFIX,
            "PLAN_STATIC_COPY_ROOT_DRIFT",
        )
        report.check(
            "including this verifier" in (
                "including this verifier"
                if "verifier.py" in SEALED_STATIC_FILES
                else ""
            ),
            "VERIFIER_NOT_SEALED",
        )
        clock = statics.section("observation_clock")
        report.equal(clock.get("lag_safe_claim"), False, "STATIC_LAG_SAFE_CLAIM")
        report.equal(clock.get("policy_effect_claim"), False, "STATIC_POLICY_EFFECT_CLAIM")
        report.equal(
            clock.get("label"),
            "RETROSPECTIVE_OBSERVED_SETTLEMENT_ASSOCIATION",
            "STATIC_OBSERVATION_LABEL_DRIFT",
        )
        decision_text = str(clock.get("decision_hour", ""))
        report.check(
            "final_confirmation_calc_time_ms + entry_lag_hours * 3600000 + 3599999"
            in decision_text,
            "STATIC_DECISION_FORMULA_DRIFT",
        )
        network = statics.plan_section("network_policy")
        for field_name in (
            "credentials",
            "engine_network_access",
            "private_endpoints",
            "rest_fallback",
            "signed_endpoints",
        ):
            report.equal(network.get(field_name), False, "STATIC_NETWORK_POLICY_DRIFT", field_name)
        run_custody = statics.plan_section("run_custody")
        report.equal(run_custody.get("one_run"), True, "STATIC_ONE_RUN_DISABLED")
        report.equal(run_custody.get("repair"), False, "STATIC_REPAIR_ALLOWED")
        report.equal(run_custody.get("rerun"), False, "STATIC_RERUN_ALLOWED")
        report.equal(run_custody.get("second_invocation"), "REFUSE", "STATIC_SECOND_RUN_ALLOWED")
        verdict_law = statics.section("verdict_law")
        report.equal(
            verdict_law.get("verified_policy_effect_claim_allowed"),
            False,
            "STATIC_VERIFIED_POLICY_CLAIM_ALLOWED",
        )
        report.check(
            str(verdict_law.get("capital_authority", "")).startswith("NO_GO"),
            "STATIC_CAPITAL_AUTHORITY_DRIFT",
        )


def verify_packet(
    protocol_dir: Path,
    packet_root: Path,
    *,
    expected_base: str | None,
    expected_producer_commit: str | None,
    expected_producer_tree: str | None,
    strict: bool,
) -> Report:
    report = Report(strict=strict)
    try:
        audit_self_source(report)
        statics = load_statics(report, protocol_dir)
        check_static_family_count(report, statics)
        check_canonical_base(report, statics, expected_base)
        check_corrected_static_contract(report, statics)
        packet = load_packet(report, packet_root, statics)
        check_packet_surface_and_sums(report, packet)
        check_static_provenance(
            report, packet, expected_producer_commit, expected_producer_tree
        )
        check_cache_manifest_attestation(report, packet)
        audit_engine_source(report, packet)
        check_corrected_bindings(report, packet)
        check_conditional_chain(report, packet)
        check_corrected_custody(report, packet)
        check_opened_source_ledger(report, packet)
        check_source_file_reconciliation(report, packet)
        check_report_and_forbidden_surfaces(report, packet)
        check_current_event_universe(report, packet)
        development = check_development_economics(report, packet)
        holdout = check_holdout_economics(report, packet, development)
        check_result_against_recomputation(report, packet, development, holdout)
    except VerifierAbort as exc:
        report.fail("VERIFIER_ABORT", str(exc))
    except (OSError, ValueError, KeyError, TypeError, ArithmeticError) as exc:
        report.fail("VERIFIER_EXCEPTION", f"{type(exc).__name__}:{exc}")
    return report


def _fixture_write_bytes(path: Path, payload: bytes, mode: int = 0o444) -> None:
    path.write_bytes(payload)
    path.chmod(mode)


def _fixture_write_json(path: Path, value: Mapping[str, Any]) -> None:
    _fixture_write_bytes(path, canonical_bytes(value))


def _build_self_check_fixture(root: Path) -> None:
    payload = b"sealed-s1t-synthetic-only\n"
    _fixture_write_bytes(root / "payload.bin", payload)
    digest = sha256_bytes(payload)
    _fixture_write_bytes(root / "SHA256SUMS", f"{digest}  payload.bin\n".encode("ascii"))


def _fixture_binding(root: Path, relative_path: str) -> dict[str, Any]:
    payload, _ = _read_regular_file(root / relative_path)
    return {
        "byte_count": len(payload),
        "raw_sha256": sha256_bytes(payload),
        "relative_path": relative_path,
    }


def _rewrite_fixture_sums(root: Path) -> None:
    rows: list[str] = []
    for path in sorted(
        (path for path in root.rglob("*") if path.is_file() and path.name != "SHA256SUMS"),
        key=lambda path: path.relative_to(root).as_posix().encode("utf-8"),
    ):
        relative = path.relative_to(root).as_posix()
        payload, _ = _read_regular_file(path)
        rows.append(f"{sha256_bytes(payload)}  {relative}\n")
    sums = root / "SHA256SUMS"
    if sums.exists():
        sums.chmod(0o600)
    _fixture_write_bytes(sums, "".join(rows).encode("utf-8"))


def _build_screen_ranking_fixture(eligible_count: int = 101) -> dict[str, Any]:
    """Synthetic current-schema ledger spanning the only allowed cutoff."""

    ledger: list[dict[str, Any]] = []
    selected: list[str] = []
    for index in range(eligible_count):
        rank = index + 1
        symbol = f"T{index:03d}USDT"
        status = "SELECTED" if rank <= RANK_CUTOFF_N else "REJECTED_BY_RANK"
        if status == "SELECTED":
            selected.append(symbol)
        ledger.append(
            {
                "eligibility": "ELIGIBLE",
                "june_contract_quote_volume_total": str(eligible_count - index),
                "june_funding_rows": 90,
                "june_hourly_rows": 720,
                "june_member_open_count": 3,
                "june_zip_sha256_by_dataset": {
                    "fundingRate": "1" * 64,
                    "klines/1h": "2" * 64,
                    "markPriceKlines/1h": "3" * 64,
                },
                "rank": rank,
                "reason_code": None,
                "selection_status": status,
                "source_bindings": [],
                "symbol": symbol,
            }
        )
    cutoff = min(RANK_CUTOFF_N, eligible_count)
    return {
        "candidate_count": eligible_count,
        "eligible_count": eligible_count,
        "fixed_universe": sorted(selected),
        "ineligible_count": 0,
        "rank_cutoff_n": RANK_CUTOFF_N,
        "ranking_order": "exact_quote_volume_total_desc_then_ascii_symbol_asc",
        "rejected_by_rank_count": eligible_count - cutoff,
        "screen_ledger": ledger,
        "selected_count": cutoff,
        "selection_rule": "first min(100, eligible_count); never padded, never replaced",
        "tested_rank_cutoffs": [RANK_CUTOFF_N],
    }


def _build_terminal_packet_fixture(root: Path, protocol_dir: Path) -> None:
    static_root = root / PACKET_STATIC_PREFIX
    static_root.mkdir(parents=True)
    bindings: list[dict[str, Any]] = []
    for repo_path in STATIC_REPOSITORY_PATHS:
        filename = PurePosixPath(repo_path).name
        source = protocol_dir / filename
        payload, _ = _read_regular_file(source)
        copy_relative = f"{PACKET_STATIC_PREFIX}/{filename}"
        _fixture_write_bytes(root / copy_relative, payload)
        bindings.append(
            {
                "byte_count": len(payload),
                "git_blob_object_id": _git_blob_oid(payload),
                "git_mode": "100644",
                "packet_copy_raw_sha256": sha256_bytes(payload),
                "packet_copy_relative_path": copy_relative,
                "raw_sha256": sha256_bytes(payload),
                "repository_relative_path": repo_path,
            }
        )
    status = root.stat()
    created_at = "2026-07-30T00:00:00+00:00"
    fixture_plan = _read_json_object(protocol_dir / "source_plan.v1.json")
    fixture_cache = fixture_plan.get("cache")
    assert isinstance(fixture_cache, dict)
    fixture_protocol_digest = next(
        str(row["raw_sha256"])
        for row in bindings
        if row["repository_relative_path"]
        == "quant/research/s1t/protocol.v1.json"
    )
    preseal = {
        "cache_manifest_attestation": {
            "declared_schema": fixture_cache["manifest_expected_schema"],
            "declaring_keys": ["schema"],
            "manifest_absolute_path": fixture_cache["manifest"],
            "manifest_raw_sha256": "3" * 64,
            "upstream_outcomes_read": False,
        },
        "cache_root": fixture_cache["root"],
        "created_at": created_at,
        "engine_network_access": False,
        "git_lineage": {
            "static_producer_commit": "1" * 40,
            "static_producer_parent": CANONICAL_BASE,
            "static_producer_tree": "2" * 40,
        },
        "packet_root": str(root),
        "packet_identity": {"device": status.st_dev, "inode": status.st_ino},
        "producer_first_parent_commit": CANONICAL_BASE,
        "protocol_raw_sha256": fixture_protocol_digest,
        "schema": f"{SCHEMA_PREFIX}.preseal.v1",
        "static_files": bindings,
    }
    _fixture_write_json(root / "preseal.v1.json", preseal)
    screen_inputs = [_fixture_binding(root, "preseal.v1.json")]
    screen = {
        "creation_flags": ["O_CREAT", "O_EXCL", "O_NOFOLLOW", "O_WRONLY"],
        "created_at": "2026-07-30T00:00:01+00:00",
        "exclusive_create": True,
        "marker_created_before_first_member": True,
        "predecessor_raw_sha256": screen_inputs[0]["raw_sha256"],
        "predecessor_relative_path": "preseal.v1.json",
        "schema": f"{SCHEMA_PREFIX}.screen_consumed.v1",
        "screen_archive_member_open_count_before": 0,
        "screen_ordinal": 1,
    }
    _fixture_write_json(root / "screen_consumed.v1.json", screen)
    result_inputs = sorted(
        (
            _fixture_binding(root, "preseal.v1.json"),
            _fixture_binding(root, "screen_consumed.v1.json"),
        ),
        key=lambda row: row["relative_path"].encode("utf-8"),
    )
    screen_digest = next(
        row["raw_sha256"]
        for row in result_inputs
        if row["relative_path"] == "screen_consumed.v1.json"
    )
    result = {
        "account_effective_fees": "UNKNOWN",
        "activity_counters": None,
        "bootstrap_intervals": None,
        "capital_authority": "NO_GO",
        "created_at": "2026-07-30T00:00:02+00:00",
        "development_and_holdout_custody": {
            "holdout": {
                "open_count": 0,
                "outcome_rows_opened_before_gates": 0,
            },
            "one_run": True,
            "repair_or_rerun": False,
        },
        "effects": EXPECTED_EFFECTS,
        "executable_capacity": "UNKNOWN",
        "failure_binding": {
            "error_code": "SYNTHETIC_SCREEN_FAILURE",
            "completed_artifact_bindings": result_inputs,
            "stage": "screen",
        },
        "holdout_state": "UNOPENED",
        "holm_p_values": None,
        "input_bindings": result_inputs,
        "limitations": [
            "publication latency is UNKNOWN",
            "public proxy is not a fill",
            "account-effective fees are UNKNOWN",
            "no policy effect claim",
            "endogeneity remains",
            "frozen cached official bytes only",
        ],
        "net_usd_per_1000_by_scenario": {scenario: None for scenario in SCENARIOS},
        "outcome_state": "TERMINAL_UNMEASURED",
        "pbo": None,
        "predecessor_raw_sha256": screen_digest,
        "predecessor_relative_path": "screen_consumed.v1.json",
        "price_funding_fee_and_adverse_attribution": None,
        "public_capacity_proxy": None,
        "reason_code": "SYNTHETIC_SCREEN_FAILURE",
        "remove_best_symbol_and_month_stress_net": None,
        "schema": f"{SCHEMA_PREFIX}.result.v1",
        "severe_hourly_marked_equity_max_drawdown": None,
        "static_producer_commit": "1" * 40,
        "static_producer_tree": "2" * 40,
        "strategy_verdict": "UNMEASURED",
        "protocol_raw_sha256": fixture_protocol_digest,
        "verdict": "UNMEASURED_RUN_CONSUMED_NO_RERUN",
        "white_reality_check_p_by_scenario": None,
    }
    _fixture_write_json(root / "result.v1.json", result)
    result_digest = sha256_file(root / "result.v1.json")
    _fixture_write_bytes(
        root / "REPORT.md",
        f"Synthetic self-check only; result.v1.json sha256: {result_digest}\n".encode("utf-8"),
    )
    _rewrite_fixture_sums(root)


def _fixture_manifest_relative(dataset: str, symbol: str, month: str) -> str:
    if dataset == "fundingRate":
        return (
            f"data/futures/um/monthly/fundingRate/{symbol}/"
            f"{symbol}-fundingRate-{month}.zip"
        )
    directory = "klines" if dataset == "klines/1h" else "markPriceKlines"
    return (
        f"data/futures/um/monthly/{directory}/{symbol}/1h/"
        f"{symbol}-1h-{month}.zip"
    )


def _rebind_terminal_fixture(
    root: Path,
    result: Mapping[str, Any],
    predecessor: str,
) -> None:
    """Rewrite only synthetic terminal metadata after a fixture-chain mutation."""

    present = [
        entry.name
        for entry in PACKET_CHAIN
        if entry.name != "result.v1.json" and (root / entry.name).is_file()
    ]
    bindings = sorted(
        (_fixture_binding(root, relative) for relative in present),
        key=lambda row: row["relative_path"].encode("utf-8"),
    )
    rebound = dict(result)
    rebound["created_at"] = "2026-07-30T00:00:04+00:00"
    rebound["input_bindings"] = bindings
    failure = dict(rebound["failure_binding"])
    failure["completed_artifact_bindings"] = bindings
    rebound["failure_binding"] = failure
    predecessor_binding = next(
        row for row in bindings if row["relative_path"] == predecessor
    )
    rebound["predecessor_relative_path"] = predecessor
    rebound["predecessor_raw_sha256"] = predecessor_binding["raw_sha256"]

    result_path = root / "result.v1.json"
    result_path.chmod(0o600)
    _fixture_write_json(result_path, rebound)
    report_path = root / "REPORT.md"
    report_path.chmod(0o600)
    _fixture_write_bytes(
        report_path,
        (
            "Synthetic self-check only; result.v1.json sha256: "
            f"{sha256_file(result_path)}\n"
        ).encode("utf-8"),
    )
    _rewrite_fixture_sums(root)


def _build_manifest_terminal_packet_fixture(
    root: Path,
    protocol_dir: Path,
) -> None:
    """Build a complete synthetic current-schema manifest without archive bytes."""

    _build_terminal_packet_fixture(root, protocol_dir)
    result = _read_json_object(root / "result.v1.json")
    ranking = _build_screen_ranking_fixture(1)
    screen_universe = {
        **ranking,
        "created_at": "2026-07-30T00:00:02+00:00",
        "june_only_admission": True,
        "later_month_availability_used": False,
        "outcome_scoring": False,
        "predecessor_raw_sha256": sha256_file(root / "screen_consumed.v1.json"),
        "predecessor_relative_path": "screen_consumed.v1.json",
        "schema": f"{SCHEMA_PREFIX}.screen_universe.v1",
        "screen_archive_member_open_count": 3,
        "screen_month": SCREEN_MONTHS[0],
        "status": "FROZEN",
    }
    _fixture_write_json(root / "screen_universe.v1.json", screen_universe)

    symbol = str(ranking["fixed_universe"][0])
    entries: list[dict[str, Any]] = []
    for month in (*SCREEN_MONTHS, *DEVELOPMENT_MONTHS, *HOLDOUT_MONTHS):
        for dataset in ("fundingRate", "klines/1h", "markPriceKlines/1h"):
            relative = _fixture_manifest_relative(dataset, symbol, month)
            entries.append(
                {
                    "byte_count": 32,
                    "cache_sidecar_sha256": "4" * 64,
                    "cache_stat_identity": {
                        "ctime_ns": 1,
                        "device": 2,
                        "inode": len(entries) + 1,
                        "mtime_ns": 3,
                        "size": 32,
                    },
                    "cache_zip_sha256": "5" * 64,
                    "dataset": dataset,
                    "inventory_state": "PRESENT",
                    "member_state": _manifest_expected_state(symbol, month, dataset),
                    "month": month,
                    "official_zip_sha256": "5" * 64,
                    "prior_schema_exposure": False,
                    "relative_path": relative,
                    "source_url": f"{ARCHIVE_HOST_PREFIX}{relative}",
                    "symbol": symbol,
                }
            )
    manifest = {
        "created_at": "2026-07-30T00:00:03+00:00",
        "development_archive_member_open_count": 0,
        "entries": entries,
        "entry_count": len(entries),
        "expected_entry_count": len(entries),
        "header_only_schema_exposed": [],
        "holdout_archive_member_open_count": 0,
        "holdout_outcome_rows_opened_before_gates": 0,
        "inventory_absence_changes_membership": False,
        "missing_count": 0,
        "packet_source_prefix": "sources",
        "predecessor_raw_sha256": sha256_file(root / "screen_universe.v1.json"),
        "predecessor_relative_path": "screen_universe.v1.json",
        "present_count": len(entries),
        "remote_revision_equality_claim": False,
        "schema": f"{SCHEMA_PREFIX}.source_manifest.v1",
        "universe_symbol_count": 1,
    }
    _fixture_write_json(root / "source_manifest.v1.json", manifest)
    _rebind_terminal_fixture(root, result, "source_manifest.v1.json")


def run_self_check(strict: bool = True) -> Report:
    """Exercise the fail-closed primitives using only synthetic temporary bytes."""

    report = Report(strict=strict)
    with report.stage("self_check"):
        audit_self_source(report)
        report.equal(
            sys.version_info >= (3, 13), True, "SELF_PYTHON_VERSION_INVALID"
        )
        report.equal(
            tuple(STATIC_REPOSITORY_PATHS),
            (
                "quant/research/s1t/DISTINCTNESS.md",
                "quant/research/s1t/OFFICIAL_SOURCE_RESEARCH.md",
                "quant/research/s1t/README.md",
                "quant/research/s1t/experiment.py",
                "quant/research/s1t/protocol.v1.json",
                "quant/research/s1t/source_plan.v1.json",
                "quant/research/s1t/trial_ledger.v1.json",
                "quant/research/s1t/verifier.py",
            ),
            "SELF_STATIC_ALLOWLIST_INVALID",
        )
        confirm_ms = int(
            datetime(2026, 1, 2, 3, 59, 59, 999000, tzinfo=UTC).timestamp() * 1000
        )
        shifted = confirm_ms + HOUR_MS
        decision = ((shifted + HOUR_MS - 1) // HOUR_MS) * HOUR_MS
        expected = int(datetime(2026, 1, 2, 5, 0, tzinfo=UTC).timestamp() * 1000)
        report.equal(decision, expected, "SELF_DECISION_FORMULA_INVALID")
        report.equal(
            _git_blob_oid(b""),
            "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
            "SELF_GIT_BLOB_OID_INVALID",
        )
        with tempfile.TemporaryDirectory(prefix="s1t-verifier-selfcheck-") as raw_root:
            root = Path(raw_root)
            _build_self_check_fixture(root)
            sums_raw, _ = _read_regular_file(root / "SHA256SUMS")
            parsed = _parse_sums(report, sums_raw)
            digest, count, _ = _digest_regular_file(root / "payload.bin")
            report.equal(parsed.get("payload.bin"), digest, "SELF_SUMS_DIGEST_INVALID")
            report.equal(count, len(b"sealed-s1t-synthetic-only\n"), "SELF_SUMS_SIZE_INVALID")
            report.check(
                sha256_bytes(b"tampered\n") != parsed.get("payload.bin"),
                "SELF_TAMPER_NOT_DETECTED",
            )
        with tempfile.TemporaryDirectory(prefix="s1t-verifier-packet-") as raw_packet:
            packet_root = Path(raw_packet)
            _build_terminal_packet_fixture(packet_root, HERE)
            valid = verify_packet(
                HERE,
                packet_root,
                expected_base=CANONICAL_BASE,
                expected_producer_commit="1" * 40,
                expected_producer_tree="2" * 40,
                strict=True,
            )
            report.check(
                valid.status == "PASS",
                "SELF_FULL_PACKET_REJECTED",
                ",".join(item.code for item in valid.failures),
            )
            result_path = packet_root / "result.v1.json"
            result_value = _read_json_object(result_path)
            tampered = dict(result_value)
            tampered["verdict"] = "NO_GO"
            tampered["outcome_state"] = "MEASURED_HOLDOUT"
            result_path.chmod(0o600)
            _fixture_write_json(result_path, tampered)
            report_path = packet_root / "REPORT.md"
            report_path.chmod(0o600)
            _fixture_write_bytes(
                report_path,
                (
                    "Synthetic self-check only; result.v1.json sha256: "
                    f"{sha256_file(result_path)}\n"
                ).encode("utf-8"),
            )
            _rewrite_fixture_sums(packet_root)
            attacked = verify_packet(
                HERE,
                packet_root,
                expected_base=CANONICAL_BASE,
                expected_producer_commit="1" * 40,
                expected_producer_tree="2" * 40,
                strict=True,
            )
            report.check(
                attacked.status == "FAIL",
                "SELF_REGENERATED_SUMS_SEMANTIC_TAMPER_ACCEPTED",
            )
        with tempfile.TemporaryDirectory(
            prefix="s1t-verifier-manifest-"
        ) as raw_packet:
            packet_root = Path(raw_packet)
            _build_manifest_terminal_packet_fixture(packet_root, HERE)
            manifest_value = _read_json_object(
                packet_root / "source_manifest.v1.json"
            )
            manifest_entries = manifest_value.get("entries")
            assert isinstance(manifest_entries, list)
            states_by_partition = {
                "screen": {
                    row.get("member_state")
                    for row in manifest_entries
                    if isinstance(row, dict) and row.get("month") in SCREEN_MONTHS
                },
                "development": {
                    row.get("member_state")
                    for row in manifest_entries
                    if isinstance(row, dict)
                    and row.get("month") in DEVELOPMENT_MONTHS
                },
                "holdout": {
                    row.get("member_state")
                    for row in manifest_entries
                    if isinstance(row, dict) and row.get("month") in HOLDOUT_MONTHS
                },
            }
            report.equal(
                states_by_partition["screen"],
                {"SCREEN_OPENED_ONCE"},
                "SELF_MANIFEST_SCREEN_STATE_INVALID",
            )
            report.equal(
                states_by_partition["development"],
                {"DEVELOPMENT_UNOPENED_AT_INVENTORY"},
                "SELF_MANIFEST_DEVELOPMENT_STATE_INVALID",
            )
            report.equal(
                states_by_partition["holdout"],
                {"SEALED_UNOPENED"},
                "SELF_MANIFEST_HOLDOUT_STATE_INVALID",
            )
            manifest_valid = verify_packet(
                HERE,
                packet_root,
                expected_base=CANONICAL_BASE,
                expected_producer_commit="1" * 40,
                expected_producer_tree="2" * 40,
                strict=True,
            )
            report.check(
                manifest_valid.status == "PASS",
                "SELF_MANIFEST_PACKET_REJECTED",
                ",".join(item.code for item in manifest_valid.failures),
            )

            tampered_manifest = json.loads(
                json.dumps(manifest_value, allow_nan=False)
            )
            holdout_row = next(
                row
                for row in tampered_manifest["entries"]
                if row["month"] == HOLDOUT_MONTHS[0]
            )
            holdout_row["member_state"] = "DEVELOPMENT_UNOPENED_AT_INVENTORY"
            manifest_path = packet_root / "source_manifest.v1.json"
            manifest_path.chmod(0o600)
            _fixture_write_json(manifest_path, tampered_manifest)
            current_result = _read_json_object(packet_root / "result.v1.json")
            _rebind_terminal_fixture(
                packet_root, current_result, "source_manifest.v1.json"
            )
            manifest_attacked = verify_packet(
                HERE,
                packet_root,
                expected_base=CANONICAL_BASE,
                expected_producer_commit="1" * 40,
                expected_producer_tree="2" * 40,
                strict=True,
            )
            report.check(
                any(
                    finding.code == "MANIFEST_MEMBER_STATE_INVALID"
                    for finding in manifest_attacked.failures
                ),
                "SELF_MANIFEST_MONTH_STATE_TAMPER_NOT_REJECTED",
            )
        with tempfile.TemporaryDirectory(prefix="s1t-verifier-source-") as raw_packet:
            packet_root = Path(raw_packet)
            _build_terminal_packet_fixture(packet_root, HERE)
            zip_relative = (
                "sources/data/futures/um/monthly/fundingRate/REJECTEDUSDT/"
                "REJECTEDUSDT-fundingRate-2025-06.zip"
            )
            zip_path = packet_root / zip_relative
            zip_path.parent.mkdir(parents=True, mode=0o700)
            opaque_zip = b"opaque-synthetic-archive-bytes\n"
            _fixture_write_bytes(zip_path, opaque_zip)
            _fixture_write_bytes(
                packet_root / f"{zip_relative}.CHECKSUM",
                f"{sha256_bytes(opaque_zip)}  {zip_path.name}\n".encode("ascii"),
            )
            _rewrite_fixture_sums(packet_root)
            unbound = verify_packet(
                HERE,
                packet_root,
                expected_base=CANONICAL_BASE,
                expected_producer_commit="1" * 40,
                expected_producer_tree="2" * 40,
                strict=True,
            )
            report.check(
                any(
                    finding.code == "SOURCE_FILE_NOT_SEMANTICALLY_BOUND"
                    for finding in unbound.failures
                ),
                "SELF_UNBOUND_SOURCE_NOT_REJECTED",
            )
        self_statics = load_statics(report, HERE)
        rank_fixture = _build_screen_ranking_fixture()
        rank_report = Report(strict=True)
        check_frozen_top100_ranking(rank_report, rank_fixture, self_statics)
        report.check(
            rank_report.status == "PASS",
            "SELF_TOP100_RANK_FIXTURE_REJECTED",
            ",".join(finding.code for finding in rank_report.failures),
        )

        over_cutoff = json.loads(json.dumps(rank_fixture, allow_nan=False))
        over_cutoff["screen_ledger"][RANK_CUTOFF_N]["selection_status"] = "SELECTED"
        over_cutoff["fixed_universe"].append(
            over_cutoff["screen_ledger"][RANK_CUTOFF_N]["symbol"]
        )
        over_cutoff["selected_count"] = RANK_CUTOFF_N + 1
        over_cutoff["rejected_by_rank_count"] = 0
        over_cutoff_report = Report(strict=True)
        check_frozen_top100_ranking(
            over_cutoff_report, over_cutoff, self_statics
        )
        report.check(
            any(
                finding.code == "SCREEN_RANK_SELECTION_STATUS_INVALID"
                for finding in over_cutoff_report.failures
            ),
            "SELF_TOP100_OVER_CUTOFF_TAMPER_NOT_REJECTED",
        )

        rank_tamper = json.loads(json.dumps(rank_fixture, allow_nan=False))
        rank_tamper["screen_ledger"][1]["rank"] = 1
        rank_tamper_report = Report(strict=True)
        check_frozen_top100_ranking(rank_tamper_report, rank_tamper, self_statics)
        report.check(
            any(
                finding.code == "SCREEN_RANKS_NOT_CONTIGUOUS"
                for finding in rank_tamper_report.failures
            ),
            "SELF_TOP100_RANK_TAMPER_NOT_REJECTED",
        )

        tie_tamper = json.loads(json.dumps(rank_fixture, allow_nan=False))
        tie_tamper["screen_ledger"][1]["june_contract_quote_volume_total"] = (
            tie_tamper["screen_ledger"][0]["june_contract_quote_volume_total"]
        )
        tie_tamper["screen_ledger"][0]["rank"] = 2
        tie_tamper["screen_ledger"][1]["rank"] = 1
        tie_tamper_report = Report(strict=True)
        check_frozen_top100_ranking(tie_tamper_report, tie_tamper, self_statics)
        report.check(
            any(
                finding.code == "SCREEN_RANK_TIE_ASCII_INVALID"
                for finding in tie_tamper_report.failures
            ),
            "SELF_TOP100_TIE_TAMPER_NOT_REJECTED",
        )

        false_selection = json.loads(json.dumps(rank_fixture, allow_nan=False))
        false_selection["rank_selection"] = False
        false_selection_report = Report(strict=True)
        check_frozen_top100_ranking(
            false_selection_report, false_selection, self_statics
        )
        report.check(
            any(
                finding.code == "SCREEN_RANK_SELECTION_FALSE"
                for finding in false_selection_report.failures
            ),
            "SELF_TOP100_FALSE_SELECTION_NOT_REJECTED",
        )

        fixture_packet = Packet(
            root=HERE,
            statics=self_statics,
            artifacts={},
            digests={},
            files=(),
            modes={},
            mtimes={},
        )
        start_ms = int(datetime(2026, 1, 1, tzinfo=UTC).timestamp() * 1000)
        end_ms = start_ms + DAY_MS
        exit_ms = start_ms + 4 * HOUR_MS
        entry_price = Decimal(100)
        exit_price = Decimal(110)
        quantity = Decimal(10)
        scenario_rows: dict[str, dict[str, str]] = {}
        scenario_nets: dict[str, Decimal] = {}
        for scenario in SCENARIOS:
            fee_rate, adverse_rate = _scenario_costs(self_statics, scenario)
            entry_fill = entry_price * (Decimal(1) + adverse_rate)
            exit_fill = exit_price * (Decimal(1) - adverse_rate)
            adverse_entry = -quantity * adverse_rate * entry_price
            adverse_exit = -quantity * adverse_rate * exit_price
            fee_entry = -fee_rate * quantity * entry_fill
            fee_exit = -fee_rate * quantity * exit_fill
            price = quantity * (exit_price - entry_price)
            net = price + adverse_entry + adverse_exit + fee_entry + fee_exit
            scenario_nets[scenario] = net
            scenario_rows[scenario] = {
                "adverse_attribution_usd": decimal_string(adverse_entry + adverse_exit),
                "adverse_entry_usd": decimal_string(adverse_entry),
                "adverse_exit_usd": decimal_string(adverse_exit),
                "entry_fill_proxy": decimal_string(entry_fill),
                "exit_fill_proxy": decimal_string(exit_fill),
                "fee_entry_usd": decimal_string(fee_entry),
                "fee_exit_usd": decimal_string(fee_exit),
                "fee_usd": decimal_string(fee_entry + fee_exit),
                "funding_usd": "0",
                "mark_price_pnl_usd": decimal_string(price),
                "net_usd": decimal_string(net),
            }
        severe = scenario_rows["severe"]
        severe_adverse_entry = Decimal(severe["adverse_entry_usd"])
        severe_adverse_exit = Decimal(severe["adverse_exit_usd"])
        severe_fee_entry = Decimal(severe["fee_entry_usd"])
        severe_fee_exit = Decimal(severe["fee_exit_usd"])
        equity_rows: list[dict[str, Any]] = []
        for hour_ms in range(start_ms, end_ms + HOUR_MS, HOUR_MS):
            is_open = start_ms <= hour_ms < exit_ms
            is_closed = hour_ms >= exit_ms
            realized = Decimal(100) if is_closed else Decimal(0)
            adverse = severe_adverse_entry + (
                severe_adverse_exit if is_closed else Decimal(0)
            )
            fee = severe_fee_entry + (severe_fee_exit if is_closed else Decimal(0))
            unrealized = Decimal(0)
            equity_value = CAPITAL + realized + adverse + fee
            equity_rows.append(
                {
                    "adverse_attribution_usd": decimal_string(adverse),
                    "booked_funding_usd": "0",
                    "equity_usd": decimal_string(equity_value),
                    "fee_usd": decimal_string(fee),
                    "open_member_marks": (
                        [
                            {
                                "cohort_entry_ms": start_ms,
                                "mark_price": "100",
                                "symbol": "TESTUSDT",
                            }
                        ]
                        if is_open
                        else []
                    ),
                    "open_unrealized_mark_price_pnl_usd": decimal_string(unrealized),
                    "realized_mark_price_pnl_usd": decimal_string(realized),
                    "timestamp_ms": hour_ms,
                }
            )
        evidence_fixture = {
            "cohorts": [
                {
                    "capacity_proxy_usd": "50",
                    "decision_ms": start_ms,
                    "entry_ms": start_ms,
                    "exit_ms": exit_ms,
                    "members": [
                        {
                            "capacity_quote_volume_24h_windows_usdt": ["1000000"] * 7,
                            "entry_mark_price": "100",
                            "exit_mark_price": "110",
                            "funding_settlements": [],
                            "member_capacity_proxy_usd": "50",
                            "member_notional_usd": "1000",
                            "quantity": "10",
                            "scenario_components": scenario_rows,
                            "side_sign": 1,
                            "symbol": "TESTUSDT",
                        }
                    ],
                    "net_usd_by_scenario": {
                        scenario: decimal_string(value)
                        for scenario, value in scenario_nets.items()
                    },
                }
            ],
            "decisions": [
                {
                    "cash_reason": None,
                    "decision_ms": start_ms,
                    "state": "NONCASH",
                }
            ],
            "hourly_equity_severe": equity_rows,
        }
        metrics_fixture = _ledger_metrics(
            report,
            fixture_packet,
            "self-economics",
            evidence_fixture,
            start_ms,
            end_ms,
        )
        report.check(metrics_fixture is not None, "SELF_ECONOMICS_LEDGER_REJECTED")
        if metrics_fixture is not None:
            report.numeric(
                metrics_fixture.daily["severe"][0],
                scenario_nets["severe"],
                "SELF_ECONOMICS_NET_INVALID",
            )
            report.numeric(
                metrics_fixture.capacity_minimum,
                Decimal(50),
                "SELF_ECONOMICS_CAPACITY_INVALID",
            )
            report.numeric(
                metrics_fixture.severe_drawdown,
                -(severe_adverse_entry + severe_fee_entry) / CAPITAL,
                "SELF_ECONOMICS_DRAWDOWN_INVALID",
            )
        tampered_evidence = json.loads(
            json.dumps(evidence_fixture, allow_nan=False)
        )
        tampered_evidence["cohorts"][0]["members"][0]["scenario_components"][
            "severe"
        ]["net_usd"] = "0"
        tamper_report = Report(strict=True)
        _ledger_metrics(
            tamper_report,
            fixture_packet,
            "self-economics-tamper",
            tampered_evidence,
            start_ms,
            end_ms,
        )
        report.check(
            tamper_report.status == "FAIL"
            and any(
                finding.code == "MEMBER_COMPONENT_INVALID"
                for finding in tamper_report.failures
            ),
            "SELF_ECONOMICS_TAMPER_NOT_REJECTED",
        )
        simple = tuple(Decimal(index) for index in range(14))
        indices = _bootstrap_indices("self-check", len(simple))
        stats = _bootstrap_stats(simple, indices)
        report.check(stats.interval[0] <= stats.interval[1], "SELF_BOOTSTRAP_INTERVAL_INVALID")
        report.check(
            Decimal(0) < stats.centered_p <= Decimal(1),
            "SELF_BOOTSTRAP_P_INVALID",
        )
    return report


def _emit_report(report: Report, json_output: bool) -> None:
    if json_output:
        print(json.dumps(report.summary(), allow_nan=False, separators=(",", ":"), sort_keys=True))
        return
    print(
        f"{report.status} {VERIFIER_ID} checks={report.checks} "
        f"failures={len(report.failures)}"
    )
    for finding in report.findings:
        print(finding.line())
    for key, value in sorted(report.notes.items()):
        print(f"NOTE {key}={value}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Independent fail-closed verifier for one sealed S-1T packet"
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--packet-root", type=Path)
    mode.add_argument("--self-check", action="store_true")
    parser.add_argument("--protocol-dir", type=Path, default=HERE)
    parser.add_argument("--expected-base", default=CANONICAL_BASE)
    parser.add_argument("--expected-producer-commit")
    parser.add_argument("--expected-producer-tree")
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--json", action="store_true", dest="json_output")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    if arguments.self_check:
        report = run_self_check(strict=True)
    else:
        assert arguments.packet_root is not None
        packet_root = arguments.packet_root.expanduser()
        protocol_dir = arguments.protocol_dir.expanduser()
        report = verify_packet(
            protocol_dir.resolve(),
            packet_root.resolve(),
            expected_base=arguments.expected_base,
            expected_producer_commit=arguments.expected_producer_commit,
            expected_producer_tree=arguments.expected_producer_tree,
            strict=arguments.strict,
        )
    _emit_report(report, arguments.json_output)
    return 0 if report.status == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
