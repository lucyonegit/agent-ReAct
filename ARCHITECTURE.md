# ReAct Agent 架构设计文档

## 项目概述

本项目是一个基于 ReAct（Reasoning + Acting）架构的智能代理系统，支持多种大语言模型（OpenAI GPT、阿里云通义千问），具备工具调用、流式输出、增量显示等功能。

### 核心特性

- **ReAct 架构**：结合推理（Reasoning）和行动（Acting）的智能代理模式
- **多模型支持**：支持 OpenAI GPT 系列和阿里云通义千问系列模型
- **工具系统**：可扩展的工具注册和执行机制
- **流式输出**：实时流式响应，支持增量内容显示
- **类型安全**：基于 TypeScript 和 Zod 的完整类型验证

## 项目结构

```
agent/
├── src/
│   ├── core/                 # 核心组件
│   │   └── ReActAgent.ts     # ReAct 代理主类
│   ├── stream/               # 流式处理
│   │   └── StreamManager.ts  # 流式事件管理器
│   ├── tools/                # 工具系统
│   │   ├── ToolRegistry.ts   # 工具注册表
│   │   └── examples/         # 示例工具
│   ├── types/                # 类型定义
│   │   └── index.ts          # 核心类型和 Schema
│   └── index.ts              # 主入口文件
├── examples/                 # 使用示例
│   └── qwen-usage.ts         # 千问模型使用示例
├── package.json              # 项目配置
└── tsconfig.json             # TypeScript 配置
```

## 核心架构

### 1. ReAct 架构模式

ReAct（Reasoning + Acting）是一种将推理和行动相结合的智能代理架构：

```
输入问题 → 思考(Thought) → 行动(Action) → 观察(Observation) → 思考 → ... → 最终答案
```

#### 执行流程

1. **思考阶段（Thought）**：分析问题，制定解决策略
2. **行动阶段（Action）**：选择并执行合适的工具
3. **观察阶段（Observation）**：获取工具执行结果
4. **迭代循环**：根据观察结果继续思考或给出最终答案

### 2. 核心组件架构

#### 2.1 ReActAgent（核心代理）

```typescript
class ReActAgent {
  private llm: BaseChatModel;           // 大语言模型
  private toolRegistry: ToolRegistry;   // 工具注册表
  private config: AgentConfig;          // 配置信息
  private streamManager: StreamManager; // 流式管理器
}
```

**主要职责：**
- 管理 ReAct 推理循环
- 协调各组件交互
- 处理流式输出
- 支持多种 LLM 模型

**核心方法：**
- `run(input, onStream?)`: 执行 ReAct 推理循环
- `generateThought()`: 生成思考内容
- `decideAction()`: 决策行动方案
- `generateFinalAnswer()`: 生成最终答案

#### 2.2 StreamManager（流式管理器）

```typescript
class StreamManager extends EventEmitter {
  private incrementalState: Map<string, {
    currentContent: string;
    lastDisplayedLength: number;
  }>;
}
```

**主要职责：**
- 管理流式事件的发送和接收
- 处理内容聚合和增量显示
- 提供事件缓冲和状态管理
- 支持多会话并发处理

**核心功能：**
- 内容聚合：将分块内容合并为完整内容
- 增量显示：只显示新增的内容部分
- 事件管理：统一的流式事件处理机制

#### 2.3 ToolRegistry（工具注册表）

```typescript
class ToolRegistry {
  private tools: Map<string, ToolDefinition>;
}
```

**主要职责：**
- 工具的注册、管理和执行
- 输入参数验证
- 执行结果标准化
- 工具描述生成

**支持的工具类型：**
- 计算器工具（CalculatorTool）
- 搜索工具（SearchTool）
- 天气查询工具（WeatherTool）
- RAG 查询工具（RagTool）

### 3. 类型系统架构

基于 Zod 的完整类型验证体系：

```typescript
// 核心类型定义
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ReActStep = z.infer<typeof ReActStepSchema>;
export type StreamEvent = z.infer<typeof StreamEventSchema>;
```

**类型安全保障：**
- 编译时类型检查
- 运行时数据验证
- 自动类型推导
- 完整的错误处理

