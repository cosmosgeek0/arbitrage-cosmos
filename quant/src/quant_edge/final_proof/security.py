"""Deterministic, syntax-aware security and Q17 scope verification.

The scanner reasons over executable Python AST nodes.  It intentionally does not
search comments, docstrings, generated-client strings, or innocent substrings.
Any exception for a process or local transport is both path-specific and bound to
an explicit, caller-supplied SHA-256; the file being scanned can never bless its
own digest.

Filesystem helpers bind caller-selected worktree bytes and path inventories.  They
do not inspect the Git index or commit tree; staged scope and clean-archive
exactness remain separate acceptance gates.
"""

from __future__ import annotations

import ast
import hashlib
import math
import os
import re
import stat
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Final


class SecurityPolicyError(ValueError):
    """A source, path, identity, or policy boundary failed closed."""


MAX_SOURCE_BYTES: Final = 2_097_152
MAX_FROZEN_BYTES: Final = 2_097_152
_SHA256_PATTERN: Final = re.compile(r"^[0-9a-f]{64}$")
DIRECTIVE_INPUT_LOCK_ACCEPTED_SHA256: Final = (
    "410010ef635a5e44b205e56c6b38f2d06e5b8e72312f5d63edcb24a5086355e1"
)
DIRECTIVE_INPUT_LOCK_ACCEPTED_BYTE_LENGTH: Final = 1_568
DIRECTIVE_INPUT_LOCK_CURRENT_SHA256: Final = (
    "d4bf31826625c2602ebb7ed72194e94a4571f7597a413ca545839f236c7a5a24"
)
DIRECTIVE_INPUT_LOCK_CURRENT_BYTE_LENGTH: Final = 1_757
PACKAGE_LOCK_ACCEPTED_SHA256: Final = (
    "3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf"
)
PACKAGE_LOCK_ACCEPTED_BYTE_LENGTH: Final = 147_793
PACKAGE_LOCK_CURRENT_SHA256: Final = (
    "59e4151191058e0bea3c82356e4b90ff84538cc1a62066104f05498d4f60b353"
)
PACKAGE_LOCK_CURRENT_BYTE_LENGTH: Final = 147_256

FROZEN_Q_LANE_FILES_SHA256: Final[tuple[tuple[str, str], ...]] = (
    (
        "EDGE_PROTOCOL_V1.md",
        "951fdbb5f347f900c61e60055f90cf2e1e1e743b75b7dc733652acb8d43353a1",
    ),
    (
        "packages/edge-protocol-tests/protocol.test.mjs",
        "b9745ad52d92c50fcfa48b9772024b86fcf4fa738e8c35c817fa77021ad970b9",
    ),
    (
        "packages/edge-protocol/fixtures/fixtures-v1.json",
        "c42a4257ea5f46abb38ec9ab4e56983e7049cdf5b448150a4d4647a6234d99a4",
    ),
    (
        "packages/edge-protocol/schema/edge-protocol-v1.schema.json",
        "229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c",
    ),
    (
        "quant/DIRECTIVE_INPUTS.lock",
        DIRECTIVE_INPUT_LOCK_ACCEPTED_SHA256,
    ),
    (
        "quant/EDGE_HYPOTHESIS_MAP.md",
        "234b0daf3086ce6e3a27fd96fa48581370bbdc427fb76cef63197fc6b303d3b4",
    ),
    (
        "quant/registry/edge_hypotheses.v1.json",
        "24c78ece6b0d6fb7307ba3b6fb01a396632db5ca557a7d52889e890b3912425e",
    ),
    (
        "quant/uv.lock",
        "716a9d0208f449bba51cde7fd67f9c90206ab0724aeac86ba862e119be859d29",
    ),
    (
        "package-lock.json",
        PACKAGE_LOCK_ACCEPTED_SHA256,
    ),
)

Q17_ALLOWED_PREFIXES: Final = (
    "quant/DECISIONS/Q17",
    "quant/RECEIPTS/Q17",
    "quant/TASKS/Q17",
    "quant/docs/Q17",
    "quant/generated/q17/",
    "quant/scripts/q17_",
    "quant/src/quant_edge/final_proof/",
    "quant/tests/q17/",
)
Q17_ALLOWED_EXACT: Final = ("quant/QUANT_EDGE_BUILD_STATE.md",)

_NETWORK_MODULES: Final = (
    "aiohttp",
    "binance",
    "boto3",
    "botocore",
    "ccxt",
    "ftplib",
    "grpc",
    "http.client",
    "httpcore",
    "httpx",
    "imaplib",
    "krakenex",
    "paramiko",
    "poplib",
    "requests",
    "smtplib",
    "telnetlib",
    "urllib.request",
    "urllib3",
    "websockets",
    "xmlrpc.client",
)
_LOCAL_TRANSPORT_MODULES: Final = ("socket", "socketserver")
_SUBPROCESS_MODULES: Final = ("subprocess",)
_PROCESS_MODULES: Final = ("multiprocessing",)
_UNSAFE_IMPORT_MODULES: Final = (
    "cloudpickle",
    "dill",
    "joblib",
    "marshal",
    "pickle",
    "shelve",
)
_ENV_IMPORT_MODULES: Final = ("decouple", "dotenv", "keyring")
_DYNAMIC_CALLS: Final = (
    "__import__",
    "builtins.__import__",
    "builtins.compile",
    "builtins.eval",
    "builtins.exec",
    "compile",
    "eval",
    "exec",
    "importlib.import_module",
)
_SHELL_CALLS: Final = (
    "os.execl",
    "os.execle",
    "os.execlp",
    "os.execlpe",
    "os.execv",
    "os.execve",
    "os.execvp",
    "os.execvpe",
    "os.fork",
    "os.forkpty",
    "os.popen",
    "os.posix_spawn",
    "os.posix_spawnp",
    "os.spawnl",
    "os.spawnle",
    "os.spawnlp",
    "os.spawnlpe",
    "os.spawnv",
    "os.spawnve",
    "os.spawnvp",
    "os.spawnvpe",
    "os.system",
    "pty.spawn",
)
_NETWORK_CALLS: Final = (
    "asyncio.create_connection",
    "asyncio.open_connection",
    "asyncio.start_server",
)
_ASYNCIO_NETWORK_METHODS: Final = frozenset(
    {
        "create_connection",
        "create_datagram_endpoint",
        "create_server",
        "create_unix_connection",
        "create_unix_server",
    }
)
_UNSAFE_DESERIALIZATION_CALLS: Final = (
    "pandas.read_pickle",
    "torch.jit.load",
    "torch.load",
    "yaml.load",
    "yaml.unsafe_load",
)
_Q16_TRANSPORT_PATH: Final = "inference/transport.py"
_Q16_INFERENCE_PATH: Final = "inference/service.py"
_CLI_PATH: Final = "cli.py"
_Q17_BENCHMARK_PATH: Final = "final_proof/benchmark.py"
_VERIFIED_REPORT_SEAL: Final = object()
_Q17_SUBPROCESS_DATA_ATTRIBUTES: Final = frozenset(
    {"subprocess.DEVNULL", "subprocess.PIPE", "subprocess.TimeoutExpired"}
)
_Q16_LOCAL_TRANSPORT_ATTRIBUTES: Final = frozenset(
    {
        "socket.AF_INET",
        "socket.AF_INET6",
        "socket.socket",
        "socketserver.BaseServer",
        "socketserver.StreamRequestHandler",
        "socketserver.TCPServer",
        "socketserver.ThreadingMixIn",
        "socketserver.UnixStreamServer",
    }
)


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _canonical_relative_path(value: str) -> str:
    if not isinstance(value, str) or not value or "\x00" in value or "\\" in value:
        raise SecurityPolicyError("relative path must be non-empty portable POSIX text")
    raw_parts = value.split("/")
    path = PurePosixPath(value)
    if (
        path.is_absolute()
        or any(part in ("", ".", "..") for part in raw_parts)
        or str(path) != value
    ):
        raise SecurityPolicyError(f"relative path is unsafe: {value!r}")
    return value


def _policy_path(value: str) -> str:
    """Normalize a source-root-relative path to its stable quant-edge suffix."""

    relative = _canonical_relative_path(value)
    marker = "src/quant_edge/"
    if marker in relative:
        return relative.split(marker, 1)[1]
    if relative.startswith("quant_edge/"):
        return relative.removeprefix("quant_edge/")
    return relative


def _validate_sha256(value: str, *, field: str) -> str:
    if not isinstance(value, str) or _SHA256_PATTERN.fullmatch(value) is None:
        raise SecurityPolicyError(f"{field} must be lowercase SHA-256")
    return value


