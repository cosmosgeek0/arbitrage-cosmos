from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest

import quant_edge.final_proof.security as security_module
from quant_edge.final_proof.security import (
    FROZEN_Q_LANE_FILES_SHA256,
    MAX_SOURCE_BYTES,
    FrozenFileIdentityV1,
    FrozenVerificationV1,
    ScopeVerificationV1,
    ScopeViolationV1,
    SecurityFindingV1,
    SecurityPolicyError,
    SecurityScanV1,
    scan_python_bytes,
    scan_python_file,
    scan_python_files,
    scan_python_tree,
    verify_changed_path_scope,
    verify_directive_input_lock,
    verify_frozen_files,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
QUANT_ROOT = REPO_ROOT / "quant"
SOURCE_ROOT = QUANT_ROOT / "src" / "quant_edge"
Q16_TRANSPORT_SHA256 = "f3ab8e8a9a6cd29776c153ddd52cc673f627c9dcdd9fa9c01078c55cf8e44769"
CLI_SHA256 = "56e110936b16370ca1e7cf1e0b9fd6668dce203f910f42d4370e12e0a716812f"
BENCHMARK_SHA256 = "0f216c5de272ec1756b5b5cfd06aae73682aa7701529bb74ed7437cb6ea7f797"
INPUT_LOCK_SHA256 = "d4bf31826625c2602ebb7ed72194e94a4571f7597a413ca545839f236c7a5a24"


def _scan(source: str, *, path: str = "candidate.py") -> SecurityScanV1:
    return scan_python_bytes(source.encode(), relative_path=path)


def _kinds(result: SecurityScanV1) -> set[str]:
    return {finding.kind for finding in result.findings}


def _symbols(result: SecurityScanV1) -> set[str]:
    return {finding.symbol for finding in result.findings}


def test_executable_ast_ignores_docs_strings_and_safe_standard_library_calls() -> None:
    result = _scan(
        '''"""requests.get; os.getenv; client.create_order; pickle.loads."""
EMBEDDED = "import socket\\nsubprocess.run('bad', shell=True)"
import ast
import os
from urllib.parse import urlsplit

def inspect(path: str) -> object:
    descriptor = os.open(path, os.O_RDONLY)
    os.close(descriptor)
    return ast.literal_eval(repr(urlsplit("https://example.invalid/path")))
'''
    )
    assert result.clean
    assert result.as_mapping()["findings"] == []
    result.require_clean()


@pytest.mark.parametrize(
    ("source", "symbol"),
    [
        ("import requests as r\nr.get('https://example.invalid')\n", "requests.get"),
        ("from httpx import Client as C\nC().post('/x')\n", "httpx.Client.post"),
        ("import urllib.request as u\nu.urlopen('https://example.invalid')\n", "urllib.request"),
        ("import websockets.client\nwebsockets.client.connect('wss://x')\n", "websockets"),
        ("from socket import socket as S\nS()\n", "socket.socket"),
        ("import importlib\nimportlib.import_module('requests').get('/x')\n", "requests"),
        ("module = 'httpx'\n__import__(module)\n", "httpx"),
        ("import smtplib\nsmtplib.SMTP('mail.invalid')\n", "smtplib.SMTP"),
        ("import httpcore\nhttpcore.request('GET', 'https://x')\n", "httpcore.request"),
        ("import asyncio\nasyncio.open_connection('x', 443)\n", "asyncio.open_connection"),
        (
            "import asyncio\nasyncio.get_running_loop().create_connection(proto, 'x', 443)\n",
            "create_connection",
        ),
        (
            "import asyncio\nloop = asyncio.get_running_loop()\n"
            "loop.create_datagram_endpoint(proto, remote_addr=('x', 443))\n",
            "create_datagram_endpoint",
        ),
    ],
)
def test_network_and_dynamic_import_aliases_are_detected(source: str, symbol: str) -> None:
    result = _scan(source)
    assert not result.clean
    assert any(symbol in finding.symbol for finding in result.findings)
    with pytest.raises(SecurityPolicyError, match="security scan rejected"):
        result.require_clean()


def test_unknown_dynamic_import_is_fail_closed() -> None:
    result = _scan("def load(name: str) -> object:\n    return __import__(name)\n")
    assert {"DYNAMIC_EXECUTION", "DYNAMIC_IMPORT_UNKNOWN"} <= _kinds(result)


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("import os as system\nsystem.getenv('API_KEY')\n", "os.getenv"),
        ("from os import getenv as read\nread('TOKEN')\n", "os.getenv"),
        ("from os import environ as env\nvalue = env['SECRET']\n", "os.environ"),
        ("import os\nname = 'environ'\ngetattr(os, name)['KEY']\n", "os.environ"),
        ("import os\nos.__dict__['getenv']('TOKEN')\n", "os.getenv"),
        ("import os\nvars(os)['getenv']('TOKEN')\n", "os.getenv"),
        ("import os\ngetattr(os, 'get' + 'env')('TOKEN')\n", "os.getenv"),
        ("import os\nos.getenvb(b'TOKEN')\n", "os.getenvb"),
        ("from dotenv import load_dotenv\nload_dotenv()\n", "dotenv.load_dotenv"),
        ("import keyring\nkeyring.get_password('service', 'user')\n", "keyring"),
    ],
)
def test_environment_and_secret_reads_survive_alias_getattr_and_subscript(
    source: str,
    expected: str,
) -> None:
    result = _scan(source)
    assert any(expected in symbol for symbol in _symbols(result))
    assert _kinds(result) & {"ENV_SECRET_IMPORT", "ENV_SECRET_READ"}


