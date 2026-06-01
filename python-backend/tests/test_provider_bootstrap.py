import asyncio
from types import SimpleNamespace

from app.core.config import Settings
from app.services import provider_bootstrap


class _FakeSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.flush_count = 0
        self.commit_count = 0

    def add(self, value: object) -> None:
        self.added.append(value)

    async def flush(self) -> None:
        self.flush_count += 1

    async def commit(self) -> None:
        self.commit_count += 1


def test_compute_provider_config_hash_changes_with_inputs() -> None:
    first = provider_bootstrap.compute_provider_config_hash("https://a", "token", "model-a")
    second = provider_bootstrap.compute_provider_config_hash("https://a", "token", "model-b")
    assert first != second


def test_ensure_user_provider_bootstrap_creates_settings_and_bootstrap_provider(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        default_provider_name="GLM Bootstrap",
        default_provider_format="openai",
        default_provider_base_url="https://provider.example.com",
        default_provider_api_key="secret-token",
        default_provider_model="gpt-4o-mini",
    )
    session = _FakeSession()
    created_payloads: list[object] = []

    async def run() -> None:
        async def fake_find_user_setting(current_session, user_id):
            return None

        async def fake_list_providers_for_user(current_session, user_id):
            return []

        async def fake_find_bootstrap_provider_for_user(current_session, user_id):
            return None

        async def fake_create_provider_service(current_session, user_id, payload):
            created_payloads.append(payload)
            return SimpleNamespace(id="provider-1")

        monkeypatch.setattr(provider_bootstrap, "find_user_setting", fake_find_user_setting)
        monkeypatch.setattr(provider_bootstrap, "list_providers_for_user", fake_list_providers_for_user)
        monkeypatch.setattr(
            provider_bootstrap,
            "find_bootstrap_provider_for_user",
            fake_find_bootstrap_provider_for_user,
        )
        monkeypatch.setattr(provider_bootstrap, "create_provider_service", fake_create_provider_service)

        await provider_bootstrap.ensure_user_provider_bootstrap(
            session,
            "00000000-0000-0000-0000-000000000001",
            settings,
        )

        assert len(session.added) == 1
        setting = session.added[0]
        assert getattr(setting, "provider_config_hash")
        assert session.flush_count == 1
        assert session.commit_count == 1
        assert len(created_payloads) == 1
        assert created_payloads[0].source == "bootstrap"
        assert created_payloads[0].baseUrl == "https://provider.example.com"

    asyncio.run(run())


def test_ensure_user_provider_bootstrap_syncs_existing_bootstrap_provider(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        default_provider_name="GLM Bootstrap",
        default_provider_format="openai",
        default_provider_base_url="https://provider.example.com",
        default_provider_api_key="secret-token",
        default_provider_model="gpt-4o-mini",
    )
    session = _FakeSession()
    updated_payloads: list[tuple[str, object]] = []

    async def run() -> None:
        user_setting = SimpleNamespace(provider_config_hash="stale-hash")
        bootstrap_provider = SimpleNamespace(id="provider-1", version=3)

        async def fake_find_user_setting(current_session, user_id):
            return user_setting

        async def fake_list_providers_for_user(current_session, user_id):
            return [bootstrap_provider]

        async def fake_find_bootstrap_provider_for_user(current_session, user_id):
            return bootstrap_provider

        async def fake_update_provider_service(current_session, user_id, provider_id, payload):
            updated_payloads.append((provider_id, payload))
            return SimpleNamespace(id=provider_id)

        monkeypatch.setattr(provider_bootstrap, "find_user_setting", fake_find_user_setting)
        monkeypatch.setattr(provider_bootstrap, "list_providers_for_user", fake_list_providers_for_user)
        monkeypatch.setattr(
            provider_bootstrap,
            "find_bootstrap_provider_for_user",
            fake_find_bootstrap_provider_for_user,
        )
        monkeypatch.setattr(provider_bootstrap, "update_provider_service", fake_update_provider_service)

        await provider_bootstrap.ensure_user_provider_bootstrap(
            session,
            "00000000-0000-0000-0000-000000000001",
            settings,
        )

        assert len(updated_payloads) == 1
        assert updated_payloads[0][0] == "provider-1"
        assert updated_payloads[0][1].version == 3
        assert user_setting.provider_config_hash == provider_bootstrap.compute_provider_config_hash(
            settings.default_provider_base_url,
            settings.default_provider_api_key,
            settings.default_provider_model,
        )
        assert session.commit_count == 1

    asyncio.run(run())