def _finding_digest(
    source_sha256: str,
    relative_path: str,
    line: int,
    kind: str,
    symbol: str,
) -> str:
    material = "\x00".join((source_sha256, relative_path, str(line), kind, symbol)).encode()
    return _sha256(material)


@dataclass(frozen=True, slots=True, order=True)
class SecurityFindingV1:
    relative_path: str
    line: int
    kind: str
    symbol: str
    digest: str

    def __post_init__(self) -> None:
        _canonical_relative_path(self.relative_path)
        if isinstance(self.line, bool) or not isinstance(self.line, int) or self.line < 1:
            raise SecurityPolicyError("finding line must be a positive integer")
        if not self.kind or not self.symbol:
            raise SecurityPolicyError("finding kind/symbol must be non-empty")
        _validate_sha256(self.digest, field="finding digest")

    def as_mapping(self) -> dict[str, object]:
        return {
            "digest": self.digest,
            "kind": self.kind,
            "line": self.line,
            "relativePath": self.relative_path,
            "symbol": self.symbol,
        }


@dataclass(frozen=True, slots=True)
class SecurityScanV1:
    scanned_files: int
    source_set_sha256: str
    findings: tuple[SecurityFindingV1, ...]

    def __post_init__(self) -> None:
        if (
            isinstance(self.scanned_files, bool)
            or not isinstance(self.scanned_files, int)
            or self.scanned_files < 1
        ):
            raise SecurityPolicyError("security scan must cover at least one source file")
        _validate_sha256(self.source_set_sha256, field="source-set digest")
        if not isinstance(self.findings, tuple) or tuple(sorted(self.findings)) != self.findings:
            raise SecurityPolicyError("security findings must be a sorted tuple")
        if len(set(self.findings)) != len(self.findings):
            raise SecurityPolicyError("security findings must be unique")

    @property
    def clean(self) -> bool:
        return not self.findings

    def require_clean(self) -> None:
        if self.findings:
            first = self.findings[0]
            raise SecurityPolicyError(
                f"security scan rejected {first.relative_path}:{first.line} "
                f"{first.kind} {first.symbol}"
            )

    def as_mapping(self) -> dict[str, object]:
        return {
            "clean": self.clean,
            "findingCount": len(self.findings),
            "findings": [finding.as_mapping() for finding in self.findings],
            "scannedFiles": self.scanned_files,
            "schema": "Q17SecurityScanV1",
            "sourceSetSha256": self.source_set_sha256,
            "version": 1,
        }


def _module_matches(symbol: str, modules: tuple[str, ...]) -> bool:
    return any(symbol == module or symbol.startswith(f"{module}.") for module in modules)


def _constant_text(node: ast.AST, literals: Mapping[str, str]) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        return literals.get(node.id)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = _constant_text(node.left, literals)
        right = _constant_text(node.right, literals)
        if left is not None and right is not None:
            return left + right
    return None


def _constant_scalar(node: ast.AST, constants: Mapping[str, object]) -> object:
    if isinstance(node, ast.Constant) and isinstance(node.value, (bool, int, str)):
        return node.value
    if isinstance(node, ast.Name) and node.id in constants:
        return constants[node.id]
    return object()


def _resolve_expression(
    node: ast.AST,
    aliases: Mapping[str, str],
    literals: Mapping[str, str],
) -> str:
    if isinstance(node, ast.Name):
        if node.id == "__builtins__":
            return "builtins"
        return aliases.get(node.id, node.id)
    if isinstance(node, ast.Attribute):
        base = _resolve_expression(node.value, aliases, literals)
        return f"{base}.{node.attr}" if base else node.attr
    if isinstance(node, ast.Subscript):
        base = _resolve_expression(node.value, aliases, literals)
        key = _constant_text(node.slice, literals)
        if base.endswith(".__dict__"):
            base = base.removesuffix(".__dict__")
        return f"{base}.{key}" if base and key else f"{base}.<dynamic>"
    if isinstance(node, ast.Call):
        target = _resolve_expression(node.func, aliases, literals)
        if target in ("vars", "builtins.vars") and len(node.args) == 1:
            return f"{_resolve_expression(node.args[0], aliases, literals)}.__dict__"
        if target in ("getattr", "builtins.getattr") and len(node.args) >= 2:
            base = _resolve_expression(node.args[0], aliases, literals)
            key = _constant_text(node.args[1], literals)
            return f"{base}.{key}" if key else f"{base}.<dynamic>"
        return target
    return "<dynamic>"


def _name_tokens(symbol: str) -> tuple[str, ...]:
    leaf = symbol.rsplit(".", 1)[-1]
    separated = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", leaf)
    return tuple(token for token in re.split(r"[^A-Za-z0-9]+", separated.casefold()) if token)


def _all_symbol_tokens(symbol: str) -> set[str]:
    separated = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", symbol)
    return {token for token in re.split(r"[^A-Za-z0-9]+", separated.casefold()) if token}


def _sensitive_dynamic_base(symbol: str) -> bool:
    base = symbol.removesuffix(".<dynamic>")
    return bool(
        _all_symbol_tokens(base)
        & {
            "account",
            "api",
            "builtins",
            "client",
            "exchange",
            "os",
            "private",
            "signed",
            "subprocess",
            "venue",
        }
    )


def _authority_kind(symbol: str) -> str | None:
    tokens = _name_tokens(symbol)
    token_set = set(tokens)
    money = token_set & {"borrow", "repay", "transfer", "withdraw", "withdrawal"}
    authority_verbs = {
        "call",
        "create",
        "execute",
        "initiate",
        "mutate",
        "request",
        "send",
        "submit",
    }
    money_modifiers = {"all", "asset", "assets", "fund", "funds", "request"}
    if (
        (len(tokens) == 1 and bool(money))
        or (bool(money) and bool(token_set & authority_verbs))
        or (
            bool(tokens)
            and tokens[0] in {"borrow", "repay", "transfer", "withdraw", "withdrawal"}
            and set(tokens[1:]) <= money_modifiers
        )
    ):
        return "MONEY_AUTHORITY"
    if (len(tokens) == 1 and token_set & {"leverage", "margin"}) or (
        token_set & {"leverage", "margin"}
        and token_set & {"change", "increase", "mutate", "set", "update"}
    ):
        return "LEVERAGE_MARGIN_AUTHORITY"
    if token_set & {"order", "orders"} and token_set & {
        "cancel",
        "buy",
        "create",
        "execute",
        "new",
        "place",
        "send",
        "sell",
        "submit",
    }:
        return "ORDER_AUTHORITY"
    if len(tokens) == 1 and token_set & {"buy", "sell"}:
        return "ORDER_AUTHORITY"
    if tokens in (("order",), ("account",)) or (
        "account" in token_set and token_set & {"balance", "fetch", "get", "info", "mutate"}
    ):
        return "ACCOUNT_AUTHORITY"
    if "risk" in token_set and token_set & {"approval", "approve", "authorize", "gate"}:
        return "RISK_APPROVAL_AUTHORITY"
    if token_set & {"signed", "authenticated", "private"} and token_set & {
        "api",
        "call",
        "client",
        "exchange",
        "request",
    }:
        return "PRIVATE_EXCHANGE_AUTHORITY"
    all_tokens = _all_symbol_tokens(symbol)
    sensitive_base = bool(
        all_tokens & {"account", "api", "client", "exchange", "private", "signed", "venue"}
    )
    if sensitive_base and all_tokens & {
        "borrow",
        "loan",
        "margin",
        "repay",
        "transfer",
        "withdraw",
        "withdrawal",
    }:
        return "MONEY_AUTHORITY"
    if (
        sensitive_base
        and all_tokens & {"asset", "assets", "balance", "balances", "user"}
        and (all_tokens & {"fetch", "get", "list", "read"})
    ):
        return "ACCOUNT_AUTHORITY"
    if sensitive_base and (
        (
            all_tokens & {"order", "orders", "trade", "trades"}
            and all_tokens & {"fetch", "get", "list", "my", "open", "read"}
        )
        or (
            "futures" in all_tokens
            and all_tokens & {"account", "information", "position", "positions"}
        )
    ):
        return "ACCOUNT_AUTHORITY"
    if sensitive_base and all_tokens & {"api", "exchange", "venue"} and "request" in all_tokens:
        return "PRIVATE_EXCHANGE_AUTHORITY"
    return None


def _keyword(call: ast.Call, name: str) -> ast.AST | None:
    for item in call.keywords:
        if item.arg == name:
            return item.value
    return None


