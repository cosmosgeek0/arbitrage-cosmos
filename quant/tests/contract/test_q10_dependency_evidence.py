import re
from pathlib import Path
from typing import cast

from quant_edge.canonical import parse_canonical_object

QUANT_ROOT = Path(__file__).resolve().parents[2]
AUDIT_PATH = QUANT_ROOT / "generated/q10/dependency_audit_summary.v1.json"
LICENSE_PATH = QUANT_ROOT / "generated/q10/dependency_license_inventory.v1.json"

ADOPTED_VERSIONS = {
    "optuna": "4.9.0",
    "scikit-learn": "1.9.0",
    "xgboost": "3.3.0",
}


def _object_list(value: object) -> list[dict[str, object]]:
    return cast(list[dict[str, object]], value)


def _normalized_distribution_name(value: object) -> str:
    return re.sub(r"[-_.]+", "-", cast(str, value).lower())


def test_q10_dependency_evidence_is_canonical_complete_and_cross_bound() -> None:
    audit = parse_canonical_object(AUDIT_PATH.read_bytes())
    licenses = parse_canonical_object(LICENSE_PATH.read_bytes())

    assert audit["schema"] == "Q10DependencyAuditSummaryV1"
    assert audit["version"] == 1
    assert audit["tool"] == "pip-audit==2.10.1"
    assert audit["observedOn"] == "2026-07-12"
    assert audit["dependencyCount"] == 64
    assert audit["vulnerabilityCount"] == 0
    assert audit["rawReportSha256"] == (
        "5c9fd743d9674a60665b59bbebb66f9743a74cead42561d908e13b71c5efbaf7"
    )

    assert licenses["schema"] == "Q10DependencyLicenseInventoryV1"
    assert licenses["version"] == 1
    assert licenses["tool"] == "pip-licenses==5.5.5"
    assert licenses["observedOn"] == "2026-07-12"
    assert licenses["packageCount"] == 64
    assert licenses["unknownLicenseCount"] == 0
    assert licenses["rawReportSha256"] == (
        "d39d1a1ac7ab2f964d7abf04decf0748455b434d0bc13e4c5849c1ca70f5b8d4"
    )

    audited = _object_list(audit["dependencies"])
    licensed = _object_list(licenses["packages"])
    audit_versions = {
        _normalized_distribution_name(item["name"]): item["version"] for item in audited
    }
    license_versions = {
        _normalized_distribution_name(item["name"]): item["version"] for item in licensed
    }
    assert len(audit_versions) == len(audited) == 64
    assert len(license_versions) == len(licensed) == 64
    assert audit_versions == license_versions
    for name, version in ADOPTED_VERSIONS.items():
        assert audit_versions[name] == version
    assert audit_versions["duckdb"] == "1.5.4"
    assert audit_versions["polars"] == "1.42.1"
    assert audit_versions["pyarrow"] == "25.0.0"
    assert all(item["vulnerabilities"] == [] for item in audited)
    assert all(cast(str, item["license"]).strip() for item in licensed)
    assert all(cast(str, item["license"]).strip().lower() != "unknown" for item in licensed)
