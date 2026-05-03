import { OllamaMessage, streamChat } from '../lib/ollama';
import { AgentMessage, Tool, ToolCall, ToolResult } from './types';
import { toolRegistry } from './tools';

const TOOL_FORMAT = `使用工具时，必须严格按以下格式输出：
\`\`\`tool
{"name":"工具名","arguments":{"参数名":"参数值"}}
\`\`\``;

const SYSTEM_PROMPT_TEMPLATE = `你是这个个人工作站应用的全局智能助手。
你可以帮助用户：
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
3. 如果用户消息中明确点名某个工具名，例如 get_task_stats、parse_color、create_task，你必须优先且精确调用该工具，不能替换成其他工具。
4. 如果缺少必要参数，先用自然语言追问，不要猜测参数。
5. 回复默认使用简体中文，简洁直接。
6. 工具调用完成后，如果你还输出自然语言，总结必须严格基于工具结果，不能编造结果。`;

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
    if (requiredParams.length > 0) {
      return null;
    }

    return {
      id: crypto.randomUUID(),
      name: tool.name,
      arguments: {},
    };
  }

  parseToolCalls(content: string): { textContent: string; toolCalls: ToolCall[] } {
    const toolCalls: ToolCall[] = [];
    const toolBlockRegex = /```tool\n([\s\S]*?)```/g;

    let match: RegExpExecArray | null;
    while ((match = toolBlockRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
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

    return {
      textContent: content.replace(toolBlockRegex, '').trim(),
      toolCalls,
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
      return await tool.execute(toolCall.arguments);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '工具执行失败',
      };
    }
  }

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