def _is_true(node: ast.AST | None) -> bool:
    return isinstance(node, ast.Constant) and node.value is True


def _is_false_or_absent(node: ast.AST | None) -> bool:
    return node is None or (isinstance(node, ast.Constant) and node.value is False)


def _positive_literal(node: ast.AST | None) -> bool:
    return (
        isinstance(node, ast.Constant)
        and not isinstance(node.value, bool)
        and isinstance(node.value, (int, float))
        and node.value > 0
        and math.isfinite(float(node.value))
    )


def _positive_number_names(
    nodes: Iterable[ast.AST],
    inherited: Iterable[str] = (),
) -> frozenset[str]:
    names = set(inherited)
    for name, value, _line in _named_assignments(nodes):
        if _positive_literal(value):
            names.add(name)
    return frozenset(names)


def _positive_cleanup_timeout(node: ast.AST, positive_names: frozenset[str]) -> bool:
    if _positive_literal(node):
        return True
    if isinstance(node, ast.Name):
        return node.id in positive_names
    return (
        isinstance(node, ast.BinOp)
        and isinstance(node.op, ast.Div)
        and isinstance(node.left, ast.Name)
        and node.left.id in positive_names
        and _positive_literal(node.right)
    )


class _LexicalScopeCollector(ast.NodeVisitor):
    """Collect one executable lexical scope without borrowing nested-function nodes."""

    def __init__(self, root: ast.Module | ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        self.root = root
        self.nodes: list[ast.AST] = []

    def collect(self) -> tuple[ast.AST, ...]:
        for statement in self.root.body:
            self.visit(statement)
        return tuple(self.nodes)

    def generic_visit(self, node: ast.AST) -> None:
        self.nodes.append(node)
        super().generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self.nodes.append(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.nodes.append(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.nodes.append(node)

    def visit_Lambda(self, node: ast.Lambda) -> None:
        self.nodes.append(node)


def _scope_aliases(nodes: Iterable[ast.AST]) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for node in nodes:
        if isinstance(node, ast.Import):
            for item in node.names:
                aliases[item.asname or item.name.split(".", 1)[0]] = item.name
        elif isinstance(node, ast.ImportFrom) and node.module:
            for item in node.names:
                aliases[item.asname or item.name] = f"{node.module}.{item.name}"
    return aliases


def _named_assignments(nodes: Iterable[ast.AST]) -> list[tuple[str, ast.AST, int]]:
    assignments: list[tuple[str, ast.AST, int]] = []
    for node in nodes:
        if isinstance(node, ast.Assign):
            targets = node.targets
            value = node.value
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets = [node.target]
            value = node.value
        else:
            continue
        for target in targets:
            if isinstance(target, ast.Name):
                assignments.append((target.id, value, node.lineno))
    return assignments


def _fixed_argv_at_call(
    node: ast.AST,
    *,
    call_line: int,
    assignments: Iterable[tuple[str, ast.AST, int]],
    aliases: Mapping[str, str],
) -> bool:
    if isinstance(node, ast.Name):
        candidates = [
            value for name, value, line in assignments if name == node.id and line < call_line
        ]
        if not candidates:
            return False
        node = candidates[-1]
    if not isinstance(node, (ast.List, ast.Tuple)) or not node.elts:
        return False
    return _resolve_expression(node.elts[0], aliases, {}) == "sys.executable"


def _same_owner_cleanup(
    nodes: Iterable[ast.AST],
    *,
    owner: str,
    spawn_line: int,
    positive_timeout_names: frozenset[str],
) -> bool:
    timed: list[int] = []
    killed: list[int] = []
    bounded_reaps: list[int] = []
    for node in nodes:
        if (
            not isinstance(node, ast.Call)
            or not isinstance(node.func, ast.Attribute)
            or not isinstance(node.func.value, ast.Name)
            or node.func.value.id != owner
            or node.lineno <= spawn_line
        ):
            continue
        if node.func.attr == "kill":
            killed.append(node.lineno)
        elif node.func.attr == "communicate":
            timeout = _keyword(node, "timeout")
            if timeout is not None:
                timed.append(node.lineno)
                if _positive_cleanup_timeout(timeout, positive_timeout_names):
                    bounded_reaps.append(node.lineno)
    return any(start < kill < reap for start in timed for kill in killed for reap in bounded_reaps)


def _direct_subprocess_scope_is_safe(
    nodes: tuple[ast.AST, ...],
    *,
    inherited_aliases: Mapping[str, str],
    inherited_positive_numbers: frozenset[str] = frozenset(),
) -> tuple[bool, bool]:
    aliases = {**inherited_aliases, **_scope_aliases(nodes)}
    assignments = _named_assignments(nodes)
    positive_numbers = _positive_number_names(nodes, inherited_positive_numbers)
    calls = [
        node
        for node in nodes
        if isinstance(node, ast.Call)
        and _resolve_expression(node.func, aliases, {}).startswith("subprocess.")
    ]
    if not calls:
        return True, False
    for call in calls:
        symbol = _resolve_expression(call.func, aliases, {})
        if symbol not in ("subprocess.Popen", "subprocess.run") or not call.args:
            return False, True
        if not _is_false_or_absent(_keyword(call, "shell")) or not _fixed_argv_at_call(
            call.args[0],
            call_line=call.lineno,
            assignments=assignments,
            aliases=aliases,
        ):
            return False, True
        if symbol == "subprocess.run":
            if not _positive_literal(_keyword(call, "timeout")):
                return False, True
            continue
        owners = [
            name
            for name, value, _line in assignments
            if isinstance(value, ast.Call) and value is call
        ]
        if len(owners) != 1 or not _same_owner_cleanup(
            nodes,
            owner=owners[0],
            spawn_line=call.lineno,
            positive_timeout_names=positive_numbers,
        ):
            return False, True
    return True, True


def _is_index(node: ast.AST, owner: str, index: int) -> bool:
    return (
        isinstance(node, ast.Subscript)
        and isinstance(node.value, ast.Name)
        and node.value.id == owner
        and isinstance(node.slice, ast.Constant)
        and node.slice.value == index
    )


def _is_resolved_path_index(node: ast.AST, owner: str, index: int) -> bool:
    return (
        isinstance(node, ast.Call)
        and not node.args
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "resolve"
        and isinstance(node.func.value, ast.Call)
        and len(node.func.value.args) == 1
        and isinstance(node.func.value.func, ast.Name)
        and node.func.value.func.id == "Path"
        and _is_index(node.func.value.args[0], owner, index)
    )


def _is_resolved_current_file(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Call)
        and not node.args
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "resolve"
        and isinstance(node.func.value, ast.Call)
        and len(node.func.value.args) == 1
        and isinstance(node.func.value.func, ast.Name)
        and node.func.value.func.id == "Path"
        and isinstance(node.func.value.args[0], ast.Name)
        and node.func.value.args[0].id == "__file__"
    )


def _guarded_benchmark_wrapper_is_safe(
    tree: ast.Module,
    *,
    global_aliases: Mapping[str, str],
) -> bool:
    protected_names = {
        "_run_child_peak_rss_with_spawn",
        "_spawn_child",
        "run_child_peak_rss",
    }
    protected_functions = {
        name: [
            node
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name
        ]
        for name in protected_names
    }
    if any(len(nodes) != 1 or nodes[0] not in tree.body for nodes in protected_functions.values()):
        return False
    functions = {name: nodes[0] for name, nodes in protected_functions.items()}
    spawn_function = functions.get("_spawn_child")
    run_function = functions.get("_run_child_peak_rss_with_spawn")
    public_function = functions.get("run_child_peak_rss")
    if spawn_function is None or run_function is None or public_function is None:
        return False
    spawn_nodes = _LexicalScopeCollector(spawn_function).collect()
    spawn_aliases = {**global_aliases, **_scope_aliases(spawn_nodes)}
    popen_calls = [
        node
        for node in spawn_nodes
        if isinstance(node, ast.Call)
        and _resolve_expression(node.func, spawn_aliases, {}) == "subprocess.Popen"
    ]
    if len(popen_calls) != 1:
        return False
    popen = popen_calls[0]
    if (
        not popen.args
        or not isinstance(popen.args[0], ast.Name)
        or popen.args[0].id != "argv"
        or not _is_false_or_absent(_keyword(popen, "shell"))
        or not any(isinstance(node, ast.Return) and node.value is popen for node in spawn_nodes)
    ):
        return False

    run_nodes = _LexicalScopeCollector(run_function).collect()
    run_aliases = {**global_aliases, **_scope_aliases(run_nodes)}
    assignments = _named_assignments(run_nodes)
    module_nodes = _LexicalScopeCollector(tree).collect()
    positive_numbers = _positive_number_names(
        run_nodes,
        _positive_number_names(module_nodes),
    )
    child_rows = [
        (name, value, line)
        for name, value, line in assignments
        if isinstance(value, ast.Call)
        and _resolve_expression(value.func, run_aliases, {}) == "spawn"
        and len(value.args) == 2
        and all(
            isinstance(argument, ast.Name) and argument.id == expected
            for argument, expected in zip(value.args, ("argv", "cwd"), strict=True)
        )
    ]
    if len(child_rows) != 1:
        return False
    child_name, _spawn_call, spawn_line = child_rows[0]
    if not _same_owner_cleanup(
        run_nodes,
        owner=child_name,
        spawn_line=spawn_line,
        positive_timeout_names=positive_numbers,
    ):
        return False
    try:
        spawn_index = [argument.arg for argument in run_function.args.kwonlyargs].index("spawn")
    except ValueError:
        return False
    default = run_function.args.kw_defaults[spawn_index]
    if default is not None:
        return False

    public_nodes = _LexicalScopeCollector(public_function).collect()
    public_aliases = {**global_aliases, **_scope_aliases(public_nodes)}
    public_assignments = _named_assignments(public_nodes)
    argv_values = [
        value
        for name, value, _line in public_assignments
        if name == "argv" and isinstance(value, ast.Tuple) and len(value.elts) == 4
    ]
    if len(argv_values) != 1:
        return False
    argv_value = argv_values[0]
    source_arg = argv_value.elts[1]
    root_arg = argv_value.elts[3]
    source_is_exact = (
        isinstance(source_arg, ast.Call)
        and isinstance(source_arg.func, ast.Name)
        and source_arg.func.id == "str"
        and len(source_arg.args) == 1
        and not source_arg.keywords
        and _is_resolved_current_file(source_arg.args[0])
    )
    root_is_exact = (
        isinstance(root_arg, ast.Call)
        and isinstance(root_arg.func, ast.Name)
        and root_arg.func.id == "str"
        and len(root_arg.args) == 1
        and not root_arg.keywords
        and isinstance(root_arg.args[0], ast.Call)
        and isinstance(root_arg.args[0].func, ast.Attribute)
        and isinstance(root_arg.args[0].func.value, ast.Name)
        and root_arg.args[0].func.value.id == "repo_root"
        and root_arg.args[0].func.attr == "resolve"
        and not root_arg.args[0].args
        and not root_arg.args[0].keywords
    )
    argv_is_exact = (
        _resolve_expression(argv_value.elts[0], public_aliases, {}) == "sys.executable"
        and source_is_exact
        and isinstance(argv_value.elts[2], ast.Constant)
        and argv_value.elts[2].value == "--q17-rss-child"
        and root_is_exact
    )
    public_calls = [
        node
        for node in public_nodes
        if isinstance(node, ast.Call)
        and _resolve_expression(node.func, public_aliases, {}) == "_run_child_peak_rss_with_spawn"
    ]
    if len(public_calls) != 1 or not argv_is_exact:
        return False
    public_call = public_calls[0]
    public_keywords = {
        item.arg: item.value for item in public_call.keywords if item.arg is not None
    }
    public_call_is_exact = (
        len(public_call.args) == 1
        and isinstance(public_call.args[0], ast.Name)
        and public_call.args[0].id == "argv"
        and len(public_keywords) == len(public_call.keywords) == 3
        and set(public_keywords) == {"cwd", "spawn", "timeout_ms"}
        and isinstance(public_keywords["cwd"], ast.Name)
        and public_keywords["cwd"].id == "repo_root"
        and isinstance(public_keywords["spawn"], ast.Name)
        and public_keywords["spawn"].id == "_spawn_child"
        and isinstance(public_keywords["timeout_ms"], ast.Name)
        and public_keywords["timeout_ms"].id == "timeout_ms"
        and any(isinstance(node, ast.Return) and node.value is public_call for node in public_nodes)
    )
    public_signature_is_exact = (
        not public_function.args.posonlyargs
        and [item.arg for item in public_function.args.args] == ["repo_root"]
        and [item.arg for item in public_function.args.kwonlyargs] == ["timeout_ms"]
        and not public_function.args.defaults
        and public_function.args.kw_defaults == [None]
        and public_function.args.vararg is None
        and public_function.args.kwarg is None
    )
    if not public_call_is_exact or not public_signature_is_exact:
        return False

    rejects = [
        node
        for node in run_nodes
        if isinstance(node, ast.If)
        and node.lineno < spawn_line
        and any(
            isinstance(item, ast.Raise) for statement in node.body for item in ast.walk(statement)
        )
    ]
    comparisons = [
        item
        for reject in rejects
        for item in ast.walk(reject.test)
        if isinstance(item, ast.Compare)
        and len(item.ops) == 1
        and isinstance(item.ops[0], ast.NotEq)
        and len(item.comparators) == 1
    ]

    def has_comparison(predicate: Callable[[ast.AST, ast.AST], bool]) -> bool:
        return any(predicate(item.left, item.comparators[0]) for item in comparisons)

    expected_source = next(
        (
            value
            for name, value, line in assignments
            if name == "expected_source" and line < spawn_line
        ),
        None,
    )
    if expected_source is None or not _is_resolved_current_file(expected_source):
        return False
    executable_guard = has_comparison(
        lambda left, right: (
            _is_index(left, "argv", 0)
            and _resolve_expression(right, run_aliases, {}) == "sys.executable"
        )
    )
    source_guard = has_comparison(
        lambda left, right: (
            _is_resolved_path_index(left, "argv", 1)
            and isinstance(right, ast.Name)
            and right.id == "expected_source"
        )
    )
    mode_guard = has_comparison(
        lambda left, right: (
            _is_index(left, "argv", 2)
            and isinstance(right, ast.Constant)
            and right.value == "--q17-rss-child"
        )
    )
    cwd_guard = has_comparison(
        lambda left, right: (
            _is_resolved_path_index(left, "argv", 3)
            and isinstance(right, ast.Call)
            and isinstance(right.func, ast.Attribute)
            and isinstance(right.func.value, ast.Name)
            and right.func.value.id == "cwd"
            and right.func.attr == "resolve"
            and not right.args
        )
    )
    tuple_guard = any(
        isinstance(item, ast.UnaryOp)
        and isinstance(item.op, ast.Not)
        and isinstance(item.operand, ast.Call)
        and isinstance(item.operand.func, ast.Name)
        and item.operand.func.id == "isinstance"
        and len(item.operand.args) == 2
        and isinstance(item.operand.args[0], ast.Name)
        and item.operand.args[0].id == "argv"
        and isinstance(item.operand.args[1], ast.Name)
        and item.operand.args[1].id == "tuple"
        for reject in rejects
        for item in ast.walk(reject.test)
    )
    return tuple_guard and executable_guard and source_guard and mode_guard and cwd_guard


def _benchmark_subprocess_is_safe(tree: ast.Module) -> bool:
    module_nodes = _LexicalScopeCollector(tree).collect()
    global_aliases = _scope_aliases(module_nodes)
    global_positive_numbers = _positive_number_names(module_nodes)
    scopes: list[tuple[str | None, tuple[ast.AST, ...]]] = [(None, module_nodes)]
    scopes.extend(
        (node.name, _LexicalScopeCollector(node).collect())
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    )
    saw_subprocess = False
    wrapper_safe = _guarded_benchmark_wrapper_is_safe(tree, global_aliases=global_aliases)
    for scope_name, nodes in scopes:
        aliases = {**global_aliases, **_scope_aliases(nodes)}
        subprocess_symbols = [
            _resolve_expression(node.func, aliases, {})
            for node in nodes
            if isinstance(node, ast.Call)
            and _resolve_expression(node.func, aliases, {}).startswith("subprocess.")
        ]
        if not subprocess_symbols:
            continue
        saw_subprocess = True
        if subprocess_symbols == ["subprocess.Popen"] and scope_name == "_spawn_child":
            if not wrapper_safe:
                return False
            continue
        safe, _saw = _direct_subprocess_scope_is_safe(
            nodes,
            inherited_aliases=global_aliases,
            inherited_positive_numbers=global_positive_numbers,
        )
        if not safe:
            return False
    return saw_subprocess


def _single_function(
    tree: ast.Module,
    name: str,
) -> ast.FunctionDef | ast.AsyncFunctionDef | None:
    matches = [
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name
    ]
    return matches[0] if len(matches) == 1 else None


def _owner_method_calls(
    root: ast.AST,
    *,
    owner: str,
    method: str,
) -> tuple[ast.Call, ...]:
    return tuple(
        node
        for node in ast.walk(root)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == owner
        and node.func.attr == method
    )


def _q16_worker_process_is_safe(tree: ast.Module) -> bool:
    """Recognize the exact bounded, disposable Q16 spawn-worker lifecycle."""

    module_nodes = _LexicalScopeCollector(tree).collect()
    aliases = _scope_aliases(module_nodes)
    context_calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and _resolve_expression(node.func, aliases, {}) == "multiprocessing.get_context"
    ]
    if not (
        len(context_calls) == 1
        and len(context_calls[0].args) == 1
        and isinstance(context_calls[0].args[0], ast.Constant)
        and context_calls[0].args[0].value == "spawn"
    ):
        return False

    run_worker = _single_function(tree, "_run_inference_worker")
    reap_worker = _single_function(tree, "_reap_worker")
    run_assessment = _single_function(tree, "_run_assessment_worker")
    if run_worker is None or reap_worker is None or run_assessment is None:
        return False

    pipe_calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and _resolve_expression(node.func, aliases, {}) == "self._worker_context.Pipe"
    ]
    process_calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and _resolve_expression(node.func, aliases, {}) == "self._worker_context.Process"
    ]
    if len(pipe_calls) != 1 or len(process_calls) != 1:
        return False
    pipe_call = pipe_calls[0]
    process_call = process_calls[0]
    if pipe_call not in tuple(ast.walk(run_assessment)) or process_call not in tuple(
        ast.walk(run_assessment)
    ):
        return False
    duplex = _keyword(pipe_call, "duplex")
    target = _keyword(process_call, "target")
    if not (
        isinstance(duplex, ast.Constant)
        and duplex.value is False
        and isinstance(target, ast.Name)
        and target.id == "_run_inference_worker"
        and _is_true(_keyword(process_call, "daemon"))
    ):
        return False

    if len(_owner_method_calls(run_assessment, owner="process", method="start")) != 1:
        return False
    reap_calls = [
        node
        for node in ast.walk(run_assessment)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "_reap_worker"
        and node.args
        and isinstance(node.args[0], ast.Name)
        and node.args[0].id == "process"
        and _keyword(node, "terminate") is not None
    ]
    if len(reap_calls) < 2:
        return False

    reap_requirements = {
        "close": 1,
        "join": 3,
        "kill": 1,
        "terminate": 1,
    }
    if any(
        len(_owner_method_calls(reap_worker, owner="process", method=method)) < count
        for method, count in reap_requirements.items()
    ):
        return False
    positive_timeouts = _positive_number_names(module_nodes)
    join_calls = _owner_method_calls(reap_worker, owner="process", method="join")
    if any(
        (timeout := _keyword(call, "timeout")) is None
        or not _positive_cleanup_timeout(timeout, positive_timeouts)
        for call in join_calls
    ):
        return False
    close_in_finally = any(
        any(
            _owner_method_calls(statement, owner="connection", method="close")
            for statement in node.finalbody
        )
        for node in ast.walk(run_worker)
        if isinstance(node, ast.Try) and node.finalbody
    )
    return close_in_finally


