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
    this.emit('task_plan',
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
      this.emit('normal', {
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
      
      if (this.config.autoPlanOnStart) {
        await this.generatePlan(context, options?.onStream, conversationId, sessionId);
      }
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
        const reactResult = await this.reasonAndAct(context, onStream, conversationId, sessionId, iteration + 1);
        
        // 记录思考步骤
        context.steps.push({
          type: 'thought',
          content: reactResult.thought
        });

        if (reactResult.type === 'final_answer') {
          // 优先完成当前进行中的步骤
          let changed = this.markCurrentStepDone('✅ 已完成');
          
          // 如仍存在未完成的计划（例如“撰写最终报告”），仅在需要时推进到“生成最终答案”步骤
          const hasPending = this.planList.some(p => p.status === 'pending');
          if (hasPending) {
            const advanced = this.markNextPendingDoing('📝 正在生成最终答案');
            const doneNow = this.markCurrentStepDone('✅ 已生成最终答案');
            changed = changed || advanced || doneNow;
          }

          if (changed) {
            // 强制推送一次计划更新，避免快照去重导致 UI 未刷新
            this.emitPlanUpdate(sessionId || 'default', conversationId || 'default', onStream, true);
          }
          
          // 使用流式生成最终答案
          if (this.config.autoGenerateFinalAnswer) {
            const finalAnswer = await this.generateFinalAnswer(context, onStream, conversationId, sessionId);
            return { finalAnswer, isPaused: false };
          }
          return { finalAnswer: reactResult.content || '', isPaused: false };
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
            this.emit('waiting_input', {
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
          
          this.emit('tool_call', {
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
          
          this.emit('tool_call', {
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
            let hasChange = this.markCurrentStepDone(`✅ 已使用 ${reactResult.toolName}`);
            // 通用规划结果接入：任何工具若返回 tasks 或 plan.steps，则更新计划
            const tasks = (toolResult.result?.tasks as any[]) || (toolResult.result?.plan?.steps as any[]);
            if (Array.isArray(tasks) && tasks.length > 0) {
              try {
                const steps = tasks.map((s: any, i: number) => ({ id: s.id || `plan_${i+1}`, title: s.title, status: 'pending' as TaskStatus, note: s.description }));
                this.planList = steps;
                hasChange = true;
              } catch {}
            }
            // 通用计划更新协议：工具可返回 planUpdate 指示计划状态更新
            const planUpdate = toolResult.result?.planUpdate;
            if (planUpdate) {
              const before = JSON.stringify(this.planList);
              const completeIds: string[] = planUpdate.completeIds || [];
              const completeTitles: string[] = planUpdate.completeTitles || [];
              const completeAll: boolean = !!planUpdate.completeAll;
              if (completeIds.length) {
                this.planList = this.planList.map(p => completeIds.includes(p.id) ? { ...p, status: 'done', note: p.note } : p);
              }
              if (completeTitles.length) {
                this.planList = this.planList.map(p => (
                  completeTitles.some(t => new RegExp(t, 'i').test(p.title)) ? { ...p, status: 'done', note: p.note } : p
                ));
              }
              if (completeAll) {
                this.planList = this.planList.map(p => ({ ...p, status: 'done' as TaskStatus }));
              }
              hasChange = hasChange || before !== JSON.stringify(this.planList);
            }
            if (hasChange) {
              this.emitPlanUpdate(sessionId || 'default', conversationId || 'default', onStream, true);
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
            this.emit('waiting_input', {
              message: '当前步骤已完成，请输入继续执行或提供新的指令...',
              reason: '人机协作模式 - 每步后等待确认'
            }, sessionId, conversationId, this.genId('waiting'), onStream);
            
            console.log('⏸️ 人机协作模式：已暂停，等待用户输入');
            return { finalAnswer: '', isPaused: true };
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        this.emit('normal', { content: `❌ 错误：${errorMessage}` }, sessionId, conversationId, `error_${iteration}`, onStream);
        throw new Error(`ReAct execution failed: ${errorMessage}`);
      }
    }

    // 如果达到最大迭代次数，生成最终答案
    const finalAnswer = await this.generateFinalAnswer(context, onStream, conversationId, sessionId);
    return { finalAnswer, isPaused: false };
  }

  /**
   * 将所有剩余的 pending 步骤标记为 done
   */
  private markAllPendingDone(note?: string): void {
    this.planList = this.planList.map(p => (
      p.status === 'pending' ? { ...p, status: 'done', note: note || p.note } : p
    ));
  }

  /**
   * 生成任务计划（使用 tool call 直接返回结构化 JSON）
   */
  private async generatePlan(
    context: AgentContext,
    onStream?: (event: StreamEvent) => void,
    conversationId?: string,
    sessionId?: string
  ): Promise<void> {
    console.log('🎯 开始生成任务计划...');

    const planToolSchema = {
      name: 'create_task_plan',
      description: '创建任务执行计划',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: '任务步骤列表',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: '任务步骤标题' }
              },
              required: ['title']
            }
          }
        },
        required: ['tasks']
      }
    };

    try {
      // 使用 bindTools 绑定工具
      const llmWithTools = this.llm.bind({
        tools: [{ type: 'function', function: planToolSchema }],
        tool_choice: { type: 'function', function: { name: 'create_task_plan' } }
      } as any);

      const response = await llmWithTools.invoke([
        new SystemMessage(prompt.createPlannerPrompt(context.input))
      ]);

      console.log('🎯 任务计划生成结果:', response.content);
      this.planList = JSON.parse(response.content as string).map((task: any, i: number) => ({
          id: `plan_${i + 1}`,
          title: task.title,
          status: 'pending' as TaskStatus
      }));
      console.log('✅ 任务计划生成成功:', this.planList.length, '个步骤');
      return

      // 解析 tool call 结果
      // const toolCalls = (response as any).additional_kwargs?.tool_calls;
      // if (toolCalls?.[0]?.function?.arguments) {
      //   const planData = JSON.parse(toolCalls[0].function.arguments);
      //   const tasks = planData.tasks || [];

      //   this.planList = tasks.map((task: any, i: number) => ({
      //     id: `plan_${i + 1}`,
      //     title: task.title,
      //     status: 'pending' as TaskStatus
      //   }));

      //   console.log('✅ 任务计划生成成功:', this.planList.length, '个步骤');
      //   return;
      // }
    } catch (error) {
      console.warn('⚠️ 任务计划生成失败，使用默认计划:', error);
    }

    // 兜底方案
    this.planList = [
      { id: 'plan_1', title: '分析问题与制定计划', status: 'pending' as TaskStatus },
      { id: 'plan_2', title: '执行必要的工具动作获取信息', status: 'pending' as TaskStatus },
      { id: 'plan_3', title: '整理观察并撰写答案', status: 'pending' as TaskStatus }
    ];
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
      this.emit('normal', {
        content: chunk.content as string,
        stream: true
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
    sessionId?: string,
    iteration?: number
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

    const toolsDescription = this.toolRegistry.getToolsDescription();
    const systemPrompt = this.buildReActPrompt(currentStep,toolsDescription);
    const conversationHistory = this.buildConversationHistory(context);
    
    const messages = [
      new SystemMessage(systemPrompt),
      ...conversationHistory,
      ];

    const response = await this.llm.invoke(messages);
    const content = response.content as string;

    // 解析 ReAct 格式输出
    const parsed = this.parseReActOutput(content);

    // 若仍有未完成步骤且返回 Final Answer，在严格模式下改写为继续思考
    const hasIncompleteSteps = this.planList.some(p => p.status !== 'done');
    if (this.config.strictActionUntilDone && hasIncompleteSteps && parsed.type === 'final_answer') {
      const pendingTitles = this.planList.filter(p => p.status !== 'done').map(p => p.title);
      if (onStream) {
        this.emit('normal', { content: `⚠️ 检测到存在未完成的计划步骤，已阻止提前输出最终答案。待完成步骤：${pendingTitles.join('，')}` }, sessionId || 'default', conversationId || 'default', this.genId('block_final'), onStream);
      }
      return {
        type: 'action',
        thought: parsed.thought,
        toolName: 'continue_thinking',
        toolInput: { reason: 'incomplete_plan', pending: pendingTitles }
      };
    }
    
    // 发送思考事件（简洁版）
    if (parsed.thought && onStream) {
      this.emit('normal', {
        content: `💭[thought] 第${iteration || 1}次迭代 ${parsed.thought}`
      }, sessionId || 'default', conversationId || 'default', this.genId('thought'), onStream);
    }

    // 如果是工具调用，发送一段友好提示
    if (parsed.type === 'action' && parsed.toolName && onStream) {
      const friendlyMessage = this.formatFriendlyToolMessage(parsed.toolName, parsed.toolInput);
      if (friendlyMessage) {
        this.emit('normal', {
          content: `[toolcall：${parsed.toolName}] ｜ ` + friendlyMessage
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
        const rawToolName = actionMatch[1].trim();
        const toolName = rawToolName;
        let toolInput: any = {};
        let rawInputStr: string | null = null;

        if (inputMatch) {
          rawInputStr = inputMatch[1].trim();
          try {
            const jsonMatch = rawInputStr.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              toolInput = JSON.parse(jsonMatch[0]);
            } else {
              toolInput = JSON.parse(rawInputStr);
            }
          } catch (e) {
            toolInput = { input: rawInputStr };
          }
        }

        // 兼容模型错误：将 Final Answer 当作 Action 名称
        if (/^final\s*answer$/i.test(toolName)) {
          const answerText = typeof toolInput === 'string'
            ? toolInput
            : (toolInput?.input ?? rawInputStr ?? '');
          return {
            type: 'final_answer',
            thought,
            content: (answerText || '').toString().trim()
          };
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
   * 构建优化的 ReAct 提示词
   */
  private buildReActPrompt(currentStep?: TaskStep,toolsDescription?: string): string {
    const languageInstructions = prompt.createLanguagePrompt(this.config.language);
    const basePrompt = prompt.createSystemPrompt(languageInstructions, toolsDescription);
    
    if (currentStep) {
      const remaining = this.planList.filter(p => p.status !== 'done').map(p => `- ${p.title}`).join('\n') || '- 无';
      return `${basePrompt}

**当前任务步骤**: ${currentStep.title}
请专注完成当前步骤，并优先使用工具执行所需操作。
在所有计划步骤完成之前，请勿输出 Final Answer；完成当前步骤后再推进到下一步。

剩余步骤:
${remaining}`;
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
      'create_coding_plan': (input) => `✍️ 正在分析需求并输出高层实现计划...`,
      'get_component_list': (input) => `🔍 正在获取可用组件列表...`,
      'search_component_docs': (input) => `🔍 正在获取组件文档...`,
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
      if (toolName === 'generate_code_project' && toolResult.result?.project) {
        const filesCount = Array.isArray(toolResult.result.project.files) ? toolResult.result.project.files.length : 0;
        const summary = toolResult.result.project.summary || '';
        observationContent = `✅ 代码生成完成\n文件数: ${filesCount}\n摘要: ${summary || '(无)'}\n已完成当前“代码生成”阶段，准备推进后续步骤（若有）。`;
      } else {
        const resultPreview = this.formatResultPreview(toolResult.result);
        observationContent = `✅ 工具执行成功\n结果: ${resultPreview}`;
      }
    } else {
      observationContent = `❌ 工具执行失败\n错误: ${toolResult.error}`;
    }
    
    if (onStream) {
      this.emit('normal', {
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
    const languageInstructions = prompt.createLanguagePrompt(this.config.language);
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
          this.emit('normal', { content, stream: true }, sessionId || 'default', conversationId || 'default', streamEventId, onStream);
        }
      }

      // 流式模式下，发送最终答案完成事件（使用相同的 ID，标记 done）
      this.emit('normal', { content: '', stream: true, done: true }, sessionId || 'default', conversationId || 'default', streamEventId, onStream);
      return fullContent;
    } else {
      // 非流式模式
      const response = await this.llm.invoke(messages);
      const content = response.content as string;
      
      // 发送完整的最终答案
      if (onStream) {
        this.emit('normal', { content }, sessionId || 'default', conversationId || 'default', `final_full_${Date.now()}`, onStream);
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

    const planSummary = this.planList.map((p, i) => `${i + 1}. ${p.title} [${p.status}]`).join('\n');
    if (planSummary) {
      messages.push(new AIMessage(`Plan Status:\n${planSummary}`));
    }

    // 只保留最近的 ReAct 步骤（避免上下文过长）
    const recentSteps = context.steps.slice(-6); // 保留最近6步
    
    for (const step of recentSteps) {
      if (step.type === 'thought') {
        messages.push(new AIMessage(`Thought: ${step.content}`));
      } else if (step.type === 'action') {
        messages.push(new AIMessage(`Action: ${step.toolName || 'unknown'}\nInput: ${JSON.stringify(step.toolInput)}`));
      } else if (step.type === 'observation') {
        const observationContent = this.truncateObservation(step.content);
        messages.push(new HumanMessage(`Observation: ${observationContent}`));
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
   * 发送流式事件（统一入口）
   */
  private emit(
    type: 'normal' | 'task_plan' | 'tool_call' | 'waiting_input',
    payload: any,
    sessionId: string,
    conversationId: string,
    eventId: string,
    onStream?: (e: StreamEvent) => void
  ): void {
    if (!onStream) return;

    let event: ConversationEvent;

    switch (type) {
      case 'normal':
        event = {
          id: eventId,
          role: 'assistant',
          type: 'normal_event',
          ...payload
        };
        break;
      case 'task_plan':
        event = {
          id: eventId,
          role: 'assistant',
          type: 'task_plan_event',
          data: payload
        };
        break;
      case 'tool_call':
        event = {
          id: eventId,
          role: 'assistant',
          type: 'tool_call_event',
          data: payload
        };
        break;
      case 'waiting_input':
        event = {
          id: eventId,
          role: 'assistant',
          type: 'waiting_input_event',
          data: payload
        };
        break;
    }

    const streamEvent: StreamEvent = {
      sessionId,
      conversationId,
      event,
      timestamp: Date.now()
    };

    this.streamManager.emitStreamEvent(streamEvent);
    onStream(streamEvent);
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