@pytest.mark.parametrize(
    "source",
    [
        "import pickle as codec\ncodec.loads(b'x')\n",
        "from joblib import load as restore\nrestore('model')\n",
        "import cloudpickle\ncloudpickle.load(handle)\n",
        "import dill\ndill.loads(blob)\n",
        "import marshal\nmarshal.loads(blob)\n",
        "import shelve\nshelve.open('state')\n",
        "import yaml\nyaml.load(raw, Loader=object)\n",
        "import torch\ntorch.load('weights')\n",
        "import numpy as np\nnp.load('x.npy', allow_pickle=True)\n",
        "from numpy import load\nload('x.npy', None, True)\n",
        "import numpy as np\nallow = 1\nnp.load('x.npy', allow_pickle=allow)\n",
        "import pandas\npandas.read_pickle('model')\n",
        "import torch\ntorch.jit.load('model')\n",
    ],
)
def test_unsafe_deserialization_is_detected(source: str) -> None:
    result = _scan(source)
    assert _kinds(result) & {
        "UNSAFE_DESERIALIZATION_IMPORT",
        "UNSAFE_DESERIALIZATION_CALL",
    }


def test_numpy_without_pickle_and_yaml_safe_load_are_not_mislabeled() -> None:
    result = _scan(
        "import numpy as np\n"
        "import yaml\n"
        "np.load('x.npy', allow_pickle=False)\n"
        "yaml.safe_load('x')\n"
    )
    assert result.clean


@pytest.mark.parametrize(
    "source",
    [
        "runner = eval\nrunner('1 + 1')\n",
        "import builtins as b\ngetattr(b, 'exec')('x = 1')\n",
        "compile('1', '<x>', 'eval')\n",
        "import importlib\nname = input()\nimportlib.import_module(name)\n",
        "getattr(__builtins__, '__im' + 'port__')('requests')\n",
    ],
)
def test_dynamic_execution_and_import_are_detected(source: str) -> None:
    assert _kinds(_scan(source)) & {"DYNAMIC_EXECUTION", "DYNAMIC_IMPORT_UNKNOWN"}


@pytest.mark.parametrize(
    "source",
    [
        "import subprocess as sp\nsp.run(['tool'])\n",
        "from subprocess import Popen as launch\nlaunch(['tool'])\n",
        "import subprocess\nsubprocess.run('tool')\n",
        "import subprocess\nsubprocess.run(['tool'], shell=True)\n",
        "import os\nos.system('tool')\n",
        "import os\nos.popen('tool')\n",
        "import pty\npty.spawn('tool')\n",
        "import os\nos.posix_spawn('/bin/sh', ['/bin/sh'], {})\n",
    ],
)
def test_subprocess_shell_and_string_argv_are_detected(source: str) -> None:
    kinds = _kinds(_scan(source))
    assert kinds & {"SUBPROCESS_IMPORT", "SUBPROCESS_CALL", "SHELL_EXECUTION"}


@pytest.mark.parametrize(
    ("expression", "kind"),
    [
        ("client.borrow()", "MONEY_AUTHORITY_CALL"),
        ("client.repay()", "MONEY_AUTHORITY_CALL"),
        ("client.transfer_funds()", "MONEY_AUTHORITY_CALL"),
        ("client.withdraw()", "MONEY_AUTHORITY_CALL"),
        ("client.set_leverage(5)", "LEVERAGE_MARGIN_AUTHORITY_CALL"),
        ("client.changeMargin('isolated')", "LEVERAGE_MARGIN_AUTHORITY_CALL"),
        ("client.create_order()", "ORDER_AUTHORITY_CALL"),
        ("client.get_account_info()", "ACCOUNT_AUTHORITY_CALL"),
        ("client.approve_risk()", "RISK_APPROVAL_AUTHORITY_CALL"),
        ("client.signed_request()", "PRIVATE_EXCHANGE_AUTHORITY_CALL"),
        ("getattr(client, 'withdraw')()", "MONEY_AUTHORITY_CALL"),
        ("ops['submit_order']()", "ORDER_AUTHORITY_CALL"),
        ("client.cancel_all_orders()", "ORDER_AUTHORITY_CALL"),
        ("client.order_market_buy()", "ORDER_AUTHORITY_CALL"),
        ("client.create_margin_loan()", "MONEY_AUTHORITY_CALL"),
        ("client.repay_margin_loan()", "MONEY_AUTHORITY_CALL"),
        ("client.transfer_spot_to_margin()", "MONEY_AUTHORITY_CALL"),
        ("client.get_user_asset()", "ACCOUNT_AUTHORITY_CALL"),
        ("client.get_open_orders()", "ACCOUNT_AUTHORITY_CALL"),
        ("client.get_my_trades()", "ACCOUNT_AUTHORITY_CALL"),
        ("client.futures_account()", "ACCOUNT_AUTHORITY_CALL"),
        ("client.futures_position_information()", "ACCOUNT_AUTHORITY_CALL"),
        ("api.request('/private')", "PRIVATE_EXCHANGE_AUTHORITY_CALL"),
        ("buy()", "ORDER_AUTHORITY_CALL"),
    ],
)
def test_private_exchange_and_money_authority_calls_are_detected(
    expression: str,
    kind: str,
) -> None:
    result = _scan(f"{expression}\n")
    assert kind in _kinds(result)