class _SecurityVisitor(ast.NodeVisitor):
    def __init__(
        self,
        *,
        relative_path: str,
        source_sha256: str,
        trusted: bool,
        trusted_process_semantics: bool,
        trusted_subprocess_semantics: bool,
    ) -> None:
        self.relative_path = relative_path
        self.policy_path = _policy_path(relative_path)
        self.source_sha256 = source_sha256
        self.trusted = trusted
        self.trusted_process_semantics = trusted_process_semantics
        self.trusted_subprocess_semantics = trusted_subprocess_semantics
        self.aliases: dict[str, str] = {}
        self.literals: dict[str, str] = {}
        self.constants: dict[str, object] = {}
        self.findings: set[SecurityFindingV1] = set()
        self._call_targets: set[int] = set()

    @property
    def allow_local_transport(self) -> bool:
        return self.trusted and self.policy_path == _Q16_TRANSPORT_PATH

    @property
    def allow_subprocess(self) -> bool:
        return self.trusted and (
            self.policy_path == _CLI_PATH
            or (self.policy_path == _Q17_BENCHMARK_PATH and self.trusted_subprocess_semantics)
        )

    @property
    def allow_process(self) -> bool:
        return (
            self.trusted
            and self.policy_path == _Q16_INFERENCE_PATH
            and self.trusted_process_semantics
        )

    def _record(self, node: ast.AST, kind: str, symbol: str) -> None:
        line = getattr(node, "lineno", 1)
        self.findings.add(
            SecurityFindingV1(
                relative_path=self.relative_path,
                line=line,
                kind=kind,
                symbol=symbol,
                digest=_finding_digest(
                    self.source_sha256,
                    self.relative_path,
                    line,
                    kind,
                    symbol,
                ),
            )
        )

    def _check_import(self, node: ast.AST, symbol: str) -> None:
        if _module_matches(symbol, _NETWORK_MODULES):
            self._record(node, "EXTERNAL_NETWORK_IMPORT", symbol)
        elif _module_matches(symbol, _LOCAL_TRANSPORT_MODULES):
            if not self.allow_local_transport:
                self._record(node, "LOCAL_TRANSPORT_IMPORT", symbol)
        elif _module_matches(symbol, _SUBPROCESS_MODULES):
            if not self.allow_subprocess:
                self._record(node, "SUBPROCESS_IMPORT", symbol)
        elif _module_matches(symbol, _PROCESS_MODULES):
            if not self.allow_process:
                self._record(node, "PROCESS_CONTROL_IMPORT", symbol)
        elif _module_matches(symbol, _UNSAFE_IMPORT_MODULES):
            self._record(node, "UNSAFE_DESERIALIZATION_IMPORT", symbol)
        elif _module_matches(symbol, _ENV_IMPORT_MODULES):
            self._record(node, "ENV_SECRET_IMPORT", symbol)

    def visit_Import(self, node: ast.Import) -> None:
        for item in node.names:
            local = item.asname or item.name.split(".", 1)[0]
            self.aliases[local] = item.name if item.asname else local
            self._check_import(node, item.name)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.level or node.module is None:
            return
        for item in node.names:
            symbol = f"{node.module}.{item.name}"
            self.aliases[item.asname or item.name] = symbol
            self._check_import(node, symbol)

    def _bind(self, target: ast.AST, value: ast.AST) -> None:
        if not isinstance(target, ast.Name):
            return
        text = _constant_text(value, self.literals)
        if text is not None:
            self.literals[target.id] = text
        scalar = _constant_scalar(value, self.constants)
        if isinstance(scalar, (bool, int, str)):
            self.constants[target.id] = scalar
        symbol = _resolve_expression(value, self.aliases, self.literals)
        if symbol != "<dynamic>":
            self.aliases[target.id] = symbol

    def visit_Assign(self, node: ast.Assign) -> None:
        for target in node.targets:
            self._bind(target, node.value)
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        if node.value is not None:
            self._bind(node.target, node.value)
        self.generic_visit(node)

    def _check_symbol(self, node: ast.AST, symbol: str, *, attribute: bool = False) -> None:
        if symbol.endswith(".<dynamic>") and _sensitive_dynamic_base(symbol):
            self._record(node, "DYNAMIC_SENSITIVE_ATTRIBUTE", symbol)
        if symbol.startswith("os.environ") or symbol in ("os.getenv", "os.getenvb", "os.environ"):
            self._record(node, "ENV_SECRET_READ", symbol)
        if symbol in _DYNAMIC_CALLS:
            self._record(node, "DYNAMIC_EXECUTION", symbol)
        if symbol in _SHELL_CALLS:
            self._record(node, "SHELL_EXECUTION", symbol)
        if symbol.startswith("subprocess.") and not self.allow_subprocess:
            self._record(node, "SUBPROCESS_CALL", symbol)
        elif (
            attribute
            and self.policy_path == _Q17_BENCHMARK_PATH
            and self.allow_subprocess
            and symbol.startswith("subprocess.")
            and symbol not in _Q17_SUBPROCESS_DATA_ATTRIBUTES
        ):
            self._record(node, "UNAPPROVED_SUBPROCESS_SYMBOL", symbol)
        if _module_matches(symbol, _PROCESS_MODULES) and not self.allow_process:
            self._record(node, "PROCESS_CONTROL_CALL", symbol)
        if _module_matches(symbol, _NETWORK_MODULES):
            self._record(node, "EXTERNAL_NETWORK_CALL", symbol)
        if symbol in _NETWORK_CALLS:
            self._record(node, "EXTERNAL_NETWORK_CALL", symbol)
        if symbol.startswith("asyncio.") and symbol.rsplit(".", 1)[-1] in _ASYNCIO_NETWORK_METHODS:
            self._record(node, "EXTERNAL_NETWORK_CALL", symbol)
        if _module_matches(symbol, _LOCAL_TRANSPORT_MODULES):
            if not self.allow_local_transport:
                self._record(node, "LOCAL_TRANSPORT_CALL", symbol)
            elif not attribute or symbol not in _Q16_LOCAL_TRANSPORT_ATTRIBUTES:
                self._record(node, "UNAPPROVED_LOCAL_TRANSPORT_SYMBOL", symbol)
        if (
            _module_matches(symbol, _UNSAFE_IMPORT_MODULES)
            or symbol in _UNSAFE_DESERIALIZATION_CALLS
        ):
            self._record(node, "UNSAFE_DESERIALIZATION_CALL", symbol)
        authority = _authority_kind(symbol)
        base_tokens = set(_name_tokens(symbol.rsplit(".", 1)[0]))
        authority_attribute = not attribute or bool(
            base_tokens & {"account", "api", "client", "exchange", "private", "signed", "venue"}
        )
        if authority is not None and authority_attribute:
            self._record(node, f"{authority}_{'ATTRIBUTE' if attribute else 'CALL'}", symbol)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if id(node) not in self._call_targets:
            symbol = _resolve_expression(node, self.aliases, self.literals)
            self._check_symbol(node, symbol, attribute=True)
        self.generic_visit(node)

    def visit_Subscript(self, node: ast.Subscript) -> None:
        symbol = _resolve_expression(node, self.aliases, self.literals)
        self._check_symbol(node, symbol, attribute=True)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, (ast.Attribute, ast.Subscript)):
            self._call_targets.add(id(node.func))
        symbol = _resolve_expression(node.func, self.aliases, self.literals)
        self._check_symbol(node, symbol)

        if symbol in ("__import__", "builtins.__import__", "importlib.import_module"):
            imported = _constant_text(node.args[0], self.literals) if node.args else None
            if imported is None:
                self._record(node, "DYNAMIC_IMPORT_UNKNOWN", symbol)
            else:
                self._check_import(node, imported)

        if symbol in ("getattr", "builtins.getattr") and len(node.args) >= 2:
            base = _resolve_expression(node.args[0], self.aliases, self.literals)
            key = _constant_text(node.args[1], self.literals)
            if key is not None:
                self._check_symbol(node, f"{base}.{key}", attribute=True)
            elif _module_matches(base, _NETWORK_MODULES):
                self._record(node, "DYNAMIC_NETWORK_ATTRIBUTE", f"{base}.<dynamic>")
            elif _sensitive_dynamic_base(f"{base}.<dynamic>"):
                self._record(node, "DYNAMIC_SENSITIVE_ATTRIBUTE", f"{base}.<dynamic>")

        allow_pickle = _keyword(node, "allow_pickle")
        if allow_pickle is None and len(node.args) >= 3:
            allow_pickle = node.args[2]
        pickle_setting = (
            _constant_scalar(allow_pickle, self.constants) if allow_pickle is not None else False
        )
        if symbol in ("numpy.load", "np.load") and pickle_setting not in (False, 0):
            self._record(node, "UNSAFE_DESERIALIZATION_CALL", f"{symbol}[allow_pickle=True]")
        if symbol.startswith("subprocess.") and not self.allow_subprocess:
            shell = _keyword(node, "shell")
            if _is_true(shell) or (node.args and isinstance(node.args[0], ast.Constant)):
                self._record(node, "SHELL_EXECUTION", symbol)
        self.generic_visit(node)


