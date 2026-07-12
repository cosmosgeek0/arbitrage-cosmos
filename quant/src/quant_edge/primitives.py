import re

from quant_edge.errors import ContractValueError

UTC_MILLIS_MIN = 1_262_304_000_000
UTC_MILLIS_MAX = 4_102_444_800_000
UINT128_MAX = (1 << 128) - 1

_ID_PATTERN = re.compile(r"^[A-Za-z0-9_.:\-]{1,128}$")


def require_utc_millis(value: object, *, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContractValueError(f"{field} must be an integer UTC millisecond")
    if not UTC_MILLIS_MIN <= value <= UTC_MILLIS_MAX:
        raise ContractValueError(f"{field} is outside the frozen UTC millisecond range")
    return value


def require_seed(value: object, *, field: str = "seed") -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContractValueError(f"{field} must be an integer")
    if not 0 <= value <= UINT128_MAX:
        raise ContractValueError(f"{field} must fit an unsigned 128-bit integer")
    return value


def require_id(value: object, *, field: str) -> str:
    if not isinstance(value, str) or _ID_PATTERN.fullmatch(value) is None:
        raise ContractValueError(f"{field} must match the frozen IdString contract")
    return value
