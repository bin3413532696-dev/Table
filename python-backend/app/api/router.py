from app.api.routes.auth import router as auth_router
from app.api.routes.agent import router as agent_router
from app.api.routes.finance import router as finance_router
from app.api.routes.health import router as health_router
from app.api.routes.knowledge import router as knowledge_router
from app.api.routes.knowledge_rag import router as knowledge_rag_router
from app.api.routes.maintenance import router as maintenance_router
from app.api.routes.providers import router as providers_router
from app.api.routes.tasks import router as tasks_router
from fastapi import APIRouter

api_router = APIRouter()
api_router.include_router(health_router, prefix="/api/health", tags=["health"])
api_router.include_router(auth_router, prefix="/api", tags=["auth"])
api_router.include_router(tasks_router, prefix="/api/tasks", tags=["tasks"])
api_router.include_router(finance_router, prefix="/api/finance", tags=["finance"])
api_router.include_router(knowledge_router, prefix="/api", tags=["knowledge"])
api_router.include_router(knowledge_rag_router, prefix="/api", tags=["knowledge-rag"])
api_router.include_router(maintenance_router, prefix="/api", tags=["maintenance"])
api_router.include_router(providers_router, prefix="/api", tags=["providers"])
api_router.include_router(agent_router, prefix="/api", tags=["agent"])