def _trusted_digest(
    relative_path: str,
    source_sha256: str,
    trusted_source_sha256: Mapping[str, str] | None,
) -> bool:
    if trusted_source_sha256 is None:
        return False
    policy_path = _policy_path(relative_path)
    normalized: dict[str, str] = {}
    for path, digest in trusted_source_sha256.items():
        canonical = _policy_path(path)
        if canonical in normalized:
            raise SecurityPolicyError(f"duplicate trusted source identity: {canonical}")
        normalized[canonical] = _validate_sha256(
            digest,
            field=f"trusted digest for {canonical}",
        )
    return normalized.get(policy_path) == source_sha256


def scan_python_bytes(
    raw: bytes,
    *,
    relative_path: str,
    trusted_source_sha256: Mapping[str, str] | None = None,
) -> SecurityScanV1:
    """Scan one Python source byte string without executing or importing it."""

    relative = _canonical_relative_path(relative_path)
    if type(raw) is not bytes or not raw or len(raw) > MAX_SOURCE_BYTES:
        raise SecurityPolicyError("Python source must be bounded non-empty bytes")
    source_sha256 = _sha256(raw)
    trusted = _trusted_digest(relative, source_sha256, trusted_source_sha256)
    try:
        source = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        finding = SecurityFindingV1(
            relative,
            1,
            "INVALID_UTF8",
            "<decode>",
            _finding_digest(source_sha256, relative, 1, "INVALID_UTF8", "<decode>"),
        )
        return SecurityScanV1(1, source_sha256, (finding,))
    try:
        tree = ast.parse(source, filename=relative, mode="exec")
    except SyntaxError as error:
        line = error.lineno or 1
        symbol = error.msg or "invalid syntax"
        finding = SecurityFindingV1(
            relative,
            line,
            "SYNTAX_ERROR",
            symbol,
            _finding_digest(source_sha256, relative, line, "SYNTAX_ERROR", symbol),
        )
        return SecurityScanV1(1, source_sha256, (finding,))
    benchmark_safe = (
        trusted
        and _policy_path(relative) == _Q17_BENCHMARK_PATH
        and _benchmark_subprocess_is_safe(tree)
    )
    process_safe = (
        trusted
        and _policy_path(relative) == _Q16_INFERENCE_PATH
        and _q16_worker_process_is_safe(tree)
    )
    visitor = _SecurityVisitor(
        relative_path=relative,
        source_sha256=source_sha256,
        trusted=trusted,
        trusted_process_semantics=process_safe,
        trusted_subprocess_semantics=benchmark_safe,
    )
    visitor.visit(tree)
    findings = tuple(sorted(visitor.findings))
    return SecurityScanV1(1, source_sha256, findings)


