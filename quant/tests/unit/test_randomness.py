from pathlib import Path

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.primitives import UINT128_MAX
from quant_edge.randomness import DeterministicRandom, RandomSource, seed_fixture_bytes

QUANT_ROOT = Path(__file__).resolve().parents[2]


def test_seed_fixture_is_locked_and_separate_instances_match() -> None:
    expected = (QUANT_ROOT / "fixtures" / "deterministic_seed_v1.json").read_bytes()
    assert seed_fixture_bytes(seed=20_260_712, count=8) == expected
    first: RandomSource = DeterministicRandom.from_seed(20_260_712)
    second: RandomSource = DeterministicRandom.from_seed(20_260_712)
    assert [first.next_u64() for _ in range(8)] == [second.next_u64() for _ in range(8)]


def test_counter_position_and_seed_change_the_stream() -> None:
    zero = DeterministicRandom.from_seed(0)
    one = DeterministicRandom.from_seed(1)
    assert zero.next_u64() != one.next_u64()
    offset = DeterministicRandom(0, 1)
    assert zero.next_u64() == offset.next_u64()


@pytest.mark.parametrize("seed", [True, -1, UINT128_MAX + 1])
def test_random_source_rejects_invalid_seed(seed: object) -> None:
    with pytest.raises(ContractValueError):
        DeterministicRandom.from_seed(seed)  # type: ignore[arg-type]


@pytest.mark.parametrize("counter", [True, -1, 1 << 64])
def test_random_source_rejects_invalid_initial_counter(counter: object) -> None:
    with pytest.raises(ContractValueError):
        DeterministicRandom(1, counter)  # type: ignore[arg-type]


def test_random_source_fails_closed_after_counter_exhaustion() -> None:
    source = DeterministicRandom(1, (1 << 64) - 1)
    source.next_u64()
    with pytest.raises(ContractValueError, match="exhausted"):
        source.next_u64()


@pytest.mark.parametrize("count", [True, 0, 1_025, 1.5])
def test_seed_fixture_rejects_unbounded_counts(count: object) -> None:
    with pytest.raises(ContractValueError):
        seed_fixture_bytes(seed=1, count=count)  # type: ignore[arg-type]
