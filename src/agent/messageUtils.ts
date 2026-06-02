import type { AgentRunDetailDto, AgentRunMessageDto, AgentSessionDetailDto } from '../lib/agentApi';
import type { AgentMessage } from './types';
import { MAX_CONTEXT_CHARS, MAX_HISTORY_MESSAGES } from './types';

const TOOL_RESULT_PREFIX = '以下是工具执行结果';
const MISSING_ASSISTANT_REPLY = '（回复内容不可用）';

export function trimMessagesHistory(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length === 0) {
    return messages;
  }

  let trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
  let totalChars = trimmed.reduce((sum, message) => sum + message.content.length, 0);

  if (totalChars <= MAX_CONTEXT_CHARS) {
    return trimmed;
  }

  let cutIndex = 0;
  while (cutIndex < trimmed.length - 1 && totalChars > MAX_CONTEXT_CHARS) {
    totalChars -= trimmed[cutIndex].content.length;
    cutIndex++;
  }

  return trimmed.slice(cutIndex);
}

export function appendManualStopMessage(content: string): string {
  const stopMessage = '已手动终止本次思考。';
  if (!content.trim()) {
    return stopMessage;
  }

  return content.includes(stopMessage) ? content : `${content}\n\n${stopMessage}`;
}

export function toInitialMessages(messages: AgentMessage[]): Array<{
  role: 'user' | 'assistant';
  content: string;
}> {
  return trimMessagesHistory(messages)
    .filter((message): message is AgentMessage & { role: 'user' | 'assistant' } => (
      message.role === 'user' || message.role === 'assistant'
    ))
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

export function mapRunMessagesToAgentMessages(messages: AgentRunMessageDto[]): AgentMessage[] {
  return messages
    .filter(isVisibleRunMessage)
    .map((message, index) => ({
      id: message.id || `msg-${index}`,
      role: message.role,
      content: message.content,
      timestamp: message.createdAt || Date.now(),
      status: 'completed' as const,
    }));
}

export function mapRunDetailToHistoryMessages(run: AgentRunDetailDto): AgentMessage[] {
  return mapRunMessagesToAgentMessages(run.messages);
}

export function mapSessionDetailToHistoryMessages(session: AgentSessionDetailDto): AgentMessage[] {
  if (session.messages && session.messages.length > 0) {
    return mapRunMessagesToAgentMessages(session.messages);
  }

  return session.runs.flatMap((run) => [
    {
      id: `user-${run.id}`,
      role: 'user' as const,
      content: run.inputText,
      timestamp: run.createdAt,
      status: 'completed' as const,
    },
    {
      id: `assistant-${run.id}`,
      role: 'assistant' as const,
      content: run.status === 'completed' ? MISSING_ASSISTANT_REPLY : `状态: ${run.status}`,
      timestamp: run.createdAt + 1,
      status: run.status === 'failed' ? 'error' as const : 'completed' as const,
    },
  ]);
}

function isVisibleRunMessage(message: AgentRunMessageDto): boolean {
  if (message.role === 'system' || message.role === 'tool') {
    return false;
  }

  if (message.role === 'user' && message.content.startsWith(TOOL_RESULT_PREFIX)) {
    return false;
  }

  return true;
}
