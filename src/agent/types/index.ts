import { z } from 'zod';

// 工具参数的Zod schema
export const ToolParameterSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  description: z.string(),
  required: z.boolean().default(false),
  schema: z.any().optional(),
});

// 工具定义的Zod schema
export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.array(ToolParameterSchema),
  execute: z.function(),
});

// 工具执行结果
export const ToolResultSchema = z.object({
  success: z.boolean(),
  result: z.any(),
  error: z.string().optional(),
});

// ReAct步骤类型
export const ReActStepSchema = z.object({
  type: z.enum(['thought', 'action', 'observation']),
  content: z.string(),
  toolName: z.string().optional(),
  toolInput: z.any().optional(),
  toolOutput: z.any().optional(),
});

// Agent配置
export const AgentConfigSchema = z.object({
  model: z.string().default('gpt-4'),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().positive().default(2000),
  maxIterations: z.number().positive().default(10),
  streamOutput: z.boolean().default(true),
  language: z.enum(['auto', 'chinese', 'english']).default('auto'),
  pauseAfterEachStep: z.boolean().default(false), // 每步后暂停等待用户确认
});

// 导出类型
export type ToolParameter = z.infer<typeof ToolParameterSchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type ReActStep = z.infer<typeof ReActStepSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ============= 新的对话结构类型定义 =============

// 事件类型
export type EventType = 'normal_event' | 'task_plan_event' | 'tool_call_event' | 'waiting_input_event';

// 任务状态
export type TaskStatus = 'pending' | 'doing' | 'done';

// 任务步骤
export interface TaskStep {
  id: string;
  title: string;
  status: TaskStatus;
  note?: string;
}

// Normal Event 数据
export interface NormalEventData {
  id: string;
  role: 'user' | 'assistant';
  type: 'normal_event';
  content: string;
  stream?: boolean;
  done?: boolean;
}

// Task Plan Event 数据
export interface TaskPlanEventData {
  id: string;
  role: 'assistant';
  type: 'task_plan_event';
  data: {
    step: TaskStep[];
  };
}

// Tool Call Event 数据
export interface ToolCallEventData {
  id: string;
  role: 'assistant';
  type: 'tool_call_event';
  data: {
    id?: string;
    status?: 'start' | 'end';
    tool_name: string;
    args: any;
    result?: ToolResult;
    success?: boolean;
    startedAt?: number;
    finishedAt?: number;
    durationMs?: number;
    iteration?: number;
  };
}

// Waiting Input Event 数据 - 等待用户输入
export interface WaitingInputEventData {
  id: string;
  role: 'assistant';
  type: 'waiting_input_event';
  data: {
    message: string;  // 提示用户输入的消息
    reason?: string;  // 为什么需要用户输入
  };
}

// 事件联合类型
export type ConversationEvent = NormalEventData | TaskPlanEventData | ToolCallEventData | WaitingInputEventData;

// Conversation 结构
export interface Conversation {
  conversationId: string;
  events: ConversationEvent[];
}

// Session 结构
export interface Session {
  sessionId: string;
  conversations: Conversation[];
}

// 流式事件接口（保持兼容性）
export interface StreamEvent {
  sessionId: string;
  conversationId: string;
  event: ConversationEvent;
  timestamp: number;
}

// Agent执行上下文
export interface AgentContext {
  input: string;
  steps: ReActStep[];
  tools: Map<string, ToolDefinition>;
  config: AgentConfig;
}