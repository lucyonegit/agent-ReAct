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
  ToolCallEventData,
  WaitingInputEventData
} from '../types/index.js';
import { prompt } from './config/prompt';



// 会话状态存储类型
interface SessionState {
  context: AgentContext;
  currentIteration: number;
  sessionId: string;
  conversationId: string;
  isPaused: boolean;
  waitingReason?: string;
}

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
  
  // 记录上次推送的计划快照，用于检测变化
  private lastEmittedPlanSnapshot: string = '';

  // 会话管理
  private currentSessionId: string | null = null;
  
  // 会话状态存储（支持暂停/恢复）
  private sessionStates: Map<string, SessionState> = new Map();
  
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
  private markNextPendingDoing(note?: string): boolean {
    const item = this.planList.find(p => p.status === 'pending');
    if (item) {
      item.status = 'doing';
      if (note) item.note = note;
      return true;  // 返回是否有变化
    }
    return false;
  }

  /**
   * 将当前 doing 项标记为 done
   */
  private markCurrentStepDone(note?: string): boolean {
    const item = this.planList.find(p => p.status === 'doing');
    if (item) {
      item.status = 'done';
      if (note) item.note = note;
      return true;  // 返回是否有变化
    }
    return false;
  }

  /**
   * 生成计划快照用于比较
   */
  private getPlanSnapshot(): string {
    return JSON.stringify(this.planList.map(p => ({
      id: p.id,
      title: p.title,
      status: p.status,
      note: p.note
    })));
  }

  /**
   * 通过流事件推送计划更新（仅在有变化时推送）
   */
  private emitPlanUpdate(
    sessionId: string,
    conversationId: string, 
    onStream?: (e: StreamEvent) => void,
    force: boolean = false  // 强制推送
  ): void {
    const currentSnapshot = this.getPlanSnapshot();
    
    // 检查是否有变化
    if (!force && currentSnapshot === this.lastEmittedPlanSnapshot) {
      console.log('⏭️ 任务计划无变化，跳过推送');
      return;
    }
    
    console.log('📤 推送任务计划更新:', { 
      force, 
      hasChange: currentSnapshot !== this.lastEmittedPlanSnapshot,
      planCount: this.planList.length 
    });
    
    const eventId = this.genId('plan_update');
    this.emitTaskPlan(
      { step: this.planList }, 
      sessionId, 
      conversationId, 
      eventId, 
      onStream
    );
    
    // 更新快照
    this.lastEmittedPlanSnapshot = currentSnapshot;
  }

  /**
   * 对外 API：带 session 的运行
   * 如未传 sessionId，首次自动创建并返回；返回结构包含 sessionId 与 conversationId
   */
  async runWithSession(
    input: string,
    options?: { 
      sessionId?: string; 
      conversationId?: string;  // 支持继续已存在的对话
      onStream?: (event: StreamEvent) => void 
    }
  ): Promise<{ sessionId: string; conversationId: string; finalAnswer: string; isPaused: boolean }> {
    const sessionId = options?.sessionId ?? (this.currentSessionId ?? this.genId('sess'));
    this.currentSessionId = sessionId;
    
    // 检查是否有暂停的会话需要恢复
    const existingState = this.sessionStates.get(sessionId);
    let conversationId: string;
    let context: AgentContext;
    let startIteration: number;
    
    if (existingState && existingState.isPaused && options?.conversationId) {
      // 恢复暂停的会话
      console.log('🔄 恢复暂停的会话:', { sessionId, conversationId: options.conversationId });
      conversationId = options.conversationId;
      context = existingState.context;
      startIteration = existingState.currentIteration;
      
      // 添加用户新输入到上下文
      context.steps.push({
        type: 'observation',
        content: `User provided additional input: ${input}`
      });
      
      // 发送用户输入事件
      this.emitNormal({ 
        content: `💬 用户输入：${input}` 
      }, sessionId, conversationId, this.genId('user_input'), options?.onStream);
      
      // 清除暂停状态
      existingState.isPaused = false;
    } else {
      // 新对话
      conversationId = this.genId('conv');
      context = {
        input,
        steps: [],
        tools: this.toolRegistry.getAllTools(),
        config: this.config
      };
      startIteration = 0;
      
      // 重置计划列表和快照（新对话需要重新规划）
      this.planList = [];
      this.lastEmittedPlanSnapshot = '';
      
      // 生成预处理提示
      await this.generatePreActionTip(input, conversationId, sessionId, options?.onStream);
      
      // 🎯 在对话开始时生成任务计划
      await this.generatePlan(context, options?.onStream, conversationId, sessionId);
    }
    
    // 进入推理循环
    const result = await this.runInternal(
      context, 
      sessionId, 
      conversationId, 
      options?.onStream,
      startIteration
    );
    
    return { 
      sessionId, 
      conversationId, 
      finalAnswer: result.finalAnswer,
      isPaused: result.isPaused
    };
  }

  /**
   * 内部推理循环（带 session/conversation 语义）
   */
  private async runInternal(
    context: AgentContext,
    sessionId: string,
    conversationId: string,
    onStream?: (event: StreamEvent) => void,
    startIteration: number = 0
  ): Promise<{ finalAnswer: string; isPaused: boolean }> {

    for (let iteration = startIteration; iteration < this.config.maxIterations; iteration++) {
      try {
        // 🔄 优化：合并思考与决策为一次 LLM 调用
        const reactResult = await this.reasonAndAct(context, onStream, conversationId, sessionId);
        
        // 记录思考步骤
        context.steps.push({
          type: 'thought',
          content: reactResult.thought
        });

        if (reactResult.type === 'final_answer') {
          // 标记当前步骤为完成
          const hasChange = this.markCurrentStepDone('✅ 已完成');
          if (hasChange) {
            this.emitPlanUpdate(sessionId || 'default', conversationId || 'default', onStream);
          }
          
          // 发送最终答案准备事件
          this.emitNormal({ 
            content: '**准备答案** - 已收集足够信息，正在生成最终答案...' 
          }, sessionId || 'default', conversationId || 'default', `prepare_answer_${iteration}`, onStream);
          
          // 使用流式生成最终答案
          const finalAnswer = await this.generateFinalAnswer(context, onStream, conversationId, sessionId);
          return { finalAnswer, isPaused: false };
        }

        if (reactResult.type === 'action') {
          // 检查是否需要等待用户输入
          if (reactResult.toolName === 'wait_for_user_input') {
            // 保存当前状态
            this.sessionStates.set(sessionId, {
              context,
              currentIteration: iteration + 1,
              sessionId,
              conversationId,
              isPaused: true,
              waitingReason: reactResult.toolInput?.reason || '需要更多信息'
            });
            
            // 发送等待输入事件
            this.emitWaitingInput({
              message: reactResult.toolInput?.message || '请输入更多信息以继续...',
              reason: reactResult.toolInput?.reason
            }, sessionId, conversationId, this.genId('waiting'), onStream);
            
            return { finalAnswer: '', isPaused: true };
          }
          
          // 执行动作
          const actionStep: ReActStep = {
            type: 'action',
            content: `Using tool: ${reactResult.toolName}`,
            toolName: reactResult.toolName,
            toolInput: reactResult.toolInput
          };
          
          context.steps.push(actionStep);
          
          // 3️⃣ 发送工具调用事件（tool_call_event）
          const toolEventId = `tool_${iteration}_${conversationId || Date.now()}`;
          const toolStartedAt = Date.now();
          
          console.log('🔧 发送工具调用 START 事件:', { toolEventId, tool: reactResult.toolName });
          
          this.emitToolCall({
            id: toolEventId,
            status: 'start',
            tool_name: reactResult.toolName!,
            args: reactResult.toolInput,
            iteration,
            startedAt: toolStartedAt
          }, sessionId, conversationId, toolEventId, onStream);
          
          const toolResult = await this.toolRegistry.executeTool(
            reactResult.toolName!,
            reactResult.toolInput
          );

          // 记录观察结果
          const observation = toolResult.success 
            ? `Tool executed successfully. Result: ${JSON.stringify(toolResult.result)}`
            : `Tool execution failed. Error: ${toolResult.error}`;

          const observationStep: ReActStep = {
            type: 'observation',
            content: observation,
            toolName: reactResult.toolName,
            toolOutput: toolResult
          };

          context.steps.push(observationStep);
          
          // 工具调用结束事件
          const toolFinishedAt = Date.now();
          
          console.log('🔧 发送工具调用 END 事件:', { toolEventId, success: toolResult.success, durationMs: toolFinishedAt - toolStartedAt });
          
          this.emitToolCall({
            id: toolEventId,
            status: 'end',
            tool_name: reactResult.toolName!,
            args: reactResult.toolInput,
            result: toolResult,
            success: toolResult.success,
            startedAt: toolStartedAt,
            finishedAt: toolFinishedAt,
            durationMs: toolFinishedAt - toolStartedAt,
            iteration
          }, sessionId, conversationId, toolEventId, onStream);
          
          // 4️⃣ 发送观察事件（独立的 normal_event）
          await this.generateObservation(toolResult, reactResult.toolName!, onStream, conversationId, sessionId, iteration);
          
          // 5️⃣ 标记当前步骤完成，推进到下一步
          if (toolResult.success) {
            const hasChange = this.markCurrentStepDone(`✅ 已使用 ${reactResult.toolName}`);
            if (hasChange) {
              this.emitPlanUpdate(sessionId || 'default', conversationId || 'default', onStream);
            }
          }
          
          // 6️⃣ 检查是否需要在每步后暂停
          if (this.config.pauseAfterEachStep) {
            // 保存当前状态
            this.sessionStates.set(sessionId, {
              context,
              currentIteration: iteration + 1,
              sessionId,
              conversationId,
              isPaused: true,
              waitingReason: '等待用户确认是否继续'
            });
            
            // 发送等待输入事件
            this.emitWaitingInput({
              message: '当前步骤已完成，请输入继续执行或提供新的指令...',
              reason: '人机协作模式 - 每步后等待确认'
            }, sessionId, conversationId, this.genId('waiting'), onStream);
            
            console.log('⏸️ 人机协作模式：已暂停，等待用户输入');
            return { finalAnswer: '', isPaused: true };
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
    return { finalAnswer, isPaused: false };
  }

  /**
   * 生成任务计划（在对话开始时调用）
   */
  private async generatePlan(
    context: AgentContext,
    onStream?: (event: StreamEvent) => void,
    conversationId?: string,
    sessionId?: string
  ): Promise<void> {
    console.log('🎯 开始生成任务计划...');
    const messages = [
      new SystemMessage(prompt.createPlannerPrompt(context.input)),
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
   * 🔄 优化：合并思考与决策为一次 LLM 调用（符合标准 ReAct 模式）
   * ReAct 循环：Thought → Action → Observation
   */
  private async reasonAndAct(
    context: AgentContext,
    onStream?: (event: StreamEvent) => void,
    conversationId?: string,
    sessionId?: string
  ): Promise<{
    type: 'action' | 'final_answer';
    thought: string;
    content?: string;
    toolName?: string;
    toolInput?: any;
  }> {
    // 推进计划步骤
    const hasDoing = this.planList.some((p) => p.status === 'doing');
    if (!hasDoing) {
      const hasChange = this.markNextPendingDoing('🤔 正在推理');
      if (hasChange) {
        this.emitPlanUpdate(sessionId || 'default', conversationId || 'default', onStream);
      }
    }

    const currentStep =
      this.planList.find((p) => p.status === 'doing') ||
      this.planList.find((p) => p.status === 'pending');

    const systemPrompt = this.buildReActPrompt(currentStep);
    const conversationHistory = this.buildConversationHistory(context);
    const toolsDescription = this.toolRegistry.getToolsDescription();

    const messages = [
      new SystemMessage(systemPrompt),
      ...conversationHistory,
      new HumanMessage(`Follow the ReAct format:

Thought: [Brief reasoning about what to do next - 1-2 sentences]
Action: [tool_name] OR Final Answer: [your answer]
Input: [tool_input_json] (only if Action is used)

Available tools:
${toolsDescription}

Remember: Keep Thought CONCISE. Output ONLY the above format.`)
    ];

    const response = await this.llm.invoke(messages);
    const content = response.content as string;

    // 解析 ReAct 格式输出
    const parsed = this.parseReActOutput(content);
    
    // 发送思考事件（简洁版）
    if (parsed.thought && onStream) {
      this.emitNormal({ 
        content: `💭 ${parsed.thought}` 
      }, sessionId || 'default', conversationId || 'default', this.genId('thought'), onStream);
    }

    // 如果是工具调用，发送友好提示
    if (parsed.type === 'action' && parsed.toolName && onStream) {
      const friendlyMessage = this.formatFriendlyToolMessage(parsed.toolName, parsed.toolInput);
      if (friendlyMessage) {
        this.emitNormal({ 
          content: friendlyMessage
        }, sessionId || 'default', conversationId || 'default', this.genId('action'), onStream);
      }
    }

    return parsed;
  }

  /**
   * 🆕 解析 ReAct 格式的 LLM 输出
   */
  private parseReActOutput(content: string): {
    type: 'action' | 'final_answer';
    thought: string;
    content?: string;
    toolName?: string;
    toolInput?: any;
  } {
    // 提取 Thought
    const thoughtMatch = content.match(/Thought:\s*(.+?)(?=\n(?:Action:|Final Answer:)|$)/s);
    const thought = thoughtMatch ? thoughtMatch[1].trim() : '';

    // 检查是否是最终答案
    if (content.includes('Final Answer:')) {
      const finalAnswerMatch = content.match(/Final Answer:\s*(.+)/s);
      const finalAnswer = finalAnswerMatch ? finalAnswerMatch[1].trim() : '';
      return {
        type: 'final_answer',
        thought,
        content: finalAnswer
      };
    }

    // 解析工具调用
    if (content.includes('Action:')) {
      const actionMatch = content.match(/Action:\s*([^\n]+)/);
      const inputMatch = content.match(/Input:\s*(.+)/s);
      
      if (actionMatch) {
        const toolName = actionMatch[1].trim();
        let toolInput: any = {};
        
        if (inputMatch) {
          try {
            const inputStr = inputMatch[1].trim();
            // 更严格的 JSON 提取
            const jsonMatch = inputStr.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              toolInput = JSON.parse(jsonMatch[0]);
            } else {
              // 尝试直接解析
              toolInput = JSON.parse(inputStr);
            }
          } catch (e) {
            console.warn('⚠️ JSON 解析失败，使用原始字符串:', inputMatch[1]);
            toolInput = { input: inputMatch[1].trim() };
          }
        }

        return {
          type: 'action',
          thought,
          toolName,
          toolInput
        };
      }
    }

    // 兜底：如果解析失败，返回思考更多
    console.warn('⚠️ ReAct 输出解析失败，使用思考模式');
    return {
      type: 'action',
      thought: content,
      toolName: 'continue_thinking',
      toolInput: { thought: content }
    };
  }

  /**
   * 🆕 构建优化的 ReAct 提示词
   */
  private buildReActPrompt(currentStep?: TaskStep): string {
    const languageInstructions = prompt.createLanguagePrompt();
    const basePrompt = prompt.createSystemPrompt(languageInstructions);
    
    if (currentStep) {
      return `${basePrompt}

**Current Task Step**: ${currentStep.title}
Focus on completing this step efficiently.`;
    }
    
    return basePrompt;
  }

  /**
   * 格式化友好的工具提示消息
   */
  private formatFriendlyToolMessage(toolName: string, toolInput: any): string {
    // 根据不同工具生成友好的提示信息
    const toolMessages: Record<string, (input: any) => string> = {
      'search': (input) => `🔍 正在搜索：${input.query || input.input || '相关信息'}...`,
      'web_search': (input) => `🌐 正在联网搜索：${input.query || input.input || ''}...`,
      'read_file': (input) => `📖 正在读取文件：${input.file_path || input.path || ''}...`,
      'write_file': (input) => `✍️ 正在写入文件：${input.file_path || input.path || ''}...`,
      'execute_code': (input) => `⚙️ 正在执行代码...`,
      'calculate': (input) => `🧮 正在计算：${input.expression || ''}...`,
      'rag_search': (input) => `📚 正在知识库中查找相关信息...`,
      'wait_for_user_input': (input) => '', // 这个工具不需要额外提示
    };

    // 如果有定制的友好消息，使用它
    if (toolMessages[toolName]) {
      return toolMessages[toolName](toolInput);
    }

    // 默认通用提示
    return `🔧 正在执行操作...`;
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
    const languageInstructions = prompt.createLanguagePrompt();
    const systemPrompt = prompt.createSystemPrompt(languageInstructions);
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
   * 构建对话历史（优化版 - 更简洁）
   */
  private buildConversationHistory(context: AgentContext): (HumanMessage | AIMessage)[] {
    const messages: (HumanMessage | AIMessage)[] = [
      new HumanMessage(`User Question: ${context.input}`)
    ];

    // 只保留最近的 ReAct 步骤（避免上下文过长）
    const recentSteps = context.steps.slice(-6); // 保留最近6步
    
    for (const step of recentSteps) {
      if (step.type === 'thought') {
        messages.push(new AIMessage(`Thought: ${step.content}`));
      } else if (step.type === 'action') {
        messages.push(new AIMessage(`Action: ${step.toolName || 'unknown'}\nInput: ${JSON.stringify(step.toolInput)}`));
      } else if (step.type === 'observation') {
        // 简化观察结果，避免过长
        const observationContent = this.truncateObservation(step.content);
        messages.push(new AIMessage(`Observation: ${observationContent}`));
      }
    }

    return messages;
  }

  /**
   * 截断过长的观察结果
   */
  private truncateObservation(content: string, maxLength: number = 500): string {
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + '... (truncated)';
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
   * 发送等待用户输入事件
   */
  private emitWaitingInput(
    data: { message: string; reason?: string },
    sessionId: string,
    conversationId: string,
    eventId: string,
    onStream?: (e: StreamEvent) => void
  ): void {
    const event: WaitingInputEventData = {
      id: eventId,
      role: 'assistant',
      type: 'waiting_input_event',
      data
    };
    
    console.log('⏸️ 发送等待输入事件:', { eventId, message: data.message });
    
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

