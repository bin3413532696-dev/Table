import { createFinanceRecord } from '../finance/repository';
import { toFinanceRecordDto } from '../finance/dto';
import { searchNotes } from '../knowledge/repository';
import { createTask, findTaskById, softDeleteTask, updateTask } from '../tasks/repository';
import { listFinanceRecords } from '../finance/repository';
import { listTasks } from '../tasks/repository';
import { toTaskDto } from '../tasks/dto';
import type {
  AgentProviderInput,
  CreateAgentRunInput,
} from './schema';

type AgentRole = 'system' | 'user' | 'assistant';

type AgentConversationMessage = {
  role: AgentRole;
  content: string;
};

type ToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

type ExecutedToolCall = ToolCall & {
  result: unknown;
};

type ToolDefinition = {
  requiresConfirmation: boolean;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};

const MAX_AGENT_EXECUTION_ITERATIONS = 5;

export interface PendingConfirmationSnapshot {
  kind: 'pending_confirmation';
  model: string;
  inputText: string;
  initialMessages: Array<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    metadata?: Record<string, unknown>;
  }>;
  assistantText: string;
  executedToolCalls: ExecutedToolCall[];
  remainingToolCalls: ToolCall[];
}

export type AgentExecutionOutcome =
  | {
      status: 'completed';
      finalText: string;
      toolCalls: ExecutedToolCall[];
    }
  | {
      status: 'waiting_confirmation';
      interimText: string;
      executedToolCalls: ExecutedToolCall[];
      pendingToolCall: ToolCall;
      confirmationMessage: string;
      snapshot: PendingConfirmationSnapshot;
    };

const TOOL_FORMAT = `当需要使用工具时，请按以下 JSON 格式输出：
\`\`\`tool
{"name": "工具名", "arguments": {"参数名": "参数值"}}
\`\`\`

注意：
- name 必须是可用工具列表中的确切名称
- arguments 必须是有效的 JSON 对象
- 多个工具调用请分别输出多个 tool 块`;

const SYSTEM_PROMPT = `你是这个个人工作站应用的后端智能助手执行器。你可以帮助用户：
- 查询和汇总任务
- 查询和汇总财务记录
- 搜索知识库笔记
- 创建任务
- 新增财务记录
- 做跨模块摘要

当前允许调用以下工具：
- query_tasks: 查询任务列表，参数可用 completed(boolean)、priority(string)、limit(number)
- get_task_stats: 获取任务汇总统计，无参数
- query_finance: 查询财务记录，参数可用 type('income'|'expense'|'all')、category(string)、startDate(string)、endDate(string)、limit(number)
- get_finance_stats: 获取财务汇总统计，无参数
- search_knowledge: 搜索知识库笔记，参数可用 query(string)、tags(string[])、limit(number)
- create_task: 创建任务，参数可用 title(string, 必填)、priority(string)、dueDate(string)
- add_finance_record: 新增财务记录，参数可用 type(string, 必填)、amount(number, 必填)、description(string, 必填)、category(string, 必填)、date(string, 必填)、model(string)
- update_task: 更新任务，参数可用 id(string, 必填)、title(string)、completed(boolean)、priority(string)、dueDate(string)
- delete_task: 删除任务，参数可用 id(string, 必填)

${TOOL_FORMAT}

规则：
1. 查询类请求可以直接调用工具。
2. create_task、add_finance_record 属于写操作，必须通过工具调用，由系统确认后再执行。
3. 如果直接回答更合适，可以不调用工具。
4. 如果缺少必要参数，先自然语言说明，不要猜测。
5. 最终回复默认使用简体中文，简洁直接。
6. 工具结果返回后，最终回答必须严格基于结果，不能编造。`;

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, '');
}

function buildProviderHeaders(provider: AgentProviderInput): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(provider.headers || {}),
    ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
  };
}

function getProviderChatUrl(provider: AgentProviderInput): string {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);

  switch (provider.apiFormat) {
    case 'anthropic':
      return `${baseUrl}/messages`;
    case 'gemini':
      return `${baseUrl}/models/${provider.model || 'gemini-pro'}:generateContent`;
    case 'openai':
    case 'custom':
    default:
      return `${baseUrl}/chat/completions`;
  }
}

