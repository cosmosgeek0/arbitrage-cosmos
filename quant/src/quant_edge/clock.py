from dataclasses import dataclass
from typing import Protocol

from quant_edge.primitives import require_utc_millis


class Clock(Protocol):
    def now_ms(self) -> int:
        """Return a caller-owned UTC millisecond without hidden fallback."""


@dataclass(frozen=True, slots=True)
class FixedClock:
    value_ms: int

    def __post_init__(self) -> None:
        require_utc_millis(self.value_ms, field="value_ms")

    def now_ms(self) -> int:
        return self.value_ms