def _read_regular_file(root: Path, relative_path: str, *, maximum_bytes: int) -> bytes:
    relative = _canonical_relative_path(relative_path)
    if not isinstance(root, Path) or not root.is_absolute():
        raise SecurityPolicyError("scan root must be an absolute real Path directory")
    try:
        root_before = root.lstat()
        resolved_root = root.resolve(strict=True)
    except OSError as error:
        raise SecurityPolicyError("scan root is unavailable") from error
    if not stat.S_ISDIR(root_before.st_mode) or root.is_symlink() or resolved_root != root:
        raise SecurityPolicyError("scan root must be an exact real non-symlink directory")
    directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        root_fd = os.open(root, directory_flags)
    except OSError as error:
        raise SecurityPolicyError("scan root cannot be opened safely") from error
    directory_fds = [root_fd]
    directory_edges: list[tuple[int, str, int]] = []
    descriptor = -1
    try:
        opened_root = os.fstat(root_fd)
        if (opened_root.st_dev, opened_root.st_ino) != (
            root_before.st_dev,
            root_before.st_ino,
        ):
            raise SecurityPolicyError("scan root changed while opening")
        parts = PurePosixPath(relative).parts
        for part in parts[:-1]:
            try:
                next_fd = os.open(part, directory_flags, dir_fd=directory_fds[-1])
            except OSError as error:
                raise SecurityPolicyError(f"path parent is absent or unsafe: {relative}") from error
            directory_edges.append((directory_fds[-1], part, next_fd))
            directory_fds.append(next_fd)
        leaf_parent_fd = directory_fds[-1]
        try:
            descriptor = os.open(
                parts[-1],
                os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0),
                dir_fd=leaf_parent_fd,
            )
        except OSError as error:
            raise SecurityPolicyError(
                f"required file cannot be opened safely: {relative}"
            ) from error
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise SecurityPolicyError(f"required path is not a regular file: {relative}")
        if before.st_size > maximum_bytes:
            raise SecurityPolicyError(f"required file exceeds {maximum_bytes} bytes: {relative}")
        chunks: list[bytes] = []
        remaining = maximum_bytes + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(65_536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        after = os.fstat(descriptor)
        try:
            linked_after = os.stat(parts[-1], dir_fd=leaf_parent_fd, follow_symlinks=False)
        except OSError as error:
            raise SecurityPolicyError(
                f"required file path changed during read: {relative}"
            ) from error
        for parent_fd, part, child_fd in directory_edges:
            try:
                linked_parent = os.stat(part, dir_fd=parent_fd, follow_symlinks=False)
                opened_parent = os.fstat(child_fd)
            except OSError as error:
                raise SecurityPolicyError(
                    f"required file parent changed during read: {relative}"
                ) from error
            if not stat.S_ISDIR(linked_parent.st_mode) or (
                linked_parent.st_dev,
                linked_parent.st_ino,
            ) != (opened_parent.st_dev, opened_parent.st_ino):
                raise SecurityPolicyError(f"required file parent changed during read: {relative}")
        identity_before = (
            before.st_dev,
            before.st_ino,
            before.st_mode,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        )
        identity_after = (
            after.st_dev,
            after.st_ino,
            after.st_mode,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        )
        if (
            len(raw) != before.st_size
            or len(raw) > maximum_bytes
            or identity_before != identity_after
            or (linked_after.st_dev, linked_after.st_ino) != (after.st_dev, after.st_ino)
        ):
            raise SecurityPolicyError(f"required file changed during bounded read: {relative}")
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        for directory_fd in reversed(directory_fds):
            os.close(directory_fd)
    try:
        root_after = root.lstat()
    except OSError as error:
        raise SecurityPolicyError("scan root disappeared during verification") from error
    if (root_after.st_dev, root_after.st_ino) != (
        root_before.st_dev,
        root_before.st_ino,
    ):
        raise SecurityPolicyError("scan root changed during verification")
    return raw


def scan_python_file(
    root: Path,
    relative_path: str,
    *,
    trusted_source_sha256: Mapping[str, str] | None = None,
) -> SecurityScanV1:
    raw = _read_regular_file(root, relative_path, maximum_bytes=MAX_SOURCE_BYTES)
    return scan_python_bytes(
        raw,
        relative_path=relative_path,
        trusted_source_sha256=trusted_source_sha256,
    )


def scan_python_files(
    root: Path,
    relative_paths: Iterable[str],
    *,
    trusted_source_sha256: Mapping[str, str] | None = None,
) -> SecurityScanV1:
    """Scan an exact caller-owned inventory, including entrypoint scripts."""

    paths = tuple(sorted(_canonical_relative_path(path) for path in relative_paths))
    if not paths or len(set(paths)) != len(paths):
        raise SecurityPolicyError("Python source inventory must be non-empty and unique")
    all_findings: list[SecurityFindingV1] = []
    source_rows: list[str] = []
    for relative in paths:
        if not relative.endswith(".py"):
            raise SecurityPolicyError(f"source inventory item is not Python: {relative}")
        result = scan_python_file(
            root,
            relative,
            trusted_source_sha256=trusted_source_sha256,
        )
        source_rows.append(f"{relative}\x00{result.source_set_sha256}")
        all_findings.extend(result.findings)
    aggregate = _sha256("\n".join(source_rows).encode())
    return SecurityScanV1(len(paths), aggregate, tuple(sorted(set(all_findings))))


def _python_tree_inventory(source_root: Path) -> tuple[str, ...]:
    entries = sorted(source_root.rglob("*"))
    if any(path.is_symlink() for path in entries):
        raise SecurityPolicyError("source tree contains a symbolic link")
    return tuple(
        path.relative_to(source_root).as_posix()
        for path in entries
        if path.suffix == ".py" and path.is_file()
    )


def scan_python_tree(
    source_root: Path,
    *,
    trusted_source_sha256: Mapping[str, str] | None = None,
) -> SecurityScanV1:
    """Scan every regular ``.py`` file below a real source directory."""

    if not isinstance(source_root, Path) or not source_root.is_absolute():
        raise SecurityPolicyError("source root must be an absolute real Path directory")
    try:
        root_info = source_root.lstat()
        resolved_root = source_root.resolve(strict=True)
    except OSError as error:
        raise SecurityPolicyError("source root is unavailable") from error
    if (
        not stat.S_ISDIR(root_info.st_mode)
        or source_root.is_symlink()
        or resolved_root != source_root
    ):
        raise SecurityPolicyError("source root must be an exact real non-symlink directory")
    root_identity = (root_info.st_dev, root_info.st_ino)
    files = _python_tree_inventory(source_root)
    if not files:
        raise SecurityPolicyError("source tree contains no Python files")
    all_findings: list[SecurityFindingV1] = []
    source_rows: list[str] = []
    for relative in files:
        result = scan_python_file(
            source_root,
            relative,
            trusted_source_sha256=trusted_source_sha256,
        )
        source_rows.append(f"{relative}\x00{result.source_set_sha256}")
        all_findings.extend(result.findings)
    try:
        root_after = source_root.lstat()
    except OSError as error:
        raise SecurityPolicyError("source root disappeared during tree scan") from error
    if (root_after.st_dev, root_after.st_ino) != root_identity:
        raise SecurityPolicyError("source root changed during tree scan")
    if _python_tree_inventory(source_root) != files:
        raise SecurityPolicyError("source tree inventory changed during scan")
    aggregate = _sha256("\n".join(source_rows).encode())
    return SecurityScanV1(len(files), aggregate, tuple(sorted(set(all_findings))))


@dataclass(frozen=True, slots=True, order=True)
class FrozenFileIdentityV1:
    relative_path: str
    expected_sha256: str
    observed_sha256: str
    byte_length: int

    def __post_init__(self) -> None:
        _canonical_relative_path(self.relative_path)
        _validate_sha256(self.expected_sha256, field="expected frozen-file digest")
        _validate_sha256(self.observed_sha256, field="observed frozen-file digest")
        if (
            isinstance(self.byte_length, bool)
            or not isinstance(self.byte_length, int)
            or self.byte_length < 1
        ):
            raise SecurityPolicyError("frozen-file byte length must be a positive integer")

    @property
    def matches(self) -> bool:
        return self.expected_sha256 == self.observed_sha256

    def as_mapping(self) -> dict[str, object]:
        return {
            "byteLength": self.byte_length,
            "expectedSha256": self.expected_sha256,
            "matches": self.matches,
            "observedSha256": self.observed_sha256,
            "relativePath": self.relative_path,
        }


@dataclass(frozen=True, slots=True)
class FrozenVerificationV1:
    files: tuple[FrozenFileIdentityV1, ...]
    identity_sha256: str
    _seal: object = field(repr=False, compare=False)

    def __post_init__(self) -> None:
        if self._seal is not _VERIFIED_REPORT_SEAL:
            raise SecurityPolicyError("frozen verification must come from the byte verifier")
        if not isinstance(self.files, tuple) or tuple(sorted(self.files)) != self.files:
            raise SecurityPolicyError("frozen-file identities must be a sorted tuple")
        if len({item.relative_path for item in self.files}) != len(self.files):
            raise SecurityPolicyError("frozen-file identities must have unique paths")
        _validate_sha256(self.identity_sha256, field="frozen identity digest")
        material = "\n".join(
            f"{item.relative_path}\x00{item.expected_sha256}\x00"
            f"{item.observed_sha256}\x00{item.byte_length}"
            for item in self.files
        ).encode()
        if self.identity_sha256 != _sha256(material):
            raise SecurityPolicyError("frozen identity digest does not bind the exact rows")

    @property
    def clean(self) -> bool:
        return bool(self.files) and all(item.matches for item in self.files)

    def require_clean(self) -> None:
        if not self.clean:
            raise SecurityPolicyError("one or more frozen file identities drifted")

    def as_mapping(self) -> dict[str, object]:
        return {
            "clean": self.clean,
            "files": [item.as_mapping() for item in self.files],
            "identitySha256": self.identity_sha256,
            "schema": "Q17FrozenVerificationV1",
            "version": 1,
        }


def require_only_declared_post_acceptance_frozen_file_drift(
    report: FrozenVerificationV1,
) -> None:
    """Allow only the exact, declared post-acceptance frozen-file mismatches."""

    if not isinstance(report, FrozenVerificationV1):
        raise SecurityPolicyError("frozen verification report is required")
    historical = dict(FROZEN_Q_LANE_FILES_SHA256)
    expected_paths = tuple(sorted(historical))
    if tuple(item.relative_path for item in report.files) != expected_paths:
        raise SecurityPolicyError(
            "frozen report must cover the exact historical acceptance inventory"
        )
    if any(item.expected_sha256 != historical[item.relative_path] for item in report.files):
        raise SecurityPolicyError("frozen report changes a historical acceptance expectation")
    drifted = tuple(item for item in report.files if not item.matches)
    declared = {
        "package-lock.json": (
            PACKAGE_LOCK_CURRENT_SHA256,
            PACKAGE_LOCK_CURRENT_BYTE_LENGTH,
        ),
        "quant/DIRECTIVE_INPUTS.lock": (
            DIRECTIVE_INPUT_LOCK_CURRENT_SHA256,
            DIRECTIVE_INPUT_LOCK_CURRENT_BYTE_LENGTH,
        ),
    }
    if {item.relative_path for item in drifted} != set(declared):
        raise SecurityPolicyError("frozen files differ beyond the declared post-acceptance drift")
    for item in drifted:
        observed_sha256, byte_length = declared[item.relative_path]
        if item.observed_sha256 != observed_sha256 or item.byte_length != byte_length:
            raise SecurityPolicyError(
                "post-acceptance frozen-file drift differs from declared current truth"
            )


def verify_frozen_files(
    repo_root: Path,
    expected_sha256: Mapping[str, str] | Iterable[tuple[str, str]],
) -> FrozenVerificationV1:
    """Bind caller-selected worktree bytes without invoking Git or another process."""

    pairs = (
        list(expected_sha256.items())
        if isinstance(expected_sha256, Mapping)
        else list(expected_sha256)
    )
    if not pairs:
        raise SecurityPolicyError("frozen-file expectation set must be non-empty")
    rows: list[FrozenFileIdentityV1] = []
    seen: set[str] = set()
    for relative_path, expected in sorted(pairs):
        relative = _canonical_relative_path(relative_path)
        if relative in seen:
            raise SecurityPolicyError(f"duplicate frozen-file expectation: {relative}")
        seen.add(relative)
        expected = _validate_sha256(expected, field=f"expected digest for {relative}")
        raw = _read_regular_file(repo_root, relative, maximum_bytes=MAX_FROZEN_BYTES)
        rows.append(FrozenFileIdentityV1(relative, expected, _sha256(raw), len(raw)))
    material = "\n".join(
        f"{item.relative_path}\x00{item.expected_sha256}\x00{item.observed_sha256}\x00{item.byte_length}"
        for item in rows
    ).encode()
    return FrozenVerificationV1(tuple(rows), _sha256(material), _VERIFIED_REPORT_SEAL)


def verify_directive_input_lock(repo_root: Path, *, expected_sha256: str) -> FrozenVerificationV1:
    return verify_frozen_files(
        repo_root,
        (("quant/DIRECTIVE_INPUTS.lock", expected_sha256),),
    )


@dataclass(frozen=True, slots=True, order=True)
class ScopeViolationV1:
    relative_path: str
    reason: str

    def __post_init__(self) -> None:
        _canonical_relative_path(self.relative_path)
        if self.reason != "OUTSIDE_EXCLUSIVE_WRITE_SET":
            raise SecurityPolicyError("scope violation reason is unsupported")

    def as_mapping(self) -> dict[str, object]:
        return {"reason": self.reason, "relativePath": self.relative_path}


def _normalize_scope_prefixes(values: Iterable[str]) -> tuple[str, ...]:
    prefixes = tuple(
        sorted(
            _canonical_relative_path(prefix.rstrip("/")) + ("/" if prefix.endswith("/") else "")
            for prefix in values
        )
    )
    if len(set(prefixes)) != len(prefixes):
        raise SecurityPolicyError("scope policy contains duplicate prefixes")
    return prefixes


def _normalize_scope_exact(values: Iterable[str]) -> tuple[str, ...]:
    exact = tuple(sorted(_canonical_relative_path(path) for path in values))
    if len(set(exact)) != len(exact):
        raise SecurityPolicyError("scope policy contains duplicate exact paths")
    return exact


def _scope_path_allowed(
    path: str,
    *,
    prefixes: tuple[str, ...],
    exact: frozenset[str],
) -> bool:
    if path in exact:
        return True
    for prefix in prefixes:
        if prefix.endswith("/") and path.startswith(prefix):
            return True
        if not path.startswith(prefix):
            continue
        if len(path) == len(prefix):
            return True
        if prefix.endswith(("-", "_", ".")) or path[len(prefix)] in ("-", "_", ".", "/"):
            return True
    return False


@dataclass(frozen=True, slots=True)
class ScopeVerificationV1:
    changed_paths: tuple[str, ...]
    violations: tuple[ScopeViolationV1, ...]
    path_set_sha256: str
    _seal: object = field(repr=False, compare=False)
    allowed_prefixes: tuple[str, ...] = Q17_ALLOWED_PREFIXES
    allowed_exact: tuple[str, ...] = Q17_ALLOWED_EXACT

    def __post_init__(self) -> None:
        if self._seal is not _VERIFIED_REPORT_SEAL:
            raise SecurityPolicyError("scope verification must come from the path verifier")
        if (
            not isinstance(self.changed_paths, tuple)
            or tuple(sorted(self.changed_paths)) != self.changed_paths
            or len(set(self.changed_paths)) != len(self.changed_paths)
        ):
            raise SecurityPolicyError("changed paths must be a sorted unique tuple")
        for path in self.changed_paths:
            _canonical_relative_path(path)
        prefixes = _normalize_scope_prefixes(self.allowed_prefixes)
        exact = _normalize_scope_exact(self.allowed_exact)
        if not prefixes and not exact:
            raise SecurityPolicyError("scope policy must permit at least one path")
        if prefixes != self.allowed_prefixes or exact != self.allowed_exact:
            raise SecurityPolicyError("scope policy must be canonical and sorted")
        expected_violations = tuple(
            ScopeViolationV1(path, "OUTSIDE_EXCLUSIVE_WRITE_SET")
            for path in self.changed_paths
            if not _scope_path_allowed(path, prefixes=prefixes, exact=frozenset(exact))
        )
        if self.violations != expected_violations:
            raise SecurityPolicyError("scope violations do not bind the changed-path set")
        _validate_sha256(self.path_set_sha256, field="changed-path set digest")
        if self.path_set_sha256 != _sha256("\n".join(self.changed_paths).encode()):
            raise SecurityPolicyError("changed-path digest does not bind the exact paths")

    @property
    def clean(self) -> bool:
        return bool(self.changed_paths) and not self.violations

    def require_clean(self) -> None:
        if not self.clean:
            raise SecurityPolicyError("changed-path set is empty or outside the exclusive scope")

    def as_mapping(self) -> dict[str, object]:
        return {
            "changedPathCount": len(self.changed_paths),
            "changedPaths": list(self.changed_paths),
            "clean": self.clean,
            "policy": {
                "allowedExact": list(self.allowed_exact),
                "allowedPrefixes": list(self.allowed_prefixes),
            },
            "pathSetSha256": self.path_set_sha256,
            "schema": "Q17ScopeVerificationV1",
            "version": 1,
            "violations": [item.as_mapping() for item in self.violations],
        }


def verify_changed_path_scope(
    changed_paths: Iterable[str],
    *,
    allowed_prefixes: Iterable[str] = Q17_ALLOWED_PREFIXES,
    allowed_exact: Iterable[str] = Q17_ALLOWED_EXACT,
) -> ScopeVerificationV1:
    """Verify caller-supplied worktree paths, not Git index or commit-tree exactness.

    Staged and clean-archive Git gates remain separate external acceptance checks.
    """

    raw_paths = list(changed_paths)
    paths = tuple(sorted(_canonical_relative_path(path) for path in raw_paths))
    if len(set(paths)) != len(paths):
        raise SecurityPolicyError("changed-path inventory contains duplicates")
    prefixes = _normalize_scope_prefixes(allowed_prefixes)
    exact = _normalize_scope_exact(allowed_exact)
    if not prefixes and not exact:
        raise SecurityPolicyError("scope policy must permit at least one path")
    violations = tuple(
        ScopeViolationV1(path, "OUTSIDE_EXCLUSIVE_WRITE_SET")
        for path in paths
        if not _scope_path_allowed(path, prefixes=prefixes, exact=frozenset(exact))
    )
    return ScopeVerificationV1(
        paths,
        violations,
        _sha256("\n".join(paths).encode()),
        _VERIFIED_REPORT_SEAL,
        prefixes,
        exact,
    )
