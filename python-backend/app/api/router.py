from fastapi import APIRouter

from app.api.constants import API_ROOT_PREFIX
from app.api.routes.agent import router as agent_router
from app.api.routes.auth import router as auth_router
from app.api.routes.finance import router as finance_router
from app.api.routes.health import router as health_router
from app.api.routes.knowledge import router as knowledge_router
from app.api.routes.knowledge_rag import router as knowledge_rag_router
from app.api.routes.maintenance import router as maintenance_router
from app.api.routes.providers import router as providers_router
from app.api.routes.tasks import router as tasks_router

api_router = APIRouter(prefix=API_ROOT_PREFIX)
api_router.include_router(health_router, tags=["health"])
api_router.include_router(auth_router, tags=["auth"])
api_router.include_router(tasks_router, tags=["tasks"])
api_router.include_router(finance_router, tags=["finance"])
api_router.include_router(knowledge_router, tags=["knowledge"])
api_router.include_router(knowledge_rag_router, tags=["knowledge-rag"])
api_router.include_router(maintenance_router, tags=["maintenance"])
api_router.include_router(providers_router, tags=["providers"])
api_router.include_router(agent_router, tags=["agent"])