def test_dangerous_client_attribute_is_detected_but_domain_data_is_not() -> None:
    dangerous = _scan("operation = client.withdraw\n")
    assert "MONEY_AUTHORITY_ATTRIBUTE" in _kinds(dangerous)
    safe = _scan(
        "value = self.borrow\nknown = effective_borrow_knownness(value)\n"
        "delta = scenario.borrow_delta\n"
    )
    assert safe.clean


@pytest.mark.parametrize(
    "source",
    [
        "getattr(client, input())()\n",
        "operation = client[input()]\noperation()\n",
        "getattr(exchange, field_name)()\n",
    ],
)
def test_dynamic_sensitive_client_attributes_fail_closed(source: str) -> None:
    assert "DYNAMIC_SENSITIVE_ATTRIBUTE" in _kinds(_scan(source))


def test_findings_are_sorted_unique_deterministic_and_json_safe() -> None:
    source = "import requests\nimport os\nos.getenv('TOKEN')\nrequests.get('/x')\n"
    first = _scan(source, path="z.py")
    second = _scan(source, path="z.py")
    assert first == second
    assert first.findings == tuple(sorted(first.findings))
    assert len(first.findings) == len(set(first.findings))
    assert json.loads(json.dumps(first.as_mapping())) == first.as_mapping()
    assert all(len(finding.digest) == 64 for finding in first.findings)


def test_invalid_source_and_contract_values_fail_closed() -> None:
    invalid_utf8 = scan_python_bytes(b"\xff", relative_path="bad.py")
    assert _kinds(invalid_utf8) == {"INVALID_UTF8"}
    syntax = _scan("if:\n", path="syntax.py")
    assert _kinds(syntax) == {"SYNTAX_ERROR"}
    with pytest.raises(SecurityPolicyError, match="bounded non-empty"):
        scan_python_bytes(b"", relative_path="empty.py")
    with pytest.raises(SecurityPolicyError, match="bounded non-empty"):
        scan_python_bytes(b"x" * (MAX_SOURCE_BYTES + 1), relative_path="large.py")
    for path in ("../bad.py", "/bad.py", "bad\\path.py", "a//b.py", "./bad.py"):
        with pytest.raises(SecurityPolicyError, match="path"):
            scan_python_bytes(b"pass\n", relative_path=path)
    with pytest.raises(SecurityPolicyError, match="positive integer"):
        SecurityFindingV1("x.py", 0, "KIND", "symbol", "0" * 64)
    with pytest.raises(SecurityPolicyError, match="kind/symbol"):
        SecurityFindingV1("x.py", 1, "", "symbol", "0" * 64)
    with pytest.raises(SecurityPolicyError, match="lowercase SHA-256"):
        SecurityFindingV1("x.py", 1, "KIND", "symbol", "bad")
    with pytest.raises(SecurityPolicyError, match="at least one"):
        SecurityScanV1(0, "0" * 64, ())
    with pytest.raises(SecurityPolicyError, match="source-set digest"):
        SecurityScanV1(1, "BAD", ())


def test_security_scan_rejects_unsorted_or_duplicate_findings() -> None:
    one = SecurityFindingV1("b.py", 1, "K", "x", "1" * 64)
    two = SecurityFindingV1("a.py", 1, "K", "x", "2" * 64)
    with pytest.raises(SecurityPolicyError, match="sorted tuple"):
        SecurityScanV1(2, "0" * 64, (one, two))
    with pytest.raises(SecurityPolicyError, match="unique"):
        SecurityScanV1(2, "0" * 64, (one, one))


