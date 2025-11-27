import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { CODING_AGENT_PROMPTS } from '../config/prompt.js';
import { AgentConfig, ReActAgent, ToolDefinition } from '../../agent/index.js';
import type { StreamEvent } from '../../agent/types/index.js';
import z from 'zod';

export class ArchitectGenerator {
    private llm: BaseChatModel;
    private config: AgentConfig

    constructor(llm: BaseChatModel, config: AgentConfig) {
        this.llm = llm;
        this.config = config;
    }

    private createAgent(): ReActAgent {
        const react = new ReActAgent({
            model: this.config.model,
            temperature: this.config.temperature,
            streamOutput: true,
            language: this.config.language,
            maxTokens: this.config.maxTokens,
            maxIterations: this.config.maxIterations,
            pauseAfterEachStep: false,
            autoPlanOnStart: false,
            autoGenerateFinalAnswer: false
        });
        return react;
    }

    async generate(bdd: string, options?: { onStream?: (event: StreamEvent) => void; onLog?: (message: string) => void; }): Promise<string> {
        const createArchitecture = async (toolInput: string) => {
            const sysPrompt = CODING_AGENT_PROMPTS.ARCHITECT_GENERATOR_PROMPT
            const userPrompt = `
                **User Prompt (用户输入)**
                任务：项目架构设计
                请分析以下 BDD 规范，并输出项目架构 JSON 结构。
                **BDD 规范：**
                ${toolInput}
            `
            const messages = [
                new SystemMessage(sysPrompt),
                new HumanMessage(userPrompt)
            ];
            const response = await this.llm.invoke(messages);

            const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
            const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            const jsonStr = match ? match[1] : raw;
            const trimmed = (jsonStr || '').trim();
            try {
                const parsed = JSON.parse(trimmed);
                return JSON.stringify(parsed);
            } catch {
                return trimmed.length > 0 ? trimmed : '[]';
            }
        }

        const isValidJSONTool: ToolDefinition = {
            name: 'is_valid_json',
            description: '检查输入是否为有效 JSON 格式',
            parameters: [
                {
                    name: 'input',
                    type: 'string',
                    description: '要检查的 JSON 字符串',
                    required: true,
                    schema: z.string()
                }
            ],
            execute: async (toolInput: any) => {
                try {
                    JSON.parse(toolInput.input);
                    return { content: 'true' };
                } catch {
                    return { content: 'false' };
                }
            }
        }
        const createPlanTool: ToolDefinition = {
            name: 'create_project_architecture',
            description: '调用此工具以创建项目的代码架构设计。当用户需求是页面/组件/交互开发时，务必先执行本工具。关键词: architect, 架构, architecture。',
            parameters: [
                {
                    name: 'input',
                    type: 'string',
                    description: '用户需求BDD内容',
                    required: true,
                    schema: z.string()
                }
            ],
            execute: async (toolInput: any) => {
                const content = await createArchitecture(toolInput.input);
                return content;
            }
        };
        const agent = this.createAgent();
        agent.getToolRegistry().registerTools([isValidJSONTool, createPlanTool]);
        const prompt = `
        ** 任务描述 **
        根据BDD需求，创建前端项目架构，严格输出 JSON 格式, 不要有任何的描述文本和markdown文本, 必须使用工具验证JSON合法性

        ** BDD需求 **
        ${bdd}
        `;
        options?.onLog?.('ArchitectAgent: 开始生成项目架构');
        const result = await agent.runWithSession(prompt, {
            onStream: (event) => {
                options?.onStream?.(event);
            }
        });
        options?.onLog?.('ArchitectAgent: 完成生成');
        const fa = (result.finalAnswer || '').trim();
        if (fa.length > 0) return fa;
        options?.onLog?.('ArchitectAgent: LLM最终答案为空，切换直接聊天兜底');
        return await createArchitecture(bdd);
    }
}
