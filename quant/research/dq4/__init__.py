"""Portable origin-proof validation for sealed research packets."""

from .origin_validator import REASON_CODES, validate

__all__ = ["REASON_CODES", "validate"]
