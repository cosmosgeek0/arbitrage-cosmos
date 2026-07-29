"""Verify the frozen DQ-7 valid and hostile receipt matrix."""

from __future__ import annotations

import json
import sys
from collections.abc import Sequence
from typing import Any, cast

from research.dq7.fixture_harness import (
    FIXTURE_DIRECTORY,
    HOSTILE_FIXTURE_PATH,
    hostile_accepted_freeze_digest,
    load_hostile_case_records,
    load_valid_fixture,
    materialize_hostile_case,
    resolve_hostile_accepted_pin,
    validate_fixture_manifest,
    validate_fixture_manifest_with_pin,
)

KNOWN_ANSWER_PATH = FIXTURE_DIRECTORY / "known_answer.v1.json"


def write_hostile_accepted_pins() -> None:
    """Recompute and check in each hostile case's accepted freeze coordinate."""

    fixture = json.loads(HOSTILE_FIXTURE_PATH.read_text(encoding="utf-8"))
    for record in fixture["cases"]:
        mutation_id = cast(str, record["mutationId"])
        record["acceptedPreOutcomeFreezeDigest"] = resolve_hostile_accepted_pin(
            mutation_id,
            materialize_hostile_case(mutation_id),
        )
    payload = json.dumps(fixture, indent=2, ensure_ascii=False)
    HOSTILE_FIXTURE_PATH.write_text(f"{payload}\n", encoding="utf-8")


def build_known_answer() -> dict[str, Any]:
    """Compute the compact deterministic answer committed by the fixture set."""

    valid_receipt = validate_fixture_manifest(load_valid_fixture())
    hostile_receipts: list[dict[str, Any]] = []
    for record in load_hostile_case_records():
        mutation_id = cast(str, record["mutationId"])
        receipt = validate_fixture_manifest_with_pin(
            materialize_hostile_case(mutation_id),
            hostile_accepted_freeze_digest(record),
        )
        hostile_receipts.append(
            {
                "caseId": record["caseId"],
                "mutationId": mutation_id,
                "n3IntakeDisposition": receipt.n3_intake_disposition.value,
                "reasonCodes": list(receipt.reason_codes),
                "receiptDigest": receipt.receipt_digest,
                "schedulerDisposition": receipt.scheduler_disposition.value,
            }
        )
    return {
        "schema": "cosmos.dq7.known-answer.v1",
        "validReceipt": {
            "attemptLedgerDigest": valid_receipt.attempt_ledger_digest,
            "familyComponentIds": [
                component.component_id for component in valid_receipt.family_components
            ],
            "familyUniverseDigest": valid_receipt.family_universe_digest,
            "manifestDigest": valid_receipt.manifest_digest,
            "receiptDigest": valid_receipt.receipt_digest,
        },
        "hostileReceipts": hostile_receipts,
    }


def verify_known_answer() -> None:
    """Raise when any frozen valid or hostile receipt changes."""

    expected = json.loads(KNOWN_ANSWER_PATH.read_text(encoding="utf-8"))
    actual = build_known_answer()
    if actual != expected:
        raise AssertionError(
            "DQ7_KNOWN_ANSWER_MISMATCH: regenerate only after reviewed contract change"
        )


def write_known_answer() -> None:
    """Rewrite the frozen answer; only run this for a reviewed contract change.

    Hostile accepted pins are rewritten first, because the frozen receipts are
    computed against those checked-in coordinates.
    """

    write_hostile_accepted_pins()
    payload = json.dumps(build_known_answer(), indent=2, ensure_ascii=False)
    KNOWN_ANSWER_PATH.write_text(f"{payload}\n", encoding="utf-8")


def main(argv: Sequence[str] | None = None) -> int:
    arguments = sys.argv[1:] if argv is None else list(argv)
    if arguments == ["--write"]:
        write_known_answer()
        print("DQ7_KNOWN_ANSWER_WRITTEN")
        return 0
    if arguments:
        print("usage: verify_known_answer.py [--write]")
        return 2
    verify_known_answer()
    print("DQ7_KNOWN_ANSWER_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
