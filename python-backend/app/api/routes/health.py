from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def health_check() -> dict[str, str]:
    return {"status": "healthy", "service": "table-python-backend"}
