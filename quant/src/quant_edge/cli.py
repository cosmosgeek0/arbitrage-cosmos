import argparse
import hashlib
import shutil
import stat
import subprocess
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import cast

from quant_edge.canonical import canonical_json_bytes
from quant_edge.clock import FixedClock
from quant_edge.config import TruthPosture, make_research_config
from quant_edge.errors import QuantEdgeError
from quant_edge.hypotheses import HypothesisRegistry, verify_hypothesis_map
from quant_edge.randomness import seed_fixture_bytes

_REGISTRY_MAX_BYTES = 262_144
_MAP_MAX_BYTES = 262_144
_PROTOCOL_ARTIFACT_MAX_BYTES = 2_097_152
_FROZEN_PROTOCOL_SHA256 = {
    "EDGE_PROTOCOL_V1.md": "951fdbb5f347f900c61e60055f90cf2e1e1e743b75b7dc733652acb8d43353a1",
    "packages/edge-protocol-tests/protocol.test.mjs": (
        "b9745ad52d92c50fcfa48b9772024b86fcf4fa738e8c35c817fa77021ad970b9"
    ),
    "packages/edge-protocol/fixtures/fixtures-v1.json": (
        "c42a4257ea5f46abb38ec9ab4e56983e7049cdf5b448150a4d4647a6234d99a4"
    ),
    "packages/edge-protocol/schema/edge-protocol-v1.schema.json": (
        "229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c"
    ),
}
_FROZEN_PROTOCOL_OUTPUT_SHA256 = "6591ec8e208d1c17f43c99522660d8d7f1d039347a3ea7b0aecd986e6b0c8d54"


def _write_stdout(raw: bytes) -> None:
    sys.stdout.buffer.write(raw)


def _read_bounded_regular_file(path: Path, *, max_bytes: int, label: str) -> bytes:
    if path.is_symlink():
        raise QuantEdgeError(f"{label} must not be a symbolic link: {path}")
    if not path.exists():
        raise QuantEdgeError(f"{label} is missing: {path}")
    metadata = path.stat()
    if not stat.S_ISREG(metadata.st_mode):
        raise QuantEdgeError(f"{label} must be a regular file: {path}")
    if metadata.st_size > max_bytes:
        raise QuantEdgeError(f"{label} exceeds {max_bytes} bytes: {path}")
    with path.open("rb") as handle:
        raw = handle.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise QuantEdgeError(f"{label} exceeds {max_bytes} bytes: {path}")
    return raw


def _config_command(args: argparse.Namespace) -> int:
    config = make_research_config(
        clock=FixedClock(cast(int, args.as_of_ms)),
        run_id=cast(str, args.run_id),
        seed=cast(int, args.seed),
        truth_posture=cast(TruthPosture, args.truth_posture),
        dataset_revision=cast(str | None, args.dataset_revision),
    )
    _write_stdout(config.canonical_bytes())
    return 0


def _seed_fixture_command(args: argparse.Namespace) -> int:
    _write_stdout(seed_fixture_bytes(seed=cast(int, args.seed), count=cast(int, args.count)))
    return 0


def _registry_command(args: argparse.Namespace) -> int:
    registry_path = Path(cast(str, args.registry))
    map_path = Path(cast(str, args.map_path))
    registry_raw = _read_bounded_regular_file(
        registry_path, max_bytes=_REGISTRY_MAX_BYTES, label="hypothesis registry"
    )
    map_raw = _read_bounded_regular_file(map_path, max_bytes=_MAP_MAX_BYTES, label="hypothesis map")
    try:
        map_markdown = map_raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise QuantEdgeError("hypothesis map must be valid UTF-8") from error
    registry = HypothesisRegistry.from_canonical_bytes(registry_raw)
    verify_hypothesis_map(map_markdown, registry)
    _write_stdout(canonical_json_bytes(registry.verification_summary()))
    return 0


def _protocol_command(args: argparse.Namespace) -> int:
    repo_root = Path(cast(str, args.repo_root)).resolve()
    for relative_path, expected_sha256 in _FROZEN_PROTOCOL_SHA256.items():
        artifact = repo_root / relative_path
        raw = _read_bounded_regular_file(
            artifact,
            max_bytes=_PROTOCOL_ARTIFACT_MAX_BYTES,
            label="frozen protocol artifact",
        )
        if hashlib.sha256(raw).hexdigest() != expected_sha256:
            raise QuantEdgeError(f"frozen protocol artifact identity mismatch: {artifact}")
    protocol_test = repo_root / "packages/edge-protocol-tests/protocol.test.mjs"
    timeout_seconds = cast(int, args.timeout_seconds)
    if not 1 <= timeout_seconds <= 300:
        raise QuantEdgeError("timeout-seconds must be from 1 through 300")
    node = shutil.which("node")
    if node is None:
        raise QuantEdgeError("node executable is unavailable")
    command = [node, str(protocol_test)]
    try:
        result = subprocess.run(
            command,
            cwd=repo_root,
            check=False,
            capture_output=True,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as error:
        raise QuantEdgeError("frozen protocol verification timed out") from error
    if result.returncode == 0:
        output_sha256 = hashlib.sha256(result.stdout).hexdigest()
        if result.stderr or output_sha256 != _FROZEN_PROTOCOL_OUTPUT_SHA256:
            raise QuantEdgeError("frozen protocol verification output mismatch")
    sys.stdout.buffer.write(result.stdout)
    sys.stderr.buffer.write(result.stderr)
    return result.returncode if 0 <= result.returncode <= 125 else 1


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="quant-edge",
        description="Deterministic advisory research infrastructure",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    config = subparsers.add_parser("config", help="render an explicit canonical config")
    config.add_argument("--run-id", required=True)
    config.add_argument("--as-of-ms", required=True, type=int)
    config.add_argument("--seed", required=True, type=int)
    config.add_argument("--truth-posture", required=True, choices=("RESEARCH", "SYNTHETIC"))
    config.add_argument("--dataset-revision")
    config.set_defaults(handler=_config_command)

    fixture = subparsers.add_parser("seed-fixture", help="render deterministic seed outputs")
    fixture.add_argument("--seed", required=True, type=int)
    fixture.add_argument("--count", required=True, type=int)
    fixture.set_defaults(handler=_seed_fixture_command)

    registry = subparsers.add_parser("registry-verify", help="verify registry and Markdown map")
    registry.add_argument("--registry", required=True)
    registry.add_argument("--map", dest="map_path", required=True)
    registry.set_defaults(handler=_registry_command)

    protocol = subparsers.add_parser("protocol-verify", help="run the frozen protocol suite")
    protocol.add_argument("--repo-root", required=True)
    protocol.add_argument("--timeout-seconds", type=int, default=30)
    protocol.set_defaults(handler=_protocol_command)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    handler = cast(Callable[[argparse.Namespace], int], args.handler)
    try:
        return handler(args)
    except (OSError, QuantEdgeError) as error:
        print(f"quant-edge: {error}", file=sys.stderr)
        return 2
