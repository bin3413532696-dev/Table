def build_v1_api_url(base_url: str, resource_path: str) -> str:
    normalized_base_url = base_url.strip().rstrip("/")
    normalized_resource_path = resource_path if resource_path.startswith("/") else f"/{resource_path}"
    if normalized_base_url.endswith("/v1"):
        return f"{normalized_base_url}{normalized_resource_path}"
    return f"{normalized_base_url}/v1{normalized_resource_path}"
