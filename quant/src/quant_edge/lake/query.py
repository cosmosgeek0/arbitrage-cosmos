from __future__ import annotations

from contextlib import suppress
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

import duckdb

from quant_edge.errors import ContractValueError, QuantEdgeError
from quant_edge.lake.contracts import UTC_NS_MAX, UTC_NS_MIN, require_path_segment
from quant_edge.lake.parquet import ValidatedEvidenceTableV1

MAX_QUERY_ROWS: Final = 1_000
_TABLE_NAME: Final = "q_input"
_HARDENED_CONFIG: Final[dict[str, str | bool | int | float | list[str]]] = {
    "threads": "1",
    "memory_limit": "64MB",
    "max_temp_directory_size": "0B",
    "enable_external_access": "false",
    "autoinstall_known_extensions": "false",
    "autoload_known_extensions": "false",
    "allow_unsigned_extensions": "false",
    "allow_community_extensions": "false",
    "python_enable_replacements": "false",
    "enable_external_file_cache": "false",
    "enable_http_metadata_cache": "false",
    "allow_persistent_secrets": "false",
    "allow_unredacted_secrets": "false",
    "scalar_subquery_error_on_multiple_rows": "true",
    "lock_configuration": "true",
}


class QueryBoundaryError(QuantEdgeError):
    """Raised when a fixed, validated-Arrow-only query boundary fails."""


class QueryKind(StrEnum):
    WINDOW = "WINDOW"
    QUALITY_COUNTS = "QUALITY_COUNTS"


@dataclass(frozen=True, slots=True)
class FixedQueryV1:
    kind: QueryKind
    limit: int
    start_event_time_ns: int | None = None
    end_event_time_ns: int | None = None
    venue: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.kind, QueryKind):
            raise ContractValueError("kind must be QueryKind")
        if isinstance(self.limit, bool) or not isinstance(self.limit, int):
            raise ContractValueError("limit must be an integer")
        if not 1 <= self.limit <= MAX_QUERY_ROWS:
            raise ContractValueError(f"limit must be between 1 and {MAX_QUERY_ROWS}")
        if self.kind is QueryKind.QUALITY_COUNTS:
            if any(
                value is not None
                for value in (self.start_event_time_ns, self.end_event_time_ns, self.venue)
            ):
                raise ContractValueError("QUALITY_COUNTS accepts no filters")
            return
        if (
            isinstance(self.start_event_time_ns, bool)
            or not isinstance(self.start_event_time_ns, int)
            or isinstance(self.end_event_time_ns, bool)
            or not isinstance(self.end_event_time_ns, int)
        ):
            raise ContractValueError("WINDOW requires exact integer event-time bounds")
        if not UTC_NS_MIN <= self.start_event_time_ns <= UTC_NS_MAX:
            raise ContractValueError("start_event_time_ns is outside the frozen UTC range")
        if not UTC_NS_MIN <= self.end_event_time_ns <= UTC_NS_MAX:
            raise ContractValueError("end_event_time_ns is outside the frozen UTC range")
        if self.start_event_time_ns > self.end_event_time_ns:
            raise ContractValueError("WINDOW time bounds are reversed")
        if self.venue is not None:
            require_path_segment(self.venue, field="venue")


@dataclass(frozen=True, slots=True)
class FixedQueryResultV1:
    columns: tuple[str, ...]
    rows: tuple[tuple[object, ...], ...]