function buildProviderRequestBody(
  provider: AgentProviderInput,
  messages: AgentConversationMessage[],
  model: string
): Record<string, unknown> {
  switch (provider.apiFormat) {
    case 'anthropic':
      return {
        model,
        max_tokens: 4096,
        stream: false,
        messages: messages
          .filter((message) => message.role !== 'system')
          .map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.content,
          })),
        system: messages.find((message) => message.role === 'system')?.content,
      };
    case 'gemini':
      return {
        contents: messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          maxOutputTokens: 4096,
        },
      };
    case 'openai':
    case 'custom':
    default:
      return {
        model,
        messages,
        stream: false,
      };
  }
}

function extractTextFromPayload(provider: AgentProviderInput, payload: any): string {
  switch (provider.apiFormat) {
    case 'anthropic':
      if (Array.isArray(payload?.content)) {
        return payload.content
          .map((item: any) => item?.text || '')
          .join('');
      }
      return '';
    case 'gemini':
      return payload?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || '').join('') || '';
    case 'openai':
    case 'custom':
    default:
      return payload?.choices?.[0]?.message?.content || '';
  }
}

function extractInlineToolJson(content: string): string[] {
  const candidates: string[] = [];
  let searchStart = 0;

  while (searchStart < content.length) {
    const nameIndex = content.indexOf('"name"', searchStart);
    if (nameIndex === -1) {
      break;
    }

    const start = content.lastIndexOf('{', nameIndex);
    if (start === -1) {
      break;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let index = start; index < content.length; index += 1) {
      const char = content[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) {
        continue;
      }
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }

    if (end === -1) {
      break;
    }

    const candidate = content.slice(start, end + 1).trim();
    if (candidate.includes('"arguments"')) {
      candidates.push(candidate);
    }
    searchStart = end + 1;
  }

  return candidates;
}

