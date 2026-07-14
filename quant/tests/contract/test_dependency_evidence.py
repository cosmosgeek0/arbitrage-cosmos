import re
from pathlib import Path
from typing import cast

from quant_edge.canonical import parse_canonical_object

QUANT_ROOT = Path(__file__).resolve().parents[2]
AUDIT_PATH = QUANT_ROOT / "generated/q01/dependency_audit_summary.v1.json"
LICENSE_PATH = QUANT_ROOT / "generated/q01/dependency_license_inventory.v1.json"


def _object_list(value: object) -> list[dict[str, object]]:
    return cast(list[dict[str, object]], value)


def _normalized_distribution_name(value: object) -> str:
    return re.sub(r"[-_.]+", "-", cast(str, value).lower())


def test_dependency_evidence_is_canonical_complete_and_cross_bound() -> None:
    audit = parse_canonical_object(AUDIT_PATH.read_bytes())
    licenses = parse_canonical_object(LICENSE_PATH.read_bytes())

    assert audit["schema"] == "Q01DependencyAuditSummaryV1"
    assert audit["version"] == 1
    assert audit["tool"] == "pip-audit==2.10.1"
    assert audit["observedOn"] == "2026-07-12"
    assert audit["dependencyCount"] == 49
    assert audit["vulnerabilityCount"] == 0
    assert audit["rawReportSha256"] == (
        "8559a6b1941a741515e22da636c2860c8f2c8f8d77cc5a6b0010d877d5ccb7cc"
    )

    assert licenses["schema"] == "Q01DependencyLicenseInventoryV1"
    assert licenses["version"] == 1
    assert licenses["tool"] == "pip-licenses==5.5.5"
    assert licenses["observedOn"] == "2026-07-12"
    assert licenses["packageCount"] == 49
    assert licenses["unknownLicenseCount"] == 0
    assert licenses["rawReportSha256"] == (
        "b3d9762b2607d10bfae630bcd8621972f7ab136884036b38decd781ddd940fd1"
    )

    audited = _object_list(audit["dependencies"])
    licensed = _object_list(licenses["packages"])
    audit_versions = {
        _normalized_distribution_name(item["name"]): item["version"] for item in audited
    }
    license_versions = {
        _normalized_distribution_name(item["name"]): item["version"] for item in licensed
    }
    assert len(audit_versions) == len(audited) == 49
    assert len(license_versions) == len(licensed) == 49
    assert audit_versions == license_versions
    assert audit_versions["duckdb"] == "1.5.4"
    assert audit_versions["polars"] == "1.42.1"
    assert audit_versions["pyarrow"] == "25.0.0"
    assert all(item["vulnerabilities"] == [] for item in audited)
    assert all(cast(str, item["license"]).strip() for item in licensed)
