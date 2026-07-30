#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import unittest
from decimal import Decimal
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("finalize_volume_economics.py")
SPEC = importlib.util.spec_from_file_location("volume_economics_finalizer", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def event(
    *,
    proposal_s: int,
    symbol: str,
    direction: str,
    entry: str,
    exit_price: str,
) -> dict[str, str]:
    return {
        "proposal_s": str(proposal_s),
        "symbol": symbol,
        "direction": direction,
        "entry_open": entry,
        "exit_open": exit_price,
    }


class FinalizeVolumeEconomicsTest(unittest.TestCase):
    def test_long_and_short_fee_slippage_paths_are_symmetric(self) -> None:
        long_row = event(
            proposal_s=MODULE.PERIOD_START_S,
            symbol="BTCUSDT",
            direction="LONG",
            entry="100",
            exit_price="101",
        )
        short_row = event(
            proposal_s=MODULE.PERIOD_START_S + 2,
            symbol="BTCUSDT",
            direction="SHORT_PREOWNED",
            entry="100",
            exit_price="99",
        )
        long_pnl = MODULE.event_pnl(long_row, Decimal("10"))
        short_pnl = MODULE.event_pnl(short_row, Decimal("10"))
        self.assertGreater(long_pnl, Decimal(0))
        self.assertGreater(short_pnl, Decimal(0))
        self.assertNotEqual(long_pnl, short_pnl)

    def test_drawdown_uses_chronological_peak_to_trough_path(self) -> None:
        rows = [
            event(
                proposal_s=MODULE.PERIOD_START_S + index * 2,
                symbol="BTCUSDT",
                direction="LONG",
                entry="100",
                exit_price="100",
            )
            for index in range(4)
        ]
        result = MODULE.drawdown(
            rows,
            [Decimal("1"), Decimal("-0.25"), Decimal("-2"), Decimal("0.5")],
        )
        self.assertEqual(
            result["modeledPnlUsdtAt12UsdtEventNotional"],
            "2.250000000000",
        )
        self.assertEqual(
            result["cumulativeOpportunityEdgePer1000Units"],
            "187.500000000000",
        )
        self.assertEqual(result["peak"]["eventIndex"], 0)
        self.assertEqual(result["trough"]["eventIndex"], 2)
        self.assertFalse(result["capitalDrawdownClaim"])

    def test_bootstrap_is_deterministic_and_uses_event_notional(self) -> None:
        rows: list[dict[str, str]] = []
        pnls: list[Decimal] = []
        for day in range(MODULE.PERIOD_DAYS):
            rows.append(
                event(
                    proposal_s=MODULE.PERIOD_START_S + day * 86_400,
                    symbol="BTCUSDT",
                    direction="LONG",
                    entry="100",
                    exit_price="100",
                )
            )
            pnls.append(Decimal("-0.012"))
        first = MODULE.bootstrap(rows, pnls)
        second = MODULE.bootstrap(rows, pnls)
        self.assertEqual(first, second)
        self.assertEqual(first["pointNetSyntheticUsdtPer1000"], "-1.000000000000")
        self.assertEqual(first["lowerNetSyntheticUsdtPer1000"], "-1.000000000000")
        self.assertEqual(first["upperNetSyntheticUsdtPer1000"], "-1.000000000000")

    def test_decimal_rendering_is_canonical(self) -> None:
        self.assertEqual(MODULE.canonical_decimal(Decimal("-0")), "0.000000000000")
        self.assertEqual(
            MODULE.canonical_decimal(Decimal("1.2345678912345")),
            "1.234567891235",
        )


if __name__ == "__main__":
    unittest.main()
