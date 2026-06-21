from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, StringConstraints, model_validator

AuthSource = Literal["default", "header", "signed_session", "missing"]
TrimmedDisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
TrimmedBio = Annotated[str, StringConstraints(max_length=200)]
PinString = Annotated[str, StringConstraints(pattern=r"^\d{4,6}$")]


class AuthUserDto(BaseModel):
    id: str
    displayName: str
    email: str | None
    status: str
    bio: str
    createdAt: str
    updatedAt: str


class AuthInfoDto(BaseModel):
    userIdHeader: str
    source: AuthSource
    isDefaultUser: bool
    devSessionCookie: str


class AuthMeData(BaseModel):
    user: AuthUserDto
    auth: AuthInfoDto


class AuthMeResponse(BaseModel):
    data: AuthMeData


class AuthUserListItem(AuthUserDto):
    isCurrentUser: bool


class AuthUserListData(BaseModel):
    items: list[AuthUserListItem]
    total: int


class AuthUserListResponse(BaseModel):
    data: AuthUserListData


class AuthCreateUserData(BaseModel):
    user: AuthUserDto


class AuthCreateUserResponse(BaseModel):
    data: AuthCreateUserData


class CreateAuthUserRequest(BaseModel):
    id: UUID | None = None
    displayName: TrimmedDisplayName
    email: str | None = None
    bio: TrimmedBio | None = None


class UpdateAuthMeRequest(BaseModel):
    displayName: TrimmedDisplayName | None = None
    email: str | None = None
    bio: TrimmedBio | None = None

    @model_validator(mode="after")
    def ensure_mutation_fields(self) -> "UpdateAuthMeRequest":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided")
        return self


class SwitchSessionRequest(BaseModel):
    userId: UUID


class PinStatusResponse(BaseModel):
    enabled: bool


class VerifyPinRequest(BaseModel):
    pin: PinString


class VerifyPinResponse(BaseModel):
    valid: bool


class UpdatePinRequest(BaseModel):
    pin: PinString


class SuccessResponse(BaseModel):
    success: bool