function parseToolCalls(content: string): { textContent: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  const toolBlockRegex = /```tool\s*\n?([\s\S]*?)```/g;
  const jsonBlockRegex = /```json\s*\n?([\s\S]*?)```/g;

  let match: RegExpExecArray | null;
  while ((match = toolBlockRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.name && typeof parsed.name === 'string') {
        toolCalls.push({
          name: parsed.name,
          arguments: parsed.arguments || {},
        });
      }
    } catch {
      // ignore
    }
  }

  while ((match = jsonBlockRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.name && typeof parsed.name === 'string' && parsed.arguments) {
        toolCalls.push({
          name: parsed.name,
          arguments: parsed.arguments,
        });
      }
    } catch {
      // ignore
    }
  }

  for (const candidate of extractInlineToolJson(content)) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed.name && typeof parsed.name === 'string') {
        toolCalls.push({
          name: parsed.name,
          arguments: parsed.arguments || {},
        });
      }
    } catch {
      // ignore
    }
  }

  const seen = new Set<string>();
  const uniqueToolCalls = toolCalls.filter((toolCall) => {
    const key = `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  const textContent = content
    .replace(toolBlockRegex, '')
    .replace(jsonBlockRegex, '')
    .replace(/\{"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g, '')
    .trim();

  return { textContent, toolCalls: uniqueToolCalls };
}

async function queryTasksTool(args: Record<string, unknown>) {
  const tasks = await listTasks();
  const completed = typeof args.completed === 'boolean' ? args.completed : undefined;
  const priority = typeof args.priority === 'string' ? args.priority : undefined;
  const limit = typeof args.limit === 'number' ? args.limit : 20;

  return tasks
    .filter((task) => completed === undefined || task.completed === completed)
    .filter((task) => !priority || task.priority === priority)
    .slice(0, limit)
    .map(toTaskDto);
}

async function getTaskStatsTool() {
  const tasks = await listTasks();
  const completed = tasks.filter((task) => task.completed).length;
  const overdue = tasks.filter((task) => {
    if (!task.dueDate || task.completed) {
      return false;
    }
    return task.dueDate.getTime() < Date.now();
  }).length;

  return {
    total: tasks.length,
    completed,
    pending: tasks.length - completed,
    overdue,
  };
}

async function queryFinanceTool(args: Record<string, unknown>) {
  const records = await listFinanceRecords();
  const type = typeof args.type === 'string' ? args.type : 'all';
  const category = typeof args.category === 'string' ? args.category : undefined;
  const startDate = typeof args.startDate === 'string' ? args.startDate : undefined;
  const endDate = typeof args.endDate === 'string' ? args.endDate : undefined;
  const limit = typeof args.limit === 'number' ? args.limit : 20;

  return records
    .filter((record) => type === 'all' || record.type === type)
    .filter((record) => !category || record.category === category)
    .filter((record) => !startDate || record.recordDate.toISOString().slice(0, 10) >= startDate)
    .filter((record) => !endDate || record.recordDate.toISOString().slice(0, 10) <= endDate)
    .slice(0, limit)
    .map(toFinanceRecordDto);
}

async function getFinanceStatsTool() {
  const records = await listFinanceRecords();
  const income = records
    .filter((record) => record.type === 'income')
    .reduce((sum, record) => sum + Number(record.amount), 0);
  const expense = records
    .filter((record) => record.type === 'expense')
    .reduce((sum, record) => sum + Number(record.amount), 0);

  return {
    total: records.length,
    income,
    expense,
    balance: income - expense,
  };
}

async function searchKnowledgeTool(args: Record<string, unknown>) {
  return searchNotes({
    query: typeof args.query === 'string' ? args.query : '',
    tags: Array.isArray(args.tags)
      ? args.tags.filter((item): item is string => typeof item === 'string')
      : undefined,
    limit: typeof args.limit === 'number' ? args.limit : 8,
    offset: 0,
  });
}

async function createTaskTool(args: Record<string, unknown>) {
  if (typeof args.title !== 'string' || !args.title.trim()) {
    throw new Error('create_task 缺少必填参数 title');
  }

  const task = await createTask({
    title: args.title.trim(),
    completed: false,
    priority:
      args.priority === 'low' || args.priority === 'medium' || args.priority === 'high'
        ? args.priority
        : 'medium',
    dueDate: typeof args.dueDate === 'string' ? args.dueDate : undefined,
    notes: undefined,
  });

  return toTaskDto(task);
}

async function addFinanceRecordTool(args: Record<string, unknown>) {
  if (
    (args.type !== 'income' && args.type !== 'expense') ||
    typeof args.amount !== 'number' ||
    typeof args.description !== 'string' ||
    typeof args.category !== 'string' ||
    typeof args.date !== 'string'
  ) {
    throw new Error('add_finance_record 缺少必填参数或参数格式错误');
  }

  const record = await createFinanceRecord({
    type: args.type,
    amount: args.amount,
    description: args.description,
    category: args.category,
    date: args.date,
    model: typeof args.model === 'string' ? args.model : undefined,
  });

  return toFinanceRecordDto(record);
}

async function updateTaskTool(args: Record<string, unknown>) {
  if (typeof args.id !== 'string' || !args.id.trim()) {
    throw new Error('update_task 缺少必填参数 id');
  }

  const existing = await findTaskById(args.id);
  if (!existing) {
    throw new Error(`未找到任务: ${args.id}`);
  }

  const updated = await updateTask(args.id, {
    ...(typeof args.title === 'string' ? { title: args.title } : {}),
    ...(args.completed !== undefined && typeof args.completed === 'boolean'
      ? { completed: args.completed }
      : {}),
    ...(args.priority === 'low' || args.priority === 'medium' || args.priority === 'high'
      ? { priority: args.priority }
      : {}),
    ...(typeof args.dueDate === 'string' ? { dueDate: args.dueDate } : {}),
  });

  return toTaskDto(updated);
}

async function deleteTaskTool(args: Record<string, unknown>) {
  if (typeof args.id !== 'string' || !args.id.trim()) {
    throw new Error('delete_task 缺少必填参数 id');
  }

  const existing = await findTaskById(args.id);
  if (!existing) {
    throw new Error(`未找到任务: ${args.id}`);
  }

  const deleted = await softDeleteTask(args.id);
  return {
    id: deleted.id,
    deleted: true,
  };
}

const toolRegistry: Record<string, ToolDefinition> = {
  query_tasks: {
    requiresConfirmation: false,
    execute: queryTasksTool,
  },
  get_task_stats: {
    requiresConfirmation: false,
    execute: async () => getTaskStatsTool(),
  },
  query_finance: {
    requiresConfirmation: false,
    execute: queryFinanceTool,
  },
  get_finance_stats: {
    requiresConfirmation: false,
    execute: async () => getFinanceStatsTool(),
  },
  search_knowledge: {
    requiresConfirmation: false,
    execute: searchKnowledgeTool,
  },
  create_task: {
    requiresConfirmation: true,
    execute: createTaskTool,
  },
  add_finance_record: {
    requiresConfirmation: true,
    execute: addFinanceRecordTool,
  },
  update_task: {
    requiresConfirmation: true,
    execute: updateTaskTool,
  },
  delete_task: {
    requiresConfirmation: true,
    execute: deleteTaskTool,
  },
};

async function executeToolCall(toolCall: ToolCall): Promise<ExecutedToolCall> {
  const tool = toolRegistry[toolCall.name];
  if (!tool) {
    throw new Error(`后端执行器暂不支持工具: ${toolCall.name}`);
  }

  return {
    ...toolCall,
    result: await tool.execute(toolCall.arguments),
  };
}

function getToolDefinition(toolName: string) {
  return toolRegistry[toolName];
}

async function requestProviderCompletion(
  provider: AgentProviderInput,
  messages: AgentConversationMessage[],
  model: string
) {
  const response = await fetch(getProviderChatUrl(provider), {
    method: 'POST',
    headers: buildProviderHeaders(provider),
    body: JSON.stringify(buildProviderRequestBody(provider, messages, model)),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Provider error: ${response.status} ${errorText || response.statusText}`);
  }

  const payload = await response.json();
  return extractTextFromPayload(provider, payload);
}