def test_q16_socket_exception_requires_exact_path_and_caller_supplied_digest() -> None:
    accepted = (QUANT_ROOT / "src/quant_edge/inference/transport.py").read_bytes()
    untrusted = scan_python_bytes(accepted, relative_path="inference/transport.py")
    assert "LOCAL_TRANSPORT_IMPORT" in _kinds(untrusted)
    wrong_digest = scan_python_bytes(
        accepted,
        relative_path="inference/transport.py",
        trusted_source_sha256={"inference/transport.py": "0" * 64},
    )
    assert not wrong_digest.clean
    wrong_path = scan_python_bytes(
        accepted,
        relative_path="other/transport.py",
        trusted_source_sha256={"inference/transport.py": Q16_TRANSPORT_SHA256},
    )
    assert not wrong_path.clean
    trusted = scan_python_bytes(
        accepted,
        relative_path="inference/transport.py",
        trusted_source_sha256={"inference/transport.py": Q16_TRANSPORT_SHA256},
    )
    assert trusted.clean


def test_q16_socket_path_cannot_allow_unapproved_socket_calls() -> None:
    source = b"import socket\nsocket.create_connection(('8.8.8.8', 443))\n"
    digest = hashlib.sha256(source).hexdigest()
    result = scan_python_bytes(
        source,
        relative_path="inference/transport.py",
        trusted_source_sha256={"inference/transport.py": digest},
    )
    assert "UNAPPROVED_LOCAL_TRANSPORT_SYMBOL" in _kinds(result)


def test_trusted_digest_map_is_strict_and_rejects_normalized_duplicates() -> None:
    with pytest.raises(SecurityPolicyError, match="trusted digest"):
        scan_python_bytes(
            b"pass\n",
            relative_path="x.py",
            trusted_source_sha256={"x.py": "bad"},
        )
    with pytest.raises(SecurityPolicyError, match="duplicate trusted"):
        scan_python_bytes(
            b"pass\n",
            relative_path="x.py",
            trusted_source_sha256={
                "x.py": hashlib.sha256(b"pass\n").hexdigest(),
                "quant_edge/x.py": "0" * 64,
            },
        )


def test_benchmark_subprocess_exception_requires_safe_semantics_and_exact_digest() -> None:
    source = b"""import subprocess
import sys
subprocess.run([sys.executable, '-c', 'pass'], shell=False, timeout=5)
"""
    digest = hashlib.sha256(source).hexdigest()
    path = "final_proof/benchmark.py"
    trusted = scan_python_bytes(source, relative_path=path, trusted_source_sha256={path: digest})
    assert trusted.clean
    assert not scan_python_bytes(source, relative_path=path).clean
    for unsafe in (
        b"import subprocess\nimport sys\nsubprocess.run('tool', timeout=5)\n",
        b"import subprocess\nimport sys\nsubprocess.run([sys.executable], shell=True, timeout=5)\n",
        b"import subprocess\nimport sys\nsubprocess.run([sys.executable])\n",
        b"import subprocess\nsubprocess.call(['tool'])\n",
    ):
        unsafe_digest = hashlib.sha256(unsafe).hexdigest()
        result = scan_python_bytes(
            unsafe,
            relative_path=path,
            trusted_source_sha256={path: unsafe_digest},
        )
        assert not result.clean


def test_benchmark_popen_requires_timeout_kill_and_communicate_cleanup() -> None:
    safe = b"""import subprocess
import sys
argv = [sys.executable, '-c', 'pass']
process = subprocess.Popen(argv, shell=False)
try:
    process.communicate(timeout=5)
except subprocess.TimeoutExpired:
    process.kill()
    process.communicate(timeout=1)
"""
    path = "final_proof/benchmark.py"
    digest = hashlib.sha256(safe).hexdigest()
    result = scan_python_bytes(safe, relative_path=path, trusted_source_sha256={path: digest})
    assert result.clean
    unsafe = safe.replace(b"    process.kill()\n", b"")
    unsafe_digest = hashlib.sha256(unsafe).hexdigest()
    assert not scan_python_bytes(
        unsafe,
        relative_path=path,
        trusted_source_sha256={path: unsafe_digest},
    ).clean


def test_benchmark_subprocess_analysis_is_lexical_and_timeout_constants_are_static() -> None:
    safe = b"""import subprocess
import sys

def launch():
    async def nested_async():
        return None
    class Nested:
        pass
    marker = lambda: None
    reap_timeout: int = 1
    argv: tuple[str, ...] = (sys.executable, '-c', 'pass')
    process: object = subprocess.Popen(argv, shell=False)
    try:
        process.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.communicate(timeout=reap_timeout)
"""
    path = "final_proof/benchmark.py"

    def result(raw: bytes) -> SecurityScanV1:
        return scan_python_bytes(
            raw,
            relative_path=path,
            trusted_source_sha256={path: hashlib.sha256(raw).hexdigest()},
        )

    assert result(safe).clean
    assert not result(safe.replace(b"reap_timeout: int = 1", b"reap_timeout: int = 0")).clean
    assert not result(safe.replace(b"timeout=reap_timeout", b"timeout=1e309")).clean


