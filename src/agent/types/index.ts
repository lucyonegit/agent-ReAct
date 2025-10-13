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
});

// 导出类型
export type ToolParameter = z.infer<typeof ToolParameterSchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type ReActStep = z.infer<typeof ReActStepSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// 流式事件接口
export interface StreamEvent {
  type: 'thought' | 'action' | 'observation' | 'final_answer' | 'error' | 'thought_chunk' | 'final_answer_chunk';
  data: any;
  timestamp: number;
  conversationId: string;
  eventId: string;
}

// Agent执行上下文
export interface AgentContext {
  input: string;
  steps: ReActStep[];
  tools: Map<string, ToolDefinition>;
  config: AgentConfig;
}