#!/usr/bin/env python3
"""Freeze and verify the accepted S-1/V-G/S-2/DQ disposition registry.

This is an offline data-layer projection.  It reads only the exact N3-S4 Git
object, explicit Git object metadata, and allowlisted run.md receipt rows.  It
does not execute research, read archive or holdout bodies, inspect private
data, call a provider, or authorize capital.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path, PurePosixPath
from typing import Any, NoReturn, cast

SCHEMA_ID = "VerdictNormalizationRegistryV1"
SOURCE_SCHEMA_ID = "VerdictNormalizationSourceSpecV1"
VERSION = 1

N3_COMMIT = "0c0c774cc48d9bcb6c914ccd393c2b5c0b6131d4"
N3_TREE = "2a532877f55f9ef1a2892b2364ff981a0ff953e3"
N3_PARENT = "88d2c06350e3387ab810010f6027d9d52191f3fe"
N3_PATH = "quant/research/n3_successor/current_profitability_registry.v4.json"
N3_BLOB = "a32a661a8c14736a28cb3d117f86614ff01945e8"
N3_BYTES = 118516
N3_RAW_SHA256 = "18098a23ad1aeb1ef8e6bfc7652177561b6d05a8904f025252ba10e9eb517a06"
N3_ACCEPTANCE_ID = "2026-07-30 ORCHESTRATOR N3-S4 ACCEPTANCE"
N3_ACCEPTANCE_SHA256 = "522922229178f38f2998d2568ced4a50f7f4d63443db319f04e7c20f7b35290b"

OWNER_BURST_ID = "2026-07-30 ORCHESTRATOR OWNER BURST REFILL"
OWNER_BURST_SHA256 = "ddd291f474cd522381886997be8b7ada7e9824596e2306aec45ae35e6869785c"

CONSUMERS = ("FINAL_PROFITABILITY", "FUTURE_S_DASH_DATA")


class ContractError(RuntimeError):
    """The frozen normalization contract did not verify."""


def fail(message: str) -> NoReturn:
    raise ContractError(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def duplicate_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def reject_constant(value: str) -> NoReturn:
    fail(f"non-finite JSON number: {value}")


def strict_load(raw: bytes, label: str, *, decimals: bool = False) -> dict[str, Any]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ContractError(f"{label}: not UTF-8") from exc
    try:
        value = json.loads(
            text,
            object_pairs_hook=duplicate_object,
            parse_constant=reject_constant,
            parse_float=Decimal if decimals else lambda _: fail("floats forbidden"),
        )
    except (json.JSONDecodeError, ContractError) as exc:
        if isinstance(exc, ContractError):
            raise
        raise ContractError(f"{label}: invalid JSON: {exc}") from exc
    require(type(value) is dict, f"{label}: root must be object")
    return cast(dict[str, Any], value)


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


def git(repo: Path, args: Sequence[str]) -> bytes:
    proc = subprocess.run(
        ["git", *args],
        cwd=repo,
        check=False,
        capture_output=True,
    )
    if proc.returncode:
        fail(f"git {' '.join(args)} failed: {proc.stderr.decode(errors='replace').strip()}")
    return proc.stdout


def exact_oid(value: str, label: str) -> str:
    require(
        len(value) == 40 and all(char in "0123456789abcdef" for char in value),
        f"{label}: full lowercase 40-hex OID required",
    )
    return value


def safe_path(value: str, label: str) -> str:
    path = PurePosixPath(value)
    require(
        bool(value) and not path.is_absolute() and ".." not in path.parts and "." not in path.parts,
        f"{label}: unsafe path",
    )
    return value


def git_tree(repo: Path, commit: str) -> str:
    return git(repo, ["show", "-s", "--format=%T", exact_oid(commit, "commit")]).decode().strip()


def read_blob(repo: Path, commit: str, path: str) -> bytes:
    safe_path(path, "blob path")
    return git(repo, ["show", f"{exact_oid(commit, 'commit')}:{path}"])


def blob_metadata(repo: Path, commit: str, path: str) -> tuple[str, int]:
    safe_path(path, "blob path")
    raw = git(repo, ["ls-tree", "-z", exact_oid(commit, "commit"), "--", path])
    entries = [entry for entry in raw.split(b"\0") if entry]
    require(len(entries) == 1, f"{commit}:{path}: expected one tree entry")
    header, found_path = entries[0].split(b"\t", 1)
    mode, object_type, blob = header.decode().split(" ")
    require(found_path.decode() == path, f"{commit}:{path}: path mismatch")
    require(mode == "100644", f"{commit}:{path}: mode must be 100644")
    require(object_type == "blob", f"{commit}:{path}: object must be blob")
    blob_text = exact_oid(blob, "blob")
    size_raw = git(repo, ["cat-file", "-s", blob_text]).decode().strip()
    require(size_raw.isdigit(), f"{commit}:{path}: invalid blob size")
    return blob_text, int(size_raw)


def verify_pin(repo: Path, pin: Mapping[str, Any], label: str) -> None:
    commit = str(pin["producerCommit"])
    tree = str(pin["producerTree"])
    require(git_tree(repo, commit) == tree, f"{label}: producer tree mismatch")
    blob, size = blob_metadata(repo, commit, str(pin["path"]))
    require(blob == pin["gitBlob"], f"{label}: blob mismatch")
    require(size == pin["byteLength"], f"{label}: byte length mismatch")
    raw = git(repo, ["cat-file", "blob", blob])
    require(len(raw) == size, f"{label}: cat-file byte length mismatch")
    require(sha256(raw) == pin["rawSha256"], f"{label}: raw SHA-256 mismatch")


def run_rows(raw: bytes) -> dict[str, bytes]:
    require(b"\r" not in raw, "run.md: CR bytes forbidden")
    require(raw.endswith(b"\n"), "run.md: final LF required")
    rows: dict[str, bytes] = {}
    for row in raw.splitlines(keepends=True):
        prefix = b"- item=`"
        if not row.startswith(prefix):
            continue
        end = row.find(b"`", len(prefix))
        require(end != -1, "run.md: malformed item row")
        try:
            record_id = row[len(prefix) : end].decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ContractError("run.md: non-UTF-8 item id") from exc
        require(record_id not in rows, f"run.md: duplicate item id: {record_id}")
        rows[record_id] = row
    return rows


def receipt(
    rows: Mapping[str, bytes],
    record_id: str,
    expected_sha: str,
    *,
    allow_transitive: bool = False,
) -> dict[str, Any]:
    if record_id not in rows:
        require(
            allow_transitive,
            f"run.md: missing receipt: {record_id}",
        )
        return {
            "recordId": record_id,
            "rowAvailability": "TRANSITIVE_FROZEN_RECEIPT",
            "rowByteLength": None,
            "rowSha256": expected_sha,
        }
    row = rows[record_id]
    require(row.endswith(b"\n"), f"run.md: missing LF: {record_id}")
    require(sha256(row) == expected_sha, f"run.md: receipt hash mismatch: {record_id}")
    return {
        "recordId": record_id,
        "rowAvailability": "CURRENT_LEDGER",
        "rowByteLength": len(row),
        "rowSha256": expected_sha,
    }


@dataclass(frozen=True)
class Pin:
    commit: str
    tree: str
    path: str
    blob: str
    size: int
    raw_sha256: str


@dataclass(frozen=True)
class Extra:
    record_id: str
    row_sha256: str
    disposition: str
    source_verdict: str | None
    normalized_verdict: str | None
    rejection_code: str
    holdout: str
    pin: Pin | None = None


LEGACY: dict[str, Pin] = {
    "S-1P": Pin(
        "6e67097311a19b44333d9c4bab8ccaa0813fb643",
        "eaf6772d1ae19ed4472e6f64fc1dc1cfab7044cf",
        "quant/research/s1p/result.v1.json",
        "bd218c1866cdd5984637765b3f3270da51f0ef41",
        1006,
        "81181ecd9c3f4d566ee728eb7f7367220dfee8f5123dab786ebed37f90d2ee7a",
    ),
    "S-1U": Pin(
        "2320bb5781ee9dfe6a2596675427fdff73680935",
        "776045386c4763a17f946ff544d0d4bdf97d2ad9",
        "quant/research/s1u/result.v1.json",
        "baa3cd535d834a9d7d9dc051909b33cacf7b89f0",
        2331,
        "e3ad36f59a1981886b273040fce59fbb3fa42e7315a9b3451366957438b988d1",
    ),
    "V-G14": Pin(
        "901d9cee04f0a8b2833522b0fd4e1f14477de736",
        "95ca53245eba9a599bfec717eedbb59b01ce116f",
        "quant/research/vg14/development_result.v1.json",
        "88b936c5bbac3077fd61ba91cef57fd66b3604ff",
        3959,
        "15fac6e45cbaceab4ee2e6d6e4469963ff520ff4c3af4985a9b4a58198e13ffe",
    ),
    "V-G15": Pin(
        "dcd47073c043ad6dce87cfd5db8ea6a372b4e0c4",
        "529f80b430007d398ce206351389f52dc17ffaa5",
        "quant/research/vg15/result.v1.json",
        "992eea5ebf1676fb61e79c69c4c32b4f6448f052",
        26236,
        "6d29b16d51cd3087e937e1b5bd4552cb73023cc40fa35305f6e44f603e4b1f6b",
    ),
    "V-G16": Pin(
        "740c72192e663a2b2d45cd32a4beb6ebfffc8da8",
        "ce8f30cefc3ec3b31ba0e95e68b8d73470f20105",
        "quant/research/vg16/result.v1.json",
        "fda3a3f5bdeafba84507427faa0ddfb93337d3a3",
        1780,
        "54081193ba43891ace9ab91c48740f3bf78b1942f77e332cc66d8f97cdcbfcb1",
    ),
    "V-G18": Pin(
        "bd29e2f22293c5ca90bac5e774f52381fa011f0f",
        "8874e3daa29e0e7df6998820851cfb23a58e09a1",
        "quant/research/vg18/result.v1.json",
        "6b30e51a98b54fbfb54a0786e811b00432474ef3",
        843,
        "248075ed05cb80c46a80beb770a80ba1eb10bbf3fdd6ffec4460325d4548e09b",
    ),
    "V-G21": Pin(
        "e10634022cf9dab49d5aca3536523c5d5f4710e5",
        "7aeed79ea035601b263e1430ba02ef576a10266f",
        "quant/research/vg21/result.v1.json",
        "1810f96471c0c246e67e43491af45e91c3f045fe",
        904,
        "0241e5617cd2a4d2e2d178b80118d2a57ee14ac060f77f7ec315a116ba2e1451",
    ),
    "V-G22": Pin(
        "5f1e88a956702a77aeccb8ef37f5ded02bce9442",
        "5b194a39a48588ca9e48964df04b1ea9e68b1c31",
        "quant/research/vg22/result.v1.json",
        "da4b1729031a1ca4d8cafe98870339d34629f651",
        1662,
        "39ad78f2fe358abc4bada25bdb56ce74959ede949fe534cb546c5339b01c3c53",
    ),
    "V-G24": Pin(
        "be9b9bdf27b06cceddeacd731bced04d330be2f5",
        "999bef8ebdafd7e7d0fe81066ef47b4200e29eeb",
        "quant/research/vg24/result.v1.json",
        "22ab9d384e124b4ef446f370a7506c7f8e5c598b",
        907,
        "7d86e5374264576e2b85956cd3afb0509661222e56b422002f97291737d1c2aa",
    ),
    "V-G25": Pin(
        "c66ca5bb6bf024f2abb9ab4e6b9136f0e1e76942",
        "f4fd146f5d925a9dbb8680db8c4701de5c0c387b",
        "quant/research/vg25/result.v1.json",
        "6d5d4f507b59beeea8a4ea76f22546cdb1515f8e",
        1197,
        "92edab755c6383415981a356f69724ae84cb05788ccd772c89000100b8c8d5a7",
    ),
    "V-G29": Pin(
        "216dfd610cdce72fb665a968f8d7ed5f379cedbc",
        "2ab401d3d10311ee50ad1eb7a7f61b07eae6f6b7",
        "quant/research/vg29/result.v1.json",
        "81529ce5d3cb54a0d7a9dd12b296a76ff8781734",
        64391,
        "08665f6ef2247869086d24c0c42329e60e77e234ce5778d7fb7396aa2612731c",
    ),
    "V-G30": Pin(
        "7f7e0b55b98fe39e4d3089720c26f3b25b3c336a",
        "a685d218c272ee4fbb648abe6fb20e970c596cf4",
        "quant/research/vg30/result.v1.json",
        "cffe90dd1b4cfb4c11aae8e960cc50e10a2e5729",
        2500,
        "34ace7541d361f678f0d71a4f42e292d9804b32bb9206a4ccb37da601ac85b52",
    ),
    "V-G31": Pin(
        "ca92ea1aa40d5bda22e5be7cde57902cddfe259a",
        "ffda4c04c056007366c6b182e3c718bf84648556",
        "quant/research/vg31/result.v1.json",
        "08d52e1e532cc882f885d49be049f05de8bfcd9c",
        57122,
        "0b42f4fd0a7cb28d652e27716b6c0054799c0e4d1bbc9cdf4eefbc7f881921fc",
    ),
}

LEGACY_FACTS: dict[str, tuple[str, str, str | None, tuple[str, ...]]] = {
    "S-1P": (
        "UNMEASURED",
        "UNMEASURED",
        None,
        ("OFF_HOUR_FUNDING_TIMESTAMP", "RUN_STOPPED_BEFORE_INFERENCE"),
    ),
    "S-1U": (
        "NO_GO",
        "REPORTED_DIAGNOSTIC",
        "0.7771",
        ("ALL_NINE_TRIALS_MATERIALLY_NEGATIVE",),
    ),
    "V-G14": (
        "NO_GO",
        "NOT_REPORTED",
        None,
        ("ALL_FOUR_TRIALS_FAILED_DEVELOPMENT_GATES",),
    ),
    "V-G15": (
        "NO_GO",
        "REPORTED_DIAGNOSTIC",
        "0.28571429",
        ("NO_DEVELOPMENT_GATE_PASSER", "BASE_LOWER_BOUND_NEGATIVE"),
    ),
    "V-G16": (
        "UNMEASURED",
        "UNMEASURED",
        None,
        ("ACAUSDT_DAILY_CLOSE_BOUNDARY_INVALID",),
    ),
    "V-G18": (
        "NO_GO",
        "REPORTED_DIAGNOSTIC",
        "0.50",
        ("CASH_ZERO_SELECTOR_ACTIVE_TRIAL_NEGATIVE",),
    ),
    "V-G21": (
        "UNMEASURED",
        "UNMEASURED",
        None,
        ("DUPLICATE_AXSUSDT_ROW", "EVALUATOR_REUSE_FORBIDDEN"),
    ),
    "V-G22": (
        "UNMEASURED",
        "UNMEASURED",
        None,
        ("ACAUSDT_DAILY_CLOSE_BOUNDARY_INVALID",),
    ),
    "V-G24": (
        "UNMEASURED",
        "UNMEASURED",
        None,
        ("DUPLICATE_OR_UNSORTED_AXSUSDT_ROW",),
    ),
    "V-G25": (
        "NO_GO",
        "REPORTED_DIAGNOSTIC",
        "0",
        ("POSITIVE_POINT_ESTIMATE_NOT_CREDIBLE", "EIGHT_DEVELOPMENT_GATES_FAILED"),
    ),
    "V-G29": (
        "NO_GO",
        "REPORTED_DIAGNOSTIC",
        "0.9429",
        ("POSITIVE_POINT_ESTIMATE_NOT_CREDIBLE", "EXTERNAL_ADJUSTED_P_ONE"),
    ),
    "V-G30": (
        "UNMEASURED",
        "UNMEASURED",
        None,
        ("ACAUSDT_DAILY_CLOSE_BOUNDARY_INVALID",),
    ),
    "V-G31": (
        "NO_GO",
        "UNMEASURED",
        None,
        ("ALL_FIXED_COHORT_NET_RANGES_NEGATIVE",),
    ),
}

PBO_REPORTED: dict[str, str] = {
    "S-1C": "0.314285714286",
    "S-1R": "0",
    "S-1Y": "0.5286",
    "S-1Z": "0.1429",
    "S-2A": "0.3127705628",
    "S-2G": "0.2571428571",
    "S-2I": "0",
    "V-G8": "0.614285714286",
    "V-G17": "0.89177489",
    "V-G19": "0.6596736597",
    "V-G20": "0.2142857143",
    "V-G23": "0.385714285714",
    "V-G26": "0.8730",
    "V-G27": "0.142857",
    "V-G28": "0.5286",
    "V-G36": "0.0571",
}
PBO_NOT_APPLICABLE = frozenset({"S-2K"})

HOLDOUT_OVERRIDES: dict[str, str] = {
    "S-1D": "OPENED_NO_VALID_COHORT",
    "S-1M": "INVALIDATED_BEFORE_ECONOMICS",
    "S-1Z": "CONSUMED_NO_REOPEN",
    "S-2H": "SEALED_UNOPENED_ZERO_OUTCOME_ROWS",
    "V-G8": "OPENED",
    "V-G10": "NOT_REQUESTED_OR_OPENED",
    "V-G11": "UNOPENED_ZERO_BODIES",
    "V-G19": "OPENED",
    "V-G23": "OPENED",
}
HOLDOUT_VALUES: dict[str, str] = {
    "S-1D": "OPENED_1;VALID_COHORTS_0_OF_51",
    "V-G8": "OPENED_1_OF_1",
    "V-G19": "OPENED_1_OF_1",
    "V-G23": "OPENED_1_OF_1",
}
OOS_VALUES: dict[str, str] = {
    "S-1D": "VALID_COHORTS_0_OF_51;UNMEASURABLE",
    "V-G8": "STRESS_NET_-129.82_USD_PER_1000;CI_[-509.96,560.54]_USD_PER_1000",
    "V-G19": "RETURN_-0.9569_PERCENT;EXCESS_-0.2348_PERCENT;LCB_-5.1856_PERCENT",
    "V-G23": "STRESS_NET_-158.06_USD_PER_1000;CI_[-317.62,7.60]_USD_PER_1000",
}

REJECTED_PINS: dict[str, Pin] = {
    "S-1V": Pin(
        "b093b996f081b8f2accd787c18bc9d0e45f852d8",
        "07019994e0a4e23b1a1aa3fc8c8c1911598e772d",
        "quant/research/s1v/result.v1.json",
        "fadeb94031befe13867ecfe4715da0527ca94e31",
        2529,
        "155265e591df90bfd4c8ecfefa64b9e5086a6c19fec3ec791f047afa221d702d",
    ),
    "S-1W": Pin(
        "380df9c6ec337133e7266a0e76c90959659cdd92",
        "aa509cf77ceb992d7414ed31f9deef23f115f7db",
        "quant/research/s1w/generated/result.v1.json",
        "b073e55db5274132f5fbf36147610660779a4660",
        2863,
        "da2e31df54fbbd52cccb16283bdc76f6485b4f93a2d26cc9c2ed52b4912dbe3d",
    ),
    "V-G1": Pin(
        "10d76cb05a75ff99fcf5abdda3b0764b1203cb2b",
        "4445277e1c2b6e80ea0bb2ec9f3d11130b84085f",
        "quant/research/vg1/result.v1.json",
        "f2edf22c8f01628feaa8f0b30e6041e95b322766",
        444631,
        "1537280ebabd56733634f2f4b96d66580640f94f1698f313f3183285fddb2473",
    ),
    "V-G12": Pin(
        "a1bd353ba30072e97fe724a03472c1b31ddb755a",
        "4ec361494e8b1520519c3c72aefed0fd7c33d57c",
        "quant/research/vg12/result.v1.json",
        "6f86a8e30f84154e1b51e520414053b13612d8e4",
        339983,
        "05d00a9f72dd46c53095f514a2681943ebd1fb66ca9a8fdc924b100d57a0cf7a",
    ),
    "V-G32": Pin(
        "b796b88a7a4784faf4b0d636415fac9422a5f365",
        "d01b2393843d7af9777d28e12b2912f526a95754",
        "quant/research/vg32/result.v1.json",
        "68cd648b62ae89b04c867a65937fb8693ab4905e",
        39094,
        "9e591b965261cae5baa2b1fccfd82a3d7e3447b054e72fd62de29588f738ca78",
    ),
    "V-G35": Pin(
        "3f99b7bb586b3277a51637bb9713b3cf81854c0f",
        "85b04be377b114dd1cb9614141a19a30e659e469",
        "quant/research/vg35/result.v1.json",
        "aff7348679bbebbbd87997d847ed2ee3b623736b",
        1632,
        "c7b7ef27bf94cdc1e5312fad6b475729eecb1dfa2d4dc9aaaadb62158f205b38",
    ),
    "V-G38": Pin(
        "fb74529fa2d55b2cff9592ee5fa9661b697326b3",
        "37aa3c8888b3e98a2415f04a50b8b31e3fa9eb8c",
        "quant/research/vg38/result.v1.json",
        "e84e6f0ee243c37175cfbae038b21aefe3fd9e5d",
        51719,
        "9bf5980fb7b142d6436d3cc57740f6f43a0262924e22cf6bb850a1a319db8e8a",
    ),
}

EXTRAS: dict[str, Extra] = {
    "S-1V": Extra(
        "2026-07-30 ORCHESTRATOR S-1V REJECTION",
        "c07a1d0207a1e7c84f50470b175fc3932d96c4e56ac11239fca3e24f29c8bccb",
        "REJECTED_PRESERVED",
        "REJECTED_PRESERVED_UNVERIFIED",
        None,
        "FROZEN_VERIFIER_SCHEMA_MISMATCH",
        "UNOPENED",
        REJECTED_PINS["S-1V"],
    ),
    "S-1W": Extra(
        "2026-07-30 ORCHESTRATOR S-1W REJECTION",
        "74bd5399248e0f4ee4976470bc120f8bc30c41f016c37b955577bfcf764ad372",
        "REJECTED_PRESERVED",
        "REJECTED_PRESERVED_ORIGIN",
        None,
        "PROTOCOL_EVALUATOR_VERIFIER_REUSE_FORBIDDEN",
        "UNOPENED",
        REJECTED_PINS["S-1W"],
    ),
    "S-1X": Extra(
        "2026-07-30 ORCHESTRATOR S-1X DISTINCTNESS STOP",
        "bf9f14b5c319382367f6116a4dd2871554e534aafe9b563fd6151c0a73229b5f",
        "RETIRED_DUPLICATE",
        "REJECTED_PRE_WORKTREE",
        None,
        "MATERIAL_DUPLICATE_S-1I",
        "NOT_CREATED",
    ),
    "S-1AA": Extra(
        "2026-07-30 ORCHESTRATOR S-1AA ACCEPTANCE + BURST REFILL",
        "fcbef7395139ec9d787739702427981b62b0a9fd28198c31997a38d6f7b677a8",
        "ACCEPTED_STATE_ONLY",
        "UNMEASURED_SOURCE_COVERAGE_UNAVAILABLE",
        "UNMEASURED",
        "SOURCE_COVERAGE_UNAVAILABLE_CAUSAL_CLOCK_UNSUPPORTED",
        "NOT_CREATED",
    ),
    "V-G1": Extra(
        "2026-07-30 ORCHESTRATOR V-G1 REJECTION",
        "28ca0b5d25c038698e99ed5af861d41868c97738568721fc4638ae28e36203a6",
        "REJECTED_PRESERVED",
        "REJECTED_PRESERVED_UNVERIFIED",
        None,
        "EVALUATOR_VERIFIER_REUSE_FORBIDDEN",
        "UNACQUIRED_UNOPENED",
        REJECTED_PINS["V-G1"],
    ),
    "V-G12": Extra(
        "2026-07-30 ORCHESTRATOR V-G12 REJECTION",
        "7e15a7f5e2a93ac87a71cc0dc091eccae83dcae253177eb754aed175fb44744d",
        "REJECTED_PRESERVED",
        "REJECTED_ORIGIN_PROOF_NOT_DURABLE",
        None,
        "ORIGIN_PROOF_NOT_DURABLE",
        "UNOPENED",
        REJECTED_PINS["V-G12"],
    ),
    "V-G32": Extra(
        "2026-07-30 ORCHESTRATOR V-G32 REJECTION",
        "da7a2a8a6679aeb01473f6cb3f8a7a9152641716ae30fa29d76197521b61cd58",
        "REJECTED_PRESERVED",
        "REJECTED_PRESERVED_LOCAL",
        None,
        "INVALID_ECONOMICS_EVALUATOR_REUSE_FORBIDDEN",
        "UNOPENED",
        REJECTED_PINS["V-G32"],
    ),
    "V-G33": Extra(
        "2026-07-29 ORCHESTRATOR V-G33 DISTINCTNESS STOP",
        "6232db9b3a1f45191c792ce733412c3f0accc3c52ce154ab8f5b70b838ccdb08",
        "RETIRED_DUPLICATE",
        "REJECTED_PRE_WORKTREE",
        None,
        "MATERIAL_DUPLICATE_V-G27",
        "NOT_CREATED",
    ),
    "V-G34": Extra(
        "2026-07-29 ORCHESTRATOR V-G34 DISTINCTNESS STOP",
        "760828106fe7654304053ea40545fefc7b1df570ed9ffdf122c44a60da7512fc",
        "RETIRED_DUPLICATE",
        "REJECTED_PRE_WORKTREE",
        None,
        "MATERIAL_DUPLICATE_V-G30",
        "NOT_CREATED",
    ),
    "V-G35": Extra(
        "2026-07-30 ORCHESTRATOR V-G35 REJECTION",
        "e52e138867da1bd098878bb95dd7474cbc8c4134c3ce6b6c460e1a9d7f72dcba",
        "REJECTED_PRESERVED",
        "REJECTED_PRESERVED_ORIGIN",
        None,
        "DRAWDOWN_DATE_LABEL_MISALIGNMENT_EVALUATOR_REUSE_FORBIDDEN",
        "UNOPENED",
        REJECTED_PINS["V-G35"],
    ),
    "V-G38": Extra(
        "2026-07-30 ORCHESTRATOR V-G38 REJECTION + REFILL",
        "fbe234950e66c5e49ee9f6f4b611cafdc0bb892b48059e1b814bda9c18c9317b",
        "REJECTED_PRESERVED",
        "REJECTED_PRESERVED_ORIGIN",
        None,
        "TERMINAL_SOURCE_STATE_FALSE",
        "UNOPENED",
        REJECTED_PINS["V-G38"],
    ),
    "S-2B": Extra(
        "2026-07-30 ORCHESTRATOR S-2B DISTINCTNESS STOP",
        "6ffbfb65775b6c94b9f236a86d63c3290ac3a62426e7da6898a4ea587e19c62b",
        "RETIRED_DUPLICATE",
        "REJECTED_PRE_WORKTREE",
        None,
        "MATERIAL_DUPLICATE_S-1B_V-G5_SIGNAL_COLLISION",
        "NOT_CREATED",
    ),
    "S-2D": Extra(
        "2026-07-30 ORCHESTRATOR S-2D DISTINCTNESS STOP",
        "7519d4cd0f19e8a6c0dca7a3452c4735af1ea0c2dd9501190b25e7f8c31e5898",
        "RETIRED_DUPLICATE",
        "REJECTED_PRE_WORKTREE",
        None,
        "MATERIAL_DUPLICATE_S-1G_S-1J",
        "NOT_CREATED",
    ),
    "S-2E": Extra(
        "2026-07-30 ORCHESTRATOR S-2E DISTINCTNESS STOP",
        "e7f5371bb8b5d180cf6550130681a2cd351fec9cc9a870f9f47dc2d180ab3662",
        "RETIRED_DUPLICATE",
        "REJECTED_PRE_WORKTREE",
        None,
        "MATERIAL_DUPLICATE_V-G2_V-G3_V-G4_V-G26",
        "NOT_CREATED",
    ),
    "S-2F": Extra(
        "2026-07-30 ORCHESTRATOR S-2F DISTINCTNESS STOP",
        "a715340cb6c0c062fe08da28938acb49edb3e627258dddbc118a78de10ee101b",
        "RETIRED_DUPLICATE",
        "REJECTED_PRE_WORKTREE",
        None,
        "MATERIAL_DUPLICATE_S-1B_V-G5_SIGNAL_COLLISION",
        "NOT_CREATED",
    ),
    "S-2J": Extra(
        "2026-07-30 ORCHESTRATOR S-2J DISTINCTNESS STOP",
        "8a65d27e848b573930f1cd8ce2deca9557b359b7bede889c4f313e8e1c281adf",
        "RETIRED_DUPLICATE",
        "REJECTED_PRE_WORKTREE",
        None,
        "MATERIAL_DUPLICATE_S-1Y",
        "NOT_CREATED",
    ),
    "S-2L": Extra(
        "2026-07-30 ORCHESTRATOR S-2L DISTINCTNESS STOP",
        "abf42270a24f4801e0e52c2d58df08ddc7fa795e1eb2c39bb79babe0e9f26f4c",
        "RETIRED_DUPLICATE",
        "REJECTED_PRE_WORKTREE",
        None,
        "MATERIAL_DUPLICATE_V-G17",
        "NOT_CREATED",
    ),
    "S-2M": Extra(
        "2026-07-30 ORCHESTRATOR S-2M ACCEPTANCE + RETIREMENT",
        "8e4f9c3babbaca90b421b8409e80d19721f46744e5d8d3c3b4467cb55463850f",
        "RETIRED_DUPLICATE",
        "REJECTED_PRE_WORKTREE",
        None,
        "MATERIAL_DUPLICATE_V-G6",
        "NOT_CREATED",
    ),
    "DQ-2": Extra(
        "2026-07-30 ORCHESTRATOR DQ-2 SOURCE STOP",
        "507fb31993a860af34e72ae506838a4241eb30f49a45497de9db27dc7609b675",
        "ACCEPTED_STATE_ONLY",
        None,
        None,
        "OFFICIAL_HISTORICAL_STATUS_SOURCE_NOT_FOUND",
        "NOT_CREATED",
    ),
    "DQ-15": Extra(
        "2026-07-30 ORCHESTRATOR DQ-15 ACCEPTANCE",
        "44bb8993fd1f3307eafa71f8ff943bc5f5ee68bfccf621b1526ad50f84dca484",
        "ACCEPTED_STATE_ONLY",
        None,
        None,
        "POINT_IN_TIME_HISTORY_NOT_ESTABLISHED",
        "NOT_CREATED",
    ),
}

S1_IDS = (*tuple(f"S-1{chr(code)}" for code in range(ord("B"), ord("Z") + 1)), "S-1AA")
VG_IDS = tuple(f"V-G{number}" for number in range(1, 39))
S2_IDS = tuple(f"S-2{chr(code)}" for code in range(ord("A"), ord("M") + 1))
DQ_IDS = tuple(f"DQ-{number}" for number in range(1, 16))
TARGET_IDS = S1_IDS + VG_IDS + S2_IDS + DQ_IDS
TARGET_DISPOSITION_PATTERN = re.compile(r"\b(S-1[A-Z]{1,2}|V-G[0-9]+|S-2[A-Z]+|DQ-[0-9]+)\b")
FINAL_ROW_TOKENS = ("ACCEPTANCE", "REJECTION", "DISTINCTNESS STOP", "SOURCE STOP")


def reject_post_census_rows(rows: Mapping[str, bytes]) -> None:
    for record_id in rows:
        upper = record_id.upper()
        if "ORCHESTRATOR" in upper and any(token in upper for token in FINAL_ROW_TOKENS):
            for match in TARGET_DISPOSITION_PATTERN.findall(upper):
                require(match in TARGET_IDS, f"new target disposition requires successor: {match}")
        is_final = "ACCEPTANCE" in upper or "TERMINAL" in upper or "VERDICT" in upper
        maker_terminal = "MAKER" in upper and is_final
        volume_terminal = "VOLUME" in upper and "ECON" in upper and is_final
        require(
            not maker_terminal and not volume_terminal,
            f"pending input has a newer terminal row: {record_id}",
        )


def category(record_id: str) -> str:
    if record_id.startswith("S-1"):
        return "S1"
    if record_id.startswith("V-G"):
        return "VG"
    if record_id.startswith("S-2"):
        return "S2"
    if record_id.startswith("DQ-"):
        return "DQ"
    return "CONTROL"


def pin_dict(pin: Pin, *, trusted: bool) -> dict[str, Any]:
    return {
        "byteLength": pin.size,
        "contentReadForNormalization": False,
        "gitBlob": pin.blob,
        "path": pin.path,
        "rawSha256": pin.raw_sha256,
        "rawSha256VerifiedThisTask": True,
        "trustedForEconomics": trusted,
    }


def producer_dict(pin: Pin) -> dict[str, str]:
    return {"commit": pin.commit, "tree": pin.tree}


def pbo_fact(record_id: str, state: str | None = None, value: str | None = None) -> dict[str, Any]:
    if state is None:
        if record_id in PBO_REPORTED:
            state, value = "REPORTED_DIAGNOSTIC", PBO_REPORTED[record_id]
        elif record_id in PBO_NOT_APPLICABLE:
            state, value = "NOT_APPLICABLE", None
        else:
            state, value = "UNMEASURED", None
    require(
        (state == "REPORTED_DIAGNOSTIC") == (value is not None),
        f"{record_id}: PBO value/state mismatch",
    )
    return {"evidence": "EXACT_ACCEPTED_DISPOSITION", "state": state, "value": value}


def oos_state(holdout: str) -> str:
    if holdout in {"OPENED", "OPENED_NO_VALID_COHORT"}:
        return "SOURCE_BOUND"
    if holdout == "CONSUMED_NO_REOPEN":
        return "CONSUMED_NO_REOPEN"
    if holdout in {"NOT_CREATED", "NOT_APPLICABLE"}:
        return "NOT_APPLICABLE"
    if holdout == "INVALIDATED_BEFORE_ECONOMICS":
        return "UNMEASURED"
    if holdout == "PENDING":
        return "PENDING"
    return "NOT_EVALUATED"


def common_record(
    *,
    record_id: str,
    disposition: str,
    n3_consumption: str,
    run_receipt: dict[str, Any],
    producer: dict[str, str] | None,
    result_pin: dict[str, Any] | None,
    absence_reason: str | None,
    source_verdict: str | None,
    normalized_verdict: str | None,
    credibility_state: str,
    credibility_reason: str,
    holdout_state: str,
    pbo: dict[str, Any],
    rejection_code: str | None,
    rejection_detail: str | None,
    economic_consumable: bool,
    limitations: Sequence[str],
    holdout_value: str | None = None,
    oos_value: str | None = None,
    task_locator_suffix: str | None = None,
) -> dict[str, Any]:
    economic = disposition == "ACCEPTED_ECONOMIC"
    derived_oos_state = oos_state(holdout_state)
    require(
        (derived_oos_state == "SOURCE_BOUND") == (oos_value is not None),
        f"{record_id}: OOS state/value mismatch",
    )
    require(
        (holdout_state in {"OPENED", "OPENED_NO_VALID_COHORT"}) == (holdout_value is not None),
        f"{record_id}: holdout state/value mismatch",
    )
    if economic:
        fees = {
            "accountEffectiveState": "UNKNOWN",
            "accountEffectiveValue": None,
            "publicProxyState": "BOUND_RESULT_NOT_ACCOUNT_TRUTH",
            "publicProxyValue": None,
        }
        capacity = {
            "executableState": "UNKNOWN",
            "executableValue": None,
            "measurementState": "UNMEASURED",
            "publicProxyState": "BOUND_RESULT_NOT_EXECUTABLE_TRUTH",
            "publicProxyValue": None,
        }
    elif disposition == "REJECTED_PRESERVED":
        fees = {
            "accountEffectiveState": "UNKNOWN",
            "accountEffectiveValue": None,
            "publicProxyState": "UNTRUSTED",
            "publicProxyValue": None,
        }
        capacity = {
            "executableState": "UNKNOWN",
            "executableValue": None,
            "measurementState": "UNTRUSTED",
            "publicProxyState": "UNTRUSTED",
            "publicProxyValue": None,
        }
    elif disposition == "PENDING":
        fees = {
            "accountEffectiveState": "PENDING",
            "accountEffectiveValue": None,
            "publicProxyState": "PENDING",
            "publicProxyValue": None,
        }
        capacity = {
            "executableState": "PENDING",
            "executableValue": None,
            "measurementState": "PENDING",
            "publicProxyState": "PENDING",
            "publicProxyValue": None,
        }
    else:
        fees = {
            "accountEffectiveState": "NOT_APPLICABLE",
            "accountEffectiveValue": None,
            "publicProxyState": "NOT_APPLICABLE",
            "publicProxyValue": None,
        }
        capacity = {
            "executableState": "NOT_APPLICABLE",
            "executableValue": None,
            "measurementState": "NOT_APPLICABLE",
            "publicProxyState": "NOT_APPLICABLE",
            "publicProxyValue": None,
        }
    require(bool(limitations), f"{record_id}: limitations required")
    require(
        economic_consumable
        == (disposition == "ACCEPTED_ECONOMIC" and n3_consumption == "CONSUMED"),
        f"{record_id}: economic-consumption invariant",
    )
    require(
        (result_pin is None) == (absence_reason is not None),
        f"{record_id}: result pin/absence invariant",
    )
    require(
        normalized_verdict in {None, "NO_GO", "UNMEASURED"},
        f"{record_id}: bad normalized verdict",
    )
    return {
        "absenceReason": absence_reason,
        "authority": "NONE",
        "capacity": capacity,
        "category": category(record_id),
        "consumer": {"ids": list(CONSUMERS), "state": "EXACT"},
        "credibility": {
            "reasonCode": credibility_reason,
            "state": credibility_state,
            "verifiedPositive": False if economic or disposition == "REJECTED_PRESERVED" else None,
        },
        "disposition": disposition,
        "economicConsumable": economic_consumable,
        "fees": fees,
        "holdout": {"state": holdout_state, "value": holdout_value},
        "id": record_id,
        "limitations": list(limitations),
        "n3Consumption": n3_consumption,
        "normalizedVerdict": normalized_verdict,
        "oos": {
            "evidence": "EXACT_ACCEPTED_DISPOSITION",
            "state": derived_oos_state,
            "value": oos_value,
        },
        "pbo": pbo,
        "producer": producer,
        "rejection": {"code": rejection_code, "detail": rejection_detail},
        "resultPin": result_pin,
        "runReceipt": run_receipt,
        "sourceVerdict": source_verdict,
        "taskLocatorSuffix": task_locator_suffix,
    }


def accepted_origin_record(
    repo: Path,
    rows: Mapping[str, bytes],
    origin: Mapping[str, Any],
) -> dict[str, Any]:
    record_id = str(origin["originId"])
    artifact = origin["artifact"]
    require(type(artifact) is dict, f"{record_id}: missing artifact")
    pin = {
        "byteLength": artifact["byteLength"],
        "contentReadForNormalization": False,
        "gitBlob": artifact["gitBlob"],
        "path": artifact["path"],
        "rawSha256": artifact["rawSha256"],
        "rawSha256VerifiedThisTask": True,
        "trustedForEconomics": True,
    }
    producer = {
        "commit": origin["producerCommit"],
        "tree": origin["producerTree"],
    }
    verify_pin(
        repo,
        {
            "byteLength": pin["byteLength"],
            "gitBlob": pin["gitBlob"],
            "path": pin["path"],
            "producerCommit": producer["commit"],
            "producerTree": producer["tree"],
            "rawSha256": pin["rawSha256"],
        },
        record_id,
    )
    limitations = tuple(str(value) for value in origin["limitations"])
    verdict = str(origin["normalizedVerdict"])
    holdout = HOLDOUT_OVERRIDES.get(record_id, "UNOPENED")
    return common_record(
        record_id=record_id,
        disposition="ACCEPTED_ECONOMIC",
        n3_consumption="CONSUMED",
        run_receipt=receipt(
            rows,
            str(origin["recordId"]),
            str(origin["acceptanceRowSha256"]),
            allow_transitive=True,
        ),
        producer=producer,
        result_pin=pin,
        absence_reason=None,
        source_verdict=str(origin["sourceVerdict"]),
        normalized_verdict=verdict,
        credibility_state="NOT_CREDIBLE_POSITIVE",
        credibility_reason="N3_VERIFIED_POSITIVE_FALSE",
        holdout_state=holdout,
        pbo=pbo_fact(record_id),
        rejection_code=verdict,
        rejection_detail=";".join(limitations),
        economic_consumable=True,
        limitations=limitations,
        holdout_value=HOLDOUT_VALUES.get(record_id),
        oos_value=OOS_VALUES.get(record_id),
    )


def legacy_record(
    repo: Path,
    rows: Mapping[str, bytes],
    record_id: str,
    legacy_receipt: Mapping[str, Any],
) -> dict[str, Any]:
    pin = LEGACY[record_id]
    verify_pin(
        repo,
        {
            "byteLength": pin.size,
            "gitBlob": pin.blob,
            "path": pin.path,
            "producerCommit": pin.commit,
            "producerTree": pin.tree,
            "rawSha256": pin.raw_sha256,
        },
        record_id,
    )
    verdict, pbo_state, pbo_value, limitations = LEGACY_FACTS[record_id]
    return common_record(
        record_id=record_id,
        disposition="ACCEPTED_ECONOMIC",
        n3_consumption="EXCLUDED_UNINSPECTED",
        run_receipt=receipt(
            rows,
            str(legacy_receipt["recordId"]),
            str(legacy_receipt["acceptanceRowSha256"]),
            allow_transitive=True,
        ),
        producer=producer_dict(pin),
        result_pin=pin_dict(pin, trusted=False),
        absence_reason=None,
        source_verdict=verdict,
        normalized_verdict=verdict,
        credibility_state="NOT_CREDIBLE_POSITIVE",
        credibility_reason="ACCEPTED_ROW_NO_CREDIBLE_POSITIVE",
        holdout_state="UNOPENED",
        pbo=pbo_fact(record_id, pbo_state, pbo_value),
        rejection_code=verdict,
        rejection_detail=";".join(limitations),
        economic_consumable=False,
        limitations=(*limitations, "N3_S4_LEGACY_EXCLUDED_UNINSPECTED"),
    )


def source_pin_record(
    repo: Path,
    rows: Mapping[str, bytes],
    pin: Mapping[str, Any],
) -> dict[str, Any]:
    artifact = pin["artifact"]
    record_id = str(pin["bindingId"])
    verify_pin(
        repo,
        {
            "byteLength": artifact["byteLength"],
            "gitBlob": artifact["gitBlob"],
            "path": artifact["path"],
            "producerCommit": artifact["producerCommit"],
            "producerTree": artifact["producerTree"],
            "rawSha256": artifact["rawSha256"],
        },
        record_id,
    )
    limitations = tuple(
        str(value)
        for value in pin.get(
            "limitations",
            ["SOURCE_ONLY_NO_ECONOMIC_ORIGIN_FAMILY_TRIAL_OR_P_VALUE"],
        )
    )
    return common_record(
        record_id=record_id,
        disposition="ACCEPTED_SOURCE_ONLY",
        n3_consumption="SOURCE_ONLY",
        run_receipt=receipt(
            rows,
            str(pin["recordId"]),
            str(pin["acceptanceRowSha256"]),
            allow_transitive=True,
        ),
        producer={
            "commit": artifact["producerCommit"],
            "tree": artifact["producerTree"],
        },
        result_pin={
            "byteLength": artifact["byteLength"],
            "contentReadForNormalization": False,
            "gitBlob": artifact["gitBlob"],
            "path": artifact["path"],
            "rawSha256": artifact["rawSha256"],
            "rawSha256VerifiedThisTask": True,
            "trustedForEconomics": False,
        },
        absence_reason=None,
        source_verdict=None,
        normalized_verdict=None,
        credibility_state="NOT_ECONOMIC",
        credibility_reason="SOURCE_ONLY_ECONOMIC_CONTRIBUTION_NONE",
        holdout_state="NOT_APPLICABLE",
        pbo=pbo_fact(record_id, "NOT_APPLICABLE", None),
        rejection_code=None,
        rejection_detail=None,
        economic_consumable=False,
        limitations=limitations,
    )


def extra_record(
    repo: Path, rows: Mapping[str, bytes], record_id: str, extra: Extra
) -> dict[str, Any]:
    pin = extra.pin
    if pin is not None:
        verify_pin(
            repo,
            {
                "byteLength": pin.size,
                "gitBlob": pin.blob,
                "path": pin.path,
                "producerCommit": pin.commit,
                "producerTree": pin.tree,
                "rawSha256": pin.raw_sha256,
            },
            record_id,
        )
        producer = producer_dict(pin)
        result_pin = pin_dict(pin, trusted=False)
        absence_reason = None
    else:
        producer = None
        result_pin = None
        absence_reason = "NO_PRODUCT_BYTES"
    if extra.disposition == "REJECTED_PRESERVED":
        credibility = "REJECTED_UNVERIFIED"
        reason = "REJECTED_RESULT_NOT_CONSUMABLE"
        n3_consumption = "FORBIDDEN"
        pbo = pbo_fact(record_id, "UNTRUSTED", None)
    elif extra.disposition == "RETIRED_DUPLICATE":
        credibility = "NOT_APPLICABLE"
        reason = "MATERIAL_DUPLICATE_NO_PRODUCT"
        n3_consumption = "FORBIDDEN"
        pbo = pbo_fact(record_id, "NOT_APPLICABLE", None)
    else:
        credibility = "NOT_APPLICABLE"
        reason = "STATE_ONLY_NO_ECONOMIC_RESULT"
        n3_consumption = "STATE_ONLY"
        pbo = pbo_fact(record_id, "NOT_APPLICABLE", None)
    return common_record(
        record_id=record_id,
        disposition=extra.disposition,
        n3_consumption=n3_consumption,
        run_receipt=receipt(
            rows,
            extra.record_id,
            extra.row_sha256,
            allow_transitive=True,
        ),
        producer=producer,
        result_pin=result_pin,
        absence_reason=absence_reason,
        source_verdict=extra.source_verdict,
        normalized_verdict=extra.normalized_verdict,
        credibility_state=credibility,
        credibility_reason=reason,
        holdout_state=extra.holdout,
        pbo=pbo,
        rejection_code=extra.rejection_code,
        rejection_detail=extra.rejection_code,
        economic_consumable=False,
        limitations=(extra.rejection_code, "NO_ECONOMIC_PROMOTION", "AUTHORITY_NONE"),
    )


def pending_record(
    rows: Mapping[str, bytes],
    record_id: str,
    reason: str,
    task_locator_suffix: str,
) -> dict[str, Any]:
    return common_record(
        record_id=record_id,
        disposition="PENDING",
        n3_consumption="PENDING",
        run_receipt=receipt(rows, OWNER_BURST_ID, OWNER_BURST_SHA256),
        producer=None,
        result_pin=None,
        absence_reason="PENDING_INPUT",
        source_verdict=None,
        normalized_verdict=None,
        credibility_state="PENDING",
        credibility_reason="NO_ACCEPTED_RESULT",
        holdout_state="PENDING",
        pbo=pbo_fact(record_id, "PENDING", None),
        rejection_code=None,
        rejection_detail=None,
        economic_consumable=False,
        limitations=(reason, "TASK_SUFFIX_LOCATOR_ONLY", "NO_ACTIVE_OUTCOME_BYTES_INSPECTED"),
        task_locator_suffix=task_locator_suffix,
    )


def load_n3(repo: Path) -> dict[str, Any]:
    require(git_tree(repo, N3_COMMIT) == N3_TREE, "N3-S4 tree mismatch")
    parent = git(repo, ["rev-parse", f"{N3_COMMIT}^"]).decode().strip()
    require(parent == N3_PARENT, "N3-S4 parent mismatch")
    blob, size = blob_metadata(repo, N3_COMMIT, N3_PATH)
    require(blob == N3_BLOB, "N3-S4 registry blob mismatch")
    require(size == N3_BYTES, "N3-S4 registry byte length mismatch")
    raw = read_blob(repo, N3_COMMIT, N3_PATH)
    require(sha256(raw) == N3_RAW_SHA256, "N3-S4 registry raw hash mismatch")
    return strict_load(raw, "N3-S4 registry", decimals=True)


def build_documents(
    repo: Path, run_md: Path
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    rows = run_rows(run_md.read_bytes())
    reject_post_census_rows(rows)
    boundary_receipt = receipt(rows, N3_ACCEPTANCE_ID, N3_ACCEPTANCE_SHA256)
    n3 = load_n3(repo)

    require(len(n3["origins"]) == 50, "N3-S4 origin count drift")
    require(len(n3["families"]) == 49, "N3-S4 family count drift")
    require(len(n3["sourceOnlyPins"]) == 13, "N3-S4 source-only pin count drift")
    require(len(n3["legacyAcceptedExcluded"]) == 13, "N3-S4 legacy count drift")
    require(
        n3["summary"]["localVerdictCounts"] == {"NO_GO": 24, "UNMEASURED": 26}, "N3 verdict drift"
    )
    require(n3["summary"]["verifiedPositiveCount"] == 0, "N3 verified-positive drift")
    require(n3["summary"]["acceptedCrediblePositiveCount"] == 0, "N3 accepted-positive drift")
    require(n3["summary"]["crediblePositiveCount"] is None, "N3 credible-positive null drift")
    require(n3["summary"]["currentProfitabilityVerdict"] == "UNKNOWN", "N3 profitability drift")
    require(n3["summary"]["capitalAuthority"] == "NONE", "N3 authority drift")
    require(n3["summary"]["completeFamilyUniverse"] is False, "N3 family-universe drift")

    records: dict[str, dict[str, Any]] = {}
    for origin in n3["origins"]:
        origin_id = str(origin["originId"])
        if origin_id.startswith(("S-1", "S-2", "V-G")):
            require(origin_id not in records, f"duplicate origin: {origin_id}")
            records[origin_id] = accepted_origin_record(repo, rows, origin)
    require(len(records) == 46, "target N3 economic-origin count drift")

    legacy_by_id: dict[str, Mapping[str, Any]] = {}
    for legacy in n3["legacyAcceptedExcluded"]:
        record_text = str(legacy["recordId"])
        match = next((item for item in LEGACY if item in record_text), None)
        if match is None:
            fail(f"unrecognized legacy row: {record_text}")
        require(match not in legacy_by_id, f"duplicate legacy id: {match}")
        legacy_by_id[match] = legacy
    require(set(legacy_by_id) == set(LEGACY), "legacy census mismatch")
    for record_id in LEGACY:
        require(record_id not in records, f"legacy already consumed: {record_id}")
        records[record_id] = legacy_record(repo, rows, record_id, legacy_by_id[record_id])

    for source_pin in n3["sourceOnlyPins"]:
        record_id = str(source_pin["bindingId"])
        require(record_id not in records, f"source pin collides: {record_id}")
        records[record_id] = source_pin_record(repo, rows, source_pin)

    for record_id, extra in EXTRAS.items():
        require(record_id not in records, f"extra collides: {record_id}")
        records[record_id] = extra_record(repo, rows, record_id, extra)

    require(set(records) == set(TARGET_IDS), "target disposition universe mismatch")
    ordered_records = [records[record_id] for record_id in TARGET_IDS]

    pending = [
        pending_record(
            rows,
            "BASIS-MAKER-REAL-TIER-GRID",
            "ACTUAL_MAKER_FEE_PER_PAIR_PER_REGIME_PENDING",
            "7179",
        ),
        pending_record(rows, "VOLUME-ECONOMICS", "VOLUME_ECONOMIC_NUMBER_PENDING", "e15a"),
    ]

    source_spec = {
        "acceptedBoundary": {
            "commit": N3_COMMIT,
            "parent": N3_PARENT,
            "registry": {
                "byteLength": N3_BYTES,
                "gitBlob": N3_BLOB,
                "path": N3_PATH,
                "rawSha256": N3_RAW_SHA256,
            },
            "runReceipt": boundary_receipt,
            "tree": N3_TREE,
        },
        "completeDispositionUniverse": True,
        "pendingControls": pending,
        "records": ordered_records,
        "schema": SOURCE_SCHEMA_ID,
        "targetIds": list(TARGET_IDS),
        "version": VERSION,
    }

    all_records: list[dict[str, Any]] = []
    for ordinal, record in enumerate([*ordered_records, *pending], start=1):
        with_ordinal = dict(record)
        with_ordinal["ordinal"] = ordinal
        all_records.append(with_ordinal)

    dispositions = Counter(record["disposition"] for record in all_records)
    categories = Counter(record["category"] for record in all_records)
    consumptions = Counter(record["n3Consumption"] for record in all_records)
    normalized = Counter(
        record["normalizedVerdict"]
        for record in all_records
        if record["normalizedVerdict"] is not None
    )
    require(
        dispositions
        == {
            "ACCEPTED_ECONOMIC": 59,
            "ACCEPTED_SOURCE_ONLY": 13,
            "ACCEPTED_STATE_ONLY": 3,
            "REJECTED_PRESERVED": 7,
            "RETIRED_DUPLICATE": 10,
            "PENDING": 2,
        },
        "disposition count drift",
    )
    require(consumptions["CONSUMED"] == 46, "consumed target count drift")
    require(categories == {"S1": 26, "VG": 38, "S2": 13, "DQ": 15, "CONTROL": 2}, "category drift")
    require(all(record["authority"] == "NONE" for record in all_records), "authority drift")
    require(
        not any(record["credibility"]["verifiedPositive"] is True for record in all_records),
        "positive promotion",
    )

    registry = {
        "acceptedBoundary": source_spec["acceptedBoundary"],
        "consumer": {"ids": list(CONSUMERS), "state": "EXACT"},
        "effects": {
            "credentialsUsed": False,
            "hostEffects": False,
            "moneyMovedUsd": 0,
            "ordersPlaced": 0,
            "privateApiUsed": False,
            "providerMutation": False,
            "transfers": 0,
            "uiEffects": False,
            "withdrawals": 0,
        },
        "records": all_records,
        "schema": SCHEMA_ID,
        "sourceSpecSha256": sha256(canonical_bytes(source_spec)),
        "summary": {
            "authority": "NONE",
            "categoryCounts": dict(sorted(categories.items())),
            "completeDispositionUniverse": True,
            "crediblePositiveCount": None,
            "dispositionCounts": dict(sorted(dispositions.items())),
            "economicConsumableCount": sum(record["economicConsumable"] for record in all_records),
            "n3Baseline": {
                "acceptedCrediblePositiveCount": 0,
                "families": 49,
                "globalProfitability": "UNKNOWN",
                "localVerdictCounts": {"NO_GO": 24, "UNMEASURED": 26},
                "origins": 50,
                "verifiedPositiveCount": 0,
            },
            "normalizedVerdictCounts": dict(sorted(normalized.items())),
            "pendingInputCount": 2,
            "positiveEdgeClaim": "NOT_MADE",
            "recommendation": "NONE",
            "recordCount": len(all_records),
            "targetDispositionCount": len(ordered_records),
            "verifiedPositiveCount": 0,
        },
        "truthPolicy": {
            "accountEffectiveFeesRemainUnknown": True,
            "crediblePositiveNullPreserved": True,
            "excludedOrRejectedEconomicsPromoted": False,
            "holdoutsReopened": False,
            "missingValuesBecomeZero": False,
            "publicCapacityPromotedToExecutable": False,
            "sealedRunsReexecuted": False,
        },
        "version": VERSION,
    }
    return schema_document(), source_spec, registry


def schema_document() -> dict[str, Any]:
    def closed(properties: dict[str, Any]) -> dict[str, Any]:
        return {
            "additionalProperties": False,
            "properties": properties,
            "required": list(properties),
            "type": "object",
        }

    nullable_string = {"type": ["string", "null"]}
    string_array = {"items": {"type": "string"}, "type": "array"}
    null_value = {"type": "null"}
    consumer_schema = closed(
        {
            "ids": {
                "items": {"enum": list(CONSUMERS)},
                "maxItems": 2,
                "minItems": 2,
                "type": "array",
                "uniqueItems": True,
            },
            "state": {"const": "EXACT"},
        }
    )
    receipt_schema = closed(
        {
            "recordId": {"type": "string"},
            "rowAvailability": {"enum": ["CURRENT_LEDGER", "TRANSITIVE_FROZEN_RECEIPT"]},
            "rowByteLength": {"minimum": 1, "type": ["integer", "null"]},
            "rowSha256": {"pattern": "^[0-9a-f]{64}$", "type": "string"},
        }
    )
    producer_schema = closed(
        {
            "commit": {"pattern": "^[0-9a-f]{40}$", "type": "string"},
            "tree": {"pattern": "^[0-9a-f]{40}$", "type": "string"},
        }
    )
    result_pin_schema = closed(
        {
            "byteLength": {"minimum": 1, "type": "integer"},
            "contentReadForNormalization": {"const": False},
            "gitBlob": {"pattern": "^[0-9a-f]{40}$", "type": "string"},
            "path": {"type": "string"},
            "rawSha256": {"pattern": "^[0-9a-f]{64}$", "type": "string"},
            "rawSha256VerifiedThisTask": {"type": "boolean"},
            "trustedForEconomics": {"type": "boolean"},
        }
    )
    record_properties: dict[str, Any] = {
        "absenceReason": nullable_string,
        "authority": {"const": "NONE"},
        "capacity": closed(
            {
                "executableState": {"enum": ["UNKNOWN", "NOT_APPLICABLE", "PENDING"]},
                "executableValue": null_value,
                "measurementState": {
                    "enum": ["UNMEASURED", "UNTRUSTED", "NOT_APPLICABLE", "PENDING"]
                },
                "publicProxyState": {
                    "enum": [
                        "BOUND_RESULT_NOT_EXECUTABLE_TRUTH",
                        "UNTRUSTED",
                        "NOT_APPLICABLE",
                        "PENDING",
                    ]
                },
                "publicProxyValue": null_value,
            }
        ),
        "category": {"enum": ["S1", "VG", "S2", "DQ", "CONTROL"]},
        "consumer": consumer_schema,
        "credibility": closed(
            {
                "reasonCode": {"type": "string"},
                "state": {
                    "enum": [
                        "NOT_CREDIBLE_POSITIVE",
                        "NOT_ECONOMIC",
                        "REJECTED_UNVERIFIED",
                        "NOT_APPLICABLE",
                        "PENDING",
                    ]
                },
                "verifiedPositive": {"type": ["boolean", "null"]},
            }
        ),
        "disposition": {
            "enum": [
                "ACCEPTED_ECONOMIC",
                "ACCEPTED_SOURCE_ONLY",
                "ACCEPTED_STATE_ONLY",
                "REJECTED_PRESERVED",
                "RETIRED_DUPLICATE",
                "PENDING",
            ]
        },
        "economicConsumable": {"type": "boolean"},
        "fees": closed(
            {
                "accountEffectiveState": {"enum": ["UNKNOWN", "NOT_APPLICABLE", "PENDING"]},
                "accountEffectiveValue": null_value,
                "publicProxyState": {
                    "enum": [
                        "BOUND_RESULT_NOT_ACCOUNT_TRUTH",
                        "UNTRUSTED",
                        "NOT_APPLICABLE",
                        "PENDING",
                    ]
                },
                "publicProxyValue": null_value,
            }
        ),
        "holdout": closed(
            {
                "state": {
                    "enum": [
                        "UNOPENED",
                        "OPENED",
                        "OPENED_NO_VALID_COHORT",
                        "INVALIDATED_BEFORE_ECONOMICS",
                        "CONSUMED_NO_REOPEN",
                        "SEALED_UNOPENED_ZERO_OUTCOME_ROWS",
                        "NOT_REQUESTED_OR_OPENED",
                        "UNOPENED_ZERO_BODIES",
                        "NOT_APPLICABLE",
                        "NOT_CREATED",
                        "UNACQUIRED_UNOPENED",
                        "PENDING",
                    ]
                },
                "value": {"type": ["string", "null"]},
            }
        ),
        "id": {"type": "string"},
        "limitations": string_array,
        "n3Consumption": {
            "enum": [
                "CONSUMED",
                "SOURCE_ONLY",
                "STATE_ONLY",
                "EXCLUDED_UNINSPECTED",
                "FORBIDDEN",
                "PENDING",
            ]
        },
        "normalizedVerdict": {"enum": ["NO_GO", "UNMEASURED", None]},
        "oos": closed(
            {
                "evidence": {"const": "EXACT_ACCEPTED_DISPOSITION"},
                "state": {
                    "enum": [
                        "SOURCE_BOUND",
                        "CONSUMED_NO_REOPEN",
                        "NOT_APPLICABLE",
                        "UNMEASURED",
                        "PENDING",
                        "NOT_EVALUATED",
                    ]
                },
                "value": {"type": ["string", "null"]},
            }
        ),
        "ordinal": {"minimum": 1, "type": "integer"},
        "pbo": closed(
            {
                "evidence": {"const": "EXACT_ACCEPTED_DISPOSITION"},
                "state": {
                    "enum": [
                        "REPORTED_DIAGNOSTIC",
                        "UNMEASURED",
                        "NOT_REPORTED",
                        "NOT_APPLICABLE",
                        "UNTRUSTED",
                        "PENDING",
                    ]
                },
                "value": {"type": ["string", "null"]},
            }
        ),
        "producer": {"oneOf": [producer_schema, {"type": "null"}]},
        "rejection": closed({"code": nullable_string, "detail": nullable_string}),
        "resultPin": {"oneOf": [result_pin_schema, {"type": "null"}]},
        "runReceipt": receipt_schema,
        "sourceVerdict": nullable_string,
        "taskLocatorSuffix": nullable_string,
    }
    record_schema = {
        "additionalProperties": False,
        "allOf": [
            {
                "if": {"properties": {"n3Consumption": {"const": "CONSUMED"}}},
                "then": {
                    "properties": {
                        "disposition": {"const": "ACCEPTED_ECONOMIC"},
                        "economicConsumable": {"const": True},
                    }
                },
            },
            {
                "if": {
                    "properties": {
                        "pbo": {"properties": {"state": {"const": "REPORTED_DIAGNOSTIC"}}}
                    }
                },
                "then": {"properties": {"pbo": {"properties": {"value": {"type": "string"}}}}},
                "else": {"properties": {"pbo": {"properties": {"value": {"type": "null"}}}}},
            },
            {
                "if": {"properties": {"disposition": {"const": "PENDING"}}},
                "then": {
                    "properties": {
                        "absenceReason": {"const": "PENDING_INPUT"},
                        "economicConsumable": {"const": False},
                        "producer": {"type": "null"},
                        "resultPin": {"type": "null"},
                        "taskLocatorSuffix": {"pattern": "^[0-9a-f]{4}$", "type": "string"},
                    }
                },
                "else": {"properties": {"taskLocatorSuffix": {"type": "null"}}},
            },
        ],
        "properties": record_properties,
        "required": list(record_properties),
        "type": "object",
    }
    boundary_schema = closed(
        {
            "commit": {"const": N3_COMMIT},
            "parent": {"const": N3_PARENT},
            "registry": closed(
                {
                    "byteLength": {"const": N3_BYTES},
                    "gitBlob": {"const": N3_BLOB},
                    "path": {"const": N3_PATH},
                    "rawSha256": {"const": N3_RAW_SHA256},
                }
            ),
            "runReceipt": receipt_schema,
            "tree": {"const": N3_TREE},
        }
    )
    effects_schema = closed(
        {
            "credentialsUsed": {"const": False},
            "hostEffects": {"const": False},
            "moneyMovedUsd": {"const": 0},
            "ordersPlaced": {"const": 0},
            "privateApiUsed": {"const": False},
            "providerMutation": {"const": False},
            "transfers": {"const": 0},
            "uiEffects": {"const": False},
            "withdrawals": {"const": 0},
        }
    )
    summary_schema = closed(
        {
            "authority": {"const": "NONE"},
            "categoryCounts": {"const": {"CONTROL": 2, "DQ": 15, "S1": 26, "S2": 13, "VG": 38}},
            "completeDispositionUniverse": {"const": True},
            "crediblePositiveCount": {"type": "null"},
            "dispositionCounts": {
                "const": {
                    "ACCEPTED_ECONOMIC": 59,
                    "ACCEPTED_SOURCE_ONLY": 13,
                    "ACCEPTED_STATE_ONLY": 3,
                    "PENDING": 2,
                    "REJECTED_PRESERVED": 7,
                    "RETIRED_DUPLICATE": 10,
                }
            },
            "economicConsumableCount": {"const": 46},
            "n3Baseline": {
                "const": {
                    "acceptedCrediblePositiveCount": 0,
                    "families": 49,
                    "globalProfitability": "UNKNOWN",
                    "localVerdictCounts": {"NO_GO": 24, "UNMEASURED": 26},
                    "origins": 50,
                    "verifiedPositiveCount": 0,
                }
            },
            "normalizedVerdictCounts": {"const": {"NO_GO": 28, "UNMEASURED": 32}},
            "pendingInputCount": {"const": 2},
            "positiveEdgeClaim": {"const": "NOT_MADE"},
            "recommendation": {"const": "NONE"},
            "recordCount": {"const": 94},
            "targetDispositionCount": {"const": 92},
            "verifiedPositiveCount": {"const": 0},
        }
    )
    truth_policy_schema = closed(
        {
            "accountEffectiveFeesRemainUnknown": {"const": True},
            "crediblePositiveNullPreserved": {"const": True},
            "excludedOrRejectedEconomicsPromoted": {"const": False},
            "holdoutsReopened": {"const": False},
            "missingValuesBecomeZero": {"const": False},
            "publicCapacityPromotedToExecutable": {"const": False},
            "sealedRunsReexecuted": {"const": False},
        }
    )
    return {
        "$id": "https://cosmos.local/schemas/verdict-normalization/v1",
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "additionalProperties": False,
        "properties": {
            "acceptedBoundary": boundary_schema,
            "consumer": consumer_schema,
            "effects": effects_schema,
            "records": {
                "items": record_schema,
                "maxItems": 94,
                "minItems": 94,
                "type": "array",
            },
            "schema": {"const": SCHEMA_ID},
            "sourceSpecSha256": {"pattern": "^[0-9a-f]{64}$", "type": "string"},
            "summary": summary_schema,
            "truthPolicy": truth_policy_schema,
            "version": {"const": VERSION},
        },
        "required": [
            "acceptedBoundary",
            "consumer",
            "effects",
            "records",
            "schema",
            "sourceSpecSha256",
            "summary",
            "truthPolicy",
            "version",
        ],
        "title": "Verdict normalization registry",
        "type": "object",
        "unevaluatedProperties": False,
    }


def paths(base_dir: Path) -> tuple[Path, Path, Path]:
    return (
        base_dir / "schema.v1.json",
        base_dir / "source_spec.v1.json",
        base_dir / "current_verdicts.v1.json",
    )


def freeze(repo: Path, run_md: Path, base_dir: Path) -> None:
    schema, source_spec, registry = build_documents(repo, run_md)
    base_dir.mkdir(parents=True, exist_ok=True)
    values = (schema, source_spec, registry)
    for index, path in enumerate(paths(base_dir)):
        value = values[index]
        path.write_bytes(canonical_bytes(value))


def verify_materialized(expected: Sequence[dict[str, Any]], base_dir: Path) -> None:
    require(len(expected) == 3, "expected document count drift")
    for index, path in enumerate(paths(base_dir)):
        value = expected[index]
        raw = path.read_bytes()
        strict_load(raw, path.name)
        require(raw == canonical_bytes(value), f"{path.name}: noncanonical or content mismatch")


def verify(repo: Path, run_md: Path, base_dir: Path) -> None:
    verify_materialized(build_documents(repo, run_md), base_dir)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("command", choices=("freeze", "verify"))
    result.add_argument("--repo", type=Path, default=Path.cwd())
    result.add_argument("--run-md", type=Path, default=Path("/Users/cosmosgeek/Desktop/run.md"))
    result.add_argument("--base-dir", type=Path, default=Path(__file__).resolve().parent)
    return result


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "freeze":
            freeze(args.repo.resolve(), args.run_md.resolve(), args.base_dir.resolve())
        else:
            verify(args.repo.resolve(), args.run_md.resolve(), args.base_dir.resolve())
    except (ContractError, OSError, KeyError, TypeError, ValueError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