def test_benchmark_exception_rejects_unrelated_argv_and_cleanup_dataflow() -> None:
    path = "final_proof/benchmark.py"
    candidates = (
        b"""import subprocess
import sys
SAFE = [sys.executable, '-c', 'pass']
def launch(argv):
    process = subprocess.Popen(argv, shell=False)
    try:
        process.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.communicate()
""",
        b"""import subprocess
import sys
def launch():
    process = subprocess.Popen([sys.executable, '-c', 'pass'], shell=False)
    try:
        decoy.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        decoy.kill()
        decoy.communicate()
""",
    )
    for source in candidates:
        digest = hashlib.sha256(source).hexdigest()
        result = scan_python_bytes(
            source,
            relative_path=path,
            trusted_source_sha256={path: digest},
        )
        assert not result.clean


def test_guarded_benchmark_wrapper_binds_exact_argv_and_spawned_child_cleanup() -> None:
    source = b"""import subprocess
import sys
from pathlib import Path

def _spawn_child(argv, cwd):
    return subprocess.Popen(argv, cwd=cwd, shell=False)

def _run_child_peak_rss_with_spawn(argv, *, cwd, timeout_ms, spawn):
    if not isinstance(argv, tuple) or len(argv) != 4:
        raise ValueError("bad argv")
    expected_source = Path(__file__).resolve()
    if (
        argv[0] != sys.executable
        or Path(argv[1]).resolve() != expected_source
        or argv[2] != "--q17-rss-child"
        or Path(argv[3]).resolve() != cwd.resolve()
    ):
        raise ValueError("unauthorized")
    child = spawn(argv, cwd)
    try:
        child.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        child.kill()
        child.communicate(timeout=1)

def run_child_peak_rss(repo_root, *, timeout_ms):
    argv = (
        sys.executable,
        str(Path(__file__).resolve()),
        "--q17-rss-child",
        str(repo_root.resolve()),
    )
    return _run_child_peak_rss_with_spawn(
        argv,
        cwd=repo_root,
        timeout_ms=timeout_ms,
        spawn=_spawn_child,
    )
"""
    path = "final_proof/benchmark.py"

    def result(raw: bytes) -> SecurityScanV1:
        return scan_python_bytes(
            raw,
            relative_path=path,
            trusted_source_sha256={path: hashlib.sha256(raw).hexdigest()},
        )

    assert result(source).clean
    mutations = (
        source.replace(b"timeout_ms, spawn):", b"timeout_ms, spawn=_spawn_child):"),
        source.replace(b"child = spawn(argv, cwd)", b"child = spawn(cwd, argv)"),
        source.replace(b"    child.kill()\n", b""),
        source.replace(b"child.communicate(timeout=1)", b"child.communicate()"),
        source.replace(b"child.communicate(timeout=1)", b"child.communicate(timeout=0)"),
        source.replace(b"child.communicate(timeout=1)", b"child.communicate(timeout=reap)"),
        source.replace(b"return subprocess.Popen", b"return other.Popen"),
        source.replace(b"argv[0] != sys.executable", b"argv[0] == sys.executable"),
        source.replace(b'argv[2] != "--q17-rss-child"', b'argv[2] != "--wrong"'),
        source.replace(b"spawn=_spawn_child,\n    )", b"spawn=other_spawn,\n    )"),
        source.replace(
            b"def run_child_peak_rss(repo_root, *, timeout_ms):",
            b"def run_child_peak_rss(repo_root, timeout_ms):",
        ),
        source + b"\nlaunch = subprocess.Popen\n",
        source + b"\ngetattr(subprocess, dynamic_name)(('tool',))\n",
        source + b"\nimport functools\nunsafe = functools.partial(subprocess.Popen, ('tool',))\n",
        source + b"\ndef _spawn_child(argv, cwd):\n    return subprocess.Popen(('tool',))\n",
    )
    assert all(not result(mutation).clean for mutation in mutations)


def test_policy_path_normalization_and_relative_imports_are_deterministic() -> None:
    source = b"from .local import value\n"
    digest = hashlib.sha256(source).hexdigest()
    result = scan_python_bytes(
        source,
        relative_path="src/quant_edge/safe.py",
        trusted_source_sha256={"quant_edge/safe.py": digest},
    )
    assert result.clean


def test_file_and_exact_inventory_scans_are_stable(tmp_path: Path) -> None:
    (tmp_path / "b.py").write_text("import requests\n")
    (tmp_path / "a.py").write_text("pass\n")
    single = scan_python_file(tmp_path, "a.py")
    assert single.clean
    first = scan_python_files(tmp_path, ("b.py", "a.py"))
    second = scan_python_files(tmp_path, ("a.py", "b.py"))
    assert first == second
    assert first.scanned_files == 2
    assert "EXTERNAL_NETWORK_IMPORT" in _kinds(first)
    with pytest.raises(SecurityPolicyError, match="non-empty and unique"):
        scan_python_files(tmp_path, ())
    with pytest.raises(SecurityPolicyError, match="non-empty and unique"):
        scan_python_files(tmp_path, ("a.py", "a.py"))
    with pytest.raises(SecurityPolicyError, match="not Python"):
        scan_python_files(tmp_path, ("note.txt",))


