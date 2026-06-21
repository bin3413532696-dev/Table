from __future__ import annotations

from app.core.config import Settings
from app.services.knowledge_rag_collaborators import RunIndexingPipelineTaskCollaborators


async def run_indexing_pipeline_task(
    *,
    user_id: str,
    document_id: str,
    job_id: str,
    file_type: str | None,
    settings: Settings,
    collaborators: RunIndexingPipelineTaskCollaborators,
) -> None:
    async with collaborators.session_local() as session:
        try:
            document = await collaborators.find_document_by_id(session, user_id, document_id)
            job = await collaborators.find_job_by_id(session, user_id, job_id)
            if not document or not job:
                return

            content, resolved_file_type = await collaborators.load_document_content_for_indexing(
                session,
                user_id,
                document,
                settings=settings,
            )

            if "[IMAGE:" in content:
                try:
                    content = await collaborators.describe_images_and_replace_placeholders(
                        session=session,
                        user_id=user_id,
                        document_id=document_id,
                        content=content,
                        settings=settings,
                    )
                    await collaborators.update_document(session, user_id, document_id, {"content": content})
                    await session.commit()
                except Exception as exc:
                    collaborators.logger.warning(
                        "Image description phase failed (continuing with placeholders): %s",
                        exc,
                    )

            await collaborators.execute_indexing_pipeline(
                session,
                user_id,
                document=document,
                job=job,
                content=content,
                file_type=file_type or resolved_file_type,
                settings=settings,
            )
        except Exception as exc:
            try:
                await collaborators.update_document(session, user_id, document_id, {"status": "failed"})
                await collaborators.update_job_status(
                    session,
                    user_id,
                    job_id,
                    status="failed",
                    error={"message": f"pipeline task crashed: {exc}"},
                )
                await session.commit()
            except Exception:
                pass
