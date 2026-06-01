from app.services.api_urls import build_v1_api_url


def test_build_v1_api_url_appends_version_when_missing() -> None:
    assert (
        build_v1_api_url("https://api.example.com", "/chat/completions")
        == "https://api.example.com/v1/chat/completions"
    )


def test_build_v1_api_url_reuses_existing_version_prefix() -> None:
    assert (
        build_v1_api_url("https://api.example.com/v1", "/chat/completions")
        == "https://api.example.com/v1/chat/completions"
    )