def test_file_reads_reject_symlink_traversal_nonregular_and_bad_roots(tmp_path: Path) -> None:
    (tmp_path / "safe.py").write_text("pass\n")
    (tmp_path / "folder").mkdir()
    (tmp_path / "link.py").symlink_to(tmp_path / "safe.py")
    with pytest.raises(SecurityPolicyError, match="opened safely"):
        scan_python_file(tmp_path, "link.py")
    with pytest.raises(SecurityPolicyError, match="opened safely"):
        scan_python_file(tmp_path, "missing.py")
    with pytest.raises(SecurityPolicyError, match="not a regular file"):
        scan_python_file(tmp_path, "folder")
    with pytest.raises(SecurityPolicyError, match="path"):
        scan_python_file(tmp_path, "../safe.py")
    root_link = tmp_path.parent / f"{tmp_path.name}-link"
    root_link.symlink_to(tmp_path, target_is_directory=True)
    try:
        with pytest.raises(SecurityPolicyError, match="real non-symlink"):
            scan_python_file(root_link, "safe.py")
    finally:
        root_link.unlink()
    with pytest.raises(SecurityPolicyError, match="non-symlink directory"):
        scan_python_file(tmp_path / "safe.py", "child.py")
    with pytest.raises(SecurityPolicyError, match="absolute real Path"):
        scan_python_file(Path("."), "safe.py")
    fifo = tmp_path / "fifo.py"
    os.mkfifo(fifo)
    with pytest.raises(SecurityPolicyError, match="regular file"):
        scan_python_file(tmp_path, "fifo.py")


