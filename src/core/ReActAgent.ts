import { ChatOpenAI } from '@langchain/openai';
import { ChatAlibabaTongyi } from '@langchain/community/chat_models/alibaba_tongyi';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { StreamManager } from '../stream/StreamManager.js';
import { 
  AgentConfig, 
  AgentConfigSchema, 
  ReActStep, 
  StreamEvent, 
  AgentContext 
} from '../types/index.js';

/**
 * ReAct架构Agent实现
 * ReAct = Reasoning + Acting
 */
export class ReActAgent {
  private llm: BaseChatModel;
  private toolRegistry: ToolRegistry;
  private config: AgentConfig;
  private streamManager: StreamManager;

  constructor(config: Partial<AgentConfig> = {}) {
    this.config = AgentConfigSchema.parse(config);
    this.llm = this.createLLM();
    this.toolRegistry = new ToolRegistry();
    this.streamManager = new StreamManager();
  }
  /**
   * 创建LLM实例
   */
  private createLLM(): BaseChatModel {
    const modelName = this.config.model.toLowerCase();
    if (modelName.includes('qwen') || modelName.includes('tongyi')) {
      return new ChatAlibabaTongyi({
        modelName: this.config.model,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
        streaming: this.config.streamOutput,
        alibabaApiKey: process.env.DASHSCOPE_API_KEY,
      });
    } else {
      return new ChatOpenAI({
        modelName: this.config.model,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
        streaming: this.config.streamOutput,
      });
    }
  }

  /**
   * ReAct推理循环
   */
  async run(
    input: string, 
    onStream?: (event: StreamEvent) => void
  ): Promise<string> {
    // 生成唯一的conversationId
    const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    const context: AgentContext = {
      input,
      steps: [],
      tools: this.toolRegistry.getAllTools(),
      config: this.config
    };

    this.emitStreamEvent('thought', 'Starting ReAct reasoning process...', conversationId, 'start', onStream);

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      try {
        // 生成思考步骤
        const thought = await this.generateThought(context, onStream, conversationId);
        context.steps.push({
          type: 'thought',
          content: thought
        });

        // 检查是否需要使用工具
        const actionDecision = await this.decideAction(context);
        
        if (actionDecision.type === 'final_answer') {
          // 使用流式生成最终答案
          const finalAnswer = await this.generateFinalAnswer(context, onStream, conversationId);
          return finalAnswer;
        }

        if (actionDecision.type === 'action') {
          // 执行动作
          const actionStep: ReActStep = {
            type: 'action',
            content: `Using tool: ${actionDecision.toolName}`,
            toolName: actionDecision.toolName,
            toolInput: actionDecision.toolInput
          };
          
          context.steps.push(actionStep);
          this.emitStreamEvent('action', {
            toolName: actionDecision.toolName,
            input: actionDecision.toolInput
          }, conversationId, `action_${iteration}`, onStream);

          // 执行工具
          const toolResult = await this.toolRegistry.executeTool(
            actionDecision.toolName!,
            actionDecision.toolInput
          );

          // 记录观察结果
          const observation = toolResult.success 
            ? `Tool executed successfully. Result: ${JSON.stringify(toolResult.result)}`
            : `Tool execution failed. Error: ${toolResult.error}`;

          const observationStep: ReActStep = {
            type: 'observation',
            content: observation,
            toolName: actionDecision.toolName,
            toolOutput: toolResult
          };

          context.steps.push(observationStep);
          this.emitStreamEvent('observation', {
            toolName: actionDecision.toolName,
            result: toolResult
          }, conversationId, `observation_${iteration}`, onStream);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        this.emitStreamEvent('error', errorMessage, conversationId, `error_${iteration}`, onStream);
        throw new Error(`ReAct execution failed: ${errorMessage}`);
      }
    }

    // 如果达到最大迭代次数，生成最终答案
    const finalAnswer = await this.generateFinalAnswer(context, onStream, conversationId);
    return finalAnswer;
  }

