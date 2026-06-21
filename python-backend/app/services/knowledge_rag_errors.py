from app.db.models import KnowledgeIndexJob


class IndexJobActiveError(RuntimeError):
    def __init__(self, job: KnowledgeIndexJob):
        self.job = job
        self.detail = {
            "code": "index_job_active",
            "documentId": str(job.document_id) if job.document_id else None,
            "jobId": str(job.id),
            "jobStatus": job.status or "pending",
            "message": "An indexing job is already active for this document.",
        }
        super().__init__(self.detail["message"])


class DocumentQualityError(Exception):
    """PDF 文本层质量未达预检阈值，应拒绝入库。"""

    def __init__(self, *, reason: str, metrics: dict, threshold: float):
        self.reason = reason
        self.metrics = metrics
        self.threshold = threshold
        self.detail = {
            "error": "DOCUMENT_QUALITY_INSUFFICIENT",
            "message": "该文档质量不达标，请检查后重新上传",
            "reason": reason,
            "metrics": metrics,
            "threshold": threshold,
        }
        super().__init__(reason)
