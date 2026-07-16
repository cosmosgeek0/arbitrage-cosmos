"""Battery-internal chronological split — typed non-authoritative by law.

This split exists so bounded studies have a validation objective and reports
have an out-of-train test slice. It is NOT purged/embargoed walk-forward, NOT
an untouched holdout and confers no validation verdict; those pieces belong to
the Q14 validation factory and are recorded ``WAITING_Q14`` in the battery
disposition table.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import require_strict_int

SPLIT_AUTHORITY: Final = "BATTERY_INTERNAL_NON_AUTHORITATIVE"


@dataclass(frozen=True, slots=True)
class InternalChronologicalSplitV1:
    """Row-order train / embargo-gap / validation / test partition."""

    train_rows: int
    embargo_rows: int
    valid_rows: int
    test_rows: int

    def __post_init__(self) -> None:
        require_strict_int(self.train_rows, field="train_rows", minimum=2, maximum=1_000_000)
        require_strict_int(self.embargo_rows, field="embargo_rows", minimum=0, maximum=1_000_000)
        require_strict_int(self.valid_rows, field="valid_rows", minimum=2, maximum=1_000_000)
        require_strict_int(self.test_rows, field="test_rows", minimum=2, maximum=1_000_000)

    @property
    def total_rows(self) -> int:
        return self.train_rows + self.embargo_rows + self.valid_rows + self.test_rows

    @property
    def train_indices(self) -> range:
        return range(0, self.train_rows)

    @property
    def embargo_indices(self) -> range:
        return range(self.train_rows, self.train_rows + self.embargo_rows)

    @property
    def valid_indices(self) -> range:
        start = self.train_rows + self.embargo_rows
        return range(start, start + self.valid_rows)

    @property
    def test_indices(self) -> range:
        start = self.train_rows + self.embargo_rows + self.valid_rows
        return range(start, start + self.test_rows)

    def require_exact_cover(self, row_count: int) -> None:
        require_strict_int(row_count, field="row_count", minimum=1, maximum=1_000_000)
        if self.total_rows != row_count:
            raise ContractValueError("split must cover the dataset rows exactly")

    def as_mapping(self) -> dict[str, object]:
        return {
            "authority": SPLIT_AUTHORITY,
            "embargoRows": self.embargo_rows,
            "testRows": self.test_rows,
            "trainRows": self.train_rows,
            "validRows": self.valid_rows,
        }
