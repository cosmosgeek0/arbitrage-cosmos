import hashlib
from dataclasses import dataclass
from typing import Protocol

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.primitives import require_seed

RNG_ALGORITHM = "SHA256_COUNTER_U64_V1"
_DOMAIN = b"quant-edge-rng-v1\x00"
_COUNTER_MAX = (1 << 64) - 1


class RandomSource(Protocol):
    def next_u64(self) -> int:
        """Return the next deterministic unsigned 64-bit value."""


@dataclass(slots=True)
class DeterministicRandom:
    _seed: int
    _counter: int = 0

    def __post_init__(self) -> None:
        require_seed(self._seed)
        if isinstance(self._counter, bool) or not isinstance(self._counter, int):
            raise ContractValueError("counter must be an integer")
        if not 0 <= self._counter <= _COUNTER_MAX:
            raise ContractValueError("counter must fit an unsigned 64-bit integer")

    @classmethod
    def from_seed(cls, seed: int) -> "DeterministicRandom":
        return cls(require_seed(seed))

    def next_u64(self) -> int:
        if self._counter > _COUNTER_MAX:
            raise ContractValueError("deterministic random counter exhausted")
        material = (
            _DOMAIN
            + self._seed.to_bytes(16, byteorder="big", signed=False)
            + self._counter.to_bytes(8, byteorder="big", signed=False)
        )
        self._counter += 1
        return int.from_bytes(hashlib.sha256(material).digest()[:8], byteorder="big")


def seed_fixture_bytes(*, seed: int, count: int) -> bytes:
    require_seed(seed)
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 1_024:
        raise ContractValueError("count must be an integer from 1 through 1024")
    source = DeterministicRandom.from_seed(seed)
    values = [f"{source.next_u64():016x}" for _ in range(count)]
    return canonical_json_bytes(
        {
            "algorithm": RNG_ALGORITHM,
            "count": count,
            "schema": "DeterministicSeedFixtureV1",
            "seed": str(seed),
            "values": values,
            "version": 1,
        }
    )