def test_fd_relative_reader_rejects_leaf_replacement_during_read(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "source.py"
    displaced = tmp_path / "displaced.py"
    source.write_text("pass\n")
    original_read = os.read
    replaced = False

    def replace_then_read(descriptor: int, maximum: int) -> bytes:
        nonlocal replaced
        if not replaced:
            source.rename(displaced)
            source.write_text("pass\n")
            replaced = True
        return original_read(descriptor, maximum)

    monkeypatch.setattr(os, "read", replace_then_read)
    with pytest.raises(SecurityPolicyError, match="changed during bounded read"):
        scan_python_file(tmp_path, "source.py")


def test_fd_relative_reader_rejects_parent_swap_with_identical_inventory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "root"
    nested = root / "nested"
    displaced = tmp_path / "displaced"
    nested.mkdir(parents=True)
    (nested / "source.py").write_text("pass\n")
    original_read = os.read
    replaced = False

    def replace_parent_then_read(descriptor: int, maximum: int) -> bytes:
        nonlocal replaced
        if not replaced:
            nested.rename(displaced)
            nested.mkdir()
            (nested / "source.py").write_text("import requests\n")
            replaced = True
        return original_read(descriptor, maximum)

    monkeypatch.setattr(os, "read", replace_parent_then_read)
    with pytest.raises(SecurityPolicyError, match="parent changed during read"):
        scan_python_tree(root)


def test_tree_scan_rejects_empty_bad_and_symlinked_trees(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(SecurityPolicyError, match="no Python"):
        scan_python_tree(empty)
    (empty / "safe.py").write_text("pass\n")
    (empty / "bad.py").write_text("import requests\n")
    report = scan_python_tree(empty)
    assert report.scanned_files == 2
    assert not report.clean
    (empty / "alias.py").symlink_to(empty / "safe.py")
    with pytest.raises(SecurityPolicyError, match="symbolic link"):
        scan_python_tree(empty)
    with pytest.raises(SecurityPolicyError, match="directory"):
        scan_python_tree(empty / "safe.py")
    with pytest.raises(SecurityPolicyError, match="unavailable"):
        scan_python_tree(tmp_path / "missing")


def test_tree_scan_rejects_inventory_change_after_scanning(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (tmp_path / "safe.py").write_text("pass\n")
    real_inventory = security_module._python_tree_inventory
    calls = 0

    def changing_inventory(root: Path) -> tuple[str, ...]:
        nonlocal calls
        calls += 1
        observed = real_inventory(root)
        return observed if calls == 1 else (*observed, "late.py")

    monkeypatch.setattr(security_module, "_python_tree_inventory", changing_inventory)
    with pytest.raises(SecurityPolicyError, match="inventory changed"):
        scan_python_tree(tmp_path)


def test_current_quant_source_tree_is_clean_with_exact_frozen_exceptions() -> None:
    report = scan_python_tree(
        SOURCE_ROOT,
        trusted_source_sha256={
            "inference/transport.py": Q16_TRANSPORT_SHA256,
            "cli.py": CLI_SHA256,
            "final_proof/benchmark.py": BENCHMARK_SHA256,
        },
    )
    assert report.clean
    assert report.scanned_files >= 147


def test_frozen_file_verification_is_deterministic_and_strict(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_bytes(b"a")
    (tmp_path / "nested").mkdir()
    (tmp_path / "nested/b.txt").write_bytes(b"b")
    expected = {
        "nested/b.txt": hashlib.sha256(b"b").hexdigest(),
        "a.txt": hashlib.sha256(b"a").hexdigest(),
    }
    first = verify_frozen_files(tmp_path, expected)
    second = verify_frozen_files(tmp_path, tuple(reversed(tuple(expected.items()))))
    assert first == second
    assert first.clean
    first.require_clean()
    assert json.loads(json.dumps(first.as_mapping())) == first.as_mapping()
    drifted = verify_frozen_files(tmp_path, {"a.txt": "0" * 64})
    assert not drifted.clean
    with pytest.raises(SecurityPolicyError, match="drifted"):
        drifted.require_clean()


def test_frozen_verification_rejects_bad_expectations_and_paths(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_bytes(b"a")
    with pytest.raises(SecurityPolicyError, match="non-empty"):
        verify_frozen_files(tmp_path, {})
    with pytest.raises(SecurityPolicyError, match="duplicate"):
        verify_frozen_files(tmp_path, (("a.txt", "0" * 64), ("a.txt", "1" * 64)))
    with pytest.raises(SecurityPolicyError, match="expected digest"):
        verify_frozen_files(tmp_path, {"a.txt": "BAD"})
    with pytest.raises(SecurityPolicyError, match="path"):
        verify_frozen_files(tmp_path, {"../a.txt": "0" * 64})
    (tmp_path / "link.txt").symlink_to(tmp_path / "a.txt")
    with pytest.raises(SecurityPolicyError, match="opened safely"):
        verify_frozen_files(tmp_path, {"link.txt": "0" * 64})
    (tmp_path / "folder").mkdir()
    with pytest.raises(SecurityPolicyError, match="regular file"):
        verify_frozen_files(tmp_path, {"folder": "0" * 64})


def test_frozen_protocol_and_input_lock_match_current_repository() -> None:
    report = verify_frozen_files(REPO_ROOT, FROZEN_Q_LANE_FILES_SHA256)
    assert report.clean
    assert tuple(item.relative_path for item in report.files) == tuple(
        sorted(
            {
                "EDGE_PROTOCOL_V1.md",
                "package-lock.json",
                "packages/edge-protocol-tests/protocol.test.mjs",
                "packages/edge-protocol/fixtures/fixtures-v1.json",
                "packages/edge-protocol/schema/edge-protocol-v1.schema.json",
                "quant/DIRECTIVE_INPUTS.lock",
                "quant/EDGE_HYPOTHESIS_MAP.md",
                "quant/registry/edge_hypotheses.v1.json",
                "quant/uv.lock",
            }
        )
    )
    lock = verify_directive_input_lock(REPO_ROOT, expected_sha256=INPUT_LOCK_SHA256)
    assert lock.clean
    assert lock.files[0].relative_path == "quant/DIRECTIVE_INPUTS.lock"


def test_changed_path_scope_accepts_only_q17_exclusive_paths() -> None:
    paths = (
        "quant/src/quant_edge/final_proof/security.py",
        "quant/tests/q17/test_security.py",
        "quant/scripts/q17_acceptance_campaign.py",
        "quant/generated/q17/security_scope.v1.json",
        "quant/TASKS/Q17.md",
        "quant/DECISIONS/Q17-001-FINAL-PROOF.md",
        "quant/docs/Q17_END_TO_END_ACCEPTANCE.md",
        "quant/RECEIPTS/Q17.md",
        "quant/QUANT_EDGE_BUILD_STATE.md",
    )
    report = verify_changed_path_scope(reversed(paths))
    assert report.clean
    report.require_clean()
    assert report.changed_paths == tuple(sorted(paths))
    assert json.loads(json.dumps(report.as_mapping())) == report.as_mapping()
    assert report == verify_changed_path_scope(paths)


def test_changed_path_scope_rejects_outside_empty_duplicates_and_bad_policy() -> None:
    report = verify_changed_path_scope(
        ("quant/src/quant_edge/registry_ops/store.py", "packages/edge-protocol/schema/x.json")
    )
    assert not report.clean
    assert len(report.violations) == 2
    with pytest.raises(SecurityPolicyError, match="empty or outside"):
        report.require_clean()
    empty = verify_changed_path_scope(())
    assert not empty.clean
    with pytest.raises(SecurityPolicyError, match="duplicates"):
        verify_changed_path_scope(("quant/tests/q17/a.py", "quant/tests/q17/a.py"))
    with pytest.raises(SecurityPolicyError, match="path"):
        verify_changed_path_scope(("../escape.py",))
    with pytest.raises(SecurityPolicyError, match="permit at least one"):
        verify_changed_path_scope(("quant/x.py",), allowed_prefixes=(), allowed_exact=())
    boundary = verify_changed_path_scope(("quant/TASKS/Q170_EVIL.md",))
    assert not boundary.clean
    assert boundary.violations[0].relative_path == "quant/TASKS/Q170_EVIL.md"


def test_report_value_objects_expose_fail_closed_empty_states() -> None:
    empty_digest = hashlib.sha256(b"").hexdigest()
    with pytest.raises(SecurityPolicyError, match="byte verifier"):
        FrozenVerificationV1((), empty_digest, object())
    scope = verify_changed_path_scope(())
    assert not scope.clean
    assert scope.as_mapping()["changedPathCount"] == 0
    with pytest.raises(SecurityPolicyError, match="path verifier"):
        ScopeVerificationV1((), (), empty_digest, object())


def test_forged_report_rows_and_digests_cannot_claim_clean() -> None:
    with pytest.raises(SecurityPolicyError, match="path"):
        FrozenFileIdentityV1("../escape", "0" * 64, "0" * 64, 1)
    with pytest.raises(SecurityPolicyError, match="byte length"):
        FrozenFileIdentityV1("safe", "0" * 64, "0" * 64, 0)
    with pytest.raises(SecurityPolicyError, match="observed frozen-file"):
        FrozenFileIdentityV1("safe", "0" * 64, "junk", 1)
    with pytest.raises(SecurityPolicyError, match="reason"):
        ScopeViolationV1("quant/x", "MADE_UP")
    with pytest.raises(SecurityPolicyError, match="path"):
        ScopeViolationV1("../escape", "OUTSIDE_EXCLUSIVE_WRITE_SET")
    row = FrozenFileIdentityV1("safe", "0" * 64, "0" * 64, 1)
    seal = security_module._VERIFIED_REPORT_SEAL
    with pytest.raises(SecurityPolicyError, match="exact rows"):
        FrozenVerificationV1((row,), "0" * 64, seal)
    with pytest.raises(SecurityPolicyError, match="violations do not bind"):
        ScopeVerificationV1(
            ("quant/TASKS/Q170_EVIL.md",),
            (),
            hashlib.sha256(b"quant/TASKS/Q170_EVIL.md").hexdigest(),
            seal,
        )
    with pytest.raises(SecurityPolicyError, match="exact paths"):
        ScopeVerificationV1(
            ("quant/TASKS/Q17.md",),
            (),
            "0" * 64,
            seal,
        )


def test_sealed_reports_reject_noncanonical_rows_and_scope_policies() -> None:
    seal = security_module._VERIFIED_REPORT_SEAL
    first = FrozenFileIdentityV1("a", "0" * 64, "0" * 64, 1)
    second = FrozenFileIdentityV1("b", "1" * 64, "1" * 64, 1)
    with pytest.raises(SecurityPolicyError, match="sorted tuple"):
        FrozenVerificationV1((second, first), "0" * 64, seal)
    with pytest.raises(SecurityPolicyError, match="unique paths"):
        FrozenVerificationV1((first, first), "0" * 64, seal)
    with pytest.raises(SecurityPolicyError, match="duplicate prefixes"):
        verify_changed_path_scope(
            ("quant/tests/q17/a.py",),
            allowed_prefixes=("quant/tests/q17/", "quant/tests/q17/"),
            allowed_exact=(),
        )
    with pytest.raises(SecurityPolicyError, match="duplicate exact"):
        verify_changed_path_scope(
            ("quant/tests/q17/a.py",),
            allowed_prefixes=(),
            allowed_exact=("quant/tests/q17/a.py", "quant/tests/q17/a.py"),
        )
    with pytest.raises(SecurityPolicyError, match="sorted unique"):
        ScopeVerificationV1(
            ("quant/tests/q17/b.py", "quant/tests/q17/a.py"),
            (),
            "0" * 64,
            seal,
        )
    canonical = verify_changed_path_scope(("quant/tests/q17/a.py",))
    with pytest.raises(SecurityPolicyError, match="canonical and sorted"):
        ScopeVerificationV1(
            canonical.changed_paths,
            canonical.violations,
            canonical.path_set_sha256,
            seal,
            tuple(reversed(canonical.allowed_prefixes)),
            canonical.allowed_exact,
        )


def test_bounded_file_read_detects_oversized_input(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (tmp_path / "large.py").write_bytes(b"pass\n")
    monkeypatch.setattr(security_module, "MAX_SOURCE_BYTES", 1)
    with pytest.raises(SecurityPolicyError, match="exceeds"):
        scan_python_file(tmp_path, "large.py")
