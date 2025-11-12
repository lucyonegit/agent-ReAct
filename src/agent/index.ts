// 核心组件导出
export { ReActAgent } from './core/ReActAgent.js';
export { ToolRegistry } from './tools/ToolRegistry.js';
export { StreamManager, createConsoleStreamHandler } from './core/stream/StreamManager.js';

// 类型定义导出
export type {
  ToolDefinition,
  ToolParameter,
  ToolResult,
  ReActStep,
  AgentConfig,
  AgentContext,
  StreamEvent
} from './types/index.js';

// 示例工具导出
export { ExampleTools } from './tools/collection/index.js';

// 便捷创建函数
import { ReActAgent } from './core/ReActAgent.js';
import { StreamManager } from './core/stream/StreamManager.js';
import { ExampleTools } from './tools/collection/index.js';
import { AgentConfig } from './types/index.js';

/**
 * 创建一个预配置的ReAct Agent
 * @param config Agent配置
 * @returns 配置好的Agent实例
 */
export function createReActAgent(
  config: Partial<AgentConfig> = {},
): ReActAgent {
  const agent = new ReActAgent(config);
  return agent;
}

/**
 * 创建带流式输出的ReAct Agent
 * @param config Agent配置
 * @param includeExampleTools 是否包含示例工具
 * @returns Agent实例和流管理器
 */
export function createStreamingReActAgent(
  config: Partial<AgentConfig> = {}
): { agent: ReActAgent; streamManager: StreamManager } {
  const agent = createReActAgent({ ...config, streamOutput: true });
  const streamManager = new StreamManager();
  
  return { agent, streamManager };
}