## 流式处理架构

### 流式事件类型

```typescript
type StreamEventType = 
  | 'thought'           // 思考完成
  | 'thought_chunk'     // 思考内容块
  | 'action'            // 行动执行
  | 'observation'       // 观察结果
  | 'final_answer'      // 最终答案完成
  | 'final_answer_chunk'// 最终答案内容块
  | 'error';            // 错误事件
```

### 增量显示机制

1. **内容聚合**：将分块内容累积为完整内容
2. **增量计算**：计算新增内容部分
3. **状态管理**：跟踪已显示内容长度
4. **自动清理**：完成事件时清理状态

### 流式处理流程

```
LLM 输出 → StreamManager → 事件分发 → 增量计算 → 用户界面
```

## 工具系统架构

### 工具定义标准

```typescript
interface ToolDefinition {
  name: string;                    // 工具名称
  description: string;             // 工具描述
  parameters: ToolParameter[];     // 参数定义
  execute: (input: any) => Promise<any>; // 执行函数
}
```

### 工具执行流程

1. **参数验证**：基于 Schema 验证输入参数
2. **工具执行**：调用工具的 execute 方法
3. **结果标准化**：统一返回格式
4. **错误处理**：捕获和包装执行错误

### 工具扩展机制

- **插件化设计**：每个工具独立实现
- **统一接口**：标准的工具定义接口
- **动态注册**：运行时注册新工具
- **类型安全**：完整的参数类型验证

## 配置系统

### Agent 配置

```typescript
interface AgentConfig {
  model: string;           // 模型名称
  temperature: number;     // 温度参数
  maxTokens: number;       // 最大令牌数
  maxIterations: number;   // 最大迭代次数
  streamOutput: boolean;   // 是否启用流式输出
  language: 'auto' | 'chinese' | 'english'; // 语言设置
}
```

### 多模型支持

- **OpenAI 模型**：GPT-3.5、GPT-4 系列
- **通义千问**：qwen-turbo、qwen-plus、qwen-max
- **自动适配**：根据模型名称自动选择对应的客户端

## 使用示例

### 基础使用

```typescript
import { ReActAgent, ExampleTools } from './src/index.js';

const agent = new ReActAgent({
  model: 'qwen-plus',
  temperature: 0.7,
  streamOutput: true
});

agent.getToolRegistry().registerTools(ExampleTools);

const result = await agent.run('计算 15 * 23 的结果');
```

### 流式输出

```typescript
const result = await agent.run(
  '查询今天的天气',
  (event) => {
    switch (event.type) {
      case 'thought_chunk':
        // 处理思考内容块
        break;
      case 'action':
        // 处理行动事件
        break;
      case 'final_answer_chunk':
        // 处理最终答案块
        break;
    }
  }
);
```

## 设计原则

### 1. 模块化设计
- 每个组件职责单一、边界清晰
- 组件间通过标准接口交互
- 支持独立测试和维护

### 2. 可扩展性
- 插件化的工具系统
- 可配置的模型支持
- 灵活的流式处理机制

### 3. 类型安全
- 完整的 TypeScript 类型定义
- 运行时数据验证
- 编译时错误检查

### 4. 用户体验
- 实时流式输出
- 增量内容显示
- 丰富的事件反馈

## 技术栈

- **语言**：TypeScript
- **运行时**：Node.js
- **LLM 框架**：LangChain
- **类型验证**：Zod
- **模型支持**：OpenAI、阿里云通义千问
- **构建工具**：TSC、TSX

## 未来扩展

### 计划功能
1. **更多工具支持**：文件操作、数据库查询、API 调用等
2. **多轮对话**：支持上下文记忆的多轮交互
3. **并发处理**：支持多任务并行执行
4. **可视化界面**：Web 界面和图形化工具
5. **性能优化**：缓存机制、批处理优化

### 架构演进
1. **微服务化**：将组件拆分为独立服务
2. **分布式部署**：支持集群部署和负载均衡
3. **插件市场**：社区驱动的工具生态
4. **多模态支持**：图像、音频等多模态输入

---

*本文档描述了 ReAct Agent 项目的整体架构设计，为开发者提供了全面的技术参考。*