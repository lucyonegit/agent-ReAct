import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAlibabaTongyi } from '@langchain/community/chat_models/alibaba_tongyi';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AgentConfig, StreamEvent, TaskStep, TaskStatus, ToolDefinition } from '../../agent/types/index.js';
import { StreamManager } from '../../agent/core/stream/StreamManager.js';
import { CODING_AGENT_PROMPTS } from '../config/prompt.js';
import { CodingPlanner } from '../planner/CodingPlanner.js';
import { BDDDecomposer } from '../bdd/BDDDecomposer.js';
import { CodeGenerator } from '../generator/CodeGenerator.js';
import { Project } from '../types.js';
import { ReActAgent } from '../../agent/index.js';
import { z } from 'zod';

export class CodingAgent {
    private llm: BaseChatModel;
    private config: AgentConfig;
    private streamManager: StreamManager;

    private planner: CodingPlanner;
    private bddDecomposer: BDDDecomposer;
    private codeGenerator: CodeGenerator;

    constructor(config: AgentConfig) {
        this.config = config;
        this.llm = this.createLLM();
        this.streamManager = new StreamManager();

        // Initialize sub-components
        this.planner = new CodingPlanner(this.llm);
        this.bddDecomposer = new BDDDecomposer(this.llm);
        this.codeGenerator = new CodeGenerator(this.llm);
    }

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

    private emit(eventType: string, data: any, sessionId: string, conversationId: string, eventId: string, onStream?: (e: StreamEvent) => void) {
        if (onStream) {
            const conversationEvent: any = {
                id: eventId,
                role: 'assistant',
                type: 'normal_event',
                content: data.content || JSON.stringify(data),
                stream: data.stream,
                done: data.done
            };

            onStream({
                sessionId,
                conversationId,
                event: conversationEvent,
                timestamp: Date.now()
            });
        }
    }

