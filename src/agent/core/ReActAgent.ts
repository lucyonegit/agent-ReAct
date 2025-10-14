import { ChatOpenAI } from '@langchain/openai';
import { ChatAlibabaTongyi } from '@langchain/community/chat_models/alibaba_tongyi';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { StreamManager } from './stream/StreamManager.js';
import { 
  AgentConfig, 
  AgentConfigSchema, 
  ReActStep, 
  StreamEvent,
  AgentContext,
  TaskStep,
  TaskStatus,
  ConversationEvent,
  NormalEventData,
  TaskPlanEventData,
  ToolCallEventData
} from '../types/index.js';
import { prompt } from './config/prompt';



// 使用类型定义中的 TaskStep

/**
 * ReAct架构Agent实现
 * ReAct = Reasoning + Acting
 */
export class ReActAgent {
  private llm: BaseChatModel;
  private toolRegistry: ToolRegistry;
  private config: AgentConfig;
  private streamManager: StreamManager;

  // 共享的 Planner 计划列表（在一次 run 的多轮 ReAct 中复用与更新）
  private planList: TaskStep[] = [];

  // 会话管理
  private currentSessionId: string | null = null;
  
  // 生成唯一ID
  private genId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

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
   * 将下一个 pending 项标记为 doing
   */
  private markNextPendingDoing(note?: string): void {
    const item = this.planList.find(p => p.status === 'pending');
    if (item) {
      item.status = 'doing';
      if (note) item.note = note;
    }
  }

  /**
   * 将当前 doing 项标记为 done
   */
  private markCurrentStepDone(note?: string): void {
    const item = this.planList.find(p => p.status === 'doing');
    if (item) {
      item.status = 'done';
      if (note) item.note = note;
    }
  }

  /**
   * 通过流事件推送计划更新
   */
  private emitPlanUpdate(
    sessionId: string,
    conversationId: string, 
    onStream?: (e: StreamEvent) => void
  ): void {
    const eventId = this.genId('plan_update');
    this.emitTaskPlan(
      { step: this.planList }, 
      sessionId, 
      conversationId, 
      eventId, 
      onStream
    );
  }

  /**
   * 对外 API：带 session 的运行
   * 如未传 sessionId，首次自动创建并返回；返回结构包含 sessionId 与 conversationId
   */
  async runWithSession(
    input: string,
    options?: { sessionId?: string; onStream?: (event: StreamEvent) => void }
  ): Promise<{ sessionId: string; conversationId: string; finalAnswer: string }> {
    const sessionId = options?.sessionId ?? (this.currentSessionId ?? this.genId('sess'));
    this.currentSessionId = sessionId;
    const conversationId = this.genId('conv');
    // 生成预处理提示
    await this.generatePreActionTip(input, conversationId, sessionId, options?.onStream);
    // 进入推理循环
    const finalAnswer = await this.runInternal(input, sessionId, conversationId, options?.onStream);
    return { sessionId, conversationId, finalAnswer };
  }

