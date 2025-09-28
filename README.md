# ReAct Agent

一个基于 LangChain 实现的 ReAct (Reasoning + Acting) 架构 Agent，支持流式输出和多工具注册。

## 🚀 特性

- **ReAct 架构**: 实现了完整的 Reasoning + Acting 循环
- **流式输出**: 支持实时流式输出，可观察 Agent 的思考过程
- **工具系统**: 支持注册和管理多个工具，使用 Zod 进行参数验证
- **类型安全**: 完整的 TypeScript 支持
- **可扩展**: 易于添加自定义工具和配置
- **示例丰富**: 提供多个使用示例和预置工具

## 📦 安装

```bash
npm install
```

## 🔧 配置

1. 复制环境变量示例文件：
```bash
cp .env.example .env
```

2. 在 `.env` 文件中设置你的 OpenAI API 密钥：
```env
OPENAI_API_KEY=your_openai_api_key_here
```

## 🎯 快速开始

### 基本使用

```typescript
import { createReActAgent, quickRun } from './src/index.js';

// 快速运行
const result = await quickRun('计算 15 + 25 的结果');
console.log(result);

// 创建自定义 Agent
const agent = createReActAgent({
  model: 'gpt-4',
  temperature: 0.7,
  maxIterations: 5
});

const answer = await agent.run('查询北京的天气，然后计算华氏度');
```

### 使用千问模型

```typescript
import { createReActAgent } from './src/index.js';

// 使用千问模型（需要设置 DASHSCOPE_API_KEY 环境变量）
const agent = createReActAgent({
  model: 'qwen-plus',  // 支持 qwen-turbo, qwen-plus, qwen-max
  temperature: 0.7,
  maxIterations: 5
});

const result = await agent.run('你好，请介绍一下自己');
```

### 流式输出

```typescript
import { createStreamingReActAgent, createConsoleStreamHandler } from './src/index.js';

const { agent, streamManager } = createStreamingReActAgent();

// 设置控制台输出
const consoleHandler = createConsoleStreamHandler('[ReAct]');
streamManager.onStreamEvent('stream_event', consoleHandler);

// 自定义事件处理
streamManager.onStreamEvent('thought', (data) => {
  console.log('💭 思考:', data);
});

const streamHandler = streamManager.createStreamHandler();
const result = await agent.run('你的问题', streamHandler);
```

### 自定义工具

```typescript
import { ReActAgent, ToolDefinition } from './src/index.js';
import { z } from 'zod';

const agent = new ReActAgent();

// 定义自定义工具
const customTool: ToolDefinition = {
  name: 'my_tool',
  description: '我的自定义工具',
  parameters: [
    {
      name: 'input',
      type: 'string',
      description: '输入参数',
      required: true,
      schema: z.string().min(1)
    }
  ],
  execute: async (input: any) => {
    // 工具逻辑
    return { result: `处理了: ${input.input}` };
  }
};

// 注册工具
agent.registerTool(customTool);
```

## 🛠️ 内置工具

项目包含以下预置工具：

### 计算器工具 (calculator)
- 执行数学计算
- 支持基本算术运算和括号
- 安全的表达式求值

```typescript
// 使用示例
await agent.run('计算 (10 + 5) * 3 的结果');
```

### 天气工具 (weather)
- 查询指定地点的天气信息
- 支持摄氏度和华氏度
- Mock 实现，返回模拟数据

```typescript
// 使用示例
await agent.run('查询北京的天气');
```

### 搜索工具 (search)
- 模拟网络搜索功能
- 支持不同搜索类别
- 返回相关搜索结果

```typescript
// 使用示例
await agent.run('搜索人工智能的最新发展');
```

## 📚 API 文档

### ReActAgent

主要的 Agent 类，实现 ReAct 架构。

```typescript
class ReActAgent {
  constructor(config?: Partial<AgentConfig>)
  registerTool(tool: ToolDefinition): void
  registerTools(tools: ToolDefinition[]): void
  run(input: string, onStream?: (event: StreamEvent) => void): Promise<string>
  updateConfig(newConfig: Partial<AgentConfig>): void
}
```

### ToolRegistry

工具注册和管理系统。

```typescript
class ToolRegistry {
  registerTool(tool: ToolDefinition): void
  getTool(name: string): ToolDefinition | undefined
  executeTool(name: string, input: any): Promise<ToolResult>
  getToolsDescription(): string
}
```

### StreamManager

流式输出管理器。

