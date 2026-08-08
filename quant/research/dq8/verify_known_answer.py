from __future__ import annotations

from research.dq8.known_answer import (
    apply_hostile_case_v1,
    hostile_case_id_v1,
    hostile_cases_v1,
    hostile_expected_code_v1,
    known_answer_projection_v1,
    load_known_receipt_v1,
    load_valid_payload_v1,
    verify_synthetic_source_digest_v1,
)
from research.dq8.validator import CoordinateContractError, validate_payload_v1


def main() -> int:
    payload = load_valid_payload_v1()
    source_digest = verify_synthetic_source_digest_v1(payload)
    receipt = known_answer_projection_v1()
    expected = load_known_receipt_v1()
    if receipt != expected:
        raise RuntimeError("DQ-8 known-answer receipt mismatch")

    cases = hostile_cases_v1()
    for case in cases:
        case_id = hostile_case_id_v1(case)
        expected_code = hostile_expected_code_v1(case)
        try:
            validate_payload_v1(apply_hostile_case_v1(payload, case))
        except CoordinateContractError as error:
            if error.code != expected_code:
                raise RuntimeError(
                    f"{case_id}: expected {expected_code}, received {error.code}"
                ) from error
        else:
            raise RuntimeError(f"{case_id}: hostile fixture unexpectedly validated")

    print(
        "DQ8_KNOWN_ANSWER_OK "
        f"receipt={receipt['receiptDigest']} hostile={len(cases)} source={source_digest}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
