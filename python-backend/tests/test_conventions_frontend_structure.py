import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_frontend_feature_structure_exists() -> None:
    for path in (
        REPO_ROOT / "src" / "app",
        REPO_ROOT / "src" / "features",
        REPO_ROOT / "src" / "shared",
        REPO_ROOT / "src" / "core",
    ):
        assert path.exists(), f"Expected frontend structure path to exist: {path}"


def test_legacy_frontend_directories_do_not_return() -> None:
    for path in (
        REPO_ROOT / "src" / "lib",
        REPO_ROOT / "src" / "store",
        REPO_ROOT / "src" / "sync",
        REPO_ROOT / "src" / "pages",
        REPO_ROOT / "src" / "agent",
    ):
        assert not path.exists(), f"Legacy frontend directory returned: {path}"


def test_shared_and_core_do_not_depend_on_features() -> None:
    source_roots = (
        REPO_ROOT / "src" / "shared",
        REPO_ROOT / "src" / "core",
    )
    forbidden_patterns = (
        re.compile(r"""from\s+['"][^'"]*features/"""),
        re.compile(r"""import\s+['"][^'"]*features/"""),
    )

    for root in source_roots:
        for path in root.rglob("*.ts*"):
            source = path.read_text(encoding="utf-8")
            assert not any(pattern.search(source) for pattern in forbidden_patterns), (
                f"{path} must not depend on src/features"
            )


def test_app_layer_depends_on_feature_public_entrypoints_only() -> None:
    app_root = REPO_ROOT / "src" / "app"
    disallowed_patterns = (
        re.compile(r"""from\s+['"][^'"]*features/[^'"]+/(api|components|pages|runtime|store|sync|types)/"""),
        re.compile(r"""import\s+['"][^'"]*features/[^'"]+/(api|components|pages|runtime|store|sync|types)/"""),
        re.compile(r"""import\(\s*['"][^'"]*features/[^'"]+/(api|components|pages|runtime|store|sync|types)/"""),
    )

    for path in app_root.rglob("*.ts*"):
        source = path.read_text(encoding="utf-8")
        assert not any(pattern.search(source) for pattern in disallowed_patterns), (
            f"{path} must only depend on feature public entrypoints"
        )


def test_components_do_not_depend_on_features() -> None:
    components_root = REPO_ROOT / "src" / "components"
    forbidden_patterns = (
        re.compile(r"""from\s+['"][^'"]*features/"""),
        re.compile(r"""import\s+['"][^'"]*features/"""),
    )

    for path in components_root.rglob("*.ts*"):
        source = path.read_text(encoding="utf-8")
        assert not any(pattern.search(source) for pattern in forbidden_patterns), (
            f"{path} must not depend on src/features"
        )


def test_no_wildcard_re_exports_in_frontend_layers() -> None:
    allowed_files = {
        REPO_ROOT / "src" / "core" / "index.ts",
        REPO_ROOT / "src" / "core" / "events" / "index.ts",
        REPO_ROOT / "src" / "core" / "errors" / "index.ts",
        REPO_ROOT / "src" / "core" / "types" / "index.ts",
        REPO_ROOT / "src" / "core" / "validation" / "index.ts",
        REPO_ROOT / "src" / "features" / "agent" / "runtime" / "index.ts",
        REPO_ROOT / "src" / "features" / "agent" / "types" / "index.ts",
        REPO_ROOT / "src" / "features" / "knowledge" / "api" / "index.ts",
        REPO_ROOT / "src" / "features" / "knowledge" / "sync" / "index.ts",
        REPO_ROOT / "src" / "features" / "settings" / "api" / "index.ts",
        REPO_ROOT / "src" / "shared" / "store" / "index.ts",
    }

    for root in (
        REPO_ROOT / "src" / "app",
        REPO_ROOT / "src" / "features",
        REPO_ROOT / "src" / "shared",
        REPO_ROOT / "src" / "core",
    ):
        for path in root.rglob("index.ts"):
            if path in allowed_files:
                continue
            source = path.read_text(encoding="utf-8")
            assert "export * from" not in source, f"{path} must not use wildcard re-exports"


def test_app_layer_uses_public_or_page_entrypoints_when_importing_features() -> None:
    app_root = REPO_ROOT / "src" / "app"
    allowed_suffixes = ("/public", "/page")
    import_pattern = re.compile(r"""(?:from|import)\s*['"](?P<target>[^'"]*features/[^'"]+)['"]""")
    dynamic_import_pattern = re.compile(r"""import\(\s*['"](?P<target>[^'"]*features/[^'"]+)['"]\s*\)""")

    for path in app_root.rglob("*.ts*"):
        source = path.read_text(encoding="utf-8")
        for pattern in (import_pattern, dynamic_import_pattern):
            for match in pattern.finditer(source):
                target = match.group("target")
                assert target.endswith(allowed_suffixes), (
                    f"{path} must import feature public/page entrypoints only: {target}"
                )


def test_feature_modules_do_not_depend_on_other_feature_root_indexes() -> None:
    features_root = REPO_ROOT / "src" / "features"
    allowed_exact_targets = {"../../settings/api"}
    for path in features_root.rglob("*.ts*"):
        source = path.read_text(encoding="utf-8")
        relative_path = path.relative_to(features_root)
        feature_name = relative_path.parts[0]
        for match in re.finditer(
            r"""from\s+['"](?P<target>\.\./\.\./(?P<other>agent|dashboard|finance|knowledge|settings|tasks|tools)(?:/[^'"]+)?)['"]""",
            source,
        ):
            target = match.group("target")
            other_feature = match.group("other")
            if other_feature == feature_name:
                continue
            assert target.endswith("/public") or target in allowed_exact_targets, (
                f"{path} must use feature public entrypoints for cross-feature imports: {target}"
            )


def test_selected_cross_feature_dependencies_prefer_public_entrypoints() -> None:
    files = (
        REPO_ROOT / "src" / "features" / "agent" / "runtime" / "useAgentRuntime.ts",
        REPO_ROOT / "src" / "features" / "agent" / "runtime" / "state.ts",
    )

    for path in files:
        source = path.read_text(encoding="utf-8")
        assert "../../settings/public" in source
        assert "../../settings/api/providers" not in source
