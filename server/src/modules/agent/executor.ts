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
import type { AgentRunStreamEvent } from './service';

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

export type StreamEventEmitter = (event: AgentRunStreamEvent) => Promise<void> | void;

const MAX_AGENT_EXECUTION_ITERATIONS = Number(process.env.MAX_AGENT_ITERATIONS) || 5;
const FETCH_TIMEOUT_MS = 120_000;

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

const TOOL_FORMAT = `工具调用格式：
\`\`\`tool
{"name": "工具名", "arguments": {"参数": "值"}}
\`\`\``;

const QUERY_TOOLS_DESC = `查询工具（可直接调用）：
- query_tasks(completed?, priority?, limit?) - 查询任务
- get_task_stats() - 任务统计
- query_finance(type?, category?, startDate?, endDate?, limit?) - 查询财务
- get_finance_stats() - 务统计
- search_knowledge(query?, tags?, limit?) - 搜索知识库`;

const WRITE_TOOLS_DESC = `写操作工具（需用户确认）：
- create_task(title!, priority?, dueDate?) - 创建任务
- add_finance_record(type!, amount!, description!, category!, date!) - 新增财务
- update_task(id!, title?, completed?, priority?, dueDate?) - 更新任务
- delete_task(id!) - 删除任务`;

const SYSTEM_PROMPT = `你是个人工作站智能助手。可用工具：

${QUERY_TOOLS_DESC}
${WRITE_TOOLS_DESC}

${TOOL_FORMAT}

规则：
1. 查询直接执行，写操作需确认
2. 缺参数时询问用户，勿猜测
3. 用简体中文回复，简洁直接
4. 结果基于工具返回，勿编造`;

/**
 * 验证 Provider baseUrl，防止 SSRF 和 API Key 外泄
 * - 仅允许 HTTPS 协议
 * - 阻止内网 IP 和云元数据地址
 */
function validateProviderUrl(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Provider baseUrl 格式无效: ${baseUrl}`);
  }

  // 仅允许 HTTPS 协议
  if (url.protocol !== 'https:') {
    throw new Error(`Provider baseUrl 必须使用 HTTPS 协议，当前为: ${url.protocol}`);
  }

  const hostname = url.hostname.toLowerCase();

  // 阻止 localhost
  if (hostname === 'localhost' || hostname === 'localhost.localdomain') {
    throw new Error('Provider baseUrl 不允许指向 localhost');
  }

  // 阻止云元数据地址（AWS/GCP/Azure）
  if (hostname === '169.254.169.254') {
    throw new Error('Provider baseUrl 不允许指向云元数据地址');
  }

  // 阻止内网 IP 段
  const privateIpPatterns = [
    /^10\.\d+\.\d+\.\d+$/,                          // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+$/,      // 172.16.0.0/12
    /^192\.168\.\d+\.\d+$/,                          // 192.168.0.0/16
    /^127\.\d+\.\d+\.\d+$/,                          // 127.0.0.0/8 (loopback)
    /^0\.0\.0\.0$/,                                  // 0.0.0.0
    /^::1$/,                                         // IPv6 loopback
    /^fc00:\/\//i,                                   // IPv6 private
    /^fe80:\/\//i,                                   // IPv6 link-local
  ];

  for (const pattern of privateIpPatterns) {
    if (pattern.test(hostname)) {
      throw new Error(`Provider baseUrl 不允许指向内网地址: ${hostname}`);
    }
  }
}

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
  // 验证 baseUrl 防止 SSRF
  validateProviderUrl(provider.baseUrl);

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
    } catch (error) {
      console.error('[Agent] Failed to parse tool block:', error);
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
    } catch (error) {
      console.error('[Agent] Failed to parse JSON tool block:', error);
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
    } catch (error) {
      console.error('[Agent] Failed to parse inline tool JSON:', error);
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
    version: existing.version,
  });

  if (!updated) {
    throw new Error(`任务已被其他请求修改: ${args.id}`);
  }

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

// 查询类工具缓存（5秒有效期，减少重复查询）
const queryCache = new Map<string, { result: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 5000;

function getCacheKey(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}:${JSON.stringify(args)}`;
}

