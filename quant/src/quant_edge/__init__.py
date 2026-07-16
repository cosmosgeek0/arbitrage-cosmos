"""Deterministic, advisory-only quant research infrastructure."""

from quant_edge.clock import Clock, FixedClock
from quant_edge.config import ResearchConfig, make_research_config
from quant_edge.randomness import DeterministicRandom, RandomSource, seed_fixture_bytes

__all__ = [
    "Clock",
    "DeterministicRandom",
    "FixedClock",
    "RandomSource",
    "ResearchConfig",
    "make_research_config",
    "seed_fixture_bytes",
]

__version__ = "0.1.0"
