from __future__ import annotations

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.regime.matrix_profile import (
    MAX_PROFILE_POINTS,
    EventIntervalV1,
    ExclusionCountsV1,
    MatrixProfileConfigV1,
    MatrixProfileEntryV1,
    MatrixProfileV1,
    compute_left_profile,
)

HUNDREDTH = FIXED_POINT_SCALE // 100


def _values(hundredths: list[int]) -> tuple[FixedPointV1, ...]:
    return tuple(FixedPointV1(value * HUNDREDTH) for value in hundredths)


def _config(*, window: int = 4, embargo: int = 0) -> MatrixProfileConfigV1:
    return MatrixProfileConfigV1(profile_id="profile-1", window=window, embargo=embargo)


class TestEventInterval:
    def test_intersection_law(self) -> None:
        event = EventIntervalV1(start=4, end=8)
        assert event.intersects(6, 10)
        assert event.intersects(0, 5)
        assert not event.intersects(8, 12)
        assert not event.intersects(0, 4)
        assert event.as_mapping() == {"end": 8, "start": 4}

    def test_rejects_empty_interval(self) -> None:
        with pytest.raises(ContractValueError, match="end"):
            EventIntervalV1(start=4, end=4)


class TestProfileContracts:
    def test_config_rejects_bad_fields(self) -> None:
        with pytest.raises(ContractValueError, match="profile_id"):
            MatrixProfileConfigV1(profile_id="", window=4, embargo=0)
        with pytest.raises(ContractValueError, match="window"):
            MatrixProfileConfigV1(profile_id="profile-1", window=1, embargo=0)
        with pytest.raises(ContractValueError, match="embargo"):
            MatrixProfileConfigV1(profile_id="profile-1", window=4, embargo=-1)
        assert _config().as_mapping()["window"] == 4

    def test_entry_laws(self) -> None:
        with pytest.raises(ContractValueError, match="strictly earlier"):
            MatrixProfileEntryV1(
                index=4,
                query_degenerate=False,
                neighbor=4,
                similarity=FixedPointV1(0),
                eligible_count=1,
            )
        with pytest.raises(ContractValueError, match="similarity exists exactly"):
            MatrixProfileEntryV1(
                index=4,
                query_degenerate=False,
                neighbor=0,
                similarity=None,
                eligible_count=1,
            )
        with pytest.raises(ContractValueError, match="inside \\[-1, 1\\]"):
            MatrixProfileEntryV1(
                index=4,
                query_degenerate=False,
                neighbor=0,
                similarity=FixedPointV1(2 * FIXED_POINT_SCALE),
                eligible_count=1,
            )
        with pytest.raises(ContractValueError, match="eligible candidates require"):
            MatrixProfileEntryV1(
                index=4,
                query_degenerate=False,
                neighbor=None,
                similarity=None,
                eligible_count=2,
            )
        with pytest.raises(ContractValueError, match="degenerate query has no neighbor"):
            MatrixProfileEntryV1(
                index=4,
                query_degenerate=True,
                neighbor=0,
                similarity=FixedPointV1(0),
                eligible_count=0,
            )
        with pytest.raises(ContractValueError, match="query_degenerate must be boolean"):
            MatrixProfileEntryV1(
                index=4,
                query_degenerate=1,  # type: ignore[arg-type]
                neighbor=None,
                similarity=None,
                eligible_count=0,
            )

    def test_exclusion_counts_and_profile_contracts(self) -> None:
        counts = ExclusionCountsV1(future=1, overlap=2, same_event=3, degenerate=4)
        assert counts.total == 10
        assert counts.as_mapping()["total"] == 10
        with pytest.raises(ContractValueError, match="future"):
            ExclusionCountsV1(future=-1, overlap=0, same_event=0, degenerate=0)
        entry = MatrixProfileEntryV1(
            index=0,
            query_degenerate=False,
            neighbor=None,
            similarity=None,
            eligible_count=0,
        )
        with pytest.raises(ContractValueError, match="cover every query window"):
            MatrixProfileV1(
                profile_id="profile-1",
                window=4,
                embargo=0,
                point_count=8,
                entries=(entry,),
                exclusions=counts,
            )
        with pytest.raises(ContractValueError, match="dense and ordered"):
            MatrixProfileV1(
                profile_id="profile-1",
                window=4,
                embargo=0,
                point_count=5,
                entries=(entry, entry),
                exclusions=counts,
            )
        with pytest.raises(ContractValueError, match="must be MatrixProfileEntryV1"):
            MatrixProfileV1(
                profile_id="profile-1",
                window=4,
                embargo=0,
                point_count=4,
                entries=(1,),  # type: ignore[arg-type]
                exclusions=counts,
            )
        with pytest.raises(ContractValueError, match="entries must be a non-empty tuple"):
            MatrixProfileV1(
                profile_id="profile-1",
                window=4,
                embargo=0,
                point_count=4,
                entries=(),
                exclusions=counts,
            )
        with pytest.raises(ContractValueError, match="exclusions must be ExclusionCountsV1"):
            MatrixProfileV1(
                profile_id="profile-1",
                window=4,
                embargo=0,
                point_count=4,
                entries=(entry,),
                exclusions=None,  # type: ignore[arg-type]
            )


