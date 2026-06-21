from fastapi import APIRouter

from app.api.constants import HEALTH_ROUTE_PREFIX

router = APIRouter(prefix=HEALTH_ROUTE_PREFIX)


@router.get("")
async def health_check() -> dict[str, str]:
    return {"status": "healthy", "service": "table-python-backend"}
