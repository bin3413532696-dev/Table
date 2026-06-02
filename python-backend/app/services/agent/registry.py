from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.agent import AgentProviderCapabilityDto, AgentToolCapabilityDto
from app.services.agent._constants import AgentModelRuntimeConfig

logger = logging.getLogger("table-python-backend.agent.registry")

ProviderResolveFn = Callable[[Any], Awaitable[AgentModelRuntimeConfig]]
ProviderStreamFn = Callable[[AgentModelRuntimeConfig, list[dict[str, str]]], Awaitable[Any]]
ToolEnabledFn = Callable[["AgentToolAvailabilityContext"], bool]
ToolExecuteFn = Callable[["AgentToolExecutionContext", dict[str, object]], Awaitable[object]]


@dataclass(frozen=True)
class AgentProviderAdapterDefinition:
    api_format: str
    label: str
    resolve_runtime_config: ProviderResolveFn
    stream_chat_completion: Callable[..., Any]


@dataclass(frozen=True)
class AgentToolAvailabilityContext:
    rag_enabled: bool = False


@dataclass(frozen=True)
class AgentToolExecutionContext:
    session: AsyncSession
    user_id: str
    settings: Any


@dataclass(frozen=True)
class AgentToolDefinition:
    name: str
    description: str
    prompt_signature: str
    category: str
    module: str
    execute: ToolExecuteFn
    execute_after_confirmation: ToolExecuteFn | None = None
    requires_confirmation: bool = False
    enabled_when: ToolEnabledFn = lambda _context: True

    @property
    def requires_rag(self) -> bool:
        return not self.enabled_when(AgentToolAvailabilityContext(rag_enabled=False))


class AgentLifecycleHook:
    async def on_run_start(self, **_: object) -> None:
        return None

    async def before_llm(self, **_: object) -> None:
        return None

    async def after_llm(self, **_: object) -> None:
        return None

    async def before_tool(self, **_: object) -> None:
        return None

    async def after_tool(self, **_: object) -> None:
        return None

    async def on_run_end(self, **_: object) -> None:
        return None

    async def on_run_error(self, **_: object) -> None:
        return None


@dataclass
class AgentHookManager:
    hooks: list[AgentLifecycleHook] = field(default_factory=list)

    async def fire(self, hook_name: str, **payload: object) -> None:
        for hook in self.hooks:
            hook_fn = getattr(hook, hook_name, None)
            if hook_fn is None:
                continue
            try:
                await hook_fn(**payload)
            except Exception:
                logger.warning("Agent lifecycle hook failed: %s", hook_name, exc_info=True)


_PROVIDER_REGISTRY: dict[str, AgentProviderAdapterDefinition] = {}
_TOOL_REGISTRY: dict[str, AgentToolDefinition] = {}
_HOOK_MANAGER = AgentHookManager()


def register_provider_adapter(definition: AgentProviderAdapterDefinition) -> None:
    _PROVIDER_REGISTRY[definition.api_format] = definition


def get_provider_adapter(api_format: str) -> AgentProviderAdapterDefinition | None:
    return _PROVIDER_REGISTRY.get(api_format)


def list_provider_adapters() -> list[AgentProviderAdapterDefinition]:
    return [_PROVIDER_REGISTRY[key] for key in sorted(_PROVIDER_REGISTRY.keys())]


def register_tool_definition(definition: AgentToolDefinition) -> None:
    _TOOL_REGISTRY[definition.name] = definition


def get_tool_definition(name: str) -> AgentToolDefinition | None:
    return _TOOL_REGISTRY.get(name)


def list_tool_definitions(*, rag_enabled: bool | None = None) -> list[AgentToolDefinition]:
    definitions = [_TOOL_REGISTRY[key] for key in sorted(_TOOL_REGISTRY.keys())]
    if rag_enabled is None:
        return definitions
    context = AgentToolAvailabilityContext(rag_enabled=rag_enabled)
    return [definition for definition in definitions if definition.enabled_when(context)]


def list_provider_capabilities() -> list[AgentProviderCapabilityDto]:
    return [
        AgentProviderCapabilityDto(
            apiFormat=definition.api_format,  # type: ignore[arg-type]
            label=definition.label,
            enabled=True,
        )
        for definition in list_provider_adapters()
    ]


def list_tool_capabilities() -> list[AgentToolCapabilityDto]:
    return [
        AgentToolCapabilityDto(
            name=definition.name,
            description=definition.description,
            promptSignature=definition.prompt_signature,
            category=definition.category,  # type: ignore[arg-type]
            module=definition.module,
            requiresConfirmation=definition.requires_confirmation,
            requiresRag=definition.requires_rag,
            enabled=True,
        )
        for definition in list_tool_definitions()
    ]


def get_agent_hook_manager() -> AgentHookManager:
    return _HOOK_MANAGER


def register_agent_hook(hook: AgentLifecycleHook) -> None:
    _HOOK_MANAGER.hooks.append(hook)
