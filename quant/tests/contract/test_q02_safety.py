import inspect
import subprocess
import sys
from pathlib import Path

from quant_edge.lake.query import run_fixed_query
from quant_edge.lake.store import ImmutableLakeStore

QUANT_ROOT = Path(__file__).resolve().parents[2]
LAKE_ROOT = QUANT_ROOT / "src" / "quant_edge" / "lake"


def test_lake_imports_are_inert_and_silent() -> None:
    statement = (
        "import quant_edge.lake.contracts; import quant_edge.lake.manifest; "
        "import quant_edge.lake.parquet; import quant_edge.lake.query; "
        "import quant_edge.lake.retention; import quant_edge.lake.store; "
        "import quant_edge.lake.governance"
    )
    result = subprocess.run(
        [sys.executable, "-c", statement],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""


def test_lake_source_has_no_ambient_or_money_authority_surface() -> None:
    forbidden = (
        "os.environ",
        "os.getenv",
        "getenv(",
        "datetime.now",
        "datetime.utcnow",
        "time.time",
        "import random",
        "Math.random",
        "import socket",
        "import requests",
        "import httpx",
        "api_key",
        "secret_key",
        "withdraw",
        "borrow(",
        "repay(",
        "place_order",
        "submit_order",
    )
    paths = sorted(LAKE_ROOT.glob("*.py"))
    assert paths
    for path in paths:
        source = path.read_text(encoding="utf-8").lower()
        assert not [needle for needle in forbidden if needle.lower() in source], path


def test_query_and_store_public_boundaries_expose_no_sql_path_or_deletion_argument() -> None:
    query_parameters = tuple(inspect.signature(run_fixed_query).parameters)
    assert query_parameters == ("validated", "query")
    assert not {"sql", "path", "uri", "connection", "table"} & set(query_parameters)

    public_store_methods = {
        name
        for name, member in inspect.getmembers(ImmutableLakeStore, predicate=inspect.isfunction)
        if not name.startswith("_")
    }
    assert public_store_methods == {"close", "publish", "read", "revision_state"}
    assert not {"delete", "repair", "overwrite", "compact"} & public_store_methods