function buildToolFollowupPrompt(toolCalls: ExecutedToolCall[]) {
  const summaries = toolCalls
    .map((toolCall) => `工具 ${toolCall.name} 执行结果：\n${JSON.stringify(toolCall.result, null, 2)}`)
    .join('\n\n');

  return `以下是工具执行的结果：\n\n${summaries}\n\n请基于这些结果给出最终回复，不要再调用工具。`;
}

function buildNoMoreToolPrompt(toolCalls: ExecutedToolCall[]) {
  return `${buildToolFollowupPrompt(toolCalls)}\n\n如果信息已经充分，请直接给出最终答复。`;
}

function buildBaseMessages(input: CreateAgentRunInput, model: string): AgentConversationMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...input.initialMessages
      .filter((message): message is typeof message & { role: AgentRole } => message.role !== 'tool')
      .map((message) => ({
        role: message.role,
        content: message.content,
      })),
    { role: 'user', content: input.inputText },
  ];
}

async function continueExecutionLoop(input: {
  provider: AgentProviderInput;
  model: string;
  baseMessages: AgentConversationMessage[];
  inputText: string;
  initialMessages: CreateAgentRunInput['initialMessages'];
  assistantText: string;
  executedToolCalls: ExecutedToolCall[];
  remainingToolCalls: ToolCall[];
}): Promise<AgentExecutionOutcome> {
  let assistantText = input.assistantText;
  let executedToolCalls = [...input.executedToolCalls];
  let pendingToolCalls = [...input.remainingToolCalls];

  for (let iteration = 0; iteration < MAX_AGENT_EXECUTION_ITERATIONS; iteration += 1) {
    if (pendingToolCalls.length === 0) {
      const response = await requestProviderCompletion(
        input.provider,
        [
          ...input.baseMessages,
          ...(assistantText ? [{ role: 'assistant' as const, content: assistantText }] : []),
          { role: 'user', content: buildNoMoreToolPrompt(executedToolCalls) },
        ],
        input.model
      );

      const parsed = parseToolCalls(response);
      assistantText = parsed.textContent || response;
      pendingToolCalls = parsed.toolCalls;

      if (pendingToolCalls.length === 0) {
        return {
          status: 'completed',
          finalText: assistantText,
          toolCalls: executedToolCalls,
        };
      }
    }

    for (let index = 0; index < pendingToolCalls.length; index += 1) {
      const toolCall = pendingToolCalls[index];
      const toolDefinition = getToolDefinition(toolCall.name);
      if (!toolDefinition) {
        throw new Error(`后端执行器暂不支持工具: ${toolCall.name}`);
      }

      if (toolDefinition.requiresConfirmation) {
        const confirmationMessage = `即将执行 ${toolCall.name}，参数如下：\n${JSON.stringify(toolCall.arguments, null, 2)}`;
        return {
          status: 'waiting_confirmation',
          interimText: assistantText || confirmationMessage,
          executedToolCalls,
          pendingToolCall: toolCall,
          confirmationMessage,
          snapshot: {
            kind: 'pending_confirmation',
            model: input.model,
            inputText: input.inputText,
            initialMessages: input.initialMessages,
            assistantText,
            executedToolCalls,
            remainingToolCalls: pendingToolCalls.slice(index + 1),
          },
        };
      }

      executedToolCalls.push(await executeToolCall(toolCall));
    }

    pendingToolCalls = [];
  }

  return {
    status: 'completed',
    finalText: assistantText,
    toolCalls: executedToolCalls,
  };
}

