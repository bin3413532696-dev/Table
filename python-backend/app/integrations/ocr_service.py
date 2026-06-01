from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx


@dataclass(frozen=True)
class OCRServiceSettings:
    service_url: str
    enabled: bool
    timeout_ms: int


class OCRServiceClient:
    def __init__(self, settings: OCRServiceSettings) -> None:
        self._settings = settings

    async def is_available(self) -> bool:
        if not self._settings.enabled:
            return False

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self._settings.service_url}/health")
                response.raise_for_status()
                payload = response.json()
                return payload.get("status") == "healthy"
        except Exception:
            return False

    async def process_pdf(self, file_path: str) -> dict[str, Any]:
        if not self._settings.enabled:
            raise RuntimeError("OCR service is disabled")

        path = Path(file_path)
        async with httpx.AsyncClient(timeout=self._settings.timeout_ms / 1000) as client:
            with path.open("rb") as handle:
                response = await client.post(
                    f"{self._settings.service_url}/ocr/process",
                    files={"file": (path.name, handle, "application/pdf")},
                )
            response.raise_for_status()
            return response.json()