function getCachedResult(toolName: string, args: Record<string, unknown>): unknown | null {
  const key = getCacheKey(toolName, args);
  const cached = queryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  queryCache.delete(key);
  return null;
}

function setCachedResult(toolName: string, args: Record<string, unknown>, result: unknown): void {
  const now = Date.now();
  for (const [key, entry] of queryCache) {
    if (entry.expiresAt <= now) {
      queryCache.delete(key);
    }
  }

  const key = getCacheKey(toolName, args);
  queryCache.set(key, { result, expiresAt: now + CACHE_TTL_MS });
}

async function executeToolCall(toolCall: ToolCall): Promise<ExecutedToolCall> {
  const tool = toolRegistry[toolCall.name];
  if (!tool) {
    throw new Error(`后端执行器暂不支持工具: ${toolCall.name}`);
  }

  // 查询类工具使用缓存
  if (!tool.requiresConfirmation) {
    const cached = getCachedResult(toolCall.name, toolCall.arguments);
    if (cached !== null) {
      return { ...toolCall, result: cached };
    }
  }

  const result = await tool.execute(toolCall.arguments);

  // 缓存查询结果
  if (!tool.requiresConfirmation) {
    setCachedResult(toolCall.name, toolCall.arguments, result);
  }

  return { ...toolCall, result };
}

// 并行执行多个工具调用（仅用于不需要确认的工具）
async function executeToolCallsParallel(toolCalls: ToolCall[]): Promise<ExecutedToolCall[]> {
  return Promise.all(toolCalls.map(executeToolCall));
}

function getToolDefinition(toolName: string) {
  return toolRegistry[toolName];
}

async function requestProviderCompletion(
  provider: AgentProviderInput,
  messages: AgentConversationMessage[],
  model: string,
  signal?: AbortSignal
) {
  const response = await fetch(getProviderChatUrl(provider), {
    method: 'POST',
    headers: buildProviderHeaders(provider),
    body: JSON.stringify(buildProviderRequestBody(provider, messages, model)),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Provider error: ${response.status} ${errorText || response.statusText}`);
  }

  const payload = await response.json();
  return extractTextFromPayload(provider, payload);
}

function buildStreamRequestBody(
  provider: AgentProviderInput,
  messages: AgentConversationMessage[],
  model: string
): Record<string, unknown> {
  const baseBody = buildProviderRequestBody(provider, messages, model);
  return { ...baseBody, stream: true };
}

async function streamProviderCompletion(
  provider: AgentProviderInput,
  messages: AgentConversationMessage[],
  model: string,
  runId: string,
  emit: StreamEventEmitter,
  signal?: AbortSignal
): Promise<string> {
  const url = getProviderChatUrl(provider);
  const body = buildStreamRequestBody(provider, messages, model);

  const response = await fetch(url, {
    method: 'POST',
    headers: buildProviderHeaders(provider),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Provider error: ${response.status} ${errorText || response.statusText}`);
  }

  if (!response.body) {
    throw new Error('Provider response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') {
          continue;
        }

        const chunk = extractStreamChunk(provider, trimmed);
        if (chunk) {
          fullText += chunk;
          await emit({ type: 'text_chunk', runId, text: chunk });
        }
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Provider response timed out (120s)');
    }
    throw error;
  }

  if (buffer.trim()) {
    const chunk = extractStreamChunk(provider, buffer.trim());
    if (chunk) {
      fullText += chunk;
      await emit({ type: 'text_chunk', runId, text: chunk });
    }
  }

  return fullText;
}

