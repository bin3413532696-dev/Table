import { OllamaMessage, streamChat } from '../lib/ollama';
import { AgentMessage, Tool, ToolCall, ToolResult } from './types';
import { toolRegistry } from './tools';

// OpenAI 标准工具调用格式说明
const TOOL_FORMAT = `当需要使用工具时，请按以下 JSON 格式输出：
\`\`\`tool
{"name": "工具名", "arguments": {"参数名": "参数值"}}
\`\`\`

注意：
- name 必须是可用工具列表中的确切名称
- arguments 必须是有效的 JSON 对象
- 多个工具调用请分别输出多个 tool 块`;

const SYSTEM_PROMPT_TEMPLATE = `你是这个个人工作站应用的全局智能助手。你可以帮助用户：
- 查询和管理任务
- 查询和管理财务记录
- 使用工具模块能力
- 读取和修改设置模块中的可管理配置
- 做跨模块汇总和分析

可用工具如下：
{TOOL_DESCRIPTIONS}

${TOOL_FORMAT}

规则：
1. 查询类请求可以直接调用工具。
2. 会修改数据、设置或状态的操作，必须先输出工具调用，由前端弹出确认；不要在自然语言里假装已经执行成功。
3. 如果用户消息里明确点名某一个工具名，例如 get_task_stats、parse_color、create_task，你必须优先且精确调用该工具，不能替换成其他工具。
4. 如果缺少必要参数，先用自然语言追问，不要猜测参数。
5. 回复默认使用简体中文，简洁直接。
6. 工具调用完成后，如果你还输出自然语言，总结必须严格基于工具结果，不能编造结果。
7. 当工具返回结果后，你可以根据结果继续调用其他工具或给出最终回复，形成完整的推理链。`;

// 多轮推理的最大迭代次数
const MAX_ITERATIONS = 5;

export class AgentEngine {
  private tools: Map<string, Tool>;
  private systemPrompt: string;

  constructor() {
    this.tools = toolRegistry;
    this.systemPrompt = this.buildSystemPrompt();
  }

  private buildSystemPrompt(): string {
    const toolDescriptions = Array.from(this.tools.values())
      .map((tool) => {
        const params = tool.parameters.properties
          ? Object.entries(tool.parameters.properties)
              .map(([key, value]) => {
                const required = tool.parameters.required?.includes(key) ? ' [必填]' : '';
                const description = value.description ? ` - ${value.description}` : '';
                return `    ${key}: ${value.type}${required}${description}`;
              })
              .join('\n')
          : '    无参数';

        return `- ${tool.name}: ${tool.description}${tool.requiresConfirmation ? '（需确认）' : ''}
  参数:
${params}`;
      })
      .join('\n\n');

    return SYSTEM_PROMPT_TEMPLATE.replace('{TOOL_DESCRIPTIONS}', toolDescriptions);
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  private extractJsonArguments(content: string): Record<string, unknown> | null {
    const fencedMatch = content.match(/```(?:json|tool)?\s*([\s\S]*?)```/i);
    const rawCandidate = fencedMatch?.[1] || (() => {
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) {
        return '';
      }
      return content.slice(start, end + 1);
    })();

    if (!rawCandidate.trim()) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawCandidate);
      if (parsed && typeof parsed === 'object') {
        if ('arguments' in parsed && parsed.arguments && typeof parsed.arguments === 'object') {
          return parsed.arguments as Record<string, unknown>;
        }
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }

    return null;
  }

  findDirectToolCall(content: string): ToolCall | null {
    const normalized = content.trim();
    if (!normalized || !/(只调用|调用|使用)/.test(normalized)) {
      return null;
    }

    const matchedTools = Array.from(this.tools.values()).filter((tool) =>
      normalized.includes(tool.name)
    );

    if (matchedTools.length !== 1) {
      return null;
    }

    const tool = matchedTools[0];
    const requiredParams = tool.parameters.required || [];
    const parsedArguments = this.extractJsonArguments(normalized);

    if (requiredParams.length > 0) {
      if (!parsedArguments) {
        return null;
      }

      const hasAllRequired = requiredParams.every((key) => parsedArguments[key] !== undefined);
      if (!hasAllRequired) {
        return null;
      }
    }

    if (requiredParams.length === 0 && !parsedArguments) {
      return {
        id: crypto.randomUUID(),
        name: tool.name,
        arguments: {},
      };
    }

    if (!parsedArguments) {
      return null;
    }

    return {
      id: crypto.randomUUID(),
      name: tool.name,
      arguments: parsedArguments,
    };
  }

  parseToolCalls(content: string): { textContent: string; toolCalls: ToolCall[] } {
    const toolCalls: ToolCall[] = [];

    // 支持多种格式的工具调用解析
    // 格式1: ```tool\n{...}\n```
    const toolBlockRegex = /```tool\s*\n?([\s\S]*?)```/g;
    // 格式2: ```json\n{"name": "...", "arguments": {...}}\n```
    const jsonBlockRegex = /```json\s*\n?([\s\S]*?)```/g;
    // 格式3: OpenAI 风格的内联 JSON
    const inlineToolRegex = /\{"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\}/g;

    // 解析 ```tool 块
    let match: RegExpExecArray | null;
    while ((match = toolBlockRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.name && typeof parsed.name === 'string') {
          toolCalls.push({
            id: crypto.randomUUID(),
            name: parsed.name,
            arguments: parsed.arguments || {},
          });
        }
      } catch {
        // Ignore malformed tool blocks.
      }
    }

    // 解析 ```json 块（如果包含 name 和 arguments 字段）
    while ((match = jsonBlockRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.name && typeof parsed.name === 'string' && parsed.arguments) {
          toolCalls.push({
            id: crypto.randomUUID(),
            name: parsed.name,
            arguments: parsed.arguments,
          });
        }
      } catch {
        // Ignore malformed JSON blocks.
      }
    }

    // 解析内联 JSON 格式
    while ((match = inlineToolRegex.exec(content)) !== null) {
      try {
        const name = match[1];
        const args = JSON.parse(match[2]);
        toolCalls.push({
          id: crypto.randomUUID(),
          name,
          arguments: args,
        });
      } catch {
        // Ignore malformed inline JSON.
      }
    }

    // 去重（基于 name + arguments 的 JSON 字符串）
    const seen = new Set<string>();
    const uniqueToolCalls = toolCalls.filter((tc) => {
      const key = `${tc.name}:${JSON.stringify(tc.arguments)}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    // 移除所有工具调用块，保留纯文本
    let textContent = content
      .replace(toolBlockRegex, '')
      .replace(jsonBlockRegex, '')
      .replace(inlineToolRegex, '')
      .trim();

    return {
      textContent,
      toolCalls: uniqueToolCalls,
    };
  }

  async executeTool(toolCall: ToolCall, skipConfirmation = false): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return { success: false, error: `未知工具: ${toolCall.name}` };
    }

    if (tool.requiresConfirmation && !skipConfirmation) {
      return {
        success: true,
        requiresConfirmation: true,
        confirmationMessage: `即将执行 ${tool.name}，参数如下：\n${JSON.stringify(toolCall.arguments, null, 2)}`,
      };
    }

    try {
      const result = await tool.execute({
        ...toolCall.arguments,
        ...(skipConfirmation ? { __confirmed: true } : {}),
      });

      if (!skipConfirmation && result.requiresConfirmation) {
        return {
          success: true,
          requiresConfirmation: true,
          confirmationMessage:
            result.confirmationMessage ||
            `即将执行 ${tool.name}，参数如下：\n${JSON.stringify(toolCall.arguments, null, 2)}`,
        };
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '工具执行失败',
      };
    }
  }

  /**
   * 构建工具结果的反馈消息
   */
  private buildToolResultMessage(toolCall: ToolCall, result: ToolResult): string {
    if (result.success && result.data !== undefined) {
      return `工具 ${toolCall.name} 执行成功，结果如下：
${JSON.stringify(result.data, null, 2)}`;
    }
    if (result.success) {
      return `工具 ${toolCall.name} 执行成功。`;
    }
    return `工具 ${toolCall.name} 执行失败：${result.error || '未知错误'}`;
  }

  /**
   * 多轮推理处理消息
   * 支持工具调用后的结果反馈和继续推理
   */
  async *processMessageWithAgenticLoop(
    messages: AgentMessage[],
    model: string,
    signal?: AbortSignal
  ): AsyncGenerator<
    | string
    | { type: 'tool_call'; toolCall: ToolCall }
    | { type: 'tool_result'; toolCallId: string; result: ToolResult }
    | { type: 'iteration_start'; iteration: number }
    | { type: 'iteration_end'; iteration: number; hasToolCalls: boolean }
  > {
    // 构建初始对话历史
    const conversationHistory: OllamaMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...messages
        .filter((message) => message.role !== 'tool')
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: message.content,
        })),
    ];

    let iteration = 0;
    let lastToolCalls: ToolCall[] = [];

    while (iteration < MAX_ITERATIONS) {
      yield { type: 'iteration_start', iteration };

      let fullResponse = '';

      // 流式生成响应
      for await (const chunk of streamChat(conversationHistory, model, undefined, { signal })) {
        fullResponse += chunk;
        yield chunk;
      }

      // 解析工具调用
      const { textContent, toolCalls } = this.parseToolCalls(fullResponse);
      lastToolCalls = toolCalls;

      // 如果没有工具调用，结束推理循环
      if (toolCalls.length === 0) {
        yield { type: 'iteration_end', iteration, hasToolCalls: false };
        break;
      }

      // Yield 所有工具调用
      for (const toolCall of toolCalls) {
        yield { type: 'tool_call', toolCall };
      }

      // 执行工具并收集结果
      const toolResults: { toolCall: ToolCall; result: ToolResult }[] = [];
      for (const toolCall of toolCalls) {
        const result = await this.executeTool(toolCall);
        toolResults.push({ toolCall, result });
        yield { type: 'tool_result', toolCallId: toolCall.id, result };
      }

      // 将工具结果添加到对话历史，供下一轮推理使用
      // 添加 assistant 的文本响应（如果有）
      if (textContent.trim()) {
        conversationHistory.push({ role: 'assistant', content: textContent });
      }

      // 添加工具调用和结果的摘要
      const toolSummary = toolResults.map(({ toolCall, result }) =>
        this.buildToolResultMessage(toolCall, result)
      ).join('\n\n');

      conversationHistory.push({
        role: 'user',
        content: `以下是工具执行的结果：\n\n${toolSummary}\n\n请根据这些结果继续处理或给出最终回复。`,
      });

      yield { type: 'iteration_end', iteration, hasToolCalls: true };
      iteration++;
    }
  }

  /**
   * 原始的单轮处理方法（保留向后兼容）
   */
  async *processMessage(
    messages: AgentMessage[],
    model: string,
    signal?: AbortSignal
  ): AsyncGenerator<string | { type: 'tool_call'; toolCall: ToolCall }> {
    const conversationHistory: OllamaMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...messages
        .filter((message) => message.role !== 'tool')
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: message.content,
        })),
    ];

    let fullResponse = '';

    for await (const chunk of streamChat(conversationHistory, model, undefined, { signal })) {
      fullResponse += chunk;
      yield chunk;
    }

    const { toolCalls } = this.parseToolCalls(fullResponse);
    for (const toolCall of toolCalls) {
      yield { type: 'tool_call', toolCall };
    }
  }

  getAvailableTools(): string[] {
    return Array.from(this.tools.keys());
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }
}

export const agentEngine = new AgentEngine();
