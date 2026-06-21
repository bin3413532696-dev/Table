from __future__ import annotations

from pathlib import Path

import pytest


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "unit: fast tests with no real infrastructure dependencies")
    config.addinivalue_line("markers", "integration: tests that require real PostgreSQL or cross-layer wiring")
    config.addinivalue_line("markers", "startup: tests that validate FastAPI application startup behavior")
    config.addinivalue_line("markers", "conventions: tests that enforce repository conventions or documentation sync")
    config.addinivalue_line("markers", "slow: slower tests that should be called out explicitly")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    root = Path(config.rootpath)

    for item in items:
        path = Path(str(item.fspath)).resolve().relative_to(root.resolve()).as_posix()

        if "/tests/test_conventions_" in f"/{path}":
            item.add_marker(pytest.mark.conventions)
            continue

        if path.startswith("tests/test_") and path.endswith("_integration.py"):
            item.add_marker(pytest.mark.integration)
            item.add_marker(pytest.mark.slow)
            continue

        if path.startswith("tests/startup/"):
            item.add_marker(pytest.mark.startup)
            item.add_marker(pytest.mark.integration)
            continue

        item.add_marker(pytest.mark.unit)