function extractStreamChunk(provider: AgentProviderInput, line: string): string {
  if (!line.startsWith('data: ')) {
    return '';
  }

  const jsonStr = line.slice(6);
  if (!jsonStr || jsonStr === '[DONE]') {
    return '';
  }

  try {
    const payload = JSON.parse(jsonStr);

    switch (provider.apiFormat) {
      case 'anthropic':
        if (payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta') {
          return payload.delta.text || '';
        }
        return '';
      case 'gemini':
        return payload?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      case 'openai':
      case 'custom':
      default:
        return payload?.choices?.[0]?.delta?.content || '';
    }
  } catch {
    return '';
  }
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
  signal?: AbortSignal;
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
        input.model,
        input.signal
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
        // 写操作需要确认，先执行之前的所有查询类工具
        const queryToolCalls = pendingToolCalls.slice(0, index);
        if (queryToolCalls.length > 0) {
          const queryResults = await executeToolCallsParallel(queryToolCalls);
          executedToolCalls.push(...queryResults);
        }

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
    }

    // 所有工具都是查询类，并行执行
    const results = await executeToolCallsParallel(pendingToolCalls);
    executedToolCalls.push(...results);
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const model = input.model === 'default' ? (provider.model || 'default') : input.model;
    const baseMessages = buildBaseMessages(input, model);

    const firstResponse = await requestProviderCompletion(provider, baseMessages, model, controller.signal);
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
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
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
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function executeAgentRunWithStream(
  input: CreateAgentRunInput & { runId: string },
  emit: StreamEventEmitter
): Promise<AgentExecutionOutcome> {
  const provider = input.provider;
  if (!provider) {
    throw new Error('缺少激活的 Provider 配置，暂时无法由后端执行智能体。');
  }

  const model = input.model === 'default' ? (provider.model || 'default') : input.model;
  const baseMessages = buildBaseMessages(input, model);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const firstResponse = await streamProviderCompletion(provider, baseMessages, model, input.runId, emit, controller.signal);

    const firstParsed = parseToolCalls(firstResponse);

    if (firstParsed.toolCalls.length === 0) {
      return {
        status: 'completed',
        finalText: firstParsed.textContent || firstResponse,
        toolCalls: [],
      };
    }

    return continueExecutionLoopWithStream({
      provider,
      model,
      baseMessages,
      inputText: input.inputText,
      initialMessages: input.initialMessages,
      assistantText: firstParsed.textContent || '',
      executedToolCalls: [],
      remainingToolCalls: firstParsed.toolCalls,
      runId: input.runId,
      emit,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function continueExecutionLoopWithStream(input: {
  provider: AgentProviderInput;
  model: string;
  baseMessages: AgentConversationMessage[];
  inputText: string;
  initialMessages: CreateAgentRunInput['initialMessages'];
  assistantText: string;
  executedToolCalls: ExecutedToolCall[];
  remainingToolCalls: ToolCall[];
  runId: string;
  emit: StreamEventEmitter;
  signal?: AbortSignal;
}): Promise<AgentExecutionOutcome> {
  let assistantText = input.assistantText;
  let executedToolCalls = [...input.executedToolCalls];
  let pendingToolCalls = [...input.remainingToolCalls];

  for (let iteration = 0; iteration < MAX_AGENT_EXECUTION_ITERATIONS; iteration += 1) {
    if (pendingToolCalls.length === 0) {
      const response = await streamProviderCompletion(
        input.provider,
        [
          ...input.baseMessages,
          ...(assistantText ? [{ role: 'assistant' as const, content: assistantText }] : []),
          { role: 'user', content: buildNoMoreToolPrompt(executedToolCalls) },
        ],
        input.model,
        input.runId,
        input.emit,
        input.signal
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

      await input.emit({
        type: 'tool_call',
        runId: input.runId,
        toolName: toolCall.name,
        arguments: toolCall.arguments,
      });

      if (toolDefinition.requiresConfirmation) {
        // 写操作需要确认，先并行执行之前的所有查询类工具
        const queryToolCalls = pendingToolCalls.slice(0, index);
        if (queryToolCalls.length > 0) {
          const queryResults = await executeToolCallsParallel(queryToolCalls);
          for (const result of queryResults) {
            await input.emit({
              type: 'tool_result',
              runId: input.runId,
              toolName: result.name,
              result: result.result,
            });
          }
          executedToolCalls.push(...queryResults);
        }

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
    }

    // 所有工具都是查询类，并行执行并推送结果
    const results = await executeToolCallsParallel(pendingToolCalls);
    for (const executedCall of results) {
      await input.emit({
        type: 'tool_result',
        runId: input.runId,
        toolName: executedCall.name,
        result: executedCall.result,
      });
      executedToolCalls.push(executedCall);
    }
    pendingToolCalls = [];
  }

  return {
    status: 'completed',
    finalText: assistantText,
    toolCalls: executedToolCalls,
  };
}
