from __future__ import annotations

import io
import importlib.util
import sys
from types import ModuleType
from pathlib import Path

from fastapi.testclient import TestClient
from pymupdf import Document

MODULE_PATH = Path(__file__).resolve().parents[1] / "main.py"


def _load_ocr_main():
    fake_paddleocr = ModuleType("paddleocr")

    class _FakePPStructure:
        def __init__(self, *args, **kwargs) -> None:
            self.args = args
            self.kwargs = kwargs

        def __call__(self, image_bytes: bytes):
            return []

    fake_paddleocr.PPStructure = _FakePPStructure
    previous = sys.modules.get("paddleocr")
    sys.modules["paddleocr"] = fake_paddleocr

    try:
        spec = importlib.util.spec_from_file_location("table_ocr_service_main", MODULE_PATH)
        assert spec is not None
        assert spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            sys.modules.pop("paddleocr", None)
        else:
            sys.modules["paddleocr"] = previous


def _build_pdf_bytes() -> bytes:
    doc = Document()
    page = doc.new_page()
    page.insert_text((72, 72), "hello table")
    return doc.tobytes()


def test_health_endpoint_is_available() -> None:
    ocr_main = _load_ocr_main()
    client = TestClient(ocr_main.app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "healthy", "service": "ocr-service"}


def test_process_document_rejects_non_pdf_upload() -> None:
    ocr_main = _load_ocr_main()
    client = TestClient(ocr_main.app)

    response = client.post(
        "/ocr/process",
        files={"file": ("note.txt", io.BytesIO(b"hello"), "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Only PDF files are supported"


def test_process_document_returns_structured_payload(monkeypatch) -> None:
    ocr_main = _load_ocr_main()
    client = TestClient(ocr_main.app)

    def fake_process_image(image_bytes: bytes, page_num: int):
        assert image_bytes
        return (
            [
                ocr_main.TextBlock(
                    content="hello table",
                    type="paragraph",
                    page=page_num,
                    bbox=[0, 0, 10, 10],
                    confidence=0.99,
                )
            ],
            [],
        )

    monkeypatch.setattr(ocr_main, "process_image", fake_process_image)

    response = client.post(
        "/ocr/process",
        files={"file": ("sample.pdf", io.BytesIO(_build_pdf_bytes()), "application/pdf")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["text_blocks"][0]["content"] == "hello table"
    assert payload["text_blocks"][0]["page"] == 1
    assert payload["tables"] == []
    assert payload["metadata"]["page_count"] == 1
    assert payload["metadata"]["has_ocr"] is True
