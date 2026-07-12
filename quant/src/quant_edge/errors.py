class QuantEdgeError(Exception):
    """Base class for deterministic, user-correctable Q-lane failures."""


class CanonicalJsonError(QuantEdgeError):
    """Raised when JSON is lossy, ambiguous, or non-canonical."""


class ContractValueError(QuantEdgeError):
    """Raised when a value violates a frozen Q-lane primitive contract."""


class HypothesisRegistryError(QuantEdgeError):
    """Raised when the hypothesis registry or Markdown projection drifts."""
