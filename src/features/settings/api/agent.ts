import {
  fetchAgentCapabilities,
  fetchAgentPersona,
  type AgentCapabilitiesDto,
  type AgentPersonaDto,
  updateAgentPersona,
} from '../../agent/public';
import { isRecord, readArrayField, readStringField } from '../../../shared/api/guards';

export interface ProviderModelOption {
  name: string;
  label: string;
}

export const PERSONA_TEMPLATES = [
  {
    name: '默认',
    prompt:
      '你是个人工作站智能助手。可用工具：\n\n查询工具（可直接调用）：\n- query_tasks(completed?, priority?, limit?) - 查询任务\n- get_task_stats() - 任务统计\n- query_finance(type?, category?, startDate?, endDate?, limit?) - 查询财务\n- get_finance_stats() - 财务统计\n- search_knowledge(query?, tags?, limit?) - 搜索知识库\n\n写操作工具（需用户确认）：\n- create_task(title!, priority?, dueDate?) - 创建任务\n- add_finance_record(type!, amount!, description!, category!, date!) - 新增财务\n- update_task(id!, title?, completed?, priority?, dueDate?) - 更新任务\n- delete_task(id!) - 删除任务\n\n规则：\n1. 查询直接执行，写操作需确认\n2. 缺参数时询问用户，勿猜测\n3. 用简体中文回复，简洁直接\n4. 结果基于工具返回，勿编造',
  },
  {
    name: '专业助手',
    prompt:
      '你是一个专业、严谨的技术助手。回复时保持结构化、逻辑清晰，提供详细的技术细节和最佳实践建议。使用简体中文，必要时提供代码示例。可用工具请参考系统默认配置。',
  },
  {
    name: '亲切伙伴',
    prompt:
      '你是一个温和、友好的助手，以鼓励性和支持性的语气与用户交流。对于新手用户，耐心解释每个步骤，避免使用过于技术性的术语。使用简体中文回复。',
  },
  {
    name: '极简模式',
    prompt:
      '你是高效助手。只返回核心结果，不提供额外解释。回复控制在 100 字以内。除非用户明确询问详情，否则直接给出答案。使用简体中文。',
  },
] as const;

export async function loadAgentCapabilities(): Promise<AgentCapabilitiesDto> {
  return await fetchAgentCapabilities();
}

export async function loadAgentPersona(): Promise<AgentPersonaDto> {
  return await fetchAgentPersona();
}

export async function saveAgentPersona(systemPrompt: string): Promise<AgentPersonaDto> {
  return await updateAgentPersona(systemPrompt);
}

export function parseProviderModelOptions(
  payload: unknown,
  apiFormat: 'anthropic' | 'openai' | 'gemini' | 'custom'
): ProviderModelOption[] {
  if (!isRecord(payload)) {
    return [];
  }

  if (apiFormat === 'openai' || apiFormat === 'custom') {
    const data = readArrayField(payload, 'data') || [];
    return data
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }
        const id = readStringField(item, 'id');
        if (!id) {
          return null;
        }
        return {
          name: id,
          label: readStringField(item, 'name') || id,
        };
      })
      .filter((item): item is ProviderModelOption => item !== null);
  }

  if (apiFormat === 'gemini') {
    const models = readArrayField(payload, 'models') || [];
    return models
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }
        const rawName = readStringField(item, 'name');
        if (!rawName) {
          return null;
        }
        const normalized = rawName.replace('models/', '');
        return {
          name: normalized,
          label: readStringField(item, 'displayName') || normalized,
        };
      })
      .filter((item): item is ProviderModelOption => item !== null);
  }

  return [];
}