def _open_hardened_connection() -> duckdb.DuckDBPyConnection:
    try:
        connection = duckdb.connect(":memory:", config=_HARDENED_CONFIG)
    except duckdb.Error as error:
        raise QueryBoundaryError(f"failed to create hardened DuckDB connection: {error}") from error
    expected: dict[str, object] = {
        "threads": 1,
        "enable_external_access": False,
        "autoinstall_known_extensions": False,
        "autoload_known_extensions": False,
        "allow_unsigned_extensions": False,
        "allow_community_extensions": False,
        "python_enable_replacements": False,
        "enable_external_file_cache": False,
        "enable_http_metadata_cache": False,
        "allow_persistent_secrets": False,
        "allow_unredacted_secrets": False,
        "scalar_subquery_error_on_multiple_rows": True,
        "lock_configuration": True,
    }
    try:
        for setting, expected_value in expected.items():
            value = connection.execute(f"SELECT current_setting('{setting}')").fetchone()
            if value is None or value[0] != expected_value:
                raise QueryBoundaryError(f"DuckDB setting {setting} was not applied")
        temp = connection.execute("SELECT current_setting('max_temp_directory_size')").fetchone()
        if temp is None or temp[0] not in ("0 bytes", "0 Bytes", "0B"):
            raise QueryBoundaryError("DuckDB spill storage was not disabled")
        memory = connection.execute("SELECT current_setting('memory_limit')").fetchone()
        if memory != ("61.0 MiB",):
            raise QueryBoundaryError("DuckDB memory limit was not applied at the exact lock")
    except (duckdb.Error, QueryBoundaryError) as error:
        connection.close()
        raise QueryBoundaryError(f"failed to verify hardened DuckDB settings: {error}") from error
    return connection


_WINDOW_COLUMNS: Final = (
    "record_id",
    "venue",
    "product",
    "event_kind",
    "symbol",
    "event_time_ns",
    "receive_wall_time_ns",
    "session_id",
    "stream_id",
    "sequence_first",
    "quality_state",
)


def run_fixed_query(
    validated: ValidatedEvidenceTableV1,
    query: FixedQueryV1,
) -> FixedQueryResultV1:
    if type(validated) is not ValidatedEvidenceTableV1:
        raise ContractValueError("query input must be validator-returned evidence")
    if type(query) is not FixedQueryV1:
        raise ContractValueError("query must be FixedQueryV1, never SQL")
    connection = _open_hardened_connection()
    try:
        connection.register(_TABLE_NAME, validated._arrow_table_for_fixed_query())
        columns: tuple[str, ...]
        if query.kind is QueryKind.QUALITY_COUNTS:
            cursor = connection.execute(
                "SELECT quality_state, COUNT(*)::BIGINT AS row_count "
                f"FROM {_TABLE_NAME} GROUP BY quality_state "
                "ORDER BY quality_state ASC LIMIT ?",
                [query.limit],
            )
            columns = ("quality_state", "row_count")
        elif query.venue is None:
            cursor = connection.execute(
                "SELECT record_id, venue, product, event_kind, symbol, event_time_ns, "
                "receive_wall_time_ns, session_id, stream_id, sequence_first, quality_state "
                f"FROM {_TABLE_NAME} WHERE event_time_ns BETWEEN ? AND ? "
                "ORDER BY event_time_ns, receive_wall_time_ns ASC NULLS LAST, "
                "session_id, stream_id, sequence_first ASC NULLS LAST, "
                "record_id LIMIT ?",
                [query.start_event_time_ns, query.end_event_time_ns, query.limit],
            )
            columns = _WINDOW_COLUMNS
        else:
            cursor = connection.execute(
                "SELECT record_id, venue, product, event_kind, symbol, event_time_ns, "
                "receive_wall_time_ns, session_id, stream_id, sequence_first, quality_state "
                f"FROM {_TABLE_NAME} WHERE venue = ? AND event_time_ns BETWEEN ? AND ? "
                "ORDER BY event_time_ns, receive_wall_time_ns ASC NULLS LAST, "
                "session_id, stream_id, sequence_first ASC NULLS LAST, "
                "record_id LIMIT ?",
                [
                    query.venue,
                    query.start_event_time_ns,
                    query.end_event_time_ns,
                    query.limit,
                ],
            )
            columns = _WINDOW_COLUMNS
        rows = tuple(tuple(row) for row in cursor.fetchall())
        if len(rows) > query.limit:
            raise QueryBoundaryError("DuckDB returned more rows than the fixed limit")
        return FixedQueryResultV1(columns=columns, rows=rows)
    except duckdb.Error as error:
        raise QueryBoundaryError(f"fixed DuckDB query failed: {error}") from error
    finally:
        with suppress(duckdb.Error):
            connection.unregister(_TABLE_NAME)
        connection.close()