export async function executeAgentRun(input: CreateAgentRunInput): Promise<AgentExecutionOutcome> {
  const provider = input.provider;
  if (!provider) {
    throw new Error('缺少激活的 Provider 配置，暂时无法由后端执行智能体。');
  }

  const model = input.model === 'default' ? (provider.model || 'default') : input.model;
  const baseMessages = buildBaseMessages(input, model);

  const firstResponse = await requestProviderCompletion(provider, baseMessages, model);
  const firstParsed = parseToolCalls(firstResponse);

  if (firstParsed.toolCalls.length === 0) {
    return {
      status: 'completed',
      finalText: firstParsed.textContent || firstResponse,
      toolCalls: [],
    };
  }

  return continueExecutionLoop({
    provider,
    model,
    baseMessages,
    inputText: input.inputText,
    initialMessages: input.initialMessages,
    assistantText: firstParsed.textContent || '',
    executedToolCalls: [],
    remainingToolCalls: firstParsed.toolCalls,
  });
}

export async function confirmAgentRunToolExecution(input: {
  provider: AgentProviderInput;
  snapshot: PendingConfirmationSnapshot;
  pendingToolCall: ToolCall;
}): Promise<
  | {
      status: 'completed';
      confirmedToolCall: ExecutedToolCall;
      finalText: string;
      toolCalls: ExecutedToolCall[];
    }
  | {
      status: 'waiting_confirmation';
      confirmedToolCall: ExecutedToolCall;
      interimText: string;
      executedToolCalls: ExecutedToolCall[];
      pendingToolCall: ToolCall;
      confirmationMessage: string;
      snapshot: PendingConfirmationSnapshot;
    }
> {
  const confirmedToolCall = await executeToolCall(input.pendingToolCall);
  const result = await continueExecutionLoop({
    provider: input.provider,
    model: input.snapshot.model,
    baseMessages: buildBaseMessages(
      {
        inputText: input.snapshot.inputText,
        model: input.snapshot.model,
        provider: input.provider,
        sessionId: undefined,
        initialMessages: input.snapshot.initialMessages,
      },
      input.snapshot.model
    ),
    inputText: input.snapshot.inputText,
    initialMessages: input.snapshot.initialMessages,
    assistantText: input.snapshot.assistantText,
    executedToolCalls: [
      ...input.snapshot.executedToolCalls,
      confirmedToolCall,
    ],
    remainingToolCalls: input.snapshot.remainingToolCalls,
  });

  if (result.status === 'waiting_confirmation') {
    return {
      status: 'waiting_confirmation',
      confirmedToolCall,
      interimText: result.interimText,
      executedToolCalls: result.executedToolCalls,
      pendingToolCall: result.pendingToolCall,
      confirmationMessage: result.confirmationMessage,
      snapshot: result.snapshot,
    };
  }

  return {
    status: 'completed',
    confirmedToolCall,
    finalText: result.finalText,
    toolCalls: result.toolCalls,
  };
}