```typescript
class StreamManager extends EventEmitter {
  startStream(): void
  endStream(): void
  emitStreamEvent(event: StreamEvent): void
  createStreamHandler(): (event: StreamEvent) => void
  onStreamEvent(eventType: string, callback: Function): void
}
```

## 🔧 配置选项

```typescript
interface AgentConfig {
  model: string;           // 模型名称，默认 'gpt-4'
  temperature: number;     // 温度参数，默认 0.7
  maxTokens: number;       // 最大令牌数，默认 2000
  maxIterations: number;   // 最大迭代次数，默认 10
  streamOutput: boolean;   // 是否启用流式输出，默认 true
  language: 'auto' | 'chinese' | 'english';  // 输出语言约束，默认 'auto'
}
```

### 支持的模型

#### OpenAI 模型
- `gpt-4` - GPT-4 模型（默认）
- `gpt-3.5-turbo` - GPT-3.5 Turbo 模型
- 其他 OpenAI 兼容模型

需要设置环境变量：`OPENAI_API_KEY`

#### 千问模型 <mcreference link="https://help.aliyun.com/zh/model-studio/what-is-qwen-llm" index="3">3</mcreference>
- `qwen-turbo` - 千问 Turbo 模型（速度快，成本低）
- `qwen-plus` - 千问 Plus 模型（平衡性能和成本）
- `qwen-max` - 千问 Max 模型（最强性能）

需要设置环境变量：`DASHSCOPE_API_KEY`

获取千问 API Key：[阿里云百炼平台](https://help.aliyun.com/zh/model-studio/getting-started/first-api-call) <mcreference link="https://help.aliyun.com/zh/model-studio/use-qwen-by-calling-api" index="5">5</mcreference>

### 环境变量配置

创建 `.env` 文件：

```bash
# OpenAI 配置
OPENAI_API_KEY=your_openai_api_key

# 千问模型配置
DASHSCOPE_API_KEY=your_dashscope_api_key
```

## 📖 示例

### 运行基本示例
```bash
npm run dev examples/basic-usage.ts
```

### 运行高级示例
```bash
npm run dev examples/advanced-usage.ts
```

### 运行千问模型示例
```bash
npm run dev examples/qwen-usage.ts
```

### 运行语言约束示例
```bash
npm run dev examples/language-constraint.ts
```

#### 语言约束功能

Agent 支持三种语言输出模式：

1. **自动模式 (`auto`)** - 默认模式，根据用户输入语言自动匹配
2. **中文模式 (`chinese`)** - 强制使用中文输出
3. **英文模式 (`english`)** - 强制使用英文输出

```typescript
// 强制中文输出
const chineseAgent = new ReActAgent({
  model: 'gpt-4',
  language: 'chinese'
});

// 强制英文输出
const englishAgent = new ReActAgent({
  model: 'gpt-4',
  language: 'english'
});

// 自动匹配语言（默认）
const autoAgent = new ReActAgent({
  model: 'gpt-4',
  language: 'auto'  // 可省略，这是默认值
});
```

## 🏗️ 项目结构

```
src/
├── core/
│   └── ReActAgent.ts          # ReAct Agent 核心实现
├── tools/
│   ├── ToolRegistry.ts        # 工具注册系统
│   └── examples/              # 示例工具
│       ├── CalculatorTool.ts  # 计算器工具
│       ├── WeatherTool.ts     # 天气工具
│       ├── SearchTool.ts      # 搜索工具
│       └── index.ts           # 工具导出
├── stream/
│   └── StreamManager.ts       # 流式输出管理
├── types/
│   └── index.ts               # 类型定义
└── index.ts                   # 主入口文件

examples/
├── basic-usage.ts             # 基本使用示例
└── advanced-usage.ts          # 高级使用示例
```

## 🧪 ReAct 架构说明

ReAct (Reasoning + Acting) 是一种将推理和行动相结合的 AI Agent 架构：

1. **Thought (思考)**: Agent 分析当前情况，制定计划
2. **Action (行动)**: 执行具体的工具调用或操作
3. **Observation (观察)**: 分析行动的结果
4. **Repeat (重复)**: 根据观察结果继续思考和行动，直到得出最终答案

这种架构使 Agent 能够：
- 逐步分解复杂问题
- 根据中间结果调整策略
- 透明地展示推理过程
- 有效利用外部工具

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🔗 相关资源

- [LangChain 文档](https://js.langchain.com/)
- [ReAct 论文](https://arxiv.org/abs/2210.03629)
- [OpenAI API 文档](https://platform.openai.com/docs)