  /**
   * 内部推理循环（带 session/conversation 语义）
   */
  private async runInternal(
    input: string,
    sessionId: string,
    conversationId: string,
    onStream?: (event: StreamEvent) => void
  ): Promise<string> {
    const context: AgentContext = {
      input,
      steps: [],
      tools: this.toolRegistry.getAllTools(),
      config: this.config
    };

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      try {
        // 1️⃣ 发送思考事件（独立的 normal_event）
        const thought = await this.generateThought(context, onStream, conversationId, sessionId);
        context.steps.push({
          type: 'thought',
          content: thought
        });

        // 2️⃣ 决策行动并发送决策事件（独立的 normal_event）
        const actionDecision = await this.decideAction(context, onStream, conversationId, sessionId);
        
        if (actionDecision.type === 'final_answer') {
          // 标记当前步骤为完成
          this.markCurrentStepDone('✅ 已完成');
          this.emitPlanUpdate(sessionId || 'default', conversationId || 'default', onStream);
          
          // 发送最终答案准备事件
          this.emitNormal({ 
            content: '**准备答案** - 已收集足够信息，正在生成最终答案...' 
          }, sessionId || 'default', conversationId || 'default', `prepare_answer_${iteration}`, onStream);
          
          // 使用流式生成最终答案
          const finalAnswer = await this.generateFinalAnswer(context, onStream, conversationId, sessionId);
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
          
          // 3️⃣ 发送工具调用事件（tool_call_event）
          const toolEventId = `tool_${iteration}_${conversationId || Date.now()}`;
          const toolStartedAt = Date.now();
          
          console.log('🔧 发送工具调用 START 事件:', { toolEventId, tool: actionDecision.toolName });
          
          this.emitToolCall({
            id: toolEventId,
            status: 'start',
            tool_name: actionDecision.toolName!,
            args: actionDecision.toolInput,
            iteration,
            startedAt: toolStartedAt
          }, sessionId, conversationId, toolEventId, onStream);
          
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
          
          // 工具调用结束事件
          const toolFinishedAt = Date.now();
          
          console.log('🔧 发送工具调用 END 事件:', { toolEventId, success: toolResult.success, durationMs: toolFinishedAt - toolStartedAt });
          
          this.emitToolCall({
            id: toolEventId,
            status: 'end',
            tool_name: actionDecision.toolName!,
            args: actionDecision.toolInput,
            result: toolResult,
            success: toolResult.success,
            startedAt: toolStartedAt,
            finishedAt: toolFinishedAt,
            durationMs: toolFinishedAt - toolStartedAt,
            iteration
          }, sessionId, conversationId, toolEventId, onStream);
          
          // 4️⃣ 发送观察事件（独立的 normal_event）
          await this.generateObservation(toolResult, actionDecision.toolName!, onStream, conversationId, sessionId, iteration);
          
          // 5️⃣ 标记当前步骤完成，推进到下一步
          if (toolResult.success) {
            this.markCurrentStepDone(`✅ 已使用 ${actionDecision.toolName}`);
            this.emitPlanUpdate(sessionId || 'default', conversationId || 'default', onStream);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        this.emitNormal({ content: `❌ 错误：${errorMessage}` }, sessionId, conversationId, `error_${iteration}`, onStream);
        throw new Error(`ReAct execution failed: ${errorMessage}`);
      }
    }

    // 如果达到最大迭代次数，生成最终答案
    const finalAnswer = await this.generateFinalAnswer(context, onStream, conversationId, sessionId);
    return finalAnswer;
  }

  /**
   * 生成初始计划（仅用于演示，可替换为真实 Planner）
   */
  private async generatePlanIfNeeded(
    context: AgentContext,
    onStream?: (event: StreamEvent) => void,
    conversationId?: string,
    sessionId?: string
  ): Promise<void> {
    if (this.planList && this.planList.length > 0) return;

    // 让 LLM 输出一个 JSON 数组的步骤计划，尽量结构化，失败则使用兜底
    const sys = this.buildSystemPrompt();
    const history = this.buildConversationHistory(context);
    const messages = [
      new SystemMessage(sys),
      ...history,
      new HumanMessage(prompt.createPlannerPrompt()),
    ];

    try {
      const resp = await this.llm.invoke(messages);
      const txt = (resp.content as string).trim();
      let plan: Array<{ title: string }> = [];
      try {
        // 尝试提取 JSON 段落
        const jsonMatch = txt.match(/\[[\s\S]*\]/);
        const jsonStr = jsonMatch ? jsonMatch[0] : txt;
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
          plan = parsed
            .map((p) => (typeof p === 'string' ? { title: p } : p))
            .filter((p) => p && typeof p.title === 'string' && p.title.trim().length > 0);
        }
      } catch {
        // 忽略解析错误，走兜底
      }
      if (!plan || plan.length === 0) {
        plan = [
          { title: '分析问题与制定计划' },
          { title: '执行必要的工具动作获取信息' },
          { title: '整理观察并撰写答案' },
        ];
      }
      this.planList = plan.map((p, i) => ({
        id: `plan_${i + 1}`,
        title: p.title,
        status: 'pending' as TaskStatus,
      }));
    } catch {
      // LLM 调用异常兜底
      this.planList = [
        { id: 'plan_1', title: '分析问题与制定计划', status: 'pending' as TaskStatus },
        { id: 'plan_2', title: '执行必要的工具动作获取信息', status: 'pending' as TaskStatus },
        { id: 'plan_3', title: '整理观察并撰写答案', status: 'pending' as TaskStatus },
      ];
    }

    // // 推送任务规划卡片
    // const eventId = this.genId('plan_init');
    // this.emitTaskPlan(
    //   { step: this.planList }, 
    //   sessionId || 'default', 
    //   conversationId || 'default', 
    //   eventId, 
    //   onStream
    // );
  }
  
  private async generatePreActionTip(
    input: string,
    conversationId: string,
    sessionId: string,
    onStream?: (event: StreamEvent) => void,
  ): Promise<string> { 
    const preActionprompt = prompt.createPreActionPrompt(input);
    const response = await this.llm.stream([new SystemMessage(preActionprompt), new HumanMessage(input)]);
    const preActionEventId = this.genId('pre_action'); 
    let preActionTip = ''
    for await (const chunk of response) {
      preActionTip += chunk.content;
      this.emitNormal({
        content: chunk.content as string,
        stream:true
      }, sessionId, conversationId, preActionEventId, onStream);
    }
    return preActionTip;
  }

