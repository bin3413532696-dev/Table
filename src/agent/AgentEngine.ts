import { streamChat, ollamaClient, OllamaMessage } from '../lib/ollama';
import { Tool, ToolResult, AgentMessage, ToolCall } from './types';
import { toolRegistry } from './tools/index';

/** 系统提示词模板 - 使用字符串拼接避免模板解析问题 */
const TOOL_FORMAT = '使用工具时，请按以下格式输出：\n```tool\n{"name": "工具名", "arguments": {...参数}}\n```';

const SYSTEM_PROMPT_TEMPLATE = `你是一个全局智能助手，可以帮助用户管理任务、财务和知识库。

你可以使用以下工具：
{TOOL_DESCRIPTIONS}

${TOOL_FORMAT}

重要规则：
1. 对于修改、删除操作，必须先向用户确认
2. 查询操作可以直接执行
3. 跨模块分析时，综合使用多个数据源
4. 回答时使用简洁清晰的中文
5. 如果不确定用户意图，先询问澄清`;

export class AgentEngine {
  private tools: Map<string, Tool>;
  private systemPrompt: string;

  constructor() {
    this.tools = toolRegistry;
    this.systemPrompt = this.buildSystemPrompt();
  }

  private buildSystemPrompt(): string {
    const toolDescriptions = Array.from(this.tools.values())
      .map(t => {
        const paramsStr = t.parameters.properties
          ? Object.entries(t.parameters.properties)
              .map(([key, val]) => `    ${key}: ${val.type}${val.description ? ` (${val.description})` : ''}${t.parameters.required?.includes(key) ? ' [必需]' : ''}`)
              .join('\n')
          : '无参数';
        return `- ${t.name}: ${t.description}${t.requiresConfirmation ? ' (需确认)' : ''}
  参数:
${paramsStr}`;
      })
      .join('\n\n');

    return SYSTEM_PROMPT_TEMPLATE.replace('{TOOL_DESCRIPTIONS}', toolDescriptions);
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  /** 解析助手回复中的工具调用 */
  parseToolCalls(content: string): { textContent: string; toolCalls: ToolCall[] } {
    const toolCalls: ToolCall[] = [];
    const toolBlockRegex = /```tool\n([\s\S]*?)```/g;

    let match;
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
        console.warn('Failed to parse tool call:', match[1]);
      }
    }

    const textContent = content.replace(toolBlockRegex, '').trim();
    return { textContent, toolCalls };
  }

  /** 执行工具调用 */
  async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return { success: false, error: `未知工具: ${toolCall.name}` };
    }

    try {
      const result = await tool.execute(toolCall.arguments);

      // 如果工具本身返回需要确认，直接返回
      if (result.requiresConfirmation) {
        return result;
      }

      // 如果工具标记为需要确认，添加确认信息
      if (tool.requiresConfirmation) {
        const argStr = JSON.stringify(toolCall.arguments, null, 2);
        return {
          ...result,
          requiresConfirmation: true,
          confirmationMessage: `即将执行: ${tool.name}\n参数: ${argStr}\n\n请确认是否执行此操作？`,
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

  /** 流式处理对话 */
  async *processMessage(
    messages: AgentMessage[],
    model: string
  ): AsyncGenerator<string | { type: 'tool_call'; toolCall: ToolCall }> {
    const conversationHistory: OllamaMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...messages
        .filter(m => m.role !== 'tool')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    let fullResponse = '';

    // 流式获取响应
    for await (const chunk of streamChat(conversationHistory, model)) {
      fullResponse += chunk;
      yield chunk;
    }

    // 检查是否有工具调用
    const { toolCalls } = this.parseToolCalls(fullResponse);

    for (const toolCall of toolCalls) {
      yield { type: 'tool_call', toolCall };
    }
  }

  /** 获取可用工具列表 */
  getAvailableTools(): string[] {
    return Array.from(this.tools.keys());
  }

  /** 获取工具详情 */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }
}

export const agentEngine = new AgentEngine();