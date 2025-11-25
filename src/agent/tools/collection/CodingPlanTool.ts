import { z } from 'zod';
import { ToolDefinition } from '../../types/index.js';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAlibabaTongyi } from '@langchain/community/chat_models/alibaba_tongyi';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { CodingPlanner } from '../../../coderAgent/planner/CodingPlanner.js';

const InputSchema = z.object({
  input: z.string(),
  model: z.string().optional(),
  temperature: z.number().optional()
});

function createLLM(model?: string, temperature?: number): BaseChatModel {
  const name = (model || 'qwen-plus').toLowerCase();
  if (name.includes('qwen') || name.includes('tongyi')) {
    return new ChatAlibabaTongyi({ modelName: model || 'qwen-plus', temperature: temperature ?? 0.3, streaming: false, alibabaApiKey: process.env.DASHSCOPE_API_KEY });
  }
  return new ChatOpenAI({ modelName: model || 'gpt-4o-mini', temperature: temperature ?? 0.3, streaming: false });
}

export const CodingPlanTool: ToolDefinition = {
  name: 'create_coding_plan',
  description: '分析需求并输出高层实现计划（3-5步）',
  parameters: [
    { name: 'input', type: 'string', description: '用户需求文本', required: true, schema: z.string() },
    { name: 'model', type: 'string', description: '可选模型名称', required: false, schema: z.string().optional() },
    { name: 'temperature', type: 'number', description: '可选温度', required: false, schema: z.number().optional() }
  ],
  execute: async (raw: any) => {
    const { input, model, temperature } = InputSchema.parse(raw);
    const llm = createLLM(model, temperature);
    const planner = new CodingPlanner(llm);
    const plan = await planner.createPlan(input);
    return { plan };
  }
};

