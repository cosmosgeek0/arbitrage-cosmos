from __future__ import annotations

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.diagnostics import (
    DEFERRED_DIAGNOSTICS,
    FeatureColumnV1,
    column_health,
    deferred_diagnostics,
    diagnostic_obligations,
    missingness_signals,
    pairwise_correlation,
    redundancy_clusters,
)
from quant_edge.features.fixedpoint import fp_from_int
from quant_edge.labels.rational import make_ratio


def _column(feature_id: str, values: tuple[int | None, ...]) -> FeatureColumnV1:
    return FeatureColumnV1(
        feature_id=feature_id,
        values=tuple(None if value is None else fp_from_int(value) for value in values),
    )


class TestColumnHealth:
    def test_health_facts(self) -> None:
        columns = (
            _column("a:v1", (1, 2, 3, None)),
            _column("b:v1", (7, 7, 7, 7)),
        )
        health = column_health(columns)

        assert health[0].missing_count == 1
        assert health[0].distinct_count == 3
        assert not health[0].near_constant
        assert health[1].near_constant
        assert health[1].as_mapping()["nearConstant"] is True

    def test_column_contracts(self) -> None:
        with pytest.raises(ContractValueError):
            FeatureColumnV1(feature_id="a:v1", values=())
        with pytest.raises(ContractValueError):
            FeatureColumnV1(feature_id="a:v1", values=(1,))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            column_health(())
        with pytest.raises(ContractValueError):
            column_health(("column",))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            column_health((_column("a:v1", (1,)), _column("a:v1", (2,))))
        with pytest.raises(ContractValueError):
            column_health((_column("a:v1", (1,)), _column("b:v1", (1, 2))))


class TestPairwiseCorrelation:
    def test_pearson_signed_r_squared(self) -> None:
        x = _column("x:v1", (1, 2, 3, 4))
        y = _column("y:v1", (2, 4, 6, 8))
        z = _column("z:v1", (8, 6, 4, 2))

        positive = pairwise_correlation(x, y, kind="PEARSON")
        negative = pairwise_correlation(x, z, kind="PEARSON")
        assert positive.signed_r_squared == make_ratio(1, 1)
        assert negative.signed_r_squared == make_ratio(-1, 1)
        assert positive.as_mapping()["kind"] == "PEARSON"

    def test_spearman_uses_midranks(self) -> None:
        x = _column("x:v1", (1, 2, 3, 100))
        y = _column("y:v1", (10, 20, 30, 31))
        tied = _column("t:v1", (5, 5, 7, 9))

        monotone = pairwise_correlation(x, y, kind="SPEARMAN")
        assert monotone.signed_r_squared == make_ratio(1, 1)
        with_ties = pairwise_correlation(x, tied, kind="SPEARMAN")
        assert with_ties.signed_r_squared is not None
        assert not with_ties.signed_r_squared.is_negative

    def test_insufficient_or_degenerate_pairs_are_none(self) -> None:
        short_x = _column("x:v1", (1, None, None, 2))
        short_y = _column("y:v1", (2, None, None, 4))
        constant = _column("c:v1", (5, 5, 5, 5))
        x = _column("x:v1", (1, 2, 3, 4))

        sparse = pairwise_correlation(short_x, short_y, kind="PEARSON")
        assert sparse.signed_r_squared is None
        assert sparse.rows_used == 2
        degenerate = pairwise_correlation(x, constant, kind="PEARSON")
        assert degenerate.signed_r_squared is None
        with pytest.raises(ContractValueError):
            pairwise_correlation(x, constant, kind="KENDALL")


class TestRedundancyClusters:
    def test_correlated_features_cluster_together(self) -> None:
        columns = (
            _column("a:v1", (1, 2, 3, 4)),
            _column("b:v1", (2, 4, 6, 8)),
            _column("c:v1", (9, 1, 8, 2)),
        )
        clusters = redundancy_clusters(
            columns,
            r_squared_threshold=make_ratio(9, 10),
        )

        grouped = {tuple(cluster.feature_ids) for cluster in clusters}
        assert ("a:v1", "b:v1") in grouped
        assert ("c:v1",) in grouped
        assert clusters[0].as_mapping()["clusterId"] == 0

    def test_threshold_contract(self) -> None:
        columns = (_column("a:v1", (1, 2, 3)),)
        with pytest.raises(ContractValueError):
            redundancy_clusters(columns, r_squared_threshold=make_ratio(-1, 2))
        with pytest.raises(ContractValueError):
            redundancy_clusters(columns, r_squared_threshold="high")  # type: ignore[arg-type]


class TestMissingness:
    def test_missing_runs_are_reported(self) -> None:
        signals = missingness_signals((_column("a:v1", (1, None, None, None, 2, None)),))

        assert signals[0].missing_count == 4
        assert signals[0].longest_missing_run == 3
        assert signals[0].as_mapping()["longestMissingRun"] == 3

    def test_deferred_diagnostics_are_recorded(self) -> None:
        assert deferred_diagnostics() == DEFERRED_DIAGNOSTICS
        assert deferred_diagnostics() == ()
        assert len(diagnostic_obligations()) == 10
        assert "SHAP_OR_EQUIVALENT_ATTRIBUTION" in diagnostic_obligations()


class TestCoverageEdges:
    def test_first_column_type_check(self) -> None:
        with pytest.raises(ContractValueError):
            column_health(("column", _column("a:v1", (1,))))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            column_health((_column("a:v1", (1,)), "column"))  # type: ignore[arg-type]

    def test_degenerate_column_does_not_cluster(self) -> None:
        columns = (
            _column("a:v1", (1, 2, 3, 4)),
            _column("flat:v1", (5, 5, 5, 5)),
        )
        clusters = redundancy_clusters(columns, r_squared_threshold=make_ratio(1, 2))

        assert {tuple(cluster.feature_ids) for cluster in clusters} == {
            ("a:v1",),
            ("flat:v1",),
        }