  /**
   * 生成思考步骤
   */
  private async generateThought(
    context: AgentContext, 
    onStream?: (event: StreamEvent) => void,
    conversationId?: string
  ): Promise<string> {
    const systemPrompt = this.buildSystemPrompt();
    const conversationHistory = this.buildConversationHistory(context);

    const messages = [
      new SystemMessage(systemPrompt),
      ...conversationHistory,
      new HumanMessage(`
        Based on the conversation so far, what should I think about next? 
        Provide your reasoning in a clear, step-by-step manner.
        Focus on analyzing the current situation and determining the next logical step.
      `)
    ];

    // 如果启用了流式输出且有回调函数
    if (this.config.streamOutput && onStream) {
      // 流式模式
      const stream = await this.llm.stream(messages);
      let fullContent = '';
      let chunkIndex = 0;
      for await (const chunk of stream) {
        const content = chunk.content as string;
        if (content) {
          fullContent += content;
          // 使用递增索引确保每个chunk都有唯一ID
          this.emitStreamEvent('thought_chunk', content, conversationId || 'default', `thought_chunk_${chunkIndex++}`, onStream);
        }
      }
      
      // 流式模式下，发送思考完成事件（不包含重复内容）
      this.emitStreamEvent('thought', '', conversationId || 'default', `thought_complete_${Date.now()}`, onStream);
      return fullContent;
    } else {
      // 非流式模式
      const response = await this.llm.invoke(messages);
      const content = response.content as string;
      
      // 发送完整的思考内容
      if (onStream) {
        this.emitStreamEvent('thought', content, conversationId || 'default', `thought_${Date.now()}`, onStream);
      }
      
      return content;
    }
  }

  /**
   * 决定下一步动作
   */
  private async decideAction(context: AgentContext): Promise<{
    type: 'action' | 'final_answer';
    content?: string;
    toolName?: string;
    toolInput?: any;
  }> {
    const systemPrompt = this.buildSystemPrompt();
    const conversationHistory = this.buildConversationHistory(context);
    const toolsDescription = this.toolRegistry.getToolsDescription();

    const messages = [
      new SystemMessage(systemPrompt),
      ...conversationHistory,
      new HumanMessage(`
        Available tools:
        ${toolsDescription}
        Based on your previous thought, decide what to do next:
        1. If you need to use a tool, respond with:
        Action: [tool_name]
        Input: [tool_input_as_json]
        2. If you have enough information to provide a final answer, respond with:
        Final Answer: [your_complete_answer]
        Choose wisely based on whether you need more information or can provide a complete answer.
      `)
    ];

    const response = await this.llm.invoke(messages);
    const content = response.content as string;

    // 解析响应
    if (content.includes('Final Answer:')) {
      const finalAnswer = content.split('Final Answer:')[1].trim();
      return {
        type: 'final_answer',
        content: finalAnswer
      };
    }

    if (content.includes('Action:')) {
      const actionMatch = content.match(/Action:\s*(.+)/);
      const inputMatch = content.match(/Input:\s*(.+)/s);
      
      if (actionMatch) {
        const toolName = actionMatch[1].trim();
        let toolInput = {};
        
        if (inputMatch) {
          try {
            toolInput = JSON.parse(inputMatch[1].trim());
          } catch {
            // 如果JSON解析失败，使用原始字符串
            toolInput = { input: inputMatch[1].trim() };
          }
        }

        return {
          type: 'action',
          toolName,
          toolInput
        };
      }
    }

    // 默认返回思考更多
    return {
      type: 'action',
      toolName: 'think_more',
      toolInput: { thought: content }
    };
  }

  /**
   * 生成最终答案
   */
  private async generateFinalAnswer(
    context: AgentContext, 
    onStream?: (event: StreamEvent) => void,
    conversationId?: string
  ): Promise<string> {
    const systemPrompt = this.buildSystemPrompt();
    const conversationHistory = this.buildConversationHistory(context);
    
    const messages = [
      new SystemMessage(systemPrompt),
      ...conversationHistory,
      new HumanMessage(`Based on the above reasoning and observations, please provide a final answer to: ${context.input}

Please be concise and direct in your response.`)
    ];

    if (this.config.streamOutput && onStream) {
      // 流式模式
      const stream = await this.llm.stream(messages);
      let fullContent = '';
      
      let chunkIndex = 0;
      for await (const chunk of stream) {
        const content = chunk.content as string;
        if (content) {
          fullContent += content;
          
          // 使用递增索引确保每个chunk都有唯一ID
          this.emitStreamEvent('final_answer_chunk', content, conversationId || 'default', `final_answer_chunk_${chunkIndex++}`, onStream);
        }
      }
      
      // 流式模式下，发送最终答案完成事件（不包含重复内容）
      this.emitStreamEvent('final_answer', '', conversationId || 'default', `final_answer_complete_${Date.now()}`, onStream);
      return fullContent;
    } else {
      // 非流式模式
      const response = await this.llm.invoke(messages);
      const content = response.content as string;
      
      // 发送完整的最终答案
      if (onStream) {
        this.emitStreamEvent('final_answer', content, conversationId || 'default', `final_answer_${Date.now()}`, onStream);
      }
      
      return content;
    }
  }

  /**
   * 构建系统提示
   */
  private buildSystemPrompt(): string {
    const languageInstructions = this.getLanguageInstructions();
    
    return `You are a ReAct (Reasoning + Acting) agent. Your task is to answer questions by following a structured reasoning process:

1. **Think**: Analyze the problem and plan your approach
2. **Act**: Use available tools when you need more information
3. **Observe**: Analyze the results from tool usage
4. **Repeat**: Continue this cycle until you can provide a complete answer

Guidelines:
- Always think step by step
- Use tools when you need specific information or to perform actions
- Be thorough in your reasoning
- Provide clear, actionable insights
- Only give a final answer when you have sufficient information

${languageInstructions}

Available tools will be provided in each interaction. Use them wisely to gather the information needed to answer the user's question completely.`;
  }

  /**
   * 根据配置获取语言约束指令
   */
  private getLanguageInstructions(): string {
    switch (this.config.language) {
      case 'chinese':
        return `Language Requirement: 
- MUST respond in Chinese (中文)
- All thoughts, actions, and final answers should be in Chinese
- Use Chinese for all reasoning and explanations`;
      
      case 'english':
        return `Language Requirement:
- MUST respond in English only
- All thoughts, actions, and final answers should be in English
- Use English for all reasoning and explanations`;
      
      case 'auto':
      default:
        return `Language Requirement:
- Respond in the same language as the user's question
- If the user asks in Chinese, respond in Chinese
- If the user asks in English, respond in English
- Maintain language consistency throughout the conversation`;
    }
  }

  /**
   * 构建对话历史
   */
  private buildConversationHistory(context: AgentContext): (HumanMessage | AIMessage)[] {
    const messages: (HumanMessage | AIMessage)[] = [
      new HumanMessage(`Question: ${context.input}`)
    ];

    for (const step of context.steps) {
      if (step.type === 'thought') {
        messages.push(new AIMessage(`Thought: ${step.content}`));
      } else if (step.type === 'action') {
        messages.push(new AIMessage(`Action: ${step.content}`));
        if (step.toolInput) {
          messages.push(new AIMessage(`Input: ${JSON.stringify(step.toolInput)}`));
        }
      } else if (step.type === 'observation') {
        messages.push(new AIMessage(`Observation: ${step.content}`));
      }
    }

    return messages;
  }

  /**
   * 发送流式事件
   */
  private emitStreamEvent(
    type: StreamEvent['type'], 
    data: any, 
    conversationId: string,
    eventId: string,
    onStream?: (event: StreamEvent) => void
  ): void {
    if (onStream) {
      const event = this.streamManager.createStreamEvent(type, data, conversationId, eventId);
      // 通过StreamManager处理事件，以便正确更新增量状态
      this.streamManager.emitStreamEvent(event);
      // 然后调用onStream回调
      onStream(event);
    }
  }

  /**
   * 获取流管理器实例
   */
  getStreamManager(): StreamManager {
    return this.streamManager;
  }

  /**
   * 获取工具注册表
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<AgentConfig>): void {
    this.config = AgentConfigSchema.parse({ ...this.config, ...newConfig });
    
    // 重新初始化LLM
    this.llm = this.createLLM();
  }
}