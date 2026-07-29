from __future__ import annotations

import pathlib
import tempfile
import unittest
import zipfile
from copy import deepcopy

import experiment


def kline_row(open_timestamp: int, venue: str = "futures") -> list[str]:
    if venue == "spot":
        raw_open = open_timestamp * 1000
        raw_close = (open_timestamp + experiment.HOUR_MS) * 1000 - 1
    else:
        raw_open = open_timestamp
        raw_close = open_timestamp + experiment.HOUR_MS - 1
    return [
        str(raw_open),
        "100",
        "102",
        "99",
        "101",
        "1",
        str(raw_close),
        "1000",
        "10",
        "1",
        "500",
        "0",
    ]


class ExperimentTests(unittest.TestCase):
    def test_protocol_is_exhaustively_bound_to_evaluator(self) -> None:
        protocol = experiment.load_json(experiment.PROTOCOL_PATH)
        experiment.validate_protocol(protocol)
        for path, value in (
            (("clock", "decision_guard_hours"), 0),
            (("consumer", "capital_authority"), "GO"),
            (("economics", "entry_gross_usd"), "1000"),
            (("economics", "funding"), "IGNORE FUNDING"),
            (("statistics", "bootstrap", "confidence"), "0.99"),
            (("statistics", "bootstrap", "seed"), 1),
            (("trials", "horizon_hours"), [1, 2]),
            (("universe", "symbols"), ["BTCUSDT"]),
            (("verdict_law", "every_gate_passes"), "CAPITAL_GO"),
        ):
            mutated = deepcopy(protocol)
            cursor = mutated
            for key in path[:-1]:
                cursor = cursor[key]
            cursor[path[-1]] = value
            with self.assertRaises(experiment.StudyError):
                experiment.validate_protocol(mutated)

    def test_native_timestamp_normalization(self) -> None:
        timestamp = experiment.DEVELOPMENT_START_MS
        self.assertEqual(
            experiment.normalize_timestamp(str(timestamp), "futures"),
            timestamp,
        )
        self.assertEqual(
            experiment.normalize_timestamp(str(timestamp * 1000), "spot"),
            timestamp,
        )
        self.assertEqual(
            experiment.normalize_timestamp(
                str((timestamp + experiment.HOUR_MS) * 1000 - 1),
                "spot",
                close=True,
            ),
            timestamp + experiment.HOUR_MS - 1,
        )
        with self.assertRaises(experiment.StudyError):
            experiment.normalize_timestamp(str(timestamp), "spot")
        with self.assertRaises(experiment.StudyError):
            experiment.normalize_timestamp(
                str(timestamp * 1000), "futures"
            )

    def test_kline_clock_schema_and_duplicate(self) -> None:
        timestamp = experiment.DEVELOPMENT_START_MS
        bars = experiment.parse_kline_rows(
            [kline_row(timestamp, "spot")], "spot"
        )
        self.assertEqual(bars[timestamp].quote_volume, 1000)
        with self.assertRaises(experiment.StudyError):
            experiment.parse_kline_rows(
                [
                    kline_row(timestamp, "futures"),
                    kline_row(timestamp, "futures"),
                ],
                "futures",
            )

    def test_funding_allows_exchange_millisecond_offset(self) -> None:
        timestamp = experiment.DEVELOPMENT_START_MS + 7
        rows = [
            ["calc_time", "funding_interval_hours", "last_funding_rate"],
            [str(timestamp), "8", "0.0001"],
        ]
        parsed = experiment.parse_funding_rows(rows, "funding")
        self.assertEqual(parsed[0].timestamp_ms, timestamp)
        self.assertEqual(parsed[0].interval_hours, 8)
        rows[1][0] = str(experiment.DEVELOPMENT_START_MS + 60_001)
        with self.assertRaises(experiment.StudyError):
            experiment.parse_funding_rows(rows, "funding")

    def test_funding_cadence_fails_on_missing_row(self) -> None:
        start = experiment.DEVELOPMENT_START_MS
        contract = {
            start + index * experiment.HOUR_MS: experiment.Bar(
                start + index * experiment.HOUR_MS,
                100,
                100,
                1000,
            )
            for index in range(17)
        }
        complete = experiment.SymbolData(
            spot={},
            contract=contract,
            mark={},
            funding=[
                experiment.Funding(start + 7, 8, 0.0001),
                experiment.Funding(
                    start + 8 * experiment.HOUR_MS + 7,
                    8,
                    0.0001,
                ),
                experiment.Funding(
                    start + 16 * experiment.HOUR_MS + 7,
                    8,
                    0.0001,
                ),
            ],
        )
        experiment.validate_funding_coverage("A", complete)
        complete.funding.pop(1)
        with self.assertRaises(experiment.StudyError):
            experiment.validate_funding_coverage("A", complete)

    def test_feature_is_prior_only(self) -> None:
        start = experiment.DEVELOPMENT_START_MS - 800 * experiment.HOUR_MS
        spot: dict[int, experiment.Bar] = {}
        futures: dict[int, experiment.Bar] = {}
        mark: dict[int, experiment.Bar] = {}
        spot_price = 100.0
        futures_price = 100.0
        for index in range(800):
            timestamp = start + index * experiment.HOUR_MS
            futures_return = (index % 9 - 4) * 0.0001
            innovation = (index % 7 - 3) * 0.00002
            spot_price *= 1 + futures_return + innovation
            futures_price *= 1 + futures_return
            spot[timestamp] = experiment.Bar(
                timestamp, spot_price, spot_price, 1_000_000
            )
            futures[timestamp] = experiment.Bar(
                timestamp, futures_price, futures_price, 1_000_000
            )
            mark[timestamp] = futures[timestamp]
        data = experiment.SymbolData(spot, futures, mark, [])
        original = experiment.build_features(data)
        last = max(futures)
        futures[last] = experiment.Bar(
            last,
            futures[last].open,
            futures[last].close * 1.5,
            futures[last].quote_volume,
        )
        changed = experiment.build_features(data)
        prior = last - experiment.HOUR_MS
        self.assertAlmostEqual(
            original[prior].spot_lead_z, changed[prior].spot_lead_z
        )

    def test_selection_requires_every_fixed_symbol(self) -> None:
        feature = experiment.Feature(1, 2, 3, 0, 0)
        timestamp = experiment.DEVELOPMENT_START_MS
        feature_map = {
            "A": {timestamp: feature},
            "B": {},
        }
        self.assertIsNone(
            experiment.select_symbols(
                feature_map, ["A", "B"], timestamp, 1, "spot_lead"
            )
        )

    def test_archive_access_is_same_descriptor_and_holdout_gated(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            key = "data/example.zip"
            path = root / key
            path.parent.mkdir(parents=True)
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("example.csv", "a,b\n1,2\n")
            item = {
                "archive_bytes": path.stat().st_size,
                "archive_sha256": experiment.sha256_file(path),
                "key": key,
                "lifecycle_partition": "DEVELOPMENT",
            }
            access = experiment.ArchiveAccess(
                {"artifacts": [item]}, root, holdout_allowed=False
            )
            self.assertEqual(list(access.rows(key)), [["a", "b"], ["1", "2"]])
            item["lifecycle_partition"] = "EMBARGO_HOLDOUT"
            blocked = experiment.ArchiveAccess(
                {"artifacts": [item]}, root, holdout_allowed=False
            )
            with self.assertRaises(experiment.StudyError):
                list(blocked.rows(key))

    def test_archive_access_rejects_extra_member(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            key = "data/example.zip"
            path = root / key
            path.parent.mkdir(parents=True)
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("one.csv", "1\n")
                archive.writestr("two.csv", "2\n")
            access = experiment.ArchiveAccess(
                {
                    "artifacts": [
                        {
                            "archive_bytes": path.stat().st_size,
                            "archive_sha256": experiment.sha256_file(path),
                            "key": key,
                            "lifecycle_partition": "DEVELOPMENT",
                        }
                    ]
                },
                root,
                holdout_allowed=False,
            )
            with self.assertRaises(experiment.StudyError):
                list(access.rows(key))

    def test_futures_only_cash_lifecycle_math(self) -> None:
        start = experiment.DEVELOPMENT_START_MS
        symbols = ["A", "B"]
        data: dict[str, experiment.SymbolData] = {}
        feature_map: dict[str, dict[int, experiment.Feature]] = {}
        for symbol, lead, exit_price in (("A", 1.0, 101.0), ("B", -1.0, 99.0)):
            bars: dict[int, experiment.Bar] = {}
            marks: dict[int, experiment.Bar] = {}
            for index in range(4):
                timestamp = start + index * experiment.HOUR_MS
                price = exit_price if index >= 3 else 100.0
                bars[timestamp] = experiment.Bar(
                    timestamp, price, price, 10_000_000
                )
                marks[timestamp] = experiment.Bar(
                    timestamp, 100.0, 100.0, 0
                )
            data[symbol] = experiment.SymbolData(
                spot=dict(bars),
                contract=bars,
                mark=marks,
                funding=[
                    experiment.Funding(
                        start + 2 * experiment.HOUR_MS + 7,
                        8,
                        0.0001,
                    )
                ],
            )
            feature_map[symbol] = {
                start: experiment.Feature(lead, lead, lead, 0, 0)
            }
        simulation = experiment.simulate(
            data,
            feature_map,
            symbols,
            start,
            start + experiment.DAY_MS,
            1,
            1,
            "spot_lead",
        )
        self.assertEqual(simulation.formation_count, 1)
        self.assertAlmostEqual(simulation.gross_usd, 9.6, places=9)
        self.assertAlmostEqual(simulation.funding_usd, 0.0, places=9)
        self.assertAlmostEqual(
            sum(simulation.daily_by_scenario["base"]), 8.256, places=9
        )
        self.assertAlmostEqual(
            simulation.maximum_marked_gross_usd, 960.0, places=9
        )

    def test_marked_gross_includes_preclose_exit_gap(self) -> None:
        start = experiment.DEVELOPMENT_START_MS
        symbols = ["A", "B"]
        data: dict[str, experiment.SymbolData] = {}
        feature_map: dict[str, dict[int, experiment.Feature]] = {}
        for symbol, lead in (("A", 1.0), ("B", -1.0)):
            bars = {
                start + index * experiment.HOUR_MS: experiment.Bar(
                    start + index * experiment.HOUR_MS,
                    110.0 if index >= 3 else 100.0,
                    110.0 if index >= 3 else 100.0,
                    10_000_000,
                )
                for index in range(4)
            }
            data[symbol] = experiment.SymbolData(
                spot=dict(bars),
                contract=bars,
                mark=dict(bars),
                funding=[
                    experiment.Funding(
                        start + 2 * experiment.HOUR_MS + 7,
                        8,
                        0,
                    )
                ],
            )
            feature_map[symbol] = {
                start: experiment.Feature(lead, lead, lead, 0, 0)
            }
        simulation = experiment.simulate(
            data,
            feature_map,
            symbols,
            start,
            start + experiment.DAY_MS,
            1,
            1,
            "spot_lead",
        )
        self.assertAlmostEqual(
            simulation.maximum_marked_gross_usd, 1056.0, places=9
        )

    def test_one_run_marker_is_exclusive(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "gate.json"
            experiment.atomic_create_once(path, b"first")
            with self.assertRaises(experiment.StudyError):
                experiment.atomic_create_once(path, b"second")
            self.assertEqual(path.read_bytes(), b"first")
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(experiment.StudyError):
                experiment.require_canonical_roots(pathlib.Path(directory))

    def test_holm_and_drawdown(self) -> None:
        adjusted = experiment.holm_adjust({"a": 0.01, "b": 0.03, "c": 0.2})
        self.assertAlmostEqual(adjusted["a"], 0.03)
        self.assertGreaterEqual(adjusted["b"], adjusted["a"])
        drawdown = experiment.maximum_drawdown(
            [(1, 10.0), (2, -4.0), (3, -9.0), (4, 2.0)]
        )
        self.assertEqual(drawdown, 13.0)

    def test_bootstrap_is_seed_deterministic(self) -> None:
        first = experiment.common_bootstrap_starts(20, 10, 7, 42)
        second = experiment.common_bootstrap_starts(20, 10, 7, 42)
        self.assertEqual(first, second)
        boot = experiment.bootstrap_means([[float(i) for i in range(20)]], first, 7)
        self.assertEqual(len(boot[0]), 10)


if __name__ == "__main__":
    unittest.main()
