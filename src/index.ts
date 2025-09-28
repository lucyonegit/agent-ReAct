// 核心组件导出
export { ReActAgent } from './core/ReActAgent.js';
export { ToolRegistry } from './tools/ToolRegistry.js';
export { StreamManager, createConsoleStreamHandler } from './stream/StreamManager.js';

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
export { 
  CalculatorTool, 
  WeatherTool, 
  SearchTool, 
  ExampleTools,
  ToolDescriptions 
} from './tools/examples/index.js';

// 便捷创建函数
import { ReActAgent } from './core/ReActAgent.js';
import { StreamManager, createConsoleStreamHandler } from './stream/StreamManager.js';
import { ExampleTools } from './tools/examples/index.js';
import { AgentConfig } from './types/index.js';

/**
 * 创建一个预配置的ReAct Agent
 * @param config Agent配置
 * @param includeExampleTools 是否包含示例工具
 * @returns 配置好的Agent实例
 */
export function createReActAgent(
  config: Partial<AgentConfig> = {},
  includeExampleTools: boolean = true
): ReActAgent {
  const agent = new ReActAgent(config);
  
  if (includeExampleTools) {
    agent.registerTools(ExampleTools);
  }
  
  return agent;
}

/**
 * 创建带流式输出的ReAct Agent
 * @param config Agent配置
 * @param includeExampleTools 是否包含示例工具
 * @returns Agent实例和流管理器
 */
export function createStreamingReActAgent(
  config: Partial<AgentConfig> = {},
  includeExampleTools: boolean = true
): { agent: ReActAgent; streamManager: StreamManager } {
  const agent = createReActAgent({ ...config, streamOutput: true }, includeExampleTools);
  const streamManager = new StreamManager();
  
  return { agent, streamManager };
}

/**
 * 快速运行ReAct Agent的便捷函数
 * @param input 用户输入
 * @param config Agent配置
 * @param enableConsoleOutput 是否启用控制台输出
 * @returns Agent响应
 */
export async function quickRun(
  input: string,
  config: Partial<AgentConfig> = {},
  enableConsoleOutput: boolean = true
): Promise<string> {
  const { agent, streamManager } = createStreamingReActAgent(config);
  
  if (enableConsoleOutput) {
    const consoleHandler = createConsoleStreamHandler('[ReAct Agent]');
    streamManager.onStreamEvent('stream_event', consoleHandler);
  }
  
  const streamHandler = streamManager.createStreamHandler();
  return await agent.run(input, streamHandler);
}