  /**
   * 生成思考步骤（作为独立的 normal_event）
   */
  private async generateThought(
    context: AgentContext, 
    onStream?: (event: StreamEvent) => void,
    conversationId?: string,
    sessionId?: string
  ): Promise<string> {
    // 1) 确保本轮共享的计划已生成
    await this.generatePlanIfNeeded(context, onStream, conversationId, sessionId);
    // 2) 如果当前没有进行中的步骤，则推进一个 pending 为 doing
    const hasDoing = this.planList.some((p) => p.status === 'doing');
    if (!hasDoing) {
      this.markNextPendingDoing('开始本步骤推理');
      this.emitPlanUpdate(sessionId || 'default', conversationId || 'default', onStream);
    }

    const currentStep =
      this.planList.find((p) => p.status === 'doing') ||
      this.planList.find((p) => p.status === 'pending');

    const systemPrompt = this.buildSystemPrompt();
    const conversationHistory = this.buildConversationHistory(context);

    const messages = [
      new SystemMessage(systemPrompt),
      new SystemMessage(`Current plan step: ${currentStep ? currentStep.title : 'General reasoning'}
Your task now: reason specifically for this step, think step-by-step, and determine the next logical action for THIS step.`),
      ...conversationHistory,
      new HumanMessage(`
        Based on the conversation so far, what should I think about next?
        
        CRITICAL REQUIREMENTS:
        1. Output ONLY 1-2 sentences (maximum 50 Chinese characters)
        2. State ONLY what you're thinking about RIGHT NOW
        3. NO explanations, NO details, NO reasoning process
        4. Just the current thought, nothing more
        
        ✅ Good examples:
        "需要查询李白的信息"
        "分析用户问题的关键要素"
        "准备使用搜索工具"
        
        ❌ Bad examples (TOO LONG, avoid):
        "首先我需要理解用户的问题，用户想要了解..."
        "让我来分析一下这个问题的各个方面..."
      `)
    ];

    const streamEventId = `thought_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    // 如果启用了流式输出且有回调函数
    if (this.config.streamOutput && onStream) {
      // 流式模式
      const stream = await this.llm.stream(messages);
      let fullContent = '';
      
      for await (const chunk of stream) {
        const content = chunk.content as string;
        if (content) {
          fullContent += content;
          this.emitNormal({ content, stream: true }, sessionId || 'default', conversationId || 'default', streamEventId, onStream);
        }
      }
      
      this.emitNormal({ content: '', stream: true, done: true }, sessionId || 'default', conversationId || 'default', streamEventId, onStream);
      return fullContent;
    } else {
      // 非流式模式
      const response = await this.llm.invoke(messages);
      const content = response.content as string;
      
      if (onStream) {
        this.emitNormal({ content }, sessionId || 'default', conversationId || 'default', streamEventId, onStream);
      }
      
      return content;
    }
  }

  /**
   * 决定下一步动作（作为独立的 normal_event）
   */
  private async decideAction(
    context: AgentContext,
    onStream?: (event: StreamEvent) => void,
    conversationId?: string,
    sessionId?: string
  ): Promise<{
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
        1. If you need to use a tool, respond EXACTLY in this format:
        Action: [tool_name]
        Input: [tool_input_as_json]
        
        2. If you have enough information to provide a final answer, respond with:
        Final Answer: [your_complete_answer]
        
        IMPORTANT: 
        - Do NOT add extra explanation
        - Do NOT repeat the thought process
        - ONLY output the Action/Input OR Final Answer
        - Keep it SHORT and DIRECT
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
            const inputStr = inputMatch[1].trim();
            // 尝试提取 JSON 部分
            const jsonMatch = inputStr.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              toolInput = JSON.parse(jsonMatch[0]);
            } else {
              toolInput = JSON.parse(inputStr);
            }
          } catch {
            // 如果JSON解析失败，使用原始字符串
            toolInput = { input: inputMatch[1].trim() };
          }
        }

        // 发送行动决策事件（独立的 normal_event）
        const actionEventId = `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const actionDescription = this.formatActionDescription(toolName, toolInput);
        
        if (onStream) {
          this.emitNormal({ 
            content: actionDescription
          }, sessionId || 'default', conversationId || 'default', actionEventId, onStream);
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
   * 格式化行动描述
   */
  private formatActionDescription(toolName: string, toolInput: any): string {
    const inputStr = typeof toolInput === 'object' 
      ? Object.entries(toolInput).map(([k, v]) => `${k}: ${v}`).join(', ')
      : String(toolInput);
    return `🎯 准备执行工具: ${toolName}\n参数: ${inputStr}`;
  }

  /**
   * 生成观察结果（作为独立的 normal_event）
   */
  private async generateObservation(
    toolResult: any,
    toolName: string,
    onStream?: (event: StreamEvent) => void,
    conversationId?: string,
    sessionId?: string,
    iteration?: number
  ): Promise<void> {
    const observationEventId = `observation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    let observationContent = '';
    if (toolResult.success) {
      // 简洁展示成功结果
      const resultPreview = this.formatResultPreview(toolResult.result);
      observationContent = `✅ 工具执行成功\n结果: ${resultPreview}`;
    } else {
      observationContent = `❌ 工具执行失败\n错误: ${toolResult.error}`;
    }
    
    if (onStream) {
      this.emitNormal({ 
        content: observationContent
      }, sessionId || 'default', conversationId || 'default', observationEventId, onStream);
    }
  }

  /**
   * 格式化结果预览（限制长度）
   */
  private formatResultPreview(result: any): string {
    if (!result) return '(空)';
    
    const resultStr = typeof result === 'string' 
      ? result 
      : JSON.stringify(result);
    
    // 限制显示长度
    if (resultStr.length > 100) {
      return resultStr.slice(0, 100) + '...';
    }
    return resultStr;
  }

  /**
   * 生成最终答案
   */
  private async generateFinalAnswer(
    context: AgentContext, 
    onStream?: (event: StreamEvent) => void,
    conversationId?: string,
    sessionId?: string
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
      // 为整个流式输出使用统一的 ID，确保前端能正确聚合
      const streamEventId = `final_answer_${conversationId || Date.now()}`;
      
      for await (const chunk of stream) {
        const content = chunk.content as string;
        if (content) {
          fullContent += content;
          // 所有流式片段使用相同的 ID
          this.emitNormal({ content, stream: true }, sessionId || 'default', conversationId || 'default', streamEventId, onStream);
        }
      }
      
      // 流式模式下，发送最终答案完成事件（使用相同的 ID，标记 done）
      this.emitNormal({ content: '', stream: true, done: true }, sessionId || 'default', conversationId || 'default', streamEventId, onStream);
      return fullContent;
    } else {
      // 非流式模式
      const response = await this.llm.invoke(messages);
      const content = response.content as string;
      
      // 发送完整的最终答案
      if (onStream) {
        this.emitNormal({ content }, sessionId || 'default', conversationId || 'default', `final_full_${Date.now()}`, onStream);
      }
      
      return content;
    }
  }

  /**
   * 构建系统提示
   */
  private buildSystemPrompt(): string {
    // TODO: 语言指令
    const languageInstructions = prompt.createLanguagePrompt();
    return prompt.createSystemPrompt(languageInstructions);
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
   * 发送底层事件
   */
  private emitStreamEvent(
    sessionId: string,
    conversationId: string,
    event: ConversationEvent,
    onStream?: (event: StreamEvent) => void
  ): void {
    if (onStream) {
      const streamEvent: StreamEvent = {
        sessionId,
        conversationId,
        event,
        timestamp: Date.now()
      };
      this.streamManager.emitStreamEvent(streamEvent);
      onStream(streamEvent);
    }
  }

  /**
   * 发送普通文本事件
   */
  private emitNormal(
    payload: { content: string; stream?: boolean; done?: boolean },
    sessionId: string,
    conversationId: string,
    eventId: string,
    onStream?: (e: StreamEvent) => void
  ): void {
    const event: NormalEventData = {
      id: eventId,
      role: 'assistant',
      type: 'normal_event',
      content: payload.content,
      stream: payload.stream,
      done: payload.done
    };
    this.emitStreamEvent(sessionId, conversationId, event, onStream);
  }

  /**
   * 发送任务计划事件
   */
  private emitTaskPlan(
    data: { step: TaskStep[] },
    sessionId: string,
    conversationId: string,
    eventId: string,
    onStream?: (e: StreamEvent) => void
  ): void {
    const event: TaskPlanEventData = {
      id: eventId,
      role: 'assistant',
      type: 'task_plan_event',
      data
    };
    this.emitStreamEvent(sessionId, conversationId, event, onStream);
  }

  /**
   * 发送工具调用事件
   */
  private emitToolCall(
    data: {
      id?: string;
      status?: 'start' | 'end';
      tool_name: string;
      args: any;
      result?: any;
      success?: boolean;
      startedAt?: number;
      finishedAt?: number;
      durationMs?: number;
      iteration?: number;
    },
    sessionId: string,
    conversationId: string,
    eventId: string,
    onStream?: (e: StreamEvent) => void
  ): void {
    const event: ToolCallEventData = {
      id: eventId,
      role: 'assistant',
      type: 'tool_call_event',
      data
    };
    
    console.log('📤 emitToolCall 调用:', { eventId, status: data.status, tool: data.tool_name });
    console.log('📤 完整事件对象:', JSON.stringify(event, null, 2));
    
    this.emitStreamEvent(sessionId, conversationId, event, onStream);
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