    private genId(prefix: string): string {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    public async run(
        input: string,
        options?: {
            sessionId?: string;
            conversationId?: string;
            onStream?: (event: StreamEvent) => void;
        }
    ): Promise<{ finalAnswer: Project }> {
        const onStream = options?.onStream;
        const react = new ReActAgent({
            model: this.config.model,
            temperature: this.config.temperature,
            streamOutput: true,
            language: this.config.language,
            maxTokens: this.config.maxTokens,
            maxIterations: this.config.maxIterations,
            pauseAfterEachStep: false,
            autoPlanOnStart: false
        });

        let finalProject: Project | null = null;

        const createPlanTool: ToolDefinition = {
            name: 'create_coding_plan',
            description: '高优先级：在开始任何实现之前，首先调用此工具以创建简洁的步骤计划（3-5步）。当用户需求是页面/组件/交互开发时，务必先执行本工具。关键词: planner, 计划, planning。',
            parameters: [
                { name: 'input', type: 'string', description: '用户需求', required: true, schema: z.string() }
            ],
            execute: async (toolInput: any) => {
                const plan = await this.planner.createPlan(toolInput.input || input);
                const steps: TaskStep[] = plan.steps.map(s => ({ id: s.id, title: s.title, status: 'pending' as TaskStatus, note: s.description }));
                if (onStream) {
                    onStream({ sessionId: options?.sessionId || 'default', conversationId: options?.conversationId || 'default', event: { id: this.genId('task_plan'), role: 'assistant', type: 'task_plan_event', data: { step: steps } }, timestamp: Date.now() });
                }
                return { plan };
            }
        };

        const bddTool: ToolDefinition = {
            name: 'decompose_bdd',
            description: '将需求拆解为按 Feature 分组的 BDD（JSON 数组，含 scenarios）',
            parameters: [
                { name: 'requirement', type: 'string', description: '需求文本', required: true, schema: z.string() }
            ],
            execute: async (toolInput: any) => {
                const features = await this.bddDecomposer.decompose(toolInput.requirement || input);
                if (onStream) {
                    onStream({ sessionId: options?.sessionId || 'default', conversationId: options?.conversationId || 'default', event: { id: this.genId('bdd_event'), role: 'assistant', type: 'bdd_event', data: { features } }, timestamp: Date.now() });
                }
                return { features };
            }
        };

        const generateTool: ToolDefinition = {
            name: 'generate_code_project',
            description: '根据BDD与内部组件生成完整前端项目结构',
            parameters: [
                { name: 'bdd', type: 'string', description: 'BDD场景JSON字符串', required: true, schema: z.string() }
            ],
            execute: async (toolInput: any) => {
                const project = await this.codeGenerator.generate(this.config, toolInput.bdd, {
                    onThought: (content) => {
                        if (onStream) {
                            const id = this.genId('react_piece');
                            onStream({ sessionId: options?.sessionId || 'default', conversationId: options?.conversationId || 'default', event: { id, role: 'assistant', type: 'normal_event', content }, timestamp: Date.now() });
                        }
                    },
                    onToolCall: (payload) => {
                        if (onStream) {
                            const id = payload.id || this.genId('tool_call');
                            onStream({
                                sessionId: options?.sessionId || 'default',
                                conversationId: options?.conversationId || 'default',
                                event: {
                                    id,
                                    role: 'assistant',
                                    type: 'tool_call_event',
                                    data: {
                                        tool_name: payload.tool_name,
                                        status: payload.status,
                                        args: payload.args,
                                        result: payload.result,
                                        success: payload.success,
                                        startedAt: payload.startedAt,
                                        finishedAt: payload.finishedAt,
                                        durationMs: payload.durationMs
                                    }
                                }
                            , timestamp: Date.now() });
                        }
                    },
                    onRagUsed: (data) => {
                        if (onStream) {
                            onStream({ sessionId: options?.sessionId || 'default', conversationId: options?.conversationId || 'default', event: { id: this.genId('rag_used'), role: 'assistant', type: 'rag_used_event', data }, timestamp: Date.now() });
                        }
                    },
                    onRagSources: (sources) => {
                        if (onStream && sources && sources.length > 0) {
                            onStream({ sessionId: options?.sessionId || 'default', conversationId: options?.conversationId || 'default', event: { id: this.genId('rag_event'), role: 'assistant', type: 'rag_event', data: { sources } }, timestamp: Date.now() });
                        }
                    },
                    onRagDoc: (payload) => {
                        if (onStream) {
                            onStream({ sessionId: options?.sessionId || 'default', conversationId: options?.conversationId || 'default', event: { id: this.genId('rag_doc'), role: 'assistant', type: 'rag_doc_event', data: payload }, timestamp: Date.now() });
                        }
                    },
                    onScenarioMatches: (matches) => {
                        if (onStream && matches && matches.length > 0) {
                            onStream({ sessionId: options?.sessionId || 'default', conversationId: options?.conversationId || 'default', event: { id: this.genId('scenario_match'), role: 'assistant', type: 'scenario_match_event', data: { matches } }, timestamp: Date.now() });
                        }
                    },
                    onArchitectLog: (message) => {
                        if (onStream) {
                            onStream({ sessionId: options?.sessionId || 'default', conversationId: options?.conversationId || 'default', event: { id: this.genId('architect_log'), role: 'assistant', type: 'architect_event', data: { message } }, timestamp: Date.now() });
                        }
                    },
                    onArchitecture: (architecture) => {
                        if (onStream) {
                            onStream({ sessionId: options?.sessionId || 'default', conversationId: options?.conversationId || 'default', event: { id: this.genId('architecture'), role: 'assistant', type: 'architecture_event', data: { architecture } }, timestamp: Date.now() });
                        }
                    },
                    onArchitectStream: (evt) => {
                        onStream?.(evt);
                    }
                });
                finalProject = project;
                return { project, planUpdate: { completeIds: ['step_3'], completeTitles: ['代码生成','code\s*gen'] } };
            }
        };

        react.getToolRegistry().registerTools([createPlanTool, bddTool, generateTool]);

        const forwardOnStream = (evt: StreamEvent) => {
            const e: any = evt.event;
            if (e && e.type === 'tool_call_event' && e.data?.status === 'end') {
                const toolName = e.data.tool_name;
                const result = e.data.result;
                if (toolName === 'create_coding_plan' && result?.plan) {
                    const steps: TaskStep[] = result.plan.steps.map((s: any) => ({ id: s.id, title: s.title, status: 'pending', note: s.description }));
                    onStream?.({ sessionId: evt.sessionId, conversationId: evt.conversationId, event: { id: this.genId('task_plan'), role: 'assistant', type: 'task_plan_event', data: { step: steps } }, timestamp: Date.now() });
                }
                if (toolName === 'decompose_bdd' && (result?.features || result?.scenarios)) {
                    const features = result?.features ?? [
                        {
                            feature_id: 'feature_1',
                            feature_title: 'General',
                            description: '',
                            scenarios: result?.scenarios || []
                        }
                    ];
                    onStream?.({ sessionId: evt.sessionId, conversationId: evt.conversationId, event: { id: this.genId('bdd_event'), role: 'assistant', type: 'bdd_event', data: { features } }, timestamp: Date.now() });
                }
                if (toolName === 'generate_code_project' && result?.project) {
                    const ragSources = this.codeGenerator.getRagSources();
                    if (ragSources && ragSources.length > 0) {
                        onStream?.({ sessionId: evt.sessionId, conversationId: evt.conversationId, event: { id: this.genId('rag_event'), role: 'assistant', type: 'rag_event', data: { sources: ragSources } }, timestamp: Date.now() });
                    }
                }
            }
            onStream?.(evt);
        };

        await react.runWithSession(input, { sessionId: options?.sessionId, conversationId: options?.conversationId, onStream: forwardOnStream });

        if (!finalProject) {
            finalProject = { files: [], summary: 'No project generated' };
        }
        return { finalAnswer: finalProject };
    }

    private planList: TaskStep[] = [];

    private markNextPendingDoing(note?: string): boolean {
        const item = this.planList.find(p => p.status === 'pending');
        if (item) {
            item.status = 'doing' as TaskStatus;
            if (note) item.note = note;
            return true;
        }
        return false;
    }

    private markCurrentStepDone(note?: string): boolean {
        const item = this.planList.find(p => p.status === 'doing');
        if (item) {
            item.status = 'done' as TaskStatus;
            if (note) item.note = note;
            return true;
        }
        return false;
    }

    private emitPlan(sessionId: string, conversationId: string, onStream?: (event: StreamEvent) => void): void {
        if (!onStream) return;
        onStream({
            sessionId,
            conversationId,
            event: {
                id: this.genId('task_plan'),
                role: 'assistant',
                type: 'task_plan_event',
                data: { step: this.planList }
            },
            timestamp: Date.now()
        });
    }
}