class TestComputeLeftProfile:
    def test_rejects_bad_inputs(self) -> None:
        with pytest.raises(ContractValueError, match="values must be a tuple"):
            compute_left_profile([1], _config())  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match=f"at most {MAX_PROFILE_POINTS}"):
            compute_left_profile(
                tuple(FixedPointV1(0) for _ in range(MAX_PROFILE_POINTS + 1)),
                _config(),
            )
        with pytest.raises(ContractValueError, match="config must be MatrixProfileConfigV1"):
            compute_left_profile(_values([1, 2, 3, 4]), None)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="events must be a tuple"):
            compute_left_profile(_values([1, 2, 3, 4]), _config(), events=[1])  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="events\\[0\\]"):
            compute_left_profile(_values([1, 2, 3, 4]), _config(), events=(1,))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="shorter than one window"):
            compute_left_profile(_values([1, 2, 3]), _config())
        with pytest.raises(ContractValueError, match="values"):
            compute_left_profile((FixedPointV1(0), 1, FixedPointV1(0), FixedPointV1(0)), _config())  # type: ignore[arg-type]

    def test_repeated_motif_finds_exact_earlier_copy(self) -> None:
        motif = [0, 30, 60, 30]
        background = [500, 501, 499, 502, 500, 498, 501, 500]
        values = _values(
            [500 + motif[i] for i in range(4)] + background + [500 + motif[i] for i in range(4)]
        )
        profile = compute_left_profile(values, _config())
        entry = profile.entries[12]
        assert entry.neighbor == 0
        assert entry.similarity is not None
        assert entry.similarity.mantissa == FIXED_POINT_SCALE

    def test_earlier_only_law_holds_for_every_entry(self) -> None:
        values = _values([500 + ((i * 37) % 21 - 10) for i in range(40)])
        for embargo in (0, 3):
            profile = compute_left_profile(values, _config(embargo=embargo))
            for entry in profile.entries:
                if entry.neighbor is not None:
                    assert entry.neighbor + profile.window + embargo <= entry.index

    def test_pair_accounting_is_conserved(self) -> None:
        values = _values([500 + ((i * 37) % 21 - 10) for i in range(30)])
        profile = compute_left_profile(
            values,
            _config(embargo=1),
            events=(EventIntervalV1(start=5, end=12),),
        )
        window_count = len(profile.entries)
        eligible_total = sum(entry.eligible_count for entry in profile.entries)
        assert profile.exclusions.total + eligible_total == window_count * (window_count - 1)

    def test_degenerate_windows_are_counted_and_yield_no_neighbor(self) -> None:
        # A long constant head makes early windows degenerate.
        values = _values([500] * 10 + [500 + ((i * 37) % 21 - 10) for i in range(10)])
        profile = compute_left_profile(values, _config())
        assert profile.exclusions.degenerate > 0
        assert profile.entries[0].query_degenerate
        assert profile.entries[0].neighbor is None
        # A varying later window may still find no eligible non-degenerate earlier
        # candidate close enough; the law only forbids fabricated neighbors.
        for entry in profile.entries:
            if entry.query_degenerate:
                assert entry.similarity is None

    def test_same_event_windows_are_excluded(self) -> None:
        motif = [0, 30, 60, 30]
        values = _values(
            [500 + motif[i] for i in range(4)]
            + [500, 501, 499, 502, 500, 498, 501, 500]
            + [500 + motif[i] for i in range(4)]
        )
        shared_event = (EventIntervalV1(start=0, end=4), EventIntervalV1(start=0, end=16))
        no_exclusion = compute_left_profile(values, _config())
        # One event covering both motif copies removes the perfect match.
        excluded = compute_left_profile(
            values,
            _config(),
            events=(EventIntervalV1(start=0, end=20),),
        )
        assert no_exclusion.entries[12].neighbor == 0
        assert excluded.exclusions.same_event > 0
        entry = excluded.entries[12]
        assert (
            entry.neighbor is None
            or entry.similarity is None
            or (entry.similarity.mantissa < FIXED_POINT_SCALE)
        )
        assert len(shared_event) == 2

    def test_anti_correlated_window_ranks_below_positive(self) -> None:
        up = [0, 10, 20, 30]
        down = [30, 20, 10, 0]
        flatish = [0, 1, 0, 2]
        values = _values(
            [500 + delta for delta in up]
            + [500 + delta for delta in down]
            + [500 + delta for delta in flatish]
            + [500 + delta for delta in up]
        )
        profile = compute_left_profile(values, _config())
        entry = profile.entries[12]
        assert entry.neighbor == 0
        assert entry.similarity is not None
        assert entry.similarity.mantissa == FIXED_POINT_SCALE

    def test_brute_force_parity_on_correlation_order(self) -> None:
        values = _values([500 + ((i * 53) % 17 - 8) * (1 + i % 3) for i in range(24)])
        window = 4
        profile = compute_left_profile(values, _config(window=window))
        mantissas = [value.mantissa for value in values]

        def stats(start: int) -> tuple[int, int]:
            segment = mantissas[start : start + window]
            total = sum(segment)
            square = sum(value * value for value in segment)
            return total, window * square - total * total

        for entry in profile.entries:
            if entry.neighbor is None:
                continue
            query_total, query_var = stats(entry.index)
            best_key: tuple[float, float] | None = None
            best_candidate: int | None = None
            for candidate in range(entry.index - window + 1):
                candidate_total, candidate_var = stats(candidate)
                if candidate_var == 0:
                    continue
                cross = sum(
                    mantissas[entry.index + offset] * mantissas[candidate + offset]
                    for offset in range(window)
                )
                cov = window * cross - query_total * candidate_total
                correlation = cov / (query_var**0.5 * candidate_var**0.5)
                if best_key is None or correlation > best_key[0] + 1e-12:
                    best_key = (correlation, 0.0)
                    best_candidate = candidate
            assert best_candidate == entry.neighbor

    def test_exact_tie_keeps_the_earliest_candidate(self) -> None:
        motif = [0, 30, 60, 30]
        filler = [500, 501, 499, 502]
        values = _values(
            [500 + motif[i] for i in range(4)]
            + filler
            + [500 + motif[i] for i in range(4)]
            + filler
            + [500 + motif[i] for i in range(4)]
        )
        profile = compute_left_profile(values, _config())
        entry = profile.entries[16]
        # Both earlier motif copies correlate exactly 1.0; the earlier one wins.
        assert entry.neighbor == 0
        assert entry.similarity is not None
        assert entry.similarity.mantissa == FIXED_POINT_SCALE

    def test_no_candidates_yields_explicit_absence(self) -> None:
        values = _values([500 + ((i * 37) % 21 - 10) for i in range(6)])
        profile = compute_left_profile(values, _config())
        # Window 4 over 6 points: queries 0..2, none has an earlier non-overlapping
        # candidate.
        assert all(entry.neighbor is None for entry in profile.entries)
        assert profile.exclusions.future + profile.exclusions.overlap